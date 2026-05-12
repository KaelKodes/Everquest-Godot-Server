// P99-style forage fallback when PEQ `forage` table is empty or missing.
// Classic common-food IDs match EQEmu Client::ForageItem defaults.

const ALL_NORRATH = [
  { id: 13046, w: 2 }, // Fruit
  { id: 13045, w: 2 }, // Berries
  { id: 13419, w: 2 }, // Vegetables
  { id: 13048, w: 2 }, // Rabbit Meat
  { id: 13047, w: 2 }, // Roots
  { id: 13044, w: 2 }, // Pod of Water
  { id: 13106, w: 1 }, // Fishing Grubs
];

/** @typedef {{ id?: number, name?: string, w: number }} ForageEntry */

function resolveEntry(entry, ItemDB, ITEMS) {
  if (entry.id != null) {
    const def = ItemDB.getById(entry.id) || ITEMS[entry.id];
    if (def) return { itemKey: Number(entry.id), def };
  }
  if (entry.name) {
    const def = ItemDB.getByName(entry.name);
    if (def) return { itemKey: def._id, def };
  }
  return null;
}

function buildWeightedResolved(pool, ItemDB, ITEMS) {
  const out = [];
  for (const e of pool) {
    const r = resolveEntry(e, ItemDB, ITEMS);
    if (r) out.push({ w: e.w, itemKey: r.itemKey, def: r.def });
  }
  return out;
}

function weightedPick(resolved) {
  if (!resolved.length) return null;
  const total = resolved.reduce((s, x) => s + x.w, 0);
  if (total <= 0) return resolved[0];
  let roll = Math.random() * total;
  for (const x of resolved) {
    roll -= x.w;
    if (roll <= 0) return x;
  }
  return resolved[resolved.length - 1];
}

/**
 * Weighted fallback when `eqemu_db.rollForageItemId` returns null.
 * @param {*} ItemDB
 * @param {*} ITEMS
 */
function pickFallbackForageItem(ItemDB, ITEMS) {
  const baseResolved = buildWeightedResolved(ALL_NORRATH, ItemDB, ITEMS);
  if (!baseResolved.length) return null;
  return weightedPick(baseResolved);
}

/** P99 chat strings */
function forageSuccessMessage(def) {
  if (!def) return 'You have scrounged up something that doesn\'t look edible.';
  const t = Number(def.itemtype);
  const name = (def.name || '').toLowerCase();
  if (name.includes('grub')) return 'You have scrounged up some fishing grubs.';
  if (name.includes('water')) return 'You have scrounged up some water.';
  if (t === 14) return 'You have scrounged up some food.';
  if (t === 15) return 'You have scrounged up some water.';
  return 'You have scrounged up something that doesn\'t look edible.';
}

module.exports = {
  ALL_NORRATH,
  pickFallbackForageItem,
  forageSuccessMessage,
};
