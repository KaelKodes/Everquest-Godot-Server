const { NPC_TYPES } = require('../data/npcTypes');

function mapEqemuClassToNpcType(eqClass) {
  if (eqClass === 41 || eqClass === 61) return NPC_TYPES.MERCHANT;
  if (eqClass === 40) return NPC_TYPES.BANK;
  if ((eqClass >= 20 && eqClass <= 35) || eqClass === 63) return NPC_TYPES.TRAINER;
  return NPC_TYPES.MOB;
}

const GUILD_MASTER_CLASS = {
  1: 'warrior', 2: 'cleric', 3: 'paladin', 4: 'ranger',
  5: 'shadow_knight', 6: 'druid', 7: 'monk', 8: 'bard',
  9: 'rogue', 10: 'shaman', 11: 'necromancer', 12: 'wizard',
  13: 'magician', 14: 'enchanter', 15: 'beastlord', 16: 'berserker',
  20: 'warrior', 21: 'cleric', 22: 'paladin', 23: 'ranger',
  24: 'shadow_knight', 25: 'druid', 26: 'monk', 27: 'bard',
  28: 'rogue', 29: 'shaman', 30: 'necromancer', 31: 'wizard',
  32: 'magician', 33: 'enchanter', 34: 'beastlord', 35: 'berserker'
};

const constants = require('../data/constants');
const CLASSES_MAP = constants.CLASSES;

function getTaughtClassId(npcClass) {
  const className = GUILD_MASTER_CLASS[npcClass];
  if (!className) return null;
  return CLASSES_MAP[className] || null;
}

module.exports = {
  mapEqemuClassToNpcType,
  GUILD_MASTER_CLASS,
  CLASSES_MAP,
  getTaughtClassId
};
