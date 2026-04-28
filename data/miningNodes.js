// server/data/miningNodes.js
// ═══════════════════════════════════════════════════════════════════
//  Mining System — Node Tiers, Pick Data, Loot Tables, Zone Spawns
// ═══════════════════════════════════════════════════════════════════

// ── Node Tier Definitions ───────────────────────────────────────────
const MINING_NODES = {
  small_metal_vein: {
    tier: 1,
    name: 'Small Metal Vein',
    hp: 50,
    minSkill: 0,
    respawnTime: 300,  // 5 minutes
  },
  metal_vein: {
    tier: 2,
    name: 'Metal Vein',
    hp: 70,
    minSkill: 30,
    respawnTime: 300,
  },
  large_metal_vein: {
    tier: 3,
    name: 'Large Metal Vein',
    hp: 90,
    minSkill: 75,
    respawnTime: 300,
  },
  fine_metal_vein: {
    tier: 4,
    name: 'Fine Metal Vein',
    hp: 110,
    minSkill: 125,
    respawnTime: 300,
  },
  precious_metal_vein: {
    tier: 5,
    name: 'Precious Metal Vein',
    hp: 130,
    minSkill: 175,
    respawnTime: 300,
  },
  velium_crystal: {
    tier: 6,
    name: 'Velium Crystal',
    hp: 160,
    minSkill: 225,
    respawnTime: 300,
  },
};

// ── Mining Pick Definitions ─────────────────────────────────────────
// itemIds are authentic P99/EQ item IDs from the items table.
// 'damage' here is the mining-specific damage used for node depletion,
// which may differ from the weapon's melee damage stat.
const MINING_PICKS = {
  rusty_mining_pick:     { tier: 1, damage: 5,  delay: 38, itemId: 5040,  name: 'Rusty Mining Pick' },
  tarnished_mining_pick: { tier: 1, damage: 5,  delay: 36, itemId: 5041,  name: 'Tarnished Mining Pick' },
  forged_pick:           { tier: 2, damage: 8,  delay: 35, itemId: 21540, name: 'Forged Pick' },
  silvered_pick:         { tier: 3, damage: 12, delay: 33, itemId: 21580, name: 'Silvered Pick' },
  mining_pick_628:       { tier: 3, damage: 12, delay: 31, itemId: 12161, name: 'Mining Pick 628' },
  miners_pick:           { tier: 4, damage: 18, delay: 35, itemId: 16392, name: "Miner's Pick" },
  ornate_miners_pick:    { tier: 5, damage: 25, delay: 30, itemId: 16393, name: "Ornate Miner's Pick" },
  sturdy_grimling_mining_pick: { tier: 5, damage: 28, delay: 29, itemId: 2695, name: 'Sturdy Grimling Mining Pick' },
  coldain_velium_pick:   { tier: 6, damage: 35, delay: 29, itemId: 30263, name: 'Coldain Velium-Pick' },
};

// Fast lookup: item_id → pick definition
const PICK_BY_ITEM_ID = {};
for (const [key, pick] of Object.entries(MINING_PICKS)) {
  if (pick.itemId) PICK_BY_ITEM_ID[pick.itemId] = pick;
}

// Also match by item name (for items loaded from DB where we match by key)
const PICK_BY_ITEM_KEY = {};
for (const [key, pick] of Object.entries(MINING_PICKS)) {
  PICK_BY_ITEM_KEY[key] = pick;
}

// ── Tier Gating & Damage Multipliers ────────────────────────────────
// tierDiff = nodeTier - pickTier
// Positive = node is harder, Negative = node is easier
function getTierMultiplier(pickTier, nodeTier) {
  const diff = nodeTier - pickTier;
  if (diff >= 2) return 0;    // Cannot mine — too hard
  if (diff === 1) return 0.5; // Struggling — 1 tier above
  if (diff === 0) return 1.0; // Base efficiency — same tier
  if (diff === -1) return 2.0; // Easy — 1 tier below
  return 3.0;                  // Obliterating — 2+ tiers below
}

// ── Hit Chance from Mining Skill ────────────────────────────────────
function getMiningHitChance(miningSkill, nodeMinSkill) {
  if (miningSkill >= nodeMinSkill) {
    // At min skill: 75%, scales up to 95% cap
    return Math.min(95, 75 + (miningSkill - nodeMinSkill) * 0.5);
  }
  // Below min skill: starts at 25%, improves slightly with skill
  return Math.max(25, 25 + miningSkill * 0.5);
}

// ── Loot Tables ─────────────────────────────────────────────────────
// Awarded on full node depletion (0 HP). Weighted random selection.
const LOOT_TABLES = {
  small_metal_vein: [
    { itemKey: 'small_piece_of_ore',  weight: 60 },
    { itemKey: 'small_brick_of_ore',  weight: 30 },
    // { itemKey: 'rough_gem',         weight: 10 }, // Future: jewelcrafting
  ],
  metal_vein: [
    { itemKey: 'small_brick_of_ore',  weight: 50 },
    { itemKey: 'large_brick_of_ore',  weight: 40 },
  ],
  large_metal_vein: [
    { itemKey: 'large_brick_of_ore',  weight: 50 },
    { itemKey: 'block_of_ore',        weight: 40 },
  ],
  fine_metal_vein: [
    { itemKey: 'small_brick_of_medium_quality_ore', weight: 40 },
    { itemKey: 'large_brick_of_medium_quality_ore', weight: 40 },
    { itemKey: 'block_of_medium_quality_ore',       weight: 20 },
  ],
  precious_metal_vein: [
    { itemKey: 'small_brick_of_high_quality_ore', weight: 35 },
    { itemKey: 'large_brick_of_high_quality_ore', weight: 35 },
    { itemKey: 'block_of_high_quality_ore',       weight: 30 },
  ],
  velium_crystal: [
    { itemKey: 'small_piece_of_velium',  weight: 30 },
    { itemKey: 'small_brick_of_velium',  weight: 30 },
    { itemKey: 'large_brick_of_velium',  weight: 25 },
    { itemKey: 'block_of_velium',        weight: 15 },
  ],
};

function rollLoot(nodeType) {
  const table = LOOT_TABLES[nodeType];
  if (!table || table.length === 0) return null;

  const totalWeight = table.reduce((sum, e) => sum + e.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const entry of table) {
    roll -= entry.weight;
    if (roll <= 0) return entry.itemKey;
  }
  return table[table.length - 1].itemKey;
}

// ── Zone Spawn Data ─────────────────────────────────────────────────
// Each zone has a pool of spawn locations. On init/respawn, nodes pick
// random locations from the pool. activeCount = how many nodes are live.
//
// Coordinates are EQ-authentic (x, y, z) from Brewall/EQEmu data.
// Phase 1: 3 starter zones for testing.

const ZONE_MINING_SPAWNS = {
  // ── Qeynos Hills (T1) ──
  qeynos_hills: {
    nodeType: 'small_metal_vein',
    activeCount: 8,
    spawnLocations: [
      // Rocky hillsides near Blackburrow entrance
      { x: -490, y: -1080, z: 3 },
      { x: -550, y: -1020, z: 8 },
      { x: -430, y: -1150, z: 5 },
      // Cliff faces along northern ridgeline
      { x: -150, y: -1450, z: 12 },
      { x: -80, y: -1380, z: 15 },
      { x: 50, y: -1500, z: 10 },
      // Eastern rocky outcrops near tunnel
      { x: 620, y: -400, z: 3 },
      { x: 700, y: -350, z: 5 },
      { x: 580, y: -480, z: 2 },
      // Southern hills
      { x: -300, y: 200, z: 5 },
      { x: -220, y: 280, z: 3 },
      { x: -380, y: 150, z: 7 },
      // Scattered outcrops
      { x: 150, y: -800, z: 3 },
      { x: 200, y: -750, z: 5 },
      { x: -50, y: -600, z: 2 },
      { x: 400, y: -200, z: 4 },
    ],
  },

  // ── Butcherblock Mountains (T1 + T2) ──
  butcherblock: {
    nodeType: 'small_metal_vein',
    activeCount: 10,
    spawnLocations: [
      // Near Kaladim entrance (dwarven mining country)
      { x: -1100, y: 3150, z: 200 },
      { x: -1050, y: 3200, z: 205 },
      { x: -1180, y: 3100, z: 195 },
      { x: -980, y: 3250, z: 210 },
      // Mountain cliff faces
      { x: -600, y: 2800, z: 180 },
      { x: -550, y: 2750, z: 175 },
      { x: -700, y: 2900, z: 185 },
      // Coastal rocks near dock
      { x: 1200, y: 2100, z: 5 },
      { x: 1150, y: 2050, z: 3 },
      { x: 1280, y: 2150, z: 7 },
      // Central mountain outcrops
      { x: -200, y: 2500, z: 150 },
      { x: -150, y: 2450, z: 145 },
      { x: -280, y: 2550, z: 155 },
      // South mountain trails
      { x: -400, y: 1800, z: 120 },
      { x: -350, y: 1750, z: 115 },
      { x: -450, y: 1850, z: 125 },
      { x: -500, y: 1900, z: 130 },
      { x: -300, y: 1700, z: 110 },
    ],
    // T2 nodes in deeper mountain areas
    additionalNodeTypes: [
      {
        nodeType: 'metal_vein',
        activeCount: 5,
        spawnLocations: [
          { x: -1200, y: 3300, z: 220 },
          { x: -1150, y: 3350, z: 225 },
          { x: -1280, y: 3250, z: 215 },
          { x: -900, y: 3400, z: 230 },
          { x: -850, y: 3350, z: 225 },
          { x: -1000, y: 3450, z: 235 },
          { x: -750, y: 2600, z: 190 },
          { x: -800, y: 2650, z: 195 },
          { x: -650, y: 2550, z: 185 },
          { x: -700, y: 2700, z: 200 },
        ],
      },
    ],
  },

  // ── Steamfont Mountains (T1 + T3) ──
  steamfont: {
    nodeType: 'small_metal_vein',
    activeCount: 8,
    spawnLocations: [
      // Near Ak'Anon entrance
      { x: -590, y: 140, z: -10 },
      { x: -540, y: 190, z: -8 },
      { x: -640, y: 90, z: -12 },
      // Minotaur cave area
      { x: 550, y: -1200, z: 30 },
      { x: 600, y: -1150, z: 28 },
      { x: 500, y: -1250, z: 32 },
      // Central gnomish mining area
      { x: -200, y: -400, z: 5 },
      { x: -150, y: -350, z: 3 },
      { x: -250, y: -450, z: 7 },
      // Windmill area outcrops
      { x: 100, y: -600, z: 10 },
      { x: 150, y: -550, z: 8 },
      { x: 50, y: -650, z: 12 },
      // Southern rocky terrain
      { x: -400, y: -800, z: 15 },
      { x: -350, y: -750, z: 12 },
      { x: -450, y: -850, z: 18 },
      { x: 300, y: -900, z: 20 },
    ],
    additionalNodeTypes: [
      {
        nodeType: 'large_metal_vein',
        activeCount: 4,
        spawnLocations: [
          // Deep mines in the mountain interior
          { x: -700, y: 50, z: -20 },
          { x: -750, y: 0, z: -25 },
          { x: -650, y: 100, z: -18 },
          { x: -800, y: -50, z: -30 },
          { x: 650, y: -1300, z: 35 },
          { x: 700, y: -1350, z: 38 },
          { x: 600, y: -1250, z: 32 },
          { x: 750, y: -1400, z: 40 },
        ],
      },
    ],
  },
};

// ── Mining Merchant NPC ─────────────────────────────────────────────
// Dougal Coalbeard — spawns in every starting zone as a mining supply
// merchant and ore-finding guide.
const MINING_NPC_DEF = {
  key: 'dougal_coalbeard',
  name: 'Dougal Coalbeard',
  level: 30,
  race: 8,     // Dwarf
  gender: 0,   // Male
  maxHp: 5000, // Tough enough that nobody accidentally kills him
  minDmg: 1,
  maxDmg: 1,
  attackDelay: 100,
  xpBase: 0,
  type: 'merchant',  // Resolved to NPC_TYPES.MERCHANT by spawnMob
};

// Spawn locations per starting zone — positioned near existing merchants/smiths
// Coordinates sourced from EQEmu spawn2 table, offset slightly so Dougal
// doesn't stack on top of the existing NPC.
const MINING_NPC_SPAWNS = {
  // Qeynos (South) — near Fesse Bontex weapon merchant area
  qeynos:     { x: -520, y: -270, z: 3.75 },
  // Qeynos Hills — near Axe Broadsmith's forge
  qeytoqrg:   { x: 950,  y: 3760, z: -18.5 },
  // Halas — near Dargon merchant in the main hall
  halas:      { x: 345,  y: 345,  z: 4.38 },
  // Rivervale — near merchant row (Slim Waterman area)
  rivervale:  { x: -395, y: -240, z: -13.75 },
  // Greater Faydark — near Kelethin merchant platform
  gfaydark:   { x: 310,  y: 120,  z: 77 },
  // Kaladim (A) — near Tumpy Irontoe (his home turf!)
  kaladima:   { x: 320,  y: 190,  z: 2.5 },
  // Ak'Anon — near Clockwork SmithXIII
  akanon:     { x: -550, y: 2150, z: -182 },
  // Neriak (Foreign Quarter) — near Mignar merchant row
  neriakb:    { x: -940, y: 145,  z: -38.75 },
  // Grobb — near Barsk merchant
  grobb:      { x: -425, y: 290,  z: 4.7 },
  // Oggok — near Angrog merchant entrance
  oggok:      { x: -10,  y: -255, z: 5.63 },
  // Cabilis East — near Sybar merchant
  cabeast:    { x: -125, y: 125,  z: 1.75 },
  // Shar Vahl — near Broker Fahaar marketplace
  sharvahl:   { x: -40,  y: 240,  z: -187.5 },
  // Rathe Mountains — near Dar Forager Lumun (froglok start)
  rathemtn:   { x: 210,  y: -2070, z: -5.5 },
  // Erudin (Erudite Paladins) — near Chembla Ellent merchant
  erudnext:   { x: -250, y: -1060, z: 83.63 },
  // Erudin Interior (Erudite casters) — upper merchant level near Wistcona
  erudnint:   { x: 755,  y: 525,  z: 83.63 },
  // Paineel (Erudite SK/Cleric) — near Loleluz merchant
  paineel:    { x: 815,  y: 940,  z: -80.13 },
  // Felwithe A (High Elf Cleric/Paladin) — near Seleni Treekeeper
  felwithea:  { x: -265, y: -15,  z: 3.75 },
  // Felwithe B (High Elf casters) — near Nestess Branchtop
  felwitheb:  { x: -920, y: 505,  z: 3.75 },
};

module.exports = {
  MINING_NODES,
  MINING_PICKS,
  PICK_BY_ITEM_ID,
  PICK_BY_ITEM_KEY,
  getTierMultiplier,
  getMiningHitChance,
  LOOT_TABLES,
  rollLoot,
  ZONE_MINING_SPAWNS,
  MINING_NPC_DEF,
  MINING_NPC_SPAWNS,
};
