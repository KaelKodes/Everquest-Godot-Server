const { send } = require('../utils');
const State = require('../state');
const { zoneInstances, sessions, authSessions } = State;
const { NPC_TYPES, HAIL_RANGE } = require('../data/npcTypes');
const QuestDialogs = require('../data/npcs/quests');
const QuestManager = require('../questManager');
const FactionSystem = require('./faction');
const GroupManager = require('./groups');
const { GUILD_MASTER_CLASS, getTaughtClassId, CLASSES_MAP } = require('../utils/npcUtils');
const combat = require('../combat');
const ChatSpamGuard = require('./chatSpamGuard');
const CombatSystem = require('./combat');
const OocRegen = require('./oocRegen');

function getDistanceSq(x1, y1, x2, y2) {
  return (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
}

let sendCombatLogFn, processQuestActionsFn, handleHailFn, awardExpFn, sendStatusFn;

function sendCombatLog(session, events) {
  if (sendCombatLogFn) return sendCombatLogFn(session, events);
}
async function processQuestActions(session, target, actions) {
  if (processQuestActionsFn) return await processQuestActionsFn(session, target, actions);
}
function handleHail(session, msg) {
  if (handleHailFn) return handleHailFn(session, msg);
}

const RP_CHAR_THRESHOLD = 60; // Characters needed to trigger a tick check
/** Base RP tick chance when other players are nearby (say range). */
const RP_TICK_CHANCE_SOCIAL = 0.33;
/** Much lower when you are effectively talking to yourself (no other PCs in range). */
const RP_TICK_CHANCE_SOLO = 0.09;

function init(deps) {
  sendCombatLogFn = deps.sendCombatLog;
  processQuestActionsFn = deps.processQuestActions;
  handleHailFn = deps.handleHail;
  awardExpFn = deps.awardExp;
  sendStatusFn = deps.sendStatus;
}

/** Say / group / tell to a student: phrase triggers hired bots to mirror the mentor's combat target. */
function isStudentAssistPhrase(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  return /assist\s+me\b/i.test(s);
}

/**
 * @param {object} mentorSession — player giving the order (must own the bots)
 * @param {string} text — chat line to scan
 */
function tryOrderStudentsAssist(mentorSession, text) {
  if (!mentorSession || !mentorSession.char || !isStudentAssistPhrase(text)) return;
  if (!sendCombatLogFn || !sendStatusFn) return;

  const ct = mentorSession.combatTarget;
  if (!ct) {
    sendCombatLogFn(mentorSession, [{ event: 'MESSAGE', text: 'You have no target.' }]);
    return;
  }

  const isPlayer = !!ct.char;
  if (isPlayer) {
    if (ct.char.id === mentorSession.char.id) return;
    if (!CombatSystem.canInteract(mentorSession, ct, false)) {
      sendCombatLogFn(mentorSession, [{ event: 'MESSAGE', text: 'Your students cannot attack that target.' }]);
      return;
    }
  } else if (ct.type === 'corpse' || (ct.hp != null && ct.hp <= 0)) {
    sendCombatLogFn(mentorSession, [{ event: 'MESSAGE', text: 'Your students cannot attack that target.' }]);
    return;
  } else if (ct.npcType != null && ct.npcType !== NPC_TYPES.MOB) {
    sendCombatLogFn(mentorSession, [{ event: 'MESSAGE', text: 'Your students only assist against valid combat targets.' }]);
    return;
  }

  const z = mentorSession.char.zoneId;
  let n = 0;
  for (const [, s] of sessions) {
    if (!s.isBot || !s.char || s.char.ownerId !== mentorSession.char.id) continue;
    if (s.char.zoneId !== z) continue;
    if (s.char.hp <= 0 || s.char.state === 'dead') continue;

    s.combatTarget = ct;
    if (!s.inCombat) OocRegen.markCombatStarted(s);
    s.inCombat = true;
    s.autoFight = true;
    if (s.char.state === 'medding') s.char.state = 'standing';
    s.attackTimer = 0;
    sendStatusFn(s);
    n++;
  }

  if (n === 0) {
    sendCombatLogFn(mentorSession, [{ event: 'MESSAGE', text: 'You have no students here to assist you.' }]);
  } else {
    const tlabel = isPlayer ? ct.char.name : (ct.name || 'target');
    sendCombatLogFn(mentorSession, [{ event: 'MESSAGE', text: `${n} student(s) assist you against ${tlabel}!` }]);
  }
}

/** Other player characters in the same zone within radius (excluding self). */
function countNearbyOtherPlayers(session, radius) {
  const char = session.char;
  if (!char) return 0;
  let n = 0;
  const r2 = radius * radius;
  for (const [, other] of sessions) {
    if (!other.char || other.char.id === char.id) continue;
    if (other.char.zoneId !== char.zoneId) continue;
    if (getDistanceSq(char.x, char.y, other.char.x, other.char.y) <= r2) n++;
  }
  return n;
}

function rpTickProbability(nearbyOthers) {
  const n = Math.max(0, nearbyOthers | 0);
  if (n <= 0) return RP_TICK_CHANCE_SOLO;
  return Math.min(0.52, RP_TICK_CHANCE_SOCIAL + n * 0.04);
}

function processRPExperience(session, text, opts = {}) {
  if (!text) return;

  const nearby = opts.nearbyPlayerCount != null
    ? Math.max(0, opts.nearbyPlayerCount | 0)
    : countNearbyOtherPlayers(session, 200);
  
  // Initialize character buffer if it doesn't exist
  if (session.rpCharBuffer === undefined) {
    session.rpCharBuffer = 0;
  }
  
  // Accumulate non-whitespace characters
  const charCount = text.replace(/\s+/g, '').length;
  if (charCount === 0) return;
  
  session.rpCharBuffer += charCount;

  // Once they hit the threshold
  if (session.rpCharBuffer >= RP_CHAR_THRESHOLD) {
    // Reset buffer (or you could subtract the threshold if you want rollover)
    session.rpCharBuffer = 0;
    
    const tickChance = rpTickProbability(nearby);
    if (Math.random() <= tickChance) {
      const level = Math.max(1, session.char.level || 1);
      const xpThisLevel = combat.xpForLevel(level + 1) - combat.xpForLevel(level);
      if (xpThisLevel > 0 && awardExpFn) {
        const pct = 0.001 + Math.random() * (0.005 - 0.001);
        const rpExp = Math.max(1, Math.floor(xpThisLevel * pct));
        void awardExpFn(session, rpExp, null, null, { source: 'rp' }).catch((e) => console.error('[CHAT] RP awardExp:', e.message));
        const RP_FLOURISH = [
          'The moment listens back. Something in you loosens into place.',
          'Words and world trade weight for a heartbeat—you are not sure who paid.',
          'For a breath, Norrath feels less like a ledger and more like a story.',
          'You catch yourself believing the scene, not only performing it.',
          'The air remembers kindness when strangers pretend to be kin.',
        ];
        const rare = Math.random() < 0.1;
        const i = Math.abs((session.char.id || 0) + (nearby | 0) * 3) % RP_FLOURISH.length;
        let line = `[color=yellow]${RP_FLOURISH[i]}[/color]`;
        if (rare) {
          line += ' [color=gray](A small truth settles—too subtle to count.)[/color]';
        }
        sendCombatLog(session, [{ event: 'MESSAGE', text: line }]);
      }
    }
  }
}

async function handleSay(session, msg) {
  const char = session.char;
  const text = (msg.text || '').trim();
  if (!text) return;

  if (ChatSpamGuard.isMuted(session)) {
    ChatSpamGuard.onMutedChatAttempt(session, sendCombatLog);
    return;
  }
  const spam = ChatSpamGuard.onPublicMessage(session, text, sendCombatLog);
  if (spam.block) return;

  // Echo the player's speech via CHAT
  send(session.ws, { type: 'CHAT', channel: 'say', sender: char.name, text: text });

  if (!spam.skipRp) {
    processRPExperience(session, text, {
      nearbyPlayerCount: countNearbyOtherPlayers(session, 200),
    });
  }

  tryOrderStudentsAssist(session, text);

  // If we have a targeted NPC, check for keyword responses
  if (session.combatTarget && session.combatTarget.npcType) {
    const target = session.combatTarget;

    // Proximity check
    const distSq = getDistanceSq(char.x, char.y, target.x, target.y);
    if (distSq > HAIL_RANGE * HAIL_RANGE) {
      // Still broadcast to other players even if NPC is too far
      broadcastChat(session, 'say', text, 200);
      return;
    }

    // Process new Dual-Engine Quest Scripts
    const zoneShortName = char.zoneId;

    // Faction check for dialogue
    const standing = FactionSystem.getStanding(char, target);
    if (standing.value < -699) { // Dubious or worse
      return; // NPCs don't talk to enemies
    }

    const eData = { message: text, joined: false, trade: {} };
    const actions = await QuestManager.triggerEvent(zoneShortName, target, char, 'EVENT_SAY', eData);
    let handledByQuest = false;

    if (actions && actions.length > 0) {
      await processQuestActions(session, target, actions);
      handledByQuest = true;
    }

    // Guildmaster / Trainer "Hire" Hook
    if (target.npcType === NPC_TYPES.TRAINER && text.toLowerCase().includes('hire')) {
      // Must be Apprehensive or better (-100+)
      if (standing.value < -100) {
        if (!handledByQuest) {
          sendCombatLog(session, [{ event: 'NPC_SAY', npcName: target.name, text: "You must prove your dedication to our cause before I trust you with a student." }]);
        }
        return;
      }

      // We derive the classes/races this trainer teaches based on their own class/race.
      const taughtClassId = getTaughtClassId(target.eqClass);
      const playerClassId = CLASSES_MAP[char.class] || 1;
      
      let validClasses = taughtClassId ? [taughtClassId] : [playerClassId];
      let validRaces = [target.race || 1];
      let maxLevel = char.level || 1;

      // Special handling for Generic Trainers (Class 63)
      if (target.eqClass === 63) {
        const eqemuDB = require('../eqemu_db');
        const data = await eqemuDB.getCharCreateData(target.race || 1);
        if (data && data.classes && data.classes.length > 0) {
          validClasses = data.classes.map(c => c.classId);
        }
        maxLevel = 1; // Generic trainers only offer level 1 students
      }

      if (!handledByQuest) {
        sendCombatLog(session, [{ event: 'NPC_SAY', npcName: target.name, text: `Ah yes, I have a few eager students I could spare for someone like you, ${char.name}!` }]);
      }
      
      // Send the packet to pop the new "Hire Student" UI
      send(session.ws, {
        type: 'OPEN_HIRE_STUDENT',
        trainerName: target.name,
        validClasses: validClasses,
        validRaces: validRaces,
        playerLevel: maxLevel
      });
      return;
    }

    if (handledByQuest) return;

    // Quest NPCs and merchants with dialog respond to keywords (Legacy Fallback)
    if (target.npcType === NPC_TYPES.QUEST || target.npcType === NPC_TYPES.MERCHANT) {
      const response = QuestDialogs.getKeywordResponse(target.key, text, char);
      if (response) {
        const keywords = QuestDialogs.extractKeywords(response);
        sendCombatLog(session, [{ event: 'NPC_SAY', npcName: target.name, text: response, keywords: keywords }]);
        return;
      }
    }

    // Merchant fallback: 'buy', 'wares', 'shop' re-opens the merchant window
    if (target.npcType === NPC_TYPES.MERCHANT) {
      const lowerText = text.toLowerCase();
      if (lowerText === 'buy' || lowerText === 'wares' || lowerText === 'shop') {
        handleHail(session, msg);
        return;
      }
    }

    // Bind keyword check
    if (target.npcType === NPC_TYPES.BIND && text.toLowerCase() === 'bind') {
      sendCombatLog(session, [{ event: 'MESSAGE', text: `${target.name} begins to cast a spell.` }]);
      sendCombatLog(session, [{ event: 'MESSAGE', text: `You feel your soul bound to this location.` }]);
      const DB = require('../db');
      DB.updateCharacterBind(session.char.id, session.char.zoneId, session.char.x, session.char.y, session.char.z).catch(err => {
        console.error(`[CHAT] Failed to update bind point for ${char.name}:`, err);
      });
      return;
    }
  }

  // Broadcast to other players within say range (200 units)
  broadcastChat(session, 'say', text, 200);
}

// ── Chat Channel Utility ────────────────────────────────────────────
// Broadcasts a CHAT message to players within radius (same zone).
function broadcastChat(session, channel, text, radius) {
  const char = session.char;
  for (const [ws, other] of sessions) {
    if (other.char.id !== char.id && other.char.zoneId === char.zoneId) {
      const pDistSq = getDistanceSq(other.char.x, other.char.y, char.x, char.y);
      if (pDistSq <= radius * radius) {
        send(other.ws, { type: 'CHAT', channel: channel, sender: char.name, text: text });
      }
    }
  }
}

// ── /shout — 3x say radius (600u), local only ───────────────────────
function handleShout(session, msg) {
  const char = session.char;
  const text = (msg.text || '').trim();
  if (!text) return;

  if (ChatSpamGuard.isMuted(session)) {
    ChatSpamGuard.onMutedChatAttempt(session, sendCombatLog);
    return;
  }
  const spam = ChatSpamGuard.onPublicMessage(session, text, sendCombatLog);
  if (spam.block) return;

  send(session.ws, { type: 'CHAT', channel: 'shout', sender: char.name, text: text });
  broadcastChat(session, 'shout', text, 600);
  if (!spam.skipRp) {
    processRPExperience(session, text, {
      nearbyPlayerCount: countNearbyOtherPlayers(session, 600),
    });
  }
}

// ── /ooc — same as say radius (200u), local only ────────────────────
function handleOOC(session, msg) {
  const char = session.char;
  const text = (msg.text || '').trim();
  if (!text) return;

  if (ChatSpamGuard.isMuted(session)) {
    ChatSpamGuard.onMutedChatAttempt(session, sendCombatLog);
    return;
  }
  const spam = ChatSpamGuard.onPublicMessage(session, text, sendCombatLog);
  if (spam.block) return;

  send(session.ws, { type: 'CHAT', channel: 'ooc', sender: char.name, text: text });
  broadcastChat(session, 'ooc', text, 200);
}

// ── /yell — 2x say radius (400u) + guard AI assist ─────────────────
function handleYell(session, msg) {
  const char = session.char;
  const text = (msg.text || '').trim() || 'Help!!';

  if (ChatSpamGuard.isMuted(session)) {
    ChatSpamGuard.onMutedChatAttempt(session, sendCombatLog);
    return;
  }
  const spam = ChatSpamGuard.onPublicMessage(session, text, sendCombatLog);
  if (spam.block) return;

  send(session.ws, { type: 'CHAT', channel: 'yell', sender: char.name, text: text });
  broadcastChat(session, 'yell', text, 400);

  // Guard AI: nearby guards respond to the yell
  const instance = zoneInstances[char.zoneId];
  if (!instance) return;

  for (const mob of instance.liveMobs) {
    if (!mob.alive) continue;
    // Identify guards by key prefix (guard_ or watchman_)
    const isGuard = mob.key && (mob.key.startsWith('guard_') || mob.key.startsWith('watchman_'));
    if (!isGuard) continue;

    const guardDistSq = getDistanceSq(mob.x, mob.y, char.x, char.y);
    if (guardDistSq > 160000) continue; // Guard must hear the yell

    // Check if the player is being attacked by a mob
    // Find mobs that are targeting this player
    for (const attacker of instance.liveMobs) {
      if (!attacker.alive || attacker === mob) continue;
      if (attacker.target && attacker.target === char.name) {
        // Don't help if the attacker IS a guard (guards help each other)
        const attackerIsGuard = attacker.key && (attacker.key.startsWith('guard_') || attacker.key.startsWith('watchman_'));
        if (attackerIsGuard) {
          // Player is fighting guards — guards assist each other, not the player
          continue;
        }
        // Don't help in PvP (attacker is a player session, not a mob)
        if (!attacker.npcType) continue;

        // Guard engages the mob attacking the player
        mob.target = attacker.id || attacker.name;
        mob.inCombat = true;
        sendCombatLog(session, [{ event: 'MESSAGE', text: `${mob.name} shouts, 'I'll protect you, citizen!'` }]);
        break; // Guard only assists against one attacker
      }
    }
  }
}

// ── /whisper — global private message ───────────────────────────────
function handleWhisper(session, msg) {
  const char = session.char;
  const targetName = (msg.target || '').trim();
  const text = (msg.text || '').trim();
  if (!text || !targetName) {
    send(session.ws, { type: 'CHAT', channel: 'system', sender: '', text: 'Usage: /whisper <player> <message>' });
    return;
  }

  // Find target player across all zones
  let targetSession = null;
  for (const [ws, other] of sessions) {
    if (other.char.name.toLowerCase() === targetName.toLowerCase()) {
      targetSession = other;
      break;
    }
  }

  if (!targetSession) {
    send(session.ws, { type: 'CHAT', channel: 'system', sender: '', text: `${targetName} is not online.` });
    return;
  }

  // Send to recipient
  send(targetSession.ws, { type: 'CHAT', channel: 'whisper', sender: char.name, text: text, direction: 'from' });
  // Echo to sender
  send(session.ws, { type: 'CHAT', channel: 'whisper', sender: targetName, text: text, direction: 'to' });

  if (targetSession.isBot && targetSession.char && targetSession.char.ownerId === char.id) {
    tryOrderStudentsAssist(session, text);
  }
}

// ── /group — broadcast to party ────────────────────────────────────
function handleGroup(session, msg) {
  const text = (msg.text || '').trim();
  if (!text) return;
  GroupManager.handleGroupChat(session, text);
  tryOrderStudentsAssist(session, text);
}

// ── /invite — invite player to group ────────────────────────────────
function handleInvite(session, msg) {
  const targetName = (msg.text || '').trim();
  if (!targetName) {
    send(session.ws, { type: 'CHAT', channel: 'system', text: 'Usage: /invite <name>' });
    return;
  }
  GroupManager.handleInvite(session, targetName);
}

// ── /disband — leave current group ──────────────────────────────────
function handleDisband(session, msg) {
  GroupManager.handleDisband(session);
}

// ── /grouproles — manage roles ─────────────────────────────────────
function handleGrouproles(session, msg) {
  const parts = (msg.text || '').split(' ');
  GroupManager.handleRoles(session, parts);
}

// ── /guild — global (stub: not implemented) ─────────────────────────
function handleGuild(session, msg) {
  const text = (msg.text || '').trim();
  if (!text) return;

  if (!session.guild) {
    send(session.ws, { type: 'CHAT', channel: 'system', sender: '', text: 'You are not in a guild.' });
    return;
  }
}

// ── /raid — global (stub: not implemented) ──────────────────────────
function handleRaid(session, msg) {
  const text = (msg.text || '').trim();
  if (!text) return;

  if (!session.raid) {
    send(session.ws, { type: 'CHAT', channel: 'system', sender: '', text: 'You are not in a raid.' });
    return;
  }
}

// ── /announcement — admin-only global broadcast (no spam guard; use for bulk GM text) ──
function handleAnnouncement(session, msg) {
  const text = (msg.text || '').trim();
  if (!text) return;

  // Check admin status (EQEmu: status >= 200 = GM)
  const auth = authSessions.get(session.ws);
  if (!auth || (auth.status || 0) < 200) {
    send(session.ws, { type: 'CHAT', channel: 'system', sender: '', text: 'You do not have permission to use this command.' });
    return;
  }

  // Broadcast to ALL connected players
  for (const [ws, other] of sessions) {
    send(other.ws, { type: 'CHAT', channel: 'announcement', sender: session.char.name, text: text });
  }
}


module.exports = {
  handleSay,
  handleShout,
  handleOOC,
  handleYell,
  handleWhisper,
  handleGroup,
  handleInvite,
  handleDisband,
  handleGrouproles,
  handleGuild,
  handleRaid,
  handleAnnouncement,
  broadcastChat,
  init,
  processRPExperience,
  countNearbyOtherPlayers,
  tryOrderStudentsAssist,
};
