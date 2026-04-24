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

  // Merge in all supplemental items
  ...SUPPLEMENTAL_ITEMS
};

// Starting gear per class - uses authentic EQEmu item IDs
// EQEmu slots: 0=charm, 1=ear1, 2=head, 3=face, 4=ear2, 5=neck, 6=shoulders, 7=arms,
//              8=back, 9=wrist1, 10=wrist2, 11=range, 12=hands, 13=primary, 14=secondary,
//              17=chest, 18=legs, 19=feet, 20=waist, 21=ammo, 22-29=general inventory
const STARTER_GEAR = {
  warrior:       [{ itemId: 5013, slot: 13 }, { itemId: 1004, slot: 17 }, { itemId: 1001, slot: 2 }],  // Rusty Short Sword, Cloth Shirt, Cloth Cap
  cleric:        [{ itemId: 6012, slot: 13 }, { itemId: 1004, slot: 17 }, { itemId: 1001, slot: 2 }],  // Worn Great Staff, Cloth Shirt, Cloth Cap
  wizard:        [{ itemId: 6012, slot: 13 }, { itemId: 1004, slot: 17 }, { itemId: 1001, slot: 2 }],
  rogue:         [{ itemId: 5013, slot: 13 }, { itemId: 2010, slot: 12 }, { itemId: 1004, slot: 17 }], // Rusty Short Sword, Leather Gloves, Cloth Shirt
  paladin:       [{ itemId: 5013, slot: 13 }, { itemId: 1004, slot: 17 }, { itemId: 1001, slot: 2 }],
  shadow_knight: [{ itemId: 5013, slot: 13 }, { itemId: 1004, slot: 17 }, { itemId: 1001, slot: 2 }],
  ranger:        [{ itemId: 5013, slot: 13 }, { itemId: 1004, slot: 17 }, { itemId: 2010, slot: 12 }],
  bard:          [{ itemId: 5013, slot: 13 }, { itemId: 1004, slot: 17 }, { itemId: 2010, slot: 12 }],
  monk:          [{ itemId: 1004, slot: 17 }, { itemId: 1001, slot: 2 }],
  druid:         [{ itemId: 6012, slot: 13 }, { itemId: 1004, slot: 17 }, { itemId: 1001, slot: 2 }],
  shaman:        [{ itemId: 6012, slot: 13 }, { itemId: 1004, slot: 17 }, { itemId: 1001, slot: 2 }],
  necromancer:   [{ itemId: 6012, slot: 13 }, { itemId: 1004, slot: 17 }, { itemId: 1001, slot: 2 }],
  magician:      [{ itemId: 6012, slot: 13 }, { itemId: 1004, slot: 17 }, { itemId: 1001, slot: 2 }],
  enchanter:     [{ itemId: 6012, slot: 13 }, { itemId: 1004, slot: 17 }, { itemId: 1001, slot: 2 }],
};

module.exports = { ITEMS, STARTER_GEAR };
