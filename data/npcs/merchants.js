// ── Merchant Inventories ─────────────────────────────────────────────
// Keyed by npcKey. Each merchant has a list of items they sell.
// Items reference keys from the item database.
//
// Price is in copper pieces (1 plat = 1000 cp, 1 gold = 100 cp, 1 silver = 10 cp).
// If price is omitted, the item's base value from the item database is used.

const MERCHANT_INVENTORIES = {

  // ─── Qeynos Hills ─────────────────────────────────────────────────

  axe_broadsmith: {
    name: 'Axe Broadsmith',
    greeting: 'Welcome to my forge! I have the finest axes in all of Qeynos.',
    items: [
      { itemKey: 'rusty_axe', price: 15 },
      { itemKey: 'rusty_battle_axe', price: 45 },
      { itemKey: 'wooden_shield', price: 25 },
      { itemKey: 'buckler', price: 30 },
    ],
  },

  chanda_miller: {
    name: 'Chanda Miller',
    greeting: 'Hello there! Can I interest you in some fresh provisions?',
    items: [
      { itemKey: 'bread', price: 5 },
      { itemKey: 'water', price: 5 },
      { itemKey: 'ration', price: 8 },
      { itemKey: 'bandages', price: 12 },
    ],
  },

  baobob_miller: {
    name: 'Baobob Miller',
    greeting: 'Greetings, traveler. My mill produces the finest flour in the region.',
    items: [
      { itemKey: 'bread', price: 5 },
      { itemKey: 'water', price: 5 },
      { itemKey: 'mead', price: 15 },
      { itemKey: 'ale', price: 10 },
    ],
  },

  crumpy_irontoe: {
    name: 'Crumpy Irontoe',
    greeting: 'Bah! What do ye want? I suppose ye need some gear.',
    items: [
      { itemKey: 'rusty_short_sword', price: 20 },
      { itemKey: 'rusty_broad_sword', price: 35 },
      { itemKey: 'rusty_dagger', price: 10 },
      { itemKey: 'cloth_cap', price: 8 },
    ],
  },

  wyle_bimlin: {
    name: 'Wyle Bimlin',
    greeting: 'Step right up! Wyle Bimlin has everything you need!',
    items: [
      { itemKey: 'small_bag', price: 20 },
      { itemKey: 'large_bag', price: 40 },
      { itemKey: 'backpack', price: 60 },
      { itemKey: 'belt_pouch', price: 15 },
    ],
  },

  barn_bloodstone: {
    name: 'Barn Bloodstone',
    greeting: 'Looking for something sharp? I deal in fine blades.',
    items: [
      { itemKey: 'rusty_long_sword', price: 40 },
      { itemKey: 'rusty_bastard_sword', price: 55 },
      { itemKey: 'rusty_scimitar', price: 38 },
      { itemKey: 'parrying_dagger', price: 25 },
    ],
  },

  tol_nicelot: {
    name: 'Tol Nicelot',
    greeting: 'Good day! I have the finest cloth and leather goods.',
    items: [
      { itemKey: 'cloth_shirt', price: 12 },
      { itemKey: 'cloth_pants', price: 12 },
      { itemKey: 'cloth_gloves', price: 8 },
      { itemKey: 'cloth_sandals', price: 8 },
      { itemKey: 'cloth_cap', price: 8 },
    ],
  },

  hefax_tinmar: {
    name: 'Hefax Tinmar',
    greeting: 'I deal in components and reagents. What do you seek?',
    items: [
      { itemKey: 'bandages', price: 12 },
      { itemKey: 'water', price: 5 },
    ],
  },

  mogan_delfin: {
    name: 'Mogan Delfin',
    greeting: 'Hail, adventurer. Care to browse my wares?',
    items: [
      { itemKey: 'bread', price: 5 },
      { itemKey: 'water', price: 5 },
      { itemKey: 'ration', price: 8 },
      { itemKey: 'iron_ration', price: 15 },
    ],
  },

  // ─── West Karana ───────────────────────────────────────────────────

  innkeep_danin: {
    name: 'Innkeep Danin',
    greeting: 'Welcome to my inn! Rest your weary bones and have a drink.',
    items: [
      { itemKey: 'bread', price: 5 },
      { itemKey: 'water', price: 5 },
      { itemKey: 'mead', price: 15 },
      { itemKey: 'ale', price: 10 },
      { itemKey: 'short_beer', price: 8 },
      { itemKey: 'ration', price: 8 },
    ],
  },

  innkeep_rislarn: {
    name: 'Innkeep Rislarn',
    greeting: 'Come in, come in! You look like you could use a meal.',
    items: [
      { itemKey: 'bread', price: 5 },
      { itemKey: 'water', price: 5 },
      { itemKey: 'ration', price: 8 },
      { itemKey: 'bandages', price: 12 },
    ],
  },

  linaya_sowlin: {
    name: 'Linaya Sowlin',
    greeting: 'I sell only the finest tailored goods.',
    items: [
      { itemKey: 'cloth_shirt', price: 12 },
      { itemKey: 'cloth_pants', price: 12 },
      { itemKey: 'cloth_cape', price: 15 },
      { itemKey: 'cloth_sleeves', price: 10 },
    ],
  },

  chrislin_baker: {
    name: 'Chrislin Baker',
    greeting: 'Fresh from the oven! Best bread in all of Karana.',
    items: [
      { itemKey: 'bread', price: 5 },
      { itemKey: 'ration', price: 8 },
    ],
  },

  silna_weaver: {
    name: 'Silna Weaver',
    greeting: 'My silks are the finest this side of Qeynos.',
    items: [
      { itemKey: 'coarse_silk', price: 25 },
      { itemKey: 'cloth_shirt', price: 12 },
    ],
  },

  minya_coldtoes: {
    name: 'Minya Coldtoes',
    greeting: 'Need supplies for the long road? I have you covered.',
    items: [
      { itemKey: 'water', price: 5 },
      { itemKey: 'bread', price: 5 },
      { itemKey: 'bandages', price: 12 },
      { itemKey: 'backpack', price: 60 },
    ],
  },

  brellsan_tarn: {
    name: 'Brellsan Tarn',
    greeting: 'Brell\'s blessings upon ye. Need some sturdy gear?',
    items: [
      { itemKey: 'rusty_short_sword', price: 20 },
      { itemKey: 'rusty_mace', price: 25 },
      { itemKey: 'wooden_shield', price: 25 },
    ],
  },

  oobnopterbevny_biddilets: {
    name: 'Oobnopterbevny Biddilets',
    greeting: 'Ah yes, yes! Tinker goods, gnomish quality!',
    items: [
      { itemKey: 'small_box', price: 25 },
      { itemKey: 'belt_pouch', price: 15 },
    ],
  },

  gindlin_toxfodder: {
    name: 'Gindlin Toxfodder',
    greeting: 'Potions and remedies, friend. What ails you?',
    items: [
      { itemKey: 'bandages', price: 12 },
      { itemKey: 'water', price: 5 },
    ],
  },

  sonagin_fartide: {
    name: 'Sonagin Fartide',
    greeting: 'I carry goods from the coast. Take a look.',
    items: [
      { itemKey: 'bread', price: 5 },
      { itemKey: 'ration', price: 8 },
      { itemKey: 'water', price: 5 },
    ],
  },

  renux_herkanor: {
    name: 'Renux Herkanor',
    greeting: 'Weapons and armor, traveler. Quality goods.',
    items: [
      { itemKey: 'rusty_long_sword', price: 40 },
      { itemKey: 'rusty_axe', price: 15 },
      { itemKey: 'buckler', price: 30 },
    ],
  },

  tarnic_mcwillows: {
    name: 'Tarnic McWillows',
    greeting: 'The plains are dangerous. Best be prepared.',
    items: [
      { itemKey: 'rusty_short_sword', price: 20 },
      { itemKey: 'bandages', price: 12 },
      { itemKey: 'water', price: 5 },
    ],
  },

  melaara_tenwinds: {
    name: 'Melaara Tenwinds',
    greeting: 'The winds bring fortune to those who are prepared.',
    items: [
      { itemKey: 'cloth_cap', price: 8 },
      { itemKey: 'cloth_shirt', price: 12 },
      { itemKey: 'cloth_pants', price: 12 },
    ],
  },

  // ─── North Karana ──────────────────────────────────────────────────

  innkeep_disda: {
    name: 'Innkeep Disda',
    greeting: 'Welcome to the outpost! Take a load off.',
    items: [
      { itemKey: 'bread', price: 5 },
      { itemKey: 'water', price: 5 },
      { itemKey: 'ale', price: 10 },
      { itemKey: 'mead', price: 15 },
      { itemKey: 'ration', price: 8 },
    ],
  },

  innkeep_james: {
    name: 'Innkeep James',
    greeting: 'Come in from the cold! Warm food and drink await.',
    items: [
      { itemKey: 'bread', price: 5 },
      { itemKey: 'water', price: 5 },
      { itemKey: 'short_beer', price: 8 },
      { itemKey: 'ration', price: 8 },
    ],
  },

  barkeep_milo: {
    name: 'Barkeep Milo',
    greeting: 'What\'ll it be? I pour the stiffest drinks in Karana.',
    items: [
      { itemKey: 'ale', price: 10 },
      { itemKey: 'mead', price: 15 },
      { itemKey: 'short_beer', price: 8 },
      { itemKey: 'bottle_of_kalish', price: 25 },
    ],
  },

  barkeep_jeny: {
    name: 'Barkeep Jeny',
    greeting: 'Pull up a stool. What can I get you?',
    items: [
      { itemKey: 'ale', price: 10 },
      { itemKey: 'mead', price: 15 },
      { itemKey: 'bread', price: 5 },
      { itemKey: 'water', price: 5 },
    ],
  },

  shiel_glimmerspindle: {
    name: 'Shiel Glimmerspindle',
    greeting: 'Ah, greetings! I have some fine gnomish curiosities for sale.',
    items: [
      { itemKey: 'small_box', price: 25 },
      { itemKey: 'belt_pouch', price: 15 },
      { itemKey: 'bandages', price: 12 },
    ],
  },

  // ─── Mining Supply NPC (all starting zones) ────────────────────────

  dougal_coalbeard: {
    name: 'Dougal Coalbeard',
    greeting: "Oi! Welcome, welcome! Dougal Coalbeard's the name, minin's me game! Browse me [wares] or ask me about [ore] — I know where t' find it all!",
    sellBonus: 0.05,  // 5% bonus when selling mining/smithing items
    sellBonusCategories: ['ore', 'velium', 'brick', 'block', 'piece of ore', 'blacksmithing'],
    items: [
      // T1 picks — starter gear, cheap
      { itemKey: 'rusty_mining_pick',     price: 50 },
      { itemKey: 'tarnished_mining_pick', price: 65 },
      // T2 pick — mid-tier, requires some coin
      { itemKey: 'forged_pick',           price: 350 },
      // T3 pick — premium, serious miners only
      { itemKey: 'silvered_pick',         price: 1200 },
    ],
  },
};

module.exports = MERCHANT_INVENTORIES;
