const CLASSES = { warrior: 1, cleric: 2, paladin: 3, ranger: 4, shadow_knight: 5, druid: 6, monk: 7, bard: 8, rogue: 9, shaman: 10, necromancer: 11, wizard: 12, magician: 13, enchanter: 14, beastlord: 15, berserker: 16 };
const RACES = { human: 1, barbarian: 2, erudite: 3, wood_elf: 4, high_elf: 5, dark_elf: 6, half_elf: 7, dwarf: 8, troll: 9, ogre: 10, halfling: 11, gnome: 12, iksar: 128, vah_shir: 130, froglok: 330 };
const INV_CLASSES = Object.fromEntries(Object.entries(CLASSES).map(([k, v]) => [v, k]));
const INV_RACES = Object.fromEntries(Object.entries(RACES).map(([k, v]) => [v, k]));
module.exports = { CLASSES, RACES, INV_CLASSES, INV_RACES };
