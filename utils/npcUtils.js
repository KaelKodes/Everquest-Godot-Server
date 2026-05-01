const { NPC_TYPES } = require('../data/npcTypes');

function mapEqemuClassToNpcType(eqClass) {
  if (eqClass === 41 || eqClass === 61) return NPC_TYPES.MERCHANT;
  if (eqClass === 40) return NPC_TYPES.BANK;
  if ((eqClass >= 20 && eqClass <= 35) || eqClass === 63) return NPC_TYPES.TRAINER;
  return NPC_TYPES.MOB;
}

const GUILD_MASTER_CLASS = {
  20: 'warrior', 21: 'cleric', 22: 'paladin', 23: 'ranger',
  24: 'rogue',   25: 'shadowknight', 26: 'druid', 27: 'monk',
  28: 'bard',    29: 'rogue', 31: 'wizard', 32: 'magician',
  33: 'necromancer', 34: 'enchanter', 35: 'shaman'
};

module.exports = {
  mapEqemuClassToNpcType,
  GUILD_MASTER_CLASS,
};
