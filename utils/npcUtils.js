const { NPC_TYPES } = require('../data/npcTypes');

function mapEqemuClassToNpcType(eqClass) {
  if (eqClass === 41 || eqClass === 61) return NPC_TYPES.MERCHANT;
  if (eqClass === 40) return NPC_TYPES.BANK;
  if ((eqClass >= 20 && eqClass <= 35) || eqClass === 63) return NPC_TYPES.TRAINER;
  return NPC_TYPES.MOB;
}

const GUILD_MASTER_CLASS = {
  1: 'warrior', 2: 'cleric', 3: 'paladin', 4: 'ranger',
  5: 'shadowknight', 6: 'druid', 7: 'monk', 8: 'bard',
  9: 'rogue', 10: 'shaman', 11: 'necromancer', 12: 'wizard',
  13: 'magician', 14: 'enchanter', 15: 'beastlord', 16: 'berserker',
  20: 'warrior', 21: 'cleric', 22: 'paladin', 23: 'ranger',
  24: 'shadowknight', 25: 'druid', 26: 'monk', 27: 'bard',
  28: 'rogue', 29: 'shaman', 30: 'necromancer', 31: 'wizard',
  32: 'magician', 33: 'enchanter', 34: 'beastlord', 35: 'berserker'
};

const CLASSES_MAP = { 
  warrior: 1, cleric: 2, paladin: 3, ranger: 4, shadowknight: 5, druid: 6, monk: 7, bard: 8, 
  rogue: 9, shaman: 10, necromancer: 11, wizard: 12, magician: 13, enchanter: 14, beastlord: 15, berserker: 16 
};

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
