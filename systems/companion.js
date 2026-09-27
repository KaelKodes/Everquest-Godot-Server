'use strict';

const DB = require('../db');
const State = require('../state');
const GroupManager = require('./groups');
const { createClassBot } = require('./botAI/createClassBot');
const Chat = require('./chat');
const { send } = require('../utils');
const { HAIL_RANGE } = require('../data/npcTypes');

const PARTNER_ACCOUNT_ID = 10000;

/**
 * One character each, on their own account, so they can all be in the world
 * with Kuldaien. Sera already has hers. Mordecai is skipped until that
 * character exists. Hormin is created on first wake if he is missing.
 */
const COMPANIONS = [
  { name: 'Sera' },
  { name: 'Mordecai' },
  { name: 'Hormin' },
];

let createSessionFn = null;
let handleLookFn = null;
let broadcastEntityStateFn = null;

function init(deps) {
  createSessionFn = deps.createSession;
  handleLookFn = deps.handleLook;
  broadcastEntityStateFn = deps.broadcastEntityState;
}

function findSessionByName(name) {
  const want = String(name || '').toLowerCase();
  for (const session of State.sessions.values()) {
    if (session.char && String(session.char.name || '').toLowerCase() === want) return session;
  }
  return null;
}

/**
 * When anyone on the GMKael account enters the world, bring each companion
 * online beside them and into the same group.
 */
async function ensureCompanion(playerSession) {
  if (!playerSession || playerSession.isBot || !playerSession.char) return;
  if (Number(playerSession.char.accountId) !== PARTNER_ACCOUNT_ID) return;
  if (!createSessionFn) return;

  for (let i = 0; i < COMPANIONS.length; i++) {
    await ensureOne(playerSession, COMPANIONS[i].name, i);
  }
  if (handleLookFn) handleLookFn(playerSession, true);
}

async function ensureOne(playerSession, name, index) {
  const existing = findSessionByName(name);
  if (existing && existing.isCompanion) {
    rejoinOne(playerSession, existing);
    return;
  }

  let row = await DB.getCharacter(name);
  if (!row && name === 'Hormin') row = await createHormin();
  if (!row) {
    console.warn(`[COMPANION] ${name} has no character yet.`);
    return;
  }

  const char = { ...row };
  char.zoneId = playerSession.char.zoneId;
  char.x = (Number(playerSession.char.x) || 0) + 8 + (index * 6);
  char.y = Number(playerSession.char.y) || 0;
  char.z = Number(playerSession.char.z) || 0;
  char.heading = Number(playerSession.char.heading) || 0;

  const fakeWs = {
    id: `companion_${char.id}`,
    readyState: 1,
    send() {},
    on() {},
    close() {},
  };

  const botSession = await createSessionFn(fakeWs, char);
  botSession.isBot = true;
  botSession.isCompanion = true;
  botSession.bot = createClassBot(botSession);

  GroupManager.handleInvite(playerSession, name);
  GroupManager.handleInviteResponse(botSession, true);
  const grouped = botSession.group;
  if (grouped) {
    GroupManager.updateGroupPresence(grouped);
    setTimeout(() => {
      if (botSession.group) GroupManager.updateGroupPresence(botSession.group);
    }, 1500);
  }

  console.log(`[COMPANION] ${name} is awake beside ${playerSession.char.name} in ${botSession.char.zoneId}.`);
}

function sameGroup(a, b) {
  return !!(a && b && a.group && a.group === b.group);
}

function rejoinOne(playerSession, bot) {
  if (!bot || !bot.isCompanion || !playerSession.char || !bot.char) return;
  if (sameGroup(bot, playerSession)) {
    GroupManager.updateGroupPresence(playerSession.group);
    return;
  }
  if (bot.group) GroupManager.handleDisband(bot);
  GroupManager.handleInvite(playerSession, bot.char.name);
  GroupManager.handleInviteResponse(bot, true);
  if (bot.group) {
    GroupManager.updateGroupPresence(bot.group);
    setTimeout(() => {
      if (bot.group) GroupManager.updateGroupPresence(bot.group);
    }, 1500);
  }
  console.log(`[COMPANION] ${bot.char.name} rejoined ${playerSession.char.name}.`);
}

function rejoinPartner(playerSession) {
  for (const entry of COMPANIONS) {
    const bot = findSessionByName(entry.name);
    if (bot && bot.isCompanion) rejoinOne(playerSession, bot);
  }
}

function dismissOne(bot) {
  if (!bot || !bot.isCompanion || !bot.char) return;
  if (bot.group) GroupManager.handleDisband(bot);
  if (broadcastEntityStateFn) broadcastEntityStateFn(bot, 'despawn');
  State.sessions.delete(bot.ws);
  const zoneId = bot.char.zoneId;
  if (zoneId && State.sessionsByZone.has(zoneId)) {
    State.sessionsByZone.get(zoneId).delete(bot);
  }
  console.log(`[COMPANION] ${bot.char.name} rests.`);
}

function dismissFor(playerSession) {
  if (!playerSession || !playerSession.char) return;
  if (Number(playerSession.char.accountId) !== PARTNER_ACCOUNT_ID) return;
  for (const entry of COMPANIONS) {
    dismissOne(findSessionByName(entry.name));
  }
  console.log(`[COMPANION] The group rests while ${playerSession.char.name} is away.`);
}

function companionsFor(playerSession) {
  const found = [];
  const seen = new Set();
  const group = playerSession && playerSession.group;
  if (group && Array.isArray(group.members)) {
    for (const member of group.members) {
      if (member && member.isCompanion && member !== playerSession && member.char) {
        found.push(member);
        seen.add(member.char.id);
      }
    }
  }
  for (const entry of COMPANIONS) {
    const bot = findSessionByName(entry.name);
    if (bot && bot.isCompanion && bot.char && !seen.has(bot.char.id)) found.push(bot);
  }
  return found;
}

function relocateSessionZone(session, zoneId) {
  const previous = session.char.zoneId;
  const byZone = State.sessionsByZone;
  if (previous && byZone.has(previous)) {
    byZone.get(previous).delete(session);
    if (byZone.get(previous).size === 0) byZone.delete(previous);
  }
  session.char.zoneId = zoneId;
  if (!byZone.has(zoneId)) byZone.set(zoneId, new Set());
  byZone.get(zoneId).add(session);
}

/**
 * Player crossed a zone line. Bring Sera to the arrival point on this node.
 */
async function followThroughZone(playerSession) {
  if (!playerSession || playerSession.isBot || playerSession.isCompanion || !playerSession.char) return;

  const zoneId = playerSession.char.zoneId;
  const x = (Number(playerSession.char.x) || 0) + 8;
  const y = Number(playerSession.char.y) || 0;
  const z = Number(playerSession.char.z) || 0;
  const heading = Number(playerSession.char.heading) || 0;

  for (const bot of companionsFor(playerSession)) {
    if (!bot.char || bot.char.zoneId === zoneId) continue;

    if (broadcastEntityStateFn) broadcastEntityStateFn(bot, 'despawn');
    relocateSessionZone(bot, zoneId);
    bot.char.x = x;
    bot.char.y = y;
    bot.char.z = z;
    bot.char.heading = heading;
    bot.casting = null;
    bot.inCombat = false;
    bot.combatTarget = null;

    try {
      await DB.saveCharacterLocation(bot.char.id, zoneId, x, y, z);
    } catch (e) {
      console.warn(`[COMPANION] Could not save ${bot.char.name} zone: ${e.message}`);
    }

    if (handleLookFn) handleLookFn(playerSession, true);
    console.log(`[COMPANION] ${bot.char.name} followed ${playerSession.char.name} into ${zoneId}.`);
  }
}

function onHail(playerSession, companionSession) {
  const speaker = playerSession && playerSession.char;
  const me = companionSession && companionSession.char;
  if (!speaker || !me) return;

  const dx = (Number(speaker.x) || 0) - (Number(me.x) || 0);
  const dy = (Number(speaker.y) || 0) - (Number(me.y) || 0);
  if (dx * dx + dy * dy > HAIL_RANGE * HAIL_RANGE) {
    send(playerSession.ws, {
      type: 'COMBAT_LOG',
      events: [{ event: 'MESSAGE', text: `You are too far away to speak with ${me.name}.` }],
    });
    return;
  }

  send(playerSession.ws, {
    type: 'COMBAT_LOG',
    events: [{ event: 'MESSAGE', text: `You say, 'Hail, ${me.name}!'` }],
  });

  const hail = companionSession.bot && companionSession.bot.persona && companionSession.bot.persona.hail;
  const line = typeof hail === 'function'
    ? hail(speaker.name)
    : (hail || `Well met, ${speaker.name}. I am Sera, a daughter of Tunare, new to these woods and still learning my prayers. Walk with me, and I will keep you on your feet.`);
  Chat.broadcastChat(companionSession, 'say', line, 2000);
}

async function createHormin() {
  const crypto = require('crypto');
  const { createCharacterFromClientMessage } = require('../create_character_common');
  let account = await DB.createAccount('companion_hormin', crypto.randomBytes(18).toString('hex'));
  if (!account || !account.id) {
    const existing = await DB.getAccountByName('companion_hormin');
    account = existing || account;
  }
  if (!account || !account.id) {
    console.warn(`[COMPANION] Could not open an account for Hormin${account && account.error ? `: ${account.error}` : ''}.`);
    return null;
  }
  const deities = await DB.getValidDeities(11, 9);
  const deity = deities.includes(205) ? 205 : (deities[0] || 396);
  const result = await createCharacterFromClientMessage(account.id, {
    name: 'Hormin',
    class: 'rogue',
    race: 'halfling',
    deity,
    gender: 0,
  });
  if (!result || result.error) {
    console.warn(`[COMPANION] Could not create Hormin${result && result.error ? `: ${result.error}` : ''}.`);
    return null;
  }
  console.log(`[COMPANION] Hormin the halfling rogue is created.`);
  return DB.getCharacter('Hormin');
}

module.exports = { init, ensureCompanion, followThroughZone, onHail, dismissFor, rejoinPartner };
