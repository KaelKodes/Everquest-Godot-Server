'use strict';

function normalizeCorpseName(n) {
  return (n || '').trim().toLowerCase();
}

/**
 * Player corpses use lootLockGroup / lootLockUntil. Owner, groupmates of owner,
 * and names in lootConsentNames (from /consent) may loot.
 */
function canLootLockedCorpse(corpse, session) {
  const char = session.char;
  if (!corpse.lootLockUntil || corpse.lootLockUntil <= Date.now()) return true;
  if (!corpse.lootLockGroup) return true;

  const me = normalizeCorpseName(char.name);
  if (normalizeCorpseName(corpse.lootLockGroup) === me) return true;
  if (corpse.isNpc === false && corpse.originalName && normalizeCorpseName(corpse.originalName) === me) {
    return true;
  }

  const consent = Array.isArray(corpse.lootConsentNames)
    ? corpse.lootConsentNames.map(normalizeCorpseName)
    : [];
  if (consent.includes(me)) return true;

  if (session.group && corpse.lootLockGroup) {
    const ownerNorm = normalizeCorpseName(corpse.lootLockGroup);
    if (session.group.members.some(m => normalizeCorpseName(m.char.name) === ownerNorm)) return true;
  }
  return false;
}

module.exports = { canLootLockedCorpse, normalizeCorpseName };
