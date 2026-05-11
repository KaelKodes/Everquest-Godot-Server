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

module.exports = {
  memmedSlotForSpellKey,
  memmedSlotForSpellName,
  pickFirstMemmedByNames,
};
