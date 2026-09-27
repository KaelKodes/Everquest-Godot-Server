'use strict';

/**
 * Feign Death — monk skill ability.
 * Success removes the player from NPC hate lists (mobs treat them as dead).
 * Used heavily by pullers to survive bad pulls and to split camps.
 *
 * Note: Necromancer / Shadowknight "Feign Death" in classic EQ is a spell,
 * not this combat skill.
 */

const combat = require('../combat');
const State = require('../state');

const FD_COOLDOWN_SEC = 8;
const FD_ROLL_MAX = 160;

function isMonk(session) {
  const cls = session && session.char && String(session.char.class || '').toLowerCase();
  return cls === 'monk';
}

function skillValue(session) {
  if (!session || !session.char) return 0;
  if (!isMonk(session)) return 0;
  return combat.getCharSkill(session.char, 'feign_death') || 0;
}

function canFeign(session) {
  return isMonk(session) && skillValue(session) > 0;
}

function isFeigned(session) {
  return !!(session && (session.feigned || (session.char && session.char.state === 'feigned')));
}

function clearFeignAggro(session) {
  if (!session || !session.char) return;
  const zoneId = session.char.zoneId;
  const zone = State.zoneInstances && State.zoneInstances[zoneId];
  if (!zone || !zone.liveMobs) return;
  const name = session.char.name;
  for (const mob of zone.liveMobs) {
    if (!mob) continue;
    if (mob.hateList) mob.hateList.removeEntFromHateList(name);
    if (mob.target === session) {
      mob.target = null;
      mob.attackTarget = null;
    }
  }
}

/**
 * Attempt Feign Death.
 * @returns {{ ok: boolean, success?: boolean, reason?: string, text?: string }}
 */
function tryFeignDeath(session, opts = {}) {
  if (!session || !session.char) return { ok: false, reason: 'no_session' };
  if (!isMonk(session)) {
    return { ok: false, reason: 'not_monk', text: 'Only monks know how to feign death.' };
  }
  if (!canFeign(session)) {
    return { ok: false, reason: 'no_skill', text: 'You have no idea how to feign death.' };
  }
  if (session.char.state === 'dead') {
    return { ok: false, reason: 'dead', text: 'You are already dead.' };
  }
  if (isFeigned(session)) {
    return { ok: true, success: true, already: true, text: 'You are already feigning death.' };
  }

  if (!session.abilityCooldowns) session.abilityCooldowns = {};
  const cdKey = 'feign_death';
  if (session.abilityCooldowns[cdKey] > 0 && !opts.ignoreCooldown) {
    const remaining = Math.ceil(session.abilityCooldowns[cdKey]);
    return {
      ok: false,
      reason: 'cooldown',
      text: `Feign Death is not ready yet. (${remaining}s)`,
    };
  }

  const skill = skillValue(session);
  let prim = skill;
  let sec = 0;
  if (prim > 100) {
    sec = Math.floor((prim - 100) / 2);
    prim = 100;
  }
  const total = prim + sec;
  const roll = Math.random() * FD_ROLL_MAX;
  const success = roll <= total;

  session.abilityCooldowns[cdKey] = FD_COOLDOWN_SEC;
  combat.trySkillUp(session, 'feign_death');

  if (!success) {
    session.feigned = false;
    return {
      ok: true,
      success: false,
      text: `${session.char.name} has fallen to the ground...`,
      failText: 'Your feign death has failed!',
    };
  }

  // Drop combat posture — mobs think we died.
  session.feigned = true;
  session.char.state = 'feigned';
  session.autoFight = false;
  session.inCombat = false;
  session.attackTarget = null;
  // Keep combatTarget for puller bookkeeping, but stop swinging.
  clearFeignAggro(session);

  return {
    ok: true,
    success: true,
    text: `${session.char.name} has fallen to the ground.`,
  };
}

/**
 * Stand up from feign. Returns true if a feign was broken.
 */
function breakFeign(session, reason) {
  if (!isFeigned(session)) return false;
  session.feigned = false;
  if (session.char && session.char.state === 'feigned') {
    session.char.state = 'standing';
  }
  session._feignBrokeAt = Date.now();
  session._feignBrokeReason = reason || 'stand';
  return true;
}

module.exports = {
  canFeign,
  isFeigned,
  isMonk,
  tryFeignDeath,
  breakFeign,
  clearFeignAggro,
  skillValue,
  FD_COOLDOWN_SEC,
};
