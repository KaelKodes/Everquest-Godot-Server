const eqemuDB = require('./eqemu_db');

async function initDatabase() {
    await eqemuDB.init();
    console.log('[DB] Database API wrapper initialized.');
}

// We proxy most things from eqemu_db, but intercept frequent updates for a Write-Behind Cache
const writeBehindCache = new Map();

// Flushes the write-behind cache to the database
async function flushWriteBehindCache() {
  if (writeBehindCache.size === 0) return;
  const chars = Array.from(writeBehindCache.entries());
  writeBehindCache.clear();
  
  let count = 0;
  for (const [charId, cache] of chars) {
    try {
      if (cache.state) await eqemuDB.updateCharacterState(cache.state);
      if (cache.skills) await eqemuDB.saveCharacterSkills(charId, cache.skills);
      if (cache.location) await eqemuDB.saveCharacterLocation(charId, cache.location.zoneId, cache.location.roomId);
      count++;
    } catch (err) {
      console.error(`[DB] Background flush failed for character ${charId}:`, err);
    }
  }
  if (count > 0) console.log(`[DB] Background flushed data for ${count} characters.`);
}

// Flush every 60 seconds
setInterval(flushWriteBehindCache, 60000);

async function forceFlushCharacter(charId) {
  const cache = writeBehindCache.get(charId);
  if (cache) {
    writeBehindCache.delete(charId);
    if (cache.state) await eqemuDB.updateCharacterState(cache.state);
    if (cache.skills) await eqemuDB.saveCharacterSkills(charId, cache.skills);
    if (cache.location) await eqemuDB.saveCharacterLocation(charId, cache.location.zoneId, cache.location.roomId);
  }
}

module.exports = {
  initDatabase,
  loginAccount: eqemuDB.loginAccount,
  createAccount: eqemuDB.createAccount,
  getCharactersByAccount: eqemuDB.getCharactersByAccount,
  getStartZone: eqemuDB.getStartZone,
  getValidDeities: eqemuDB.getValidDeities,
  getCharacter: eqemuDB.getCharacter,
  createCharacter: eqemuDB.createCharacter,
  
  // Write-Behind Cache interceptors
  updateCharacterState: (char) => {
    if (!writeBehindCache.has(char.id)) writeBehindCache.set(char.id, {});
    // Store a shallow copy to prevent reference mutation issues over time
    writeBehindCache.get(char.id).state = { ...char };
  },
  saveCharacterSkills: (charId, skills) => {
    if (!writeBehindCache.has(charId)) writeBehindCache.set(charId, {});
    writeBehindCache.get(charId).skills = { ...skills };
  },
  saveCharacterLocation: (charId, zoneId, roomId) => {
    if (!writeBehindCache.has(charId)) writeBehindCache.set(charId, {});
    writeBehindCache.get(charId).location = { zoneId, roomId };
  },
  forceFlushCharacter,
  flushWriteBehindCache,

  // Passthroughs
  getInventory: eqemuDB.getInventory,
  addItem: eqemuDB.addItem,
  updateItemQuantity: eqemuDB.updateItemQuantity,
  equipItem: eqemuDB.equipItem,
  unequipItem: eqemuDB.unequipItem,
  getSpells: eqemuDB.getSpells,
  memorizeSpell: eqemuDB.memorizeSpell,
  forgetSpell: eqemuDB.forgetSpell,
  getSkills: eqemuDB.getSkills,
  unequipSlot: eqemuDB.unequipSlot,
  deleteItem: eqemuDB.deleteItem,
  moveItem: eqemuDB.moveItem,
  getCharacterFactionValues: eqemuDB.getCharacterFactionValues,
  updateCharacterFactionValue: eqemuDB.updateCharacterFactionValue,
  getFactionCaches: eqemuDB.getFactionCaches,
  addBuybackItem: eqemuDB.addBuybackItem,
  getBuybackItems: eqemuDB.getBuybackItems,
  removeBuybackItem: eqemuDB.removeBuybackItem,
};
