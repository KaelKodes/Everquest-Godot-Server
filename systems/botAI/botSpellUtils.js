'use strict';

const SpellDB = require('../../data/spellDatabase');

/** @param {object} session */
function memmedSlotForSpellKey(session, spellKey) {
  if (!session || !spellKey) return null;
  const row = (session.spells || []).find((s) => s.spell_key === spellKey);
  return row != null ? row.slot : null;
}

function memmedSlotForSpellName(session, spellName) {
  const def = SpellDB.getByName(spellName);
  if (!def || !def._key) return null;
  return memmedSlotForSpellKey(session, def._key);
}

/** First memmed spell in list order (exact SpellDB names). */
function pickFirstMemmedByNames(session, namesInPriorityOrder) {
  for (const name of namesInPriorityOrder) {
    const slot = memmedSlotForSpellName(session, name);
    if (slot != null) {
      const def = SpellDB.getByName(name);
      if (def) return { name, slot, def };
    }
  }
  return null;
}

function eachMemmed(session) {
  const out = [];
  for (const row of (session && session.spells) || []) {
    const def = SpellDB.getByKey(row.spell_key);
    if (!def) continue;
    out.push({
      name: def.name,
      slot: row.slot,
      def,
      level: def.level || 0,
    });
  }
  return out;
}

/** Highest-level memorized spell matching `pred(def)`. */
function pickBestMemmed(session, pred) {
  let best = null;
  for (const spell of eachMemmed(session)) {
    if (!pred(spell.def)) continue;
    if (!best || spell.level >= best.level) best = spell;
  }
  return best;
}

/** Lowest-level memorized spell matching `pred(def)`. Used for cheap tags. */
function pickCheapestMemmed(session, pred) {
  let best = null;
  for (const spell of eachMemmed(session)) {
    if (!pred(spell.def)) continue;
    if (!best || spell.level < best.level) best = spell;
  }
  return best;
}

function hasSpa(def, spa, direction) {
  return (def.effects || []).some((e) => {
    if (e.spa !== spa) return false;
    if (direction == null) return true;
    return direction < 0 ? e.base < 0 : e.base > 0;
  });
}

// Not party upkeep: invis, invis vs undead/animals, charm, bind, gate, cancel,
// mez, summon, divine aura, illusion.
const SKIP_BUFF_SPA = [12, 22, 25, 26, 27, 28, 29, 31, 32, 33, 40, 58];

/**
 * A beneficial buff she should keep on people. Short panic spells (under
 * three minutes) are left out so she does not recast them in a loop.
 */
function isPartyBuff(def) {
  if (!def || def.effect !== 'buff' || !def.goodEffect) return false;
  const seconds = Number(def.duration) || 0;
  if (seconds < 180) return false;
  if (SKIP_BUFF_SPA.some((spa) => hasSpa(def, spa))) return false;
  return true;
}

function effectSignature(def) {
  const spas = [...new Set((def.effects || []).filter((e) => e.base !== 0).map((e) => e.spa))];
  spas.sort((a, b) => a - b);
  return spas.join(',') || 'none';
}

/**
 * Spells that replace each other. A shared stacking group is one line
 * (Courage, Center, Symbol). When the data leaves the group at 0, the
 * same non-zero effects are one line (Holy Armor, Spirit Armor).
 */
function lineKey(def) {
  const id = def && def.stacking && Number(def.stacking.spellGroupId);
  if (id) return `g:${id}`;
  return `e:${effectSignature(def)}`;
}

function lineRank(def) {
  const rank = def && def.stacking && Number(def.stacking.spellGroupRank);
  if (rank) return rank;
  return Number(def && def.level) || 0;
}

function spellPower(def) {
  return Number(def && def.level) || 0;
}

function betterBuff(a, b) {
  const pa = spellPower(a.def);
  const pb = spellPower(b.def);
  if (pa !== pb) return pa > pb ? a : b;
  return lineRank(a.def) >= lineRank(b.def) ? a : b;
}

function coversWant(have, want) {
  if (!have || !want || lineKey(have) !== lineKey(want)) return false;
  const haveLvl = spellPower(have);
  const wantLvl = spellPower(want);
  if (haveLvl !== wantLvl) return haveLvl > wantLvl;
  return lineRank(have) >= lineRank(want);
}

function isSelfBuffTarget(def) {
  return !!(def && def.targetType && def.targetType.id === 6);
}

function isGroupBuffTarget(def) {
  const id = def && def.targetType && def.targetType.id;
  return id === 3 || id === 41;
}

/** Best memorized buff in each stacking line. A weaker spell in the same line is not kept up beside it. */
function partyBuffsToKeep(session) {
  const best = new Map();
  for (const spell of eachMemmed(session)) {
    if (!isPartyBuff(spell.def)) continue;
    const key = lineKey(spell.def);
    const prev = best.get(key);
    if (!prev || betterBuff(spell, prev) === spell) best.set(key, spell);
  }
  return [...best.values()].sort((a, b) => (b.level || 0) - (a.level || 0));
}

function buffSpellDef(buff) {
  if (!buff) return null;
  if (buff.spellId != null) {
    const byId = SpellDB.getById(buff.spellId);
    if (byId) return byId;
  }
  if (buff.name && SpellDB.generateSpellKey) {
    const byKey = SpellDB.getByKey(SpellDB.generateSpellKey(buff.name));
    if (byKey && String(byKey.name).toLowerCase() === String(buff.name).toLowerCase()) return byKey;
  }
  if (buff.name) return SpellDB.getByName(buff.name);
  return null;
}

/** True when the buff is in its last stretch and should be cast again before it drops. */
function isBuffFading(buff) {
  const left = Number(buff && buff.duration) || 0;
  const max = Number(buff && buff.maxDuration) || left;
  if (left <= 0) return true;
  const window = Math.min(60, Math.max(18, max * 0.08));
  return left <= window;
}

/**
 * up: this spell, or a stronger one in the same line, is still solid.
 * fading: this spell is about to wear off.
 * weaker: an older spell in the line is on them.
 * missing: nothing in the line.
 * away: dead or in another zone.
 */
function buffHold(session, member, spell) {
  if (!member || !member.char || !session || !session.char) return 'away';
  if ((member.char.hp || 0) <= 0 || member.char.state === 'dead') return 'away';
  if (member.char.zoneId !== session.char.zoneId) return 'away';

  const wantName = String(spell.name || '').toLowerCase();
  let weaker = false;
  for (const buff of member.buffs || []) {
    if (buff.beneficial === false) continue;
    const def = buffSpellDef(buff);
    const same = (def && spell.def && def.id === spell.def.id)
      || String(buff.name || '').toLowerCase() === wantName;
    const sameLine = !!(def && lineKey(def) === lineKey(spell.def));
    if (!same && !sameLine) continue;
    if (isBuffFading(buff)) {
      if (same) return 'fading';
      continue;
    }
    if (same || coversWant(def, spell.def)) return 'up';
    if (sameLine) weaker = true;
  }
  return weaker ? 'weaker' : 'missing';
}

function withinBuffReach(session, member, spell) {
  if (buffHold(session, member, spell) === 'away') return false;
  if (member === session) return true;
  const range = (spell.def && spell.def.range && spell.def.range.range) || 100;
  const dist = Math.hypot(
    (member.char.x || 0) - (session.char.x || 0),
    (member.char.y || 0) - (session.char.y || 0),
  );
  return dist <= Number(range) + 20;
}

function partyBuffTargets(session, spell) {
  const group = session && session.group;
  const members = (group && group.members && group.members.length) ? group.members : [session];
  if (isSelfBuffTarget(spell.def)) return [session];
  return members.filter((member) => member && member.char);
}

function needsPartyBuff(session, member, spell) {
  const hold = buffHold(session, member, spell);
  if (hold !== 'missing' && hold !== 'fading' && hold !== 'weaker') return false;
  return withinBuffReach(session, member, spell);
}

function joinNames(names) {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

function describePartyBuffs(session) {
  const kept = partyBuffsToKeep(session);
  const cls = session && session.char && String(session.char.class || '').toLowerCase();
  if (!kept.length) {
    if (cls !== 'cleric') return '';
    const inBook = [];
    const seen = new Set();
    for (const row of (session.spellbook || [])) {
      const def = SpellDB.getByKey(row.spell_key);
      if (!def || !isPartyBuff(def) || seen.has(def.id)) continue;
      seen.add(def.id);
      inBook.push(def.name);
    }
    if (!inBook.length) return 'Buffs: none memorized.';
    return `Buffs: none on the spell bar. In the book, not memorized: ${inBook.slice(0, 8).join(', ')}.`;
  }

  const parts = [];
  for (const spell of kept) {
    const up = [];
    const fading = [];
    const missing = [];
    const away = [];
    for (const member of partyBuffTargets(session, spell)) {
      const name = member.char.name;
      const hold = buffHold(session, member, spell);
      if (hold === 'up') up.push(name);
      else if (hold === 'fading') fading.push(name);
      else if (hold === 'away') away.push(name);
      else missing.push(name);
    }
    const notes = [];
    if (up.length) notes.push(`up on ${joinNames(up)}`);
    if (fading.length) notes.push(`about to wear off on ${joinNames(fading)}`);
    if (missing.length) notes.push(`missing on ${joinNames(missing)}`);
    if (away.length) notes.push(`${joinNames(away)} not here`);
    parts.push(`${spell.name}: ${notes.join('; ')}`);
  }
  return `Buffs: ${parts.join('. ')}.`;
}

module.exports = {
  memmedSlotForSpellKey,
  memmedSlotForSpellName,
  pickFirstMemmedByNames,
  eachMemmed,
  pickBestMemmed,
  pickCheapestMemmed,
  hasSpa,
  isPartyBuff,
  isGroupBuffTarget,
  partyBuffsToKeep,
  partyBuffTargets,
  buffHold,
  withinBuffReach,
  needsPartyBuff,
  describePartyBuffs,
};
