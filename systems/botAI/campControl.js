'use strict';

/**
 * Shared camp picture for crowd control, the tank's next target, and the puller.
 * A camp is not clear while any engaged or mesmerized mob is still alive.
 */

const State = require('../../state');
const { send } = require('../../utils');

const CAMP_RADIUS = 80;

function isLivingMob(mob) {
  if (!mob || mob.alive === false || mob.pendingRemove) return false;
  if (mob.hp != null && mob.hp <= 0) return false;
  if (mob.char) return false;
  if (mob.isPet) return false;
  if (mob.type === 'corpse') return false;
  if (mob.npcType && mob.npcType !== 'mob') return false;
  return true;
}

function isMezzed(mob) {
  if (!mob || !Array.isArray(mob.buffs)) return false;
  return mob.buffs.some((b) => b.isMez || (b.effects || []).some((e) => e.spa === 31));
}

function mezSecondsLeft(mob) {
  if (!mob || !Array.isArray(mob.buffs)) return 0;
  let left = 0;
  for (const buff of mob.buffs) {
    const mez = buff.isMez || (buff.effects || []).some((e) => e.spa === 31);
    if (mez) left = Math.max(left, buff.duration || 0);
  }
  return left;
}

function tankSession(session) {
  const group = session && session.group;
  if (!group || !group.members || group.members.length === 0) return null;
  const id = group.roles && group.roles.mainTank;
  if (id == null) return group.members[0] || null;
  return group.members.find((m) => m && m.char && m.char.id === id) || group.members[0] || null;
}

function anchorChar(session) {
  const tank = tankSession(session);
  if (tank && tank.char) return tank.char;
  return session.char;
}

function isOurPet(session, mob) {
  if (!session || !mob) return false;
  if (session.pet && (mob === session.pet || mob.id === session.pet.id)) return true;
  if (mob.charmOwner === session || mob.ownerSession === session) return true;
  return false;
}

function hasHate(mob) {
  return !!(mob.hateList && Array.isArray(mob.hateList.entries) && mob.hateList.entries.length > 0);
}

function liveMobs(session) {
  const zone = State.zoneInstances && State.zoneInstances[session.char.zoneId];
  return (zone && zone.liveMobs) || [];
}

function dist2(a, b) {
  const dx = (a.x || 0) - (b.x || 0);
  const dy = (a.y || 0) - (b.y || 0);
  return dx * dx + dy * dy;
}

/**
 * Mobs the group still has to deal with: aggro'd, already swinging, or mezzed near camp.
 */
function campMobs(session, radius = CAMP_RADIUS) {
  if (!session || !session.char) return [];
  const anchor = anchorChar(session);
  const r2 = radius * radius;
  const out = [];
  for (const mob of liveMobs(session)) {
    if (!isLivingMob(mob)) continue;
    if (isOurPet(session, mob)) continue;
    if (dist2(mob, anchor) > r2) continue;
    if (isMezzed(mob) || mob.target || hasHate(mob)) out.push(mob);
  }
  return out;
}

function focusOf(session) {
  const tank = tankSession(session);
  const ct = tank && tank.combatTarget;
  if (!isLivingMob(ct)) return null;
  return ct;
}

function campHasWork(session) {
  return campMobs(session).length > 0;
}

/** Adds other than the tank's current kill target. */
function addsExceptFocus(session) {
  const focus = focusOf(session);
  return campMobs(session).filter((mob) => !focus || mob.id !== focus.id);
}

function tankIsOn(session, mob) {
  if (!mob) return false;
  const tank = tankSession(session);
  const ct = tank && tank.combatTarget;
  if (!ct) return false;
  return ct === mob || ct.id === mob.id;
}

/**
 * Next mob for the tank once the current kill is dead.
 * Prefer a mezzed add close to the tank, so the group breaks one mez at a time.
 */
function nextAdd(session) {
  const adds = addsExceptFocus(session);
  if (adds.length === 0) return null;
  const anchor = anchorChar(session);
  const mezzed = adds.filter((mob) => isMezzed(mob));
  const pool = mezzed.length > 0 ? mezzed : adds;
  pool.sort((a, b) => dist2(a, anchor) - dist2(b, anchor));
  return pool[0];
}

function pointSession(session, mob) {
  if (!session || !mob) return;
  session.combatTarget = mob;
  try {
    send(session.ws, {
      type: 'TARGET_UPDATE',
      target: {
        id: mob.id,
        name: mob.name,
        hp: mob.hp,
        maxHp: mob.maxHp,
        level: mob.level,
        type: mob.isPet ? 'pet' : 'enemy',
        buffs: mob.buffs || [],
      },
    });
  } catch (e) { /* ignore */ }
}

function nearestIdleMob(session, minDist, maxDist) {
  if (!session || !session.char) return null;
  const anchor = anchorChar(session);
  const min2 = minDist * minDist;
  const max2 = maxDist * maxDist;
  let best = null;
  let bestD = Infinity;
  for (const mob of liveMobs(session)) {
    if (!isLivingMob(mob)) continue;
    if (isOurPet(session, mob) || isMezzed(mob) || mob.target || hasHate(mob)) continue;
    const d = dist2(mob, anchor);
    if (d < min2 || d > max2 || d >= bestD) continue;
    best = mob;
    bestD = d;
  }
  return best;
}

module.exports = {
  CAMP_RADIUS,
  isLivingMob,
  isMezzed,
  mezSecondsLeft,
  tankSession,
  campMobs,
  focusOf,
  campHasWork,
  addsExceptFocus,
  tankIsOn,
  nextAdd,
  pointSession,
  nearestIdleMob,
};
