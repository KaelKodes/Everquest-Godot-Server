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
      if (cache.location) await eqemuDB.saveCharacterLocation(charId, cache.location.zoneId, cache.location.x, cache.location.y, cache.location.z);
      if (cache.buffs) await eqemuDB.saveCharacterBuffs(charId, cache.buffs);
      count++;
    } catch (err) {
      console.error(`[DB] Background flush failed for character ${charId}:`, err);
    }
  }
  if (count > 0) console.log(`[DB] Background flushed data for ${count} characters.`);
}

// Flush every 30 seconds (Reduced from 60s for better responsiveness with heartbeat saves)
setInterval(flushWriteBehindCache, 30000);

async function forceFlushCharacter(charId) {
  const cache = writeBehindCache.get(charId);
  if (cache) {
    writeBehindCache.delete(charId);
    if (cache.state) await eqemuDB.updateCharacterState(cache.state);
    if (cache.skills) await eqemuDB.saveCharacterSkills(charId, cache.skills);
    if (cache.location) await eqemuDB.saveCharacterLocation(charId, cache.location.zoneId, cache.location.x, cache.location.y, cache.location.z);
  }
}

module.exports = {
  initDatabase,
  loginAccount: eqemuDB.loginAccount,
  createAccount: eqemuDB.createAccount,
  getCharactersByAccount: eqemuDB.getCharactersByAccount,
  getCharCreateData: eqemuDB.getCharCreateData,
  getStartZone: eqemuDB.getStartZone,
  getValidDeities: eqemuDB.getValidDeities,
  getCharacter: eqemuDB.getCharacter,
  getCharacterById: eqemuDB.getCharacterById,
  getMentorStudents: eqemuDB.getMentorStudents,
  countStudentsForMentor: eqemuDB.countStudentsForMentor,
  countMainsForAccount: eqemuDB.countMainsForAccount,
  createCharacter: eqemuDB.createCharacter,
  deleteCharacter: eqemuDB.deleteCharacter,
  
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
  saveCharacterLocation: (charId, zoneId, x, y, z) => {
    if (!writeBehindCache.has(charId)) writeBehindCache.set(charId, {});
    writeBehindCache.get(charId).location = { zoneId, x, y, z };
  },

  // Efficient Light Save (Location & Basic State)
  saveLight: (session) => {
    if (!session || !session.char) return;
    const char = session.char;
    if (!writeBehindCache.has(char.id)) writeBehindCache.set(char.id, {});
    const cache = writeBehindCache.get(char.id);
    
    // Light state: HP, Mana, Position
    cache.state = { 
        id: char.id,
        hp: char.hp, 
        mana: char.mana, 
        state: char.state,
        x: char.x, 
        y: char.y, 
        z: char.z, 
        heading: char.heading,
        zoneId: char.zoneId,
        roomId: char.roomId
    };
    cache.location = { zoneId: char.zoneId, x: char.x, y: char.y, z: char.z || 0 };
  },

  forceFlushCharacter,
  flushWriteBehindCache,

  // Passthroughs
  getArchiveShortName: eqemuDB.getArchiveShortName,
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
  reduceItemStackAtSlot: eqemuDB.reduceItemStackAtSlot,
  moveItem: eqemuDB.moveItem,
  splitStackToSlot: eqemuDB.splitStackToSlot,
  getCharacterFactionValues: eqemuDB.getCharacterFactionValues,
  updateCharacterFactionValue: eqemuDB.updateCharacterFactionValue,
  getFactionCaches: eqemuDB.getFactionCaches,
  addBuybackItem: eqemuDB.addBuybackItem,
  getBuybackItems: eqemuDB.getBuybackItems,
  removeBuybackItem: eqemuDB.removeBuybackItem,
  updateCharacterBind: eqemuDB.updateCharacterBind,
  getCharacterStudents: eqemuDB.getCharacterStudents,
  createCharacterStudent: eqemuDB.createCharacterStudent,
  getCharacterSpellbook: eqemuDB.getCharacterSpellbook,
  saveCharacterSpellbook: eqemuDB.saveCharacterSpellbook,
  getCharacterSpellLoadouts: eqemuDB.getCharacterSpellLoadouts,
  saveCharacterSpellLoadouts: eqemuDB.saveCharacterSpellLoadouts,
  getCharacterBuffs: eqemuDB.getCharacterBuffs,
  saveCharacterBuffs: eqemuDB.saveCharacterBuffs,
  rollLootFromTable: eqemuDB.rollLootFromTable
  ,
  // Persistent player corpses
  savePlayerCorpse: eqemuDB.savePlayerCorpse,
  getPlayerCorpsesForZone: eqemuDB.getPlayerCorpsesForZone,
  updatePlayerCorpse: eqemuDB.updatePlayerCorpse,
  deletePlayerCorpse: eqemuDB.deletePlayerCorpse,
  appendLootConsentForCharacterCorpses: eqemuDB.appendLootConsentForCharacterCorpses,
  removeLootConsentForCharacterCorpses: eqemuDB.removeLootConsentForCharacterCorpses,
  clearLootConsentForCharacterCorpses: eqemuDB.clearLootConsentForCharacterCorpses
  ,
  // Zone routing (DB-backed)
  refreshZoneRoutingCache: eqemuDB.refreshZoneRoutingCache,
  getZoneRoute: eqemuDB.getZoneRoute,
  upsertZoneRoute: eqemuDB.upsertZoneRoute
};
