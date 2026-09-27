/**
 * City guards answer a help yell.
 * They run to whoever is attacking the caller (player or bot),
 * and taunt those mobs off the caller. Taunt is nearly certain, not absolute.
 */

const State = require('../state');
const HateList = require('./hate');
const combat = require('../combat');

const HEAR_RADIUS = 400;
const HEAR_RADIUS_SQ = HEAR_RADIUS * HEAR_RADIUS;
const TAUNT_RANGE = 40;
const TAUNT_RANGE_SQ = TAUNT_RANGE * TAUNT_RANGE;
const MELEE_RANGE = 12;
const MELEE_RANGE_SQ = MELEE_RANGE * MELEE_RANGE;
const TAUNT_COOLDOWN = 6;
const TAUNT_CHANCE = 0.95;
const SAY_RADIUS = 200;
const SAY_RADIUS_SQ = SAY_RADIUS * SAY_RADIUS;
const HOME_ARRIVE_SQ = 9;
/** Apprehensive or better. Dubious and worse get no help. */
const MIN_AID_FACTION = -100;
const GUARD_HATE_PREFIX = '!g:';

function isHelpYell(text) {
  return /\bhelp\b/i.test(String(text || ''));
}

function isCityGuard(mob) {
  if (!mob || mob.isPet) return false;
  const key = String(mob.key || '');
  if (key.startsWith('guard_') || key.startsWith('watchman_')) return true;
  const name = String(mob.name || '').trim();
  if (/^(guard|watchman)(\s|_)/i.test(name)) return true;
  if (/^an?\s+(city\s+)?(guard|watchman)\b/i.test(name)) return true;
  return false;
}

function guardHateId(guard) {
  return `${GUARD_HATE_PREFIX}${guard.id}`;
}

function isGuardHateId(entityId) {
  return typeof entityId === 'string' && entityId.startsWith(GUARD_HATE_PREFIX);
}

function resolveGuardTarget(zone, hateId) {
  if (!zone || !Array.isArray(zone.liveMobs) || !isGuardHateId(hateId)) return null;
  const id = hateId.slice(GUARD_HATE_PREFIX.length);
  return zone.liveMobs.find((m) =>
    String(m.id) === id && m.hp > 0 && m.alive !== false && !m.pendingRemove
  ) || null;
}

function distSq(ax, ay, bx, by) {
  const dx = (ax || 0) - (bx || 0);
  const dy = (ay || 0) - (by || 0);
  return dx * dx + dy * dy;
}

function willAid(char, guard) {
  if (!char || !guard) return false;
  const factionId = guard.npc_faction_id;
  if (!factionId) return true;
  try {
    const Faction = require('./faction');
    const standing = Faction.getStanding(char, guard);
    if (!standing || standing.value == null) return true;
    return standing.value >= MIN_AID_FACTION;
  } catch (err) {
    return true;
  }
}

function ensureHateList(mob) {
  if (!mob.hateList || typeof mob.hateList.getMobWithMostHateOnList !== 'function') {
    mob.hateList = new HateList();
  }
  return mob.hateList;
}

/** True when this mob is actively on the caller (not already peeled onto a guard). */
function mobIsAttacking(mob, session) {
  if (!mob || !session || !session.char) return false;
  if (mob.alive === false || mob.hp <= 0 || mob.pendingRemove || mob.isPet) return false;
  if (isCityGuard(mob)) return false;
  const name = session.char.name;
  if (mob.target === session) return true;
  if (name && mob.target === name) return true;
  if (mob.target && mob.target.char && mob.target.char.name === name) return true;
  if (mob.hateList && typeof mob.hateList.getMobWithMostHateOnList === 'function') {
    if (mob.hateList.getMobWithMostHateOnList() === name) return true;
  }
  return false;
}

function guardBusyWithPlayer(guard) {
  if (guard.hateList && typeof guard.hateList.getMobWithMostHateOnList === 'function') {
    const top = guard.hateList.getMobWithMostHateOnList();
    if (top && !isGuardHateId(top)) return true;
  }
  if (guard.target && guard.target.char && guard.target.char.name) return true;
  return false;
}

function findOwner(session) {
  if (!session || !session.isBot || !session.char) return null;
  const ownerId = session.char.ownerId;
  const ownerName = session.ownerCharName;
  for (const [, other] of State.sessions) {
    if (!other || other.isBot || !other.char) continue;
    if (ownerId != null && other.char.id === ownerId) return other;
    if (ownerName && other.char.name === ownerName) return other;
  }
  return null;
}

function recipientsNear(origin, caller, radiusSq) {
  const out = [];
  const seen = new Set();
  const add = (s) => {
    if (!s || !s.char || seen.has(s)) return;
    if (s.isBot && !s.isCompanion) return;
    if (!s.ws) return;
    seen.add(s);
    out.push(s);
  };
  add(caller);
  add(findOwner(caller));
  const zoneId = (origin && origin.zoneId) || (caller && caller.char && caller.char.zoneId);
  const ox = origin && origin.x != null ? origin.x : (caller && caller.char ? caller.char.x : 0);
  const oy = origin && origin.y != null ? origin.y : (caller && caller.char ? caller.char.y : 0);
  for (const [, other] of State.sessions) {
    if (!other || !other.char || other.char.zoneId !== zoneId) continue;
    if (distSq(other.char.x, other.char.y, ox, oy) <= radiusSq) add(other);
  }
  return out;
}

function personal(session) {
  const people = [];
  const seen = new Set();
  const add = (s) => {
    if (!s || !s.char || seen.has(s)) return;
    if (s.isBot && !s.isCompanion) return;
    if (!s.ws) return;
    seen.add(s);
    people.push(s);
  };
  add(session);
  add(findOwner(session));
  return people;
}

function emit(api, people, events) {
  if (!api || typeof api.sendCombatLog !== 'function' || !events || events.length === 0) return;
  for (const s of people) {
    try { api.sendCombatLog(s, events); } catch (err) { /* ignore a dead socket */ }
  }
}

function rememberHome(guard) {
  if (guard.assistHomeX != null) return;
  guard.assistHomeX = guard.spawnX != null ? guard.spawnX : guard.x;
  guard.assistHomeY = guard.spawnY != null ? guard.spawnY : guard.y;
  guard.assistHomeZ = guard.spawnZ != null ? guard.spawnZ : (guard.z || 0);
}

/**
 * Peel the attacker off the caller onto this guard.
 * Succeeds TAUNT_CHANCE of the time. Already-peeled mobs are left on whichever guard holds them.
 */
function tryGuardTaunt(attacker, guard, roll = Math.random()) {
  const hate = ensureHateList(attacker);
  const myId = guardHateId(guard);
  const top = hate.getMobWithMostHateOnList();
  if (isGuardHateId(top)) {
    return { skipped: true, success: true, pulled: false };
  }
  if (roll() >= TAUNT_CHANCE) {
    return { skipped: false, success: false, pulled: false };
  }
  const topEntry = hate.entries.find((e) => e.entityId === top);
  const topHate = topEntry ? topEntry.hateAmount : 0;
  const bump = Math.max(25, Math.floor(topHate * 0.15));
  hate.setHateAmount(myId, topHate + bump);
  attacker.target = guard;
  return { skipped: false, success: true, pulled: true };
}

function callForHelp(session, liveMobs, sendCombatLog) {
  const empty = { responded: [], shouts: [], line: null };
  if (!session || !session.char || !Array.isArray(liveMobs)) return empty;
  const char = session.char;
  if (char.hp <= 0 || char.state === 'dead') return empty;

  const attackers = [];
  const guardsInEarshot = [];
  let guardsAreTheThreat = false;
  for (const mob of liveMobs) {
    if (!mob || mob.hp <= 0 || mob.alive === false) continue;
    if (isCityGuard(mob)) {
      if (distSq(mob.x, mob.y, char.x, char.y) <= HEAR_RADIUS_SQ) guardsInEarshot.push(mob);
      const top = mob.hateList && mob.hateList.getMobWithMostHateOnList && mob.hateList.getMobWithMostHateOnList();
      if (mob.target === session || (char.name && (mob.target === char.name || top === char.name))) {
        guardsAreTheThreat = true;
      }
      continue;
    }
    if (mobIsAttacking(mob, session)) attackers.push(mob);
  }

  const api = sendCombatLog ? { sendCombatLog } : null;

  if (guardsAreTheThreat) {
    const line = 'The guards will not protect you from their own.';
    if (api) emit(api, personal(session), [{ event: 'MESSAGE', text: line }]);
    return { responded: [], shouts: [], line };
  }

  if (attackers.length === 0) return empty;

  const available = [];
  let refused = 0;
  for (const guard of guardsInEarshot) {
    if (!willAid(char, guard)) {
      refused += 1;
      continue;
    }
    if (guard.assistTarget && guard.assistTarget.hp > 0 && guard.assistTarget.alive !== false && !guard.assistTarget.pendingRemove) {
      continue;
    }
    if (guardBusyWithPlayer(guard)) continue;
    available.push(guard);
  }

  if (available.length === 0) {
    if (refused > 0 && guardsInEarshot.length > 0) {
      const line = 'The guards ignore your plea for help.';
      if (api) emit(api, personal(session), [{ event: 'MESSAGE', text: line }]);
      return { responded: [], shouts: [], line };
    }
    return empty;
  }

  const load = new Map();
  for (const foe of attackers) load.set(foe, 0);
  for (const guard of guardsInEarshot) {
    if (guard.assistCaller === session && guard.assistTarget && load.has(guard.assistTarget)) {
      load.set(guard.assistTarget, load.get(guard.assistTarget) + 1);
    }
  }

  const responded = [];
  const shouts = [];
  for (const guard of available) {
    let best = null;
    let bestLoad = Infinity;
    let bestDist = Infinity;
    for (const foe of attackers) {
      const n = load.get(foe) || 0;
      const d = distSq(guard.x, guard.y, foe.x, foe.y);
      if (n < bestLoad || (n === bestLoad && d < bestDist)) {
        best = foe;
        bestLoad = n;
        bestDist = d;
      }
    }
    if (!best) continue;
    rememberHome(guard);
    guard.assistTarget = best;
    guard.assistCaller = session;
    guard.returningHome = false;
    guard.tauntTimer = 0;
    load.set(best, bestLoad + 1);
    responded.push(guard);
    shouts.push(`${guard.name} shouts, 'I'll protect you!'`);
  }

  if (api && shouts.length) {
    const people = recipientsNear(char, session, HEAR_RADIUS_SQ);
    emit(api, people, shouts.map((text) => ({ event: 'MESSAGE', text })));
  }

  return { responded, shouts, line: null };
}

function face(mob, tx, ty, zoneId, api, moved) {
  let heading = (Math.atan2(tx - mob.x, ty - mob.y) / (2 * Math.PI)) * 512;
  if (heading < 0) heading += 512;
  const turned = Math.abs(heading - (mob.heading || 0)) > 1;
  if (turned) mob.heading = heading;
  if ((moved || turned) && api && api.broadcastMobMove) api.broadcastMobMove(mob, zoneId);
}

function stepToward(mob, tx, ty, tz, dt, zoneId, api) {
  const dx = tx - mob.x;
  const dy = ty - mob.y;
  const dz = (tz || 0) - (mob.z || 0);
  const dSq = dx * dx + dy * dy + dz * dz;
  if (dSq <= 0) return 0;
  const rooted = Array.isArray(mob.buffs) && mob.buffs.some((b) => b.isRoot);
  const dist = Math.sqrt(dSq);
  if (!rooted) {
    const speed = (mob.runspeed || 1.25) * 12.0;
    const move = speed * dt;
    const step = Math.min(move, dist);
    mob.x += (dx / dist) * step;
    mob.y += (dy / dist) * step;
    mob.z = (mob.z || 0) + (dz / dist) * step;
  }
  face(mob, tx, ty, zoneId, api, !rooted);
  return dSq;
}

function npcMitigation(npc) {
  if (npc && npc.ac != null) return npc.ac;
  return Math.max(0, ((npc && npc.level) || 1) * 6);
}

function ensureDamage(mob) {
  if (mob.minDmg == null) mob.minDmg = Math.max(1, Math.floor((mob.level || 1) / 2));
  if (mob.maxDmg == null) mob.maxDmg = Math.max(mob.minDmg, (mob.level || 1) * 2);
}

function meleeEvent(kind, attacker, defender, damage) {
  const text = combat.getMobAttackText ? combat.getMobAttackText(attacker) : 'slash';
  return {
    event: kind,
    source: attacker.name,
    target: defender.name,
    damage: damage || 0,
    text,
    type: 'slash',
    sourceId: attacker.id != null ? String(attacker.id) : '',
    targetId: defender.id != null ? String(defender.id) : ''
  };
}

function killGuard(guard, zone, api, events) {
  guard.hp = 0;
  guard.alive = false;
  guard.pendingRemove = true;
  guard.assistTarget = null;
  guard.assistCaller = null;
  guard.returningHome = false;
  const hateId = guardHateId(guard);
  if (zone && Array.isArray(zone.liveMobs)) {
    for (const other of zone.liveMobs) {
      if (!other || other === guard) continue;
      if (other.hateList && typeof other.hateList.removeEntFromHateList === 'function') {
        other.hateList.removeEntFromHateList(hateId);
      }
      if (other.target === guard) other.target = null;
    }
  }
  const death = {
    event: 'DEATH',
    who: guard.name,
    whoId: guard.id != null ? String(guard.id) : ''
  };
  if (events) events.push(death);
  else emit(api, recipientsNear(guard, null, SAY_RADIUS_SQ), [death]);
}

function creditSession(caller, foe, api) {
  if (caller && caller.char && caller.char.hp > 0 && caller.char.state !== 'dead') return caller;
  if (!api || !api.sessions || !foe.hateList || typeof foe.hateList.getDamageTopOnHateList !== 'function') {
    return caller && caller.char ? caller : null;
  }
  const topDmg = foe.hateList.getDamageTopOnHateList();
  if (!topDmg || isGuardHateId(topDmg)) return caller && caller.char ? caller : null;
  const list = api.sessions.values ? Array.from(api.sessions.values()) : Object.values(api.sessions);
  for (const s of list) {
    if (s && s.char && s.char.name === topDmg && s.char.hp > 0 && s.char.state !== 'dead') return s;
  }
  return caller && caller.char ? caller : null;
}

function onFoeDeath(guard, foe, zone, api) {
  foe.hp = 0;
  foe.pendingRemove = true;
  const credit = creditSession(guard.assistCaller, foe, api);
  if (credit && foe.alive !== false && typeof api.handleMobDeath === 'function') {
    const prevTarget = credit.combatTarget;
    const prevCombat = credit.inCombat;
    const prevAuto = credit.autoFight;
    const deathEvents = [];
    Promise.resolve(api.handleMobDeath(credit, foe, deathEvents)).then(() => {
      if (prevTarget && prevTarget !== foe && prevTarget.hp > 0 && prevTarget.alive !== false) {
        credit.combatTarget = prevTarget;
        credit.inCombat = prevCombat;
        credit.autoFight = prevAuto;
      }
      emit(api, recipientsNear(foe, guard.assistCaller, SAY_RADIUS_SQ), deathEvents);
    }).catch((err) => {
      console.error('[GUARD] handleMobDeath:', err && err.message ? err.message : err);
    });
  } else {
    foe.alive = false;
  }

  const freed = [];
  if (zone && Array.isArray(zone.liveMobs)) {
    for (const other of zone.liveMobs) {
      if (other && other.assistTarget === foe) freed.push(other);
    }
  }
  if (!freed.includes(guard)) freed.push(guard);
  for (const other of freed) pickNextOrHome(other, zone);
}

function pickNextOrHome(guard, zone) {
  const caller = guard.assistCaller;
  const mobs = (zone && zone.liveMobs) || [];
  if (caller && caller.char && caller.char.hp > 0 && caller.char.state !== 'dead') {
    const next = mobs.find((m) => mobIsAttacking(m, caller));
    if (next) {
      guard.assistTarget = next;
      guard.returningHome = false;
      guard.tauntTimer = 0;
      return;
    }
  }
  const myId = guardHateId(guard);
  const stuck = mobs.find((m) =>
    m && m !== guard && m.hp > 0 && m.alive !== false && !m.pendingRemove && !isCityGuard(m) &&
    (m.target === guard || (m.hateList && m.hateList.getMobWithMostHateOnList && m.hateList.getMobWithMostHateOnList() === myId))
  );
  if (stuck) {
    guard.assistTarget = stuck;
    guard.returningHome = false;
    return;
  }
  guard.assistTarget = null;
  guard.returningHome = true;
}

function guardStrike(guard, foe, zone, zoneId, api) {
  ensureDamage(guard);
  const people = recipientsNear(foe, guard.assistCaller, SAY_RADIUS_SQ);
  const events = [];
  const hitChance = Math.min(95, Math.max(25, 65 + ((guard.level || 1) - (foe.level || 1)) * 3));
  if (Math.random() * 100 < hitChance) {
    const dmg = combat.calcMobDamage(guard, npcMitigation(foe));
    foe.hp -= dmg;
    ensureHateList(foe).addEntToHateList(guardHateId(guard), dmg, 0);
    if (api && api.breakMez) api.breakMez(foe, events);
    events.push(meleeEvent('MELEE_HIT', guard, foe, dmg));
  } else {
    events.push(meleeEvent('MELEE_MISS', guard, foe, 0));
  }
  emit(api, people, events);
  if (foe.hp <= 0) onFoeDeath(guard, foe, zone, api);
}

/**
 * One AI tick for a guard who is answering a help yell, or walking back to post.
 * Returns true when this tick was consumed (caller should skip generic mob AI).
 */
function tick(mob, zone, zoneId, dt, api) {
  if (!mob || mob.hp <= 0 || mob.alive === false || mob.pendingRemove) return false;
  if (!mob.assistTarget && !mob.returningHome) return false;

  if (Array.isArray(mob.buffs)) {
    if (mob.buffs.some((b) => b.isMez || b.isStun)) return true;
    if (mob.buffs.some((b) => b.isFear)) return false;
  }

  if (mob.assistTarget) {
    if (guardBusyWithPlayer(mob)) {
      mob.assistTarget = null;
      mob.assistCaller = null;
      mob.returningHome = false;
      return false;
    }
    const foe = mob.assistTarget;
    if (!foe || foe.hp <= 0 || foe.alive === false || foe.pendingRemove) {
      pickNextOrHome(mob, zone);
      if (!mob.assistTarget) {
        /* fall through to walk home */
      } else {
        return true;
      }
    } else {
      const dSq = stepToward(mob, foe.x, foe.y, foe.z || 0, dt, zoneId, api);
      const flatSq = distSq(mob.x, mob.y, foe.x, foe.y);
      if (mob.tauntTimer == null) mob.tauntTimer = 0;
      mob.tauntTimer -= dt;
      if (flatSq <= TAUNT_RANGE_SQ && mob.tauntTimer <= 0) {
        mob.tauntTimer = TAUNT_COOLDOWN;
        const result = tryGuardTaunt(foe, mob, mob._tauntRoll);
        if (result.pulled) {
          emit(api, recipientsNear(mob, mob.assistCaller, SAY_RADIUS_SQ), [{
            event: 'MESSAGE',
            text: `${mob.name} taunts ${foe.name}, commanding its attention!`
          }]);
        } else if (!result.success && !result.skipped) {
          emit(api, recipientsNear(mob, mob.assistCaller, SAY_RADIUS_SQ), [{
            event: 'MESSAGE',
            text: `${mob.name} fails to taunt ${foe.name}.`
          }]);
        }
      }
      if (dSq <= MELEE_RANGE_SQ) {
        if (isNaN(mob.attackTimer)) mob.attackTimer = 0;
        if (isNaN(mob.attackDelay) || !mob.attackDelay) mob.attackDelay = 3;
        mob.attackTimer -= dt;
        if (mob.attackTimer <= 0) {
          mob.attackTimer = mob.attackDelay;
          guardStrike(mob, foe, zone, zoneId, api);
        }
      }
      return true;
    }
  }

  if (mob.returningHome && !guardBusyWithPlayer(mob)) {
    rememberHome(mob);
    const dx = mob.assistHomeX - mob.x;
    const dy = mob.assistHomeY - mob.y;
    if (dx * dx + dy * dy <= HOME_ARRIVE_SQ) {
      mob.x = mob.assistHomeX;
      mob.y = mob.assistHomeY;
      mob.z = mob.assistHomeZ || 0;
      mob.returningHome = false;
      mob.assistCaller = null;
      if (api && api.broadcastMobMove) api.broadcastMobMove(mob, zoneId);
      return true;
    }
    stepToward(mob, mob.assistHomeX, mob.assistHomeY, mob.assistHomeZ || 0, dt, zoneId, api);
    return true;
  }

  return false;
}

/**
 * A mob whose hate leader is a guard swings at that guard.
 * Called from mob AI once the target has been resolved to the guard NPC.
 */
function strikeNpc(attacker, defender, zone, api) {
  if (!attacker || !defender || defender.hp <= 0 || defender.alive === false) return;
  ensureDamage(attacker);
  const caller = defender.assistCaller || null;
  const people = recipientsNear(defender, caller, SAY_RADIUS_SQ);
  const events = [];
  const hitChance = Math.min(95, Math.max(20, 60 + ((attacker.level || 1) - (defender.level || 1)) * 3));
  if (Math.random() * 100 < hitChance) {
    const dmg = combat.calcMobDamage(attacker, npcMitigation(defender));
    defender.hp -= dmg;
    events.push(meleeEvent('MELEE_HIT', attacker, defender, dmg));
    if (defender.hp <= 0) killGuard(defender, zone, api, events);
  } else {
    events.push(meleeEvent('MELEE_MISS', attacker, defender, 0));
  }
  emit(api, people, events);
}

module.exports = {
  HEAR_RADIUS,
  TAUNT_CHANCE,
  TAUNT_COOLDOWN,
  MIN_AID_FACTION,
  isHelpYell,
  isCityGuard,
  guardHateId,
  isGuardHateId,
  resolveGuardTarget,
  mobIsAttacking,
  tryGuardTaunt,
  callForHelp,
  tick,
  strikeNpc,
  willAid
};
