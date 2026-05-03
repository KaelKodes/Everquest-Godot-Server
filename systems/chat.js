const { send } = require('../utils');
const State = require('../state');
const { zoneInstances, sessions, authSessions } = State;
const { NPC_TYPES, HAIL_RANGE } = require('../data/npcTypes');
const QuestDialogs = require('../data/npcs/quests');
const QuestManager = require('../questManager');
const FactionSystem = require('./faction');
const GroupManager = require('./groups');
const { GUILD_MASTER_CLASS, getTaughtClassId, CLASSES_MAP } = require('../utils/npcUtils');


function getDistanceSq(x1, y1, x2, y2) {
  return (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
}

// Proxy functions injected from gameEngine
function sendCombatLog(session, events) {
  if (module.exports.sendCombatLogFn) return module.exports.sendCombatLogFn(session, events);
}
function processQuestActions(session, target, actions) {
  if (module.exports.processQuestActionsFn) return module.exports.processQuestActionsFn(session, target, actions);
}
function handleHail(session, msg) {
  if (module.exports.handleHailFn) return module.exports.handleHailFn(session, msg);
}

const RP_CHAR_THRESHOLD = 60; // Characters needed to trigger a tick check
const RP_TICK_CHANCE = 0.33;  // 33% chance to actually receive the exp on tick

function processRPExperience(session, text) {
  if (!text) return;
  
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
    
    // 33% chance to get an RP tick
    if (Math.random() <= RP_TICK_CHANCE) {
      const rpExp = Math.floor(Math.random() * 20) + 10; // 10-30 exp
      if (module.exports.awardExpFn) {
         module.exports.awardExpFn(session, rpExp, null);
         sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=yellow]You feel a sense of immersion. You gained ${rpExp} experience for roleplaying.[/color]` }]);
      }
    }
  }
}

async function handleSay(session, msg) {
  const char = session.char;
  const text = (msg.text || '').trim();
  if (!text) return;

  // Echo the player's speech via CHAT
  send(session.ws, { type: 'CHAT', channel: 'say', sender: char.name, text: text });
  
  processRPExperience(session, text);

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
      processQuestActions(session, target, actions);
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
      // TODO: Actually save bind point
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
  send(session.ws, { type: 'CHAT', channel: 'shout', sender: char.name, text: text });
  broadcastChat(session, 'shout', text, 600);
  processRPExperience(session, text);
}

// ── /ooc — same as say radius (200u), local only ────────────────────
function handleOOC(session, msg) {
  const char = session.char;
  const text = (msg.text || '').trim();
  if (!text) return;
  send(session.ws, { type: 'CHAT', channel: 'ooc', sender: char.name, text: text });
  broadcastChat(session, 'ooc', text, 200);
}

// ── /yell — 2x say radius (400u) + guard AI assist ─────────────────
function handleYell(session, msg) {
  const char = session.char;
  const text = (msg.text || '').trim() || 'Help!!';
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
}

// ── /group — broadcast to party ────────────────────────────────────
function handleGroup(session, msg) {
  const text = (msg.text || '').trim();
  if (!text) return;
  GroupManager.handleGroupChat(session, text);
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

// ── /announcement — admin-only global broadcast ─────────────────────
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
  processRPExperience,
  setSendCombatLogFn: (fn) => { module.exports.sendCombatLogFn = fn; },
  setProcessQuestActionsFn: (fn) => { module.exports.processQuestActionsFn = fn; },
  setHandleHailFn: (fn) => { module.exports.handleHailFn = fn; },
  setAwardExpFn: (fn) => { module.exports.awardExpFn = fn; }
};
