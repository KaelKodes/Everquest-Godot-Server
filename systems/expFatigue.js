/**
 * Learning fatigue ("exp exhaustion"): grind-heavy kill XP fills a meter;
 * restorative XP, RP, and Norrath time bring it back down.
 *
 * `char.learningFatigue` is 0 (fresh) .. MAX (mentally exhausted).
 * Player-facing hints are vague (mindSky / mindMurmur); exact math stays server-side.
 */

function xpForLevel(level) {
  return require('../combat').xpForLevel(level);
}

const MAX_FATIGUE = 1000;

/** Per kill: fatigue += (killXp / xpThisLevel) * this factor. */
const KILL_FATIGUE_PER_LEVEL_RATIO = 220;

/** Restorative / quest XP relief (same shape as kill gain). */
const RESTORATIVE_RELIEF_PER_LEVEL_RATIO = 280;

/** Flat relief when an RP tick fires. */
const RP_TICK_RELIEF = 28;

/** Must be present for this many engine ticks in a Norrath hour to get hourly relief. */
const FULL_NORRATH_HOUR_TICKS = 900;

/** Fatigue relieved after a full Norrath hour online. */
const HOUR_RELIEF_FATIGUE = 20;

/** Opaque client labels — not a 1:1 map to internal tiers; enough variety to resist datamining. */
const MIND_SKIES = ['lucid', 'bright', 'settled', 'thinned', 'strained', 'hollow'];

const MURMURS_BY_SKY = {
  lucid: [
    'The road tastes new.',
    'Every sense feels borrowed from a kinder season.',
    'You could swear the wind remembers your name today.',
  ],
  bright: [
    'The world still answers when you call.',
    'There is room left in you for wonder.',
    'Footfalls feel light; the next lesson waits like a gift.',
  ],
  settled: [
    'Habit and hunger walk side by side now.',
    'You know the shape of the fight before it begins.',
    'Nothing surprises you—which is its own kind of tired.',
  ],
  thinned: [
    'Victory arrives, but something forgets to follow it home.',
    'The space behind your eyes feels wider than it should.',
    'Each kill lands true—and still leaves an echo that will not leave.',
  ],
  strained: [
    'The world offers its lessons; your mind fumbles the catch.',
    'You are present for the slaughter, absent for the meaning.',
    'Even triumph rings hollow if you strike often enough.',
  ],
  hollow: [
    'You could win forever here and still walk away smaller.',
    'The hollow behind your eyes has learned your favorite route.',
    'Norrath still teaches—you are no longer sure you are listening.',
  ],
};

/** When strain worsens (tier index rises). Lines avoid numbers and system jargon. */
const WHISPERS_ON_RISE = {
  1: [
    'Something in you tightens without asking why.',
    'The wilds press a little closer than they did a moment ago.',
  ],
  2: [
    'Your thoughts skid off the moment right after the kill.',
    'Hunger for blood and hunger for sense no longer line up.',
  ],
  3: [
    'Each victory lands flat, like coin on cold stone.',
    'The world still offers its riddles—you answer with muscle, not mind.',
  ],
  4: [
    'Your senses stay with the fight after your spirit has already left.',
    'The mirror in your memory shows someone who has done this one time too many.',
  ],
  5: [
    'A hollow opens behind your eyes. Even triumph echoes wrong.',
    'Lessons still arrive; they find fewer places to land.',
  ],
};

/** When strain eases (tier index falls). */
const WHISPERS_ON_EASE = {
  0: [
    'Color returns to the world in places you had stopped noticing.',
    'Your shoulders loosen, as if Norrath had forgiven a small debt.',
  ],
  1: [
    'The road ahead looks possible again—not easy, just possible.',
    'Something unclenches; the next step feels like a choice, not a habit.',
  ],
  2: [
    'The air remembers how to move through you, not only past you.',
    'You catch yourself listening before you strike.',
  ],
  3: [
    'The old hunger for sense stirs, faint but faithful.',
    'Victory tastes like something again, even if you cannot name the spice.',
  ],
  4: [
    'The weight on your thoughts thins to something you can carry.',
    'You feel room to be curious again.',
  ],
};

function pickWhisper(session, poolByDest, destIdx) {
  const char = session.char;
  const pool = poolByDest[destIdx] || poolByDest[Math.min(destIdx, 5)] || ['Something shifts.'];
  const salt = Number(char?.id) || 0;
  const i = Math.abs(salt + destIdx * 17 + destIdx * destIdx * 3) % pool.length;
  return pool[i];
}

function getTierIndex(fatigue) {
  const f = Math.max(0, Math.min(MAX_FATIGUE, fatigue || 0));
  if (f < 167) return 0;
  if (f < 333) return 1;
  if (f < 500) return 2;
  if (f < 667) return 3;
  if (f < 833) return 4;
  return 5;
}

function getKillXpMultiplier(fatigue) {
  const idx = getTierIndex(fatigue);
  if (idx >= 5) return 0.75;
  if (idx >= 4) return 0.95;
  if (idx === 0) return 1.02;
  return 1;
}

function xpSpanForLevel(level) {
  const lv = Math.max(1, level || 1);
  return Math.max(1, xpForLevel(lv + 1) - xpForLevel(lv));
}

function clampChar(char) {
  if (char.learningFatigue == null || !Number.isFinite(char.learningFatigue)) char.learningFatigue = 0;
  char.learningFatigue = Math.max(0, Math.min(MAX_FATIGUE, char.learningFatigue));
}

function notifyTierChange(session, sendCombatLog, prevIdx, newIdx) {
  if (!sendCombatLog || prevIdx === newIdx) return;
  if (newIdx > prevIdx) {
    const text = pickWhisper(session, WHISPERS_ON_RISE, newIdx);
    sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=silver]${text}[/color]` }]);
  } else if (newIdx < prevIdx) {
    const text = pickWhisper(session, WHISPERS_ON_EASE, newIdx);
    sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=green]${text}[/color]` }]);
  }
}

function addFromKillXp(session, rawKillXp, sendCombatLog) {
  const char = session.char;
  if (!char || rawKillXp <= 0) return;
  clampChar(char);
  const prev = getTierIndex(char.learningFatigue);
  const span = xpSpanForLevel(char.level);
  const gain = (rawKillXp / span) * KILL_FATIGUE_PER_LEVEL_RATIO;
  char.learningFatigue = Math.min(MAX_FATIGUE, char.learningFatigue + gain);
  notifyTierChange(session, sendCombatLog, prev, getTierIndex(char.learningFatigue));
}

function relieveFromRestorativeXp(session, xpAmount, sendCombatLog) {
  const char = session.char;
  if (!char || xpAmount <= 0) return;
  clampChar(char);
  const prev = getTierIndex(char.learningFatigue);
  const span = xpSpanForLevel(char.level);
  const drop = (xpAmount / span) * RESTORATIVE_RELIEF_PER_LEVEL_RATIO;
  char.learningFatigue = Math.max(0, char.learningFatigue - drop);
  notifyTierChange(session, sendCombatLog, prev, getTierIndex(char.learningFatigue));
}

function relieveFromRpTick(session, sendCombatLog) {
  const char = session.char;
  if (!char) return;
  clampChar(char);
  const prev = getTierIndex(char.learningFatigue);
  char.learningFatigue = Math.max(0, char.learningFatigue - RP_TICK_RELIEF);
  notifyTierChange(session, sendCombatLog, prev, getTierIndex(char.learningFatigue));
}

function relieveInGameHour(session, sendCombatLog) {
  const ticks = session._norrathHourPresenceTicks | 0;
  session._norrathHourPresenceTicks = 0;

  if (session.isBot) return;

  const char = session.char;
  if (!char || char.state === 'dead') return;
  if (ticks < FULL_NORRATH_HOUR_TICKS) return;

  clampChar(char);
  const prev = getTierIndex(char.learningFatigue);
  char.learningFatigue = Math.max(0, char.learningFatigue - HOUR_RELIEF_FATIGUE);
  notifyTierChange(session, sendCombatLog, prev, getTierIndex(char.learningFatigue));
}

function pickMurmur(char, tierIdx) {
  const sky = MIND_SKIES[Math.min(tierIdx, MIND_SKIES.length - 1)];
  const murmurs = MURMURS_BY_SKY[sky] || MURMURS_BY_SKY.lucid;
  const hour = Math.floor(Date.now() / 3600000);
  const i = Math.abs((Number(char.id) || 0) + tierIdx * 11 + hour) % murmurs.length;
  return { sky, murmur: murmurs[i] };
}

/**
 * Opaque hints for UI — no raw fatigue, tiers, or multipliers.
 */
function statusPayload(char) {
  clampChar(char);
  const tier = getTierIndex(char.learningFatigue);
  const { sky, murmur } = pickMurmur(char, tier);
  return {
    mindSky: sky,
    mindMurmur: murmur,
  };
}

module.exports = {
  MAX_FATIGUE,
  FULL_NORRATH_HOUR_TICKS,
  getTierIndex,
  getKillXpMultiplier,
  addFromKillXp,
  relieveFromRestorativeXp,
  relieveFromRpTick,
  relieveInGameHour,
  statusPayload,
};
