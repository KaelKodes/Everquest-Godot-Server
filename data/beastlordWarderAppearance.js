/**
 * Beastlord warder visuals (EQEmu pets_beastlord_data + custom race overrides).
 * petRace drives client scale via race_models.json; modelCode overrides the GLB when set.
 */

/** @type {Record<number, { petRace: number, texture: number, helmTexture: number, gender: number, face: number, sizeModifier: number, modelCode?: string }>} */
const BY_PLAYER_RACE = {
  // Live EQ defaults
  2: { petRace: 42, texture: 2, helmTexture: 0, gender: 0, face: 0, sizeModifier: 1.0, modelCode: 'wol' },       // Barbarian — white wolf
  9: { petRace: 91, texture: 0, helmTexture: 0, gender: 0, face: 0, sizeModifier: 2.5, modelCode: 'all' },       // Troll — basilisk
  10: { petRace: 43, texture: 3, helmTexture: 0, gender: 0, face: 0, sizeModifier: 1.0, modelCode: 'bea' },      // Ogre — bear
  128: { petRace: 42, texture: 0, helmTexture: 0, gender: 1, face: 0, sizeModifier: 2.0, modelCode: 'wol' },     // Iksar — large wolf
  130: { petRace: 63, texture: 0, helmTexture: 0, gender: 0, face: 0, sizeModifier: 0.8, modelCode: 'tig' },     // Vah Shir — tiger

  // Custom combos (EQMUD)
  8: { petRace: 43, texture: 3, helmTexture: 0, gender: 0, face: 0, sizeModifier: 1.0, modelCode: 'bea' },       // Dwarf — ogre bear
  7: { petRace: 42, texture: 0, helmTexture: 0, gender: 0, face: 0, sizeModifier: 1.0, modelCode: 'wol_00' },   // Half-elf — black wolf
};

const FALLBACK = BY_PLAYER_RACE[2];

function getBeastlordWarderAppearance(playerRaceId) {
  const race = Number(playerRaceId) || 0;
  return BY_PLAYER_RACE[race] || FALLBACK;
}

module.exports = { getBeastlordWarderAppearance, BY_PLAYER_RACE };
