/**
 * Classic group experience (Project 1999 / pre-2003 grouping bonus).
 *
 * The kill's experience is the amount the highest eligible member would earn
 * solo. A group-size bonus is applied, then the pot is split by each member's
 * effective total experience (stored XP times their race and class factor).
 * Penalized races and classes need more XP to level and draw a larger share,
 * so a group stays roughly in step.
 *
 * Level window matches the classic rule: a member gets a share when they are
 * within half their level of the highest member, and always at least 5 levels.
 * That is the precise form of "about (level / 2) + 5".
 */

const { xpForLevel } = require('../combat');

/** Bonus on the kill's total XP before the split. Index is member count. */
const GROUP_XP_BONUS = Object.freeze({
  1: 1,
  2: 1.02,
  3: 1.06,
  4: 1.10,
  5: 1.14,
  6: 1.20,
});

/** Multiplier on XP required to level. Above 1 is a penalty. */
const RACE_XP_FACTOR = Object.freeze({
  troll: 1.20,
  iksar: 1.20,
  ogre: 1.15,
  barbarian: 1.05,
  halfling: 0.95,
});

const CLASS_XP_FACTOR = Object.freeze({
  paladin: 1.40,
  shadow_knight: 1.40,
  ranger: 1.40,
  bard: 1.40,
  monk: 1.20,
  wizard: 1.10,
  magician: 1.10,
  enchanter: 1.10,
  necromancer: 1.10,
  rogue: 0.91,
  warrior: 0.90,
});

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function xpRequiredFactor(race, klass) {
  const raceKey = normalizeKey(race);
  const classKey = normalizeKey(klass);
  const raceFactor = RACE_XP_FACTOR[raceKey] != null ? RACE_XP_FACTOR[raceKey] : 1;
  const classFactor = CLASS_XP_FACTOR[classKey] != null ? CLASS_XP_FACTOR[classKey] : 1;
  return raceFactor * classFactor;
}

/** Cumulative XP at which this character reaches the next level. */
function xpToReachNextLevel(char) {
  const level = Math.max(1, (char && char.level) || 1);
  const floor = xpForLevel(level);
  const span = xpForLevel(level + 1) - floor;
  const factor = xpRequiredFactor(char && char.race, char && char.class);
  return floor + span * factor;
}

/** XP still required to finish the current level, after race and class. */
function xpSpanForChar(char) {
  const level = Math.max(1, (char && char.level) || 1);
  const span = xpForLevel(level + 1) - xpForLevel(level);
  return Math.max(1, span * xpRequiredFactor(char && char.race, char && char.class));
}

function groupBonus(memberCount) {
  const n = Math.max(1, Math.min(6, memberCount | 0));
  return GROUP_XP_BONUS[n];
}

/**
 * True when memberLevel may take a share from a group whose highest member
 * is highestLevel. Uses the member's own level, matching classic:
 * gap allowed is max(5, floor(memberLevel / 2)).
 */
function withinGroupLevelRange(memberLevel, highestLevel) {
  const level = Math.max(1, memberLevel | 0);
  const highest = Math.max(1, highestLevel | 0);
  let maxDiff = -(Math.floor((level * 15) / 10) - level);
  if (maxDiff > -5) maxDiff = -5;
  return (level - highest) >= maxDiff;
}

/**
 * Split an integer pot by weight. Remainder goes to the largest fractions
 * so the shares add back up to the pot.
 */
function splitByWeight(pot, weights) {
  const n = weights.length;
  const total = Math.max(0, Math.floor(pot));
  if (n === 0 || total <= 0) return weights.map(() => 0);

  const sum = weights.reduce((acc, w) => acc + (w > 0 ? w : 0), 0);
  if (sum <= 0) {
    const base = Math.floor(total / n);
    let rem = total - base * n;
    return weights.map(() => {
      const extra = rem > 0 ? 1 : 0;
      rem -= extra;
      return base + extra;
    });
  }

  const raw = weights.map(w => (total * Math.max(0, w)) / sum);
  const floors = raw.map(v => Math.floor(v));
  let rem = total - floors.reduce((acc, v) => acc + v, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < order.length && rem > 0; k++) {
    floors[order[k].i] += 1;
    rem -= 1;
  }
  return floors;
}

function effectiveXpWeight(char) {
  const xp = Math.max(0, Number(char && char.experience) || 0);
  const factor = xpRequiredFactor(char && char.race, char && char.class);
  return Math.max(xp, 1) * factor;
}

/**
 * Who shares this kill: alive, in the same zone as the corpse.
 * Someone grouped but in another zone does not take a share and does not
 * add to the group bonus. The killer is included when they are in that zone.
 */
function presentMembers(killer, zoneId) {
  const group = killer && killer.group;
  const roster = (group && Array.isArray(group.members) && group.members.length)
    ? group.members
    : [killer];
  const present = [];
  for (const member of roster) {
    if (!member || !member.char) continue;
    if (member !== killer) {
      if (member.char.state === 'dead') continue;
      if (member.char.hp != null && member.char.hp <= 0) continue;
    } else if (member.char.state === 'dead') {
      continue;
    }
    if (String(member.char.zoneId) !== String(zoneId)) continue;
    present.push(member);
  }
  if (
    killer && killer.char && killer.char.state !== 'dead' &&
    String(killer.char.zoneId) === String(zoneId) &&
    !present.includes(killer)
  ) {
    present.push(killer);
  }
  return present;
}

/**
 * @param {object} args
 * @param {object} args.killer session that got the kill
 * @param {object} args.mob
 * @param {string} args.zoneId
 * @param {number} args.zem
 * @param {function} args.calcXPGain (playerLevel, mobLevel, mobXpBase, zem) => number
 */
function splitKillXp({ killer, mob, zoneId, zem, calcXPGain }) {
  const present = presentMembers(killer, zoneId);
  if (!present.length) {
    return { baseXp: 0, bonus: 1, present: [], eligible: [], shares: [] };
  }

  let highest = present[0];
  for (const member of present) {
    if ((member.char.level || 1) > (highest.char.level || 1)) highest = member;
  }
  const highestLevel = highest.char.level || 1;

  const eligible = present.filter(member =>
    withinGroupLevelRange(member.char.level || 1, highestLevel)
  );

  const baseXp = eligible.length
    ? calcXPGain(highestLevel, mob.level, mob.xpBase, zem)
    : 0;

  if (!baseXp || baseXp <= 0) {
    return { baseXp: 0, bonus: 1, present, eligible, shares: [] };
  }

  const bonus = groupBonus(eligible.length);
  const pot = Math.round(baseXp * bonus);
  const weights = eligible.map(member => effectiveXpWeight(member.char));
  const amounts = splitByWeight(pot, weights);
  const shares = eligible.map((session, i) => ({
    session,
    xp: amounts[i],
  }));

  return { baseXp, bonus, present, eligible, shares };
}

module.exports = {
  GROUP_XP_BONUS,
  RACE_XP_FACTOR,
  CLASS_XP_FACTOR,
  xpRequiredFactor,
  xpToReachNextLevel,
  xpSpanForChar,
  groupBonus,
  withinGroupLevelRange,
  splitByWeight,
  effectiveXpWeight,
  presentMembers,
  splitKillXp,
};
