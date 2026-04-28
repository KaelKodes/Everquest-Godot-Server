const SUPPLEMENTAL_ITEMS = require('./items_supplemental');

const ITEMS = {
  // ─── Loot Drops ───
  fire_beetle_eye: {
    name: 'Fire Beetle Eye',
    type: 'tradeskill',
    slot: 0,
    weight: 0.1,
    value: 1,
  },
  fire_beetle_leg: {
    name: 'Fire Beetle Leg',
    type: 'tradeskill',
    slot: 0,
    weight: 0.3,
    value: 1,
  },
  rat_whiskers: {
    name: 'Rat Whiskers',
    type: 'tradeskill',
    slot: 0,
    weight: 0.1,
    value: 1,
  },
  wolf_pelt: {
    name: 'Wolf Pelt',
    type: 'tradeskill',
    slot: 0,
    weight: 1.0,
    value: 3,
  },
  gnoll_fang: {
    name: 'Gnoll Fang',
    type: 'tradeskill',
    slot: 0,
    weight: 0.1,
    value: 2,
  },
  lion_skin: {
    name: 'Lion Skin',
    type: 'tradeskill',
    slot: 0,
    weight: 2.0,
    value: 8,
  },
  scarecrow_straw: {
    name: 'Scarecrow Straw',
    type: 'tradeskill',
    slot: 0,
    weight: 0.5,
    value: 2,
  },
  giant_toenail: {
    name: 'Giant Toenail',
    type: 'tradeskill',
    slot: 0,
    weight: 3.0,
    value: 50,
  },
  griffon_feather: {
    name: 'Griffon Feather',
    type: 'tradeskill',
    slot: 0,
    weight: 0.2,
    value: 15,
  },

  // ─── Weapons ───
  rusty_short_sword: {
    name: 'Rusty Short Sword',
    type: 'weapon',
    slot: 13,
    damage: 3,
    delay: 25,
    weight: 3.5,
    value: 2,
  },
  bronze_long_sword: {
    name: 'Bronze Long Sword',
    type: 'weapon',
    slot: 13,
    damage: 7,
    delay: 35,
    weight: 7.0,
    value: 25,
  },
  worn_great_staff: {
    name: 'Worn Great Staff',
    type: 'weapon',
    slot: 13,
    damage: 5,
    delay: 30,
    weight: 5.0,
    value: 5,
    wis: 2,
    mana: 5,
  },

  // ─── Armor ───
  cloth_cap: {
    name: 'Cloth Cap',
    type: 'armor',
    slot: 2,
    ac: 1,
    weight: 0.3,
    value: 1,
  },
  tattered_tunic: {
    name: 'Tattered Tunic',
    type: 'armor',
    slot: 17,
    ac: 2,
    weight: 2.0,
    value: 3,
  },
  leather_gloves: {
    name: 'Leather Gloves',
    type: 'armor',
    slot: 12,
    ac: 2,
    weight: 1.0,
    value: 4,
    dex: 1,
  },
  bronze_helm: {
    name: 'Bronze Helm',
    type: 'armor',
    slot: 2,
    ac: 5,
    weight: 4.5,
    value: 20,
    sta: 2,
  },
  bronze_breastplate: {
    name: 'Bronze Breastplate',
    type: 'armor',
    slot: 17,
    ac: 10,
    weight: 8.0,
    value: 50,
    hp: 10,
    sta: 3,
  },

  // ─── Starter / Vendor ───
  torch: {
    name: 'Torch',
    type: 'light',
    slot: 0,
    weight: 0.5,
    value: 2,
    light: 7,
  },
  bread: {
    name: 'Bread',
    type: 'food',
    slot: 0,
    weight: 0.2,
    value: 1,
  },
  water: {
    name: 'Water Flask',
    type: 'drink',
    slot: 0,
    weight: 0.5,
    value: 1,
  },

  // ─── Summoned Items (created by spells) ───
  summoned_food: {
    name: 'Summoned Food',
    type: 'food',
    slot: 0,
    weight: 0.1,
    value: 0,
    summoned: true,
  },
  summoned_drink: {
    name: 'Summoned Drink',
    type: 'drink',
    slot: 0,
    weight: 0.1,
    value: 0,
    summoned: true,
  },
  summoned_bandages: {
    name: 'Summoned Bandages',
    type: 'general',
    slot: 0,
    weight: 0.1,
    value: 0,
    summoned: true,
  },
  summoned_dagger: {
    name: 'Summoned Dagger',
    type: 'weapon',
    slot: 13,
    damage: 5,
    delay: 23,
    weight: 1.5,
    value: 0,
    summoned: true,
  },
  summoned_hammer: {
    name: 'Summoned Hammer',
    type: 'weapon',
    slot: 13,
    damage: 8,
    delay: 30,
    weight: 5.0,
    value: 0,
    summoned: true,
  },
  summoned_arrows: {
    name: 'Summoned Arrows',
    type: 'ammo',
    slot: 21,
    weight: 0.1,
    value: 0,
    summoned: true,
  },
  summoned_light: {
    name: 'Summoned Light',
    type: 'general',
    slot: 0,
    weight: 0.0,
    value: 0,
    summoned: true,
  },

  // Merge in all supplemental items
  ...SUPPLEMENTAL_ITEMS
};

// EQ item ID → our item key mapping for summon spells
const SUMMON_ITEM_MAP = {
  // Food (13078 = bread variants)
  13078: 'summoned_food',
  10550: 'summoned_food',
  // Drink (13079 = water variants)
  13079: 'summoned_drink',
  10551: 'summoned_drink',
  // Bandages
  13081: 'summoned_bandages',
  // Daggers
  7310: 'summoned_dagger',
  8317: 'summoned_dagger',
  // Hammers
  6307: 'summoned_hammer',
  6309: 'summoned_hammer',
  // Arrows
  8316: 'summoned_arrows',
  // Light sources
  6350: 'summoned_light',
  6351: 'summoned_light',
};

// Starting gear per class - uses authentic EQEmu item IDs
// EQEmu slots: 0=charm, 1=ear1, 2=head, 3=face, 4=ear2, 5=neck, 6=shoulders, 7=arms,
//              8=back, 9=wrist1, 10=wrist2, 11=range, 12=hands, 13=primary, 14=secondary,
//              17=chest, 18=legs, 19=feet, 20=waist, 21=ammo, 22-29=general inventory
const STARTER_GEAR = {
  warrior:       [{ itemId: 5013, slot: 13 }, { itemId: 1004, slot: 17 }, { itemId: 1001, slot: 2 }, { itemId: 16, slot: 22 }],  // Rusty Short Sword, Cloth Shirt, Cloth Cap, Torch
  cleric:        [{ itemId: 6012, slot: 13 }, { itemId: 1004, slot: 17 }, { itemId: 1001, slot: 2 }, { itemId: 16, slot: 22 }],  // Worn Great Staff, Cloth Shirt, Cloth Cap, Torch
  wizard:        [{ itemId: 6012, slot: 13 }, { itemId: 1004, slot: 17 }, { itemId: 1001, slot: 2 }, { itemId: 16, slot: 22 }],
  rogue:         [{ itemId: 5013, slot: 13 }, { itemId: 2010, slot: 12 }, { itemId: 1004, slot: 17 }, { itemId: 16, slot: 22 }], // Rusty Short Sword, Leather Gloves, Cloth Shirt, Torch
  paladin:       [{ itemId: 5013, slot: 13 }, { itemId: 1004, slot: 17 }, { itemId: 1001, slot: 2 }, { itemId: 16, slot: 22 }],
  shadow_knight: [{ itemId: 5013, slot: 13 }, { itemId: 1004, slot: 17 }, { itemId: 1001, slot: 2 }, { itemId: 16, slot: 22 }],
  ranger:        [{ itemId: 5013, slot: 13 }, { itemId: 1004, slot: 17 }, { itemId: 2010, slot: 12 }, { itemId: 16, slot: 22 }],
  bard:          [{ itemId: 5013, slot: 13 }, { itemId: 1004, slot: 17 }, { itemId: 2010, slot: 12 }, { itemId: 16, slot: 22 }],
  monk:          [{ itemId: 1004, slot: 17 }, { itemId: 1001, slot: 2 }, { itemId: 16, slot: 22 }],
  druid:         [{ itemId: 6012, slot: 13 }, { itemId: 1004, slot: 17 }, { itemId: 1001, slot: 2 }, { itemId: 16, slot: 22 }],
  shaman:        [{ itemId: 6012, slot: 13 }, { itemId: 1004, slot: 17 }, { itemId: 1001, slot: 2 }, { itemId: 16, slot: 22 }],
  necromancer:   [{ itemId: 6012, slot: 13 }, { itemId: 1004, slot: 17 }, { itemId: 1001, slot: 2 }, { itemId: 16, slot: 22 }],
  magician:      [{ itemId: 6012, slot: 13 }, { itemId: 1004, slot: 17 }, { itemId: 1001, slot: 2 }, { itemId: 16, slot: 22 }],
  enchanter:     [{ itemId: 6012, slot: 13 }, { itemId: 1004, slot: 17 }, { itemId: 1001, slot: 2 }, { itemId: 16, slot: 22 }],
};

module.exports = { ITEMS, STARTER_GEAR, SUMMON_ITEM_MAP };
