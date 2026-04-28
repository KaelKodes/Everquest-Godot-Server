const eqemuDB = require('./eqemu_db');

async function initDatabase() {
    await eqemuDB.init();
    console.log('[DB] Database API wrapper initialized.');
}

// We can just proxy everything from eqemu_db
module.exports = {
  initDatabase,
  loginAccount: eqemuDB.loginAccount,
  createAccount: eqemuDB.createAccount,
  getCharactersByAccount: eqemuDB.getCharactersByAccount,
  getStartZone: eqemuDB.getStartZone,
  getValidDeities: eqemuDB.getValidDeities,
  getCharacter: eqemuDB.getCharacter,
  createCharacter: eqemuDB.createCharacter,
  updateCharacterState: eqemuDB.updateCharacterState,
  getInventory: eqemuDB.getInventory,
  addItem: eqemuDB.addItem,
  updateItemQuantity: eqemuDB.updateItemQuantity,
  equipItem: eqemuDB.equipItem,
  unequipItem: eqemuDB.unequipItem,
  getSpells: eqemuDB.getSpells,
  memorizeSpell: eqemuDB.memorizeSpell,
  forgetSpell: eqemuDB.forgetSpell,
  getSkills: eqemuDB.getSkills,
  saveCharacterSkills: eqemuDB.saveCharacterSkills,
  unequipSlot: eqemuDB.unequipSlot,
  deleteItem: eqemuDB.deleteItem,
  moveItem: eqemuDB.moveItem,
  saveCharacterLocation: eqemuDB.saveCharacterLocation,
};

