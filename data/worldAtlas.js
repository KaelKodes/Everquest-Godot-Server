// ── World Atlas ─────────────────────────────────────────────────────
// 
// Defines the global position and bounds of every zone in world space.
// This allows the client to:
//   1. Place adjacent zone terrain at correct offsets
//   2. Load neighbor geometry within view distance
//   3. Show a coherent, continuous world without void at zone borders
//
// Coordinate system:
//   X = East/West  (positive = east)
//   Y = North/South (positive = north)
//   Z = Up/Down (not used for atlas placement — handled by terrain)
//
// Each zone entry has:
//   worldX, worldY — center of the zone in global coordinates
//   width, height  — bounding box of the zone in game units
//   climate        — climate type (for weather system)
//   continent      — which landmass this zone belongs to
//   environment    — 'outdoor' or 'indoor' (for vision/weather)
//   connections    — list of adjacent zones with edge info
//   terrain        — hint for gap-fill generation ('plains','forest','mountain','water','desert','swamp','snow','city')
//
// Units: 1 unit ≈ 1 foot. Zone sizes based on EQ coordinate ranges.
//
// Layout reference: Brewall's Ultimate EQ World Map (2014)
// The Antonica continent runs roughly:
//   Qeynos (west) → Karanas (center) → Freeport (east)
//   with vertical branches for dungeons and cities
// ────────────────────────────────────────────────────────────────────

const WORLD_ATLAS = {

  // ═══════════════════════════════════════════════════════════════════
  // ANTONICA — Western Antonica (Qeynos Region)
  // ═══════════════════════════════════════════════════════════════════

  qeynos_city: {
    name: 'South Qeynos',
    shortName: 'qeynos2',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'temperate',
    terrain: 'city',
    worldX: 0,
    worldY: 0,
    width: 2000,
    height: 2000,
    connections: [
      { zone: 'north_qeynos', edge: 'north' },
      { zone: 'qeynos_hills', edge: 'east' },
    ],
  },

  north_qeynos: {
    name: 'North Qeynos',
    shortName: 'qeynos',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'temperate',
    terrain: 'city',
    worldX: 0,
    worldY: 2500,
    width: 2000,
    height: 2500,
    connections: [
      { zone: 'qeynos_city', edge: 'south' },
      { zone: 'qeynos_hills', edge: 'east' },
    ],
  },

  qeynos_hills: {
    name: 'Qeynos Hills',
    shortName: 'qeytoqrg',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'temperate',
    terrain: 'forest',
    worldX: 3500,
    worldY: 1500,
    width: 3500,
    height: 5600,
    connections: [
      { zone: 'qeynos_city', edge: 'west' },
      { zone: 'north_qeynos', edge: 'west' },
      { zone: 'surefall_glade', edge: 'north' },
      { zone: 'blackburrow', edge: 'north' },
      { zone: 'west_karana', edge: 'east' },
    ],
  },

  surefall_glade: {
    name: 'Surefall Glade',
    shortName: 'qrg',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'temperate',
    terrain: 'forest',
    worldX: 3000,
    worldY: 5500,
    width: 1500,
    height: 1500,
    connections: [
      { zone: 'qeynos_hills', edge: 'south' },
      { zone: 'jaggedpine', edge: 'north' },
    ],
  },

  blackburrow: {
    name: 'Blackburrow',
    shortName: 'blackburrow',
    continent: 'antonica',
    environment: 'indoor',
    climate: 'underground',
    terrain: 'mountain',
    worldX: 4500,
    worldY: 5500,
    width: 1200,
    height: 1200,
    connections: [
      { zone: 'qeynos_hills', edge: 'south' },
      { zone: 'everfrost', edge: 'north' },
    ],
  },

  jaggedpine: {
    name: 'Jaggedpine Forest',
    shortName: 'jaggedpine',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'temperate',
    terrain: 'forest',
    worldX: 3000,
    worldY: 7500,
    width: 2500,
    height: 2500,
    connections: [
      { zone: 'surefall_glade', edge: 'south' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // ANTONICA — The Karanas (Central Plains)
  // ═══════════════════════════════════════════════════════════════════

  west_karana: {
    name: 'West Karana',
    shortName: 'qey2hh1',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'temperate',
    terrain: 'plains',
    worldX: 8000,
    worldY: 1500,
    width: 6000,
    height: 6000,
    connections: [
      { zone: 'qeynos_hills', edge: 'west' },
      { zone: 'north_karana', edge: 'east' },
      { zone: 'paw', edge: 'south' },
    ],
  },

  north_karana: {
    name: 'North Karana',
    shortName: 'northkarana',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'temperate',
    terrain: 'plains',
    worldX: 14000,
    worldY: 2000,
    width: 6000,
    height: 6000,
    connections: [
      { zone: 'west_karana', edge: 'west' },
      { zone: 'east_karana', edge: 'east' },
      { zone: 'south_karana', edge: 'south' },
    ],
  },

  east_karana: {
    name: 'East Karana',
    shortName: 'eastkarana',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'temperate',
    terrain: 'plains',
    worldX: 20000,
    worldY: 2500,
    width: 5000,
    height: 5000,
    connections: [
      { zone: 'north_karana', edge: 'west' },
      { zone: 'highpass', edge: 'east' },
      { zone: 'gorge_of_king_xorbb', edge: 'east' },
    ],
  },

  south_karana: {
    name: 'South Karana',
    shortName: 'southkarana',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'temperate',
    terrain: 'plains',
    worldX: 14000,
    worldY: -4000,
    width: 6000,
    height: 6000,
    connections: [
      { zone: 'north_karana', edge: 'north' },
      { zone: 'lake_rathetear', edge: 'south' },
    ],
  },

  paw: {
    name: 'Infected Paw',
    shortName: 'paw',
    continent: 'antonica',
    environment: 'indoor',
    climate: 'underground',
    terrain: 'mountain',
    worldX: 8000,
    worldY: -3000,
    width: 1500,
    height: 1500,
    connections: [
      { zone: 'west_karana', edge: 'north' },
      { zone: 'south_karana', edge: 'east' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // ANTONICA — Everfrost / Halas (Northern)
  // ═══════════════════════════════════════════════════════════════════

  everfrost: {
    name: 'Everfrost Peaks',
    shortName: 'everfrost',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'arctic',
    terrain: 'snow',
    worldX: 4500,
    worldY: 9000,
    width: 4000,
    height: 4000,
    connections: [
      { zone: 'blackburrow', edge: 'south' },
      { zone: 'halas', edge: 'north' },
      { zone: 'permafrost', edge: 'north' },
    ],
  },

  halas: {
    name: 'Halas',
    shortName: 'halas',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'arctic',
    terrain: 'city',
    worldX: 4500,
    worldY: 12000,
    width: 1500,
    height: 1500,
    connections: [
      { zone: 'everfrost', edge: 'south' },
    ],
  },

  permafrost: {
    name: 'Permafrost Keep',
    shortName: 'permafrost',
    continent: 'antonica',
    environment: 'indoor',
    climate: 'arctic',
    terrain: 'snow',
    worldX: 6500,
    worldY: 12000,
    width: 2000,
    height: 2000,
    connections: [
      { zone: 'everfrost', edge: 'south' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // ANTONICA — Highpass / Kithicor / Commons (Central-East)
  // ═══════════════════════════════════════════════════════════════════

  highpass: {
    name: 'Highpass Hold',
    shortName: 'highkeep',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'temperate',
    terrain: 'mountain',
    worldX: 25000,
    worldY: 2500,
    width: 2000,
    height: 3000,
    connections: [
      { zone: 'east_karana', edge: 'west' },
      { zone: 'kithicor', edge: 'east' },
    ],
  },

  kithicor: {
    name: 'Kithicor Forest',
    shortName: 'kithicor',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'temperate',
    terrain: 'forest',
    worldX: 28000,
    worldY: 2500,
    width: 3000,
    height: 4000,
    connections: [
      { zone: 'highpass', edge: 'west' },
      { zone: 'west_commons', edge: 'east' },
      { zone: 'rivervale', edge: 'south' },
    ],
  },

  rivervale: {
    name: 'Rivervale',
    shortName: 'rivervale',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'temperate',
    terrain: 'forest',
    worldX: 28000,
    worldY: -1000,
    width: 1500,
    height: 1500,
    connections: [
      { zone: 'kithicor', edge: 'north' },
      { zone: 'misty_thicket', edge: 'south' },
    ],
  },

  west_commons: {
    name: 'West Commonlands',
    shortName: 'commons',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'temperate',
    terrain: 'plains',
    worldX: 32000,
    worldY: 2500,
    width: 4000,
    height: 4000,
    connections: [
      { zone: 'kithicor', edge: 'west' },
      { zone: 'east_commons', edge: 'east' },
      { zone: 'befallen', edge: 'south' },
    ],
  },

  east_commons: {
    name: 'East Commonlands',
    shortName: 'ecommons',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'temperate',
    terrain: 'plains',
    worldX: 37000,
    worldY: 2500,
    width: 4000,
    height: 4000,
    connections: [
      { zone: 'west_commons', edge: 'west' },
      { zone: 'freeport', edge: 'east' },
      { zone: 'nektulos', edge: 'south' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // ANTONICA — Freeport Region (Eastern)
  // ═══════════════════════════════════════════════════════════════════

  freeport: {
    name: 'West Freeport',
    shortName: 'freportw',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'temperate',
    terrain: 'city',
    worldX: 42000,
    worldY: 2500,
    width: 2500,
    height: 3000,
    connections: [
      { zone: 'east_commons', edge: 'west' },
      { zone: 'east_freeport', edge: 'east' },
      { zone: 'north_ro', edge: 'south' },
    ],
  },

  east_freeport: {
    name: 'East Freeport',
    shortName: 'freporte',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'temperate',
    terrain: 'city',
    worldX: 45000,
    worldY: 2500,
    width: 2500,
    height: 3000,
    connections: [
      { zone: 'freeport', edge: 'west' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // ANTONICA — Desert of Ro / Innothule (Southern)
  // ═══════════════════════════════════════════════════════════════════

  north_ro: {
    name: 'North Desert of Ro',
    shortName: 'nro',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'arid',
    terrain: 'desert',
    worldX: 42000,
    worldY: -2000,
    width: 5000,
    height: 4000,
    connections: [
      { zone: 'freeport', edge: 'north' },
      { zone: 'south_ro', edge: 'south' },
      { zone: 'oasis', edge: 'west' },
    ],
  },

  south_ro: {
    name: 'South Desert of Ro',
    shortName: 'sro',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'arid',
    terrain: 'desert',
    worldX: 42000,
    worldY: -6500,
    width: 5000,
    height: 4000,
    connections: [
      { zone: 'north_ro', edge: 'north' },
      { zone: 'innothule', edge: 'west' },
    ],
  },

  oasis: {
    name: 'Oasis of Marr',
    shortName: 'oasis',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'arid',
    terrain: 'desert',
    worldX: 37000,
    worldY: -3000,
    width: 4000,
    height: 4000,
    connections: [
      { zone: 'north_ro', edge: 'east' },
      { zone: 'south_ro', edge: 'east' },
    ],
  },

  nektulos: {
    name: 'Nektulos Forest',
    shortName: 'nektulos',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'temperate',
    terrain: 'forest',
    worldX: 37000,
    worldY: -1000,
    width: 4000,
    height: 3000,
    connections: [
      { zone: 'east_commons', edge: 'north' },
      { zone: 'lavastorm', edge: 'south' },
    ],
  },

  lavastorm: {
    name: 'Lavastorm Mountains',
    shortName: 'lavastorm',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'arid',
    terrain: 'mountain',
    worldX: 37000,
    worldY: -5000,
    width: 3000,
    height: 3000,
    connections: [
      { zone: 'nektulos', edge: 'north' },
      { zone: 'najena', edge: 'south' },
      { zone: 'solusek_eye', edge: 'south' },
    ],
  },

  innothule: {
    name: 'Innothule Swamp',
    shortName: 'innothule',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'tropical',
    terrain: 'swamp',
    worldX: 37000,
    worldY: -8000,
    width: 4000,
    height: 3000,
    connections: [
      { zone: 'south_ro', edge: 'east' },
      { zone: 'feerrott', edge: 'west' },
      { zone: 'grobb', edge: 'south' },
    ],
  },

  feerrott: {
    name: 'The Feerrott',
    shortName: 'feerrott',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'tropical',
    terrain: 'swamp',
    worldX: 32000,
    worldY: -8000,
    width: 4000,
    height: 4000,
    connections: [
      { zone: 'innothule', edge: 'east' },
      { zone: 'oggok', edge: 'south' },
      { zone: 'cazic_thule', edge: 'south' },
    ],
  },

  lake_rathetear: {
    name: 'Lake Rathetear',
    shortName: 'lakerathe',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'temperate',
    terrain: 'plains',
    worldX: 14000,
    worldY: -10000,
    width: 5000,
    height: 5000,
    connections: [
      { zone: 'south_karana', edge: 'north' },
      { zone: 'rathe_mountains', edge: 'east' },
    ],
  },

  rathe_mountains: {
    name: 'Rathe Mountains',
    shortName: 'rathemtn',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'temperate',
    terrain: 'mountain',
    worldX: 20000,
    worldY: -10000,
    width: 4000,
    height: 4000,
    connections: [
      { zone: 'lake_rathetear', edge: 'west' },
      { zone: 'feerrott', edge: 'east' },
    ],
  },

  misty_thicket: {
    name: 'Misty Thicket',
    shortName: 'misty',
    continent: 'antonica',
    environment: 'outdoor',
    climate: 'temperate',
    terrain: 'forest',
    worldX: 28000,
    worldY: -3500,
    width: 2500,
    height: 2500,
    connections: [
      { zone: 'rivervale', edge: 'north' },
      { zone: 'runnyeye', edge: 'south' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // FAYDWER (Butcherblock Docks connect via ocean)
  // ═══════════════════════════════════════════════════════════════════

  butcherblock: {
    name: 'Butcherblock Mountains',
    shortName: 'butcher',
    continent: 'faydwer',
    environment: 'outdoor',
    climate: 'temperate',
    terrain: 'mountain',
    worldX: 60000,
    worldY: 2000,
    width: 4000,
    height: 5000,
    connections: [
      { zone: 'greater_faydark', edge: 'east' },
      { zone: 'kaladim', edge: 'north' },
    ],
  },

  greater_faydark: {
    name: 'Greater Faydark',
    shortName: 'gfaydark',
    continent: 'faydwer',
    environment: 'outdoor',
    climate: 'temperate',
    terrain: 'forest',
    worldX: 65000,
    worldY: 2000,
    width: 5000,
    height: 5000,
    connections: [
      { zone: 'butcherblock', edge: 'west' },
      { zone: 'lesser_faydark', edge: 'south' },
      { zone: 'felwithe', edge: 'north' },
      { zone: 'crushbone', edge: 'north' },
    ],
  },

  lesser_faydark: {
    name: 'Lesser Faydark',
    shortName: 'lfaydark',
    continent: 'faydwer',
    environment: 'outdoor',
    climate: 'temperate',
    terrain: 'forest',
    worldX: 65000,
    worldY: -3000,
    width: 4000,
    height: 4000,
    connections: [
      { zone: 'greater_faydark', edge: 'north' },
      { zone: 'steamfont', edge: 'south' },
    ],
  },

  steamfont: {
    name: 'Steamfont Mountains',
    shortName: 'steamfont',
    continent: 'faydwer',
    environment: 'outdoor',
    climate: 'temperate',
    terrain: 'mountain',
    worldX: 65000,
    worldY: -7000,
    width: 4000,
    height: 4000,
    connections: [
      { zone: 'lesser_faydark', edge: 'north' },
      { zone: 'akanon', edge: 'south' },
    ],
  },

  crushbone: {
    name: 'Crushbone',
    shortName: 'crushbone',
    continent: 'faydwer',
    environment: 'outdoor',
    climate: 'temperate',
    terrain: 'forest',
    worldX: 65000,
    worldY: 6000,
    width: 2500,
    height: 2500,
    connections: [
      { zone: 'greater_faydark', edge: 'south' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // ODUS
  // ═══════════════════════════════════════════════════════════════════

  erudin: {
    name: 'Erudin',
    shortName: 'erudin',
    continent: 'odus',
    environment: 'outdoor',
    climate: 'coastal',
    terrain: 'city',
    worldX: -15000,
    worldY: -4000,
    width: 2000,
    height: 2000,
    connections: [
      { zone: 'toxxulia', edge: 'south' },
    ],
  },

  toxxulia: {
    name: 'Toxxulia Forest',
    shortName: 'tox',
    continent: 'odus',
    environment: 'outdoor',
    climate: 'tropical',
    terrain: 'forest',
    worldX: -15000,
    worldY: -7000,
    width: 3000,
    height: 3000,
    connections: [
      { zone: 'erudin', edge: 'north' },
      { zone: 'paineel', edge: 'south' },
    ],
  },
};

// ── Helper Functions ────────────────────────────────────────────────

/**
 * Get the bounding box of a zone in world space.
 */
function getZoneBounds(zoneKey) {
  const z = WORLD_ATLAS[zoneKey];
  if (!z) return null;
  return {
    minX: z.worldX - z.width / 2,
    maxX: z.worldX + z.width / 2,
    minY: z.worldY - z.height / 2,
    maxY: z.worldY + z.height / 2,
    centerX: z.worldX,
    centerY: z.worldY,
    width: z.width,
    height: z.height,
  };
}

/**
 * Convert a local zone position to global world coordinates.
 */
function localToWorld(zoneKey, localX, localY) {
  const z = WORLD_ATLAS[zoneKey];
  if (!z) return { x: localX, y: localY };
  return {
    x: z.worldX + localX,
    y: z.worldY + localY,
  };
}

/**
 * Convert global world coordinates to a zone's local position.
 */
function worldToLocal(zoneKey, worldX, worldY) {
  const z = WORLD_ATLAS[zoneKey];
  if (!z) return { x: worldX, y: worldY };
  return {
    x: worldX - z.worldX,
    y: worldY - z.worldY,
  };
}

/**
 * Find all zones whose bounding box is within `radius` units of
 * a global position. Used to determine which neighbor terrain
 * the client should load.
 *
 * Returns array of { zoneKey, atlas, distance, offset } sorted by distance.
 *   offset = { x, y } from the current zone's center to the neighbor's center
 */
function getNeighborZones(currentZoneKey, localX, localY, radius) {
  const current = WORLD_ATLAS[currentZoneKey];
  if (!current) return [];

  const worldPos = localToWorld(currentZoneKey, localX, localY);
  const neighbors = [];

  for (const [key, zone] of Object.entries(WORLD_ATLAS)) {
    if (key === currentZoneKey) continue;

    // Skip zones on different continents — they're across the ocean
    if (zone.continent !== current.continent) continue;

    // Distance from player's world position to the nearest point on zone bounds
    const bounds = getZoneBounds(key);
    const nearestX = Math.max(bounds.minX, Math.min(worldPos.x, bounds.maxX));
    const nearestY = Math.max(bounds.minY, Math.min(worldPos.y, bounds.maxY));
    const dx = worldPos.x - nearestX;
    const dy = worldPos.y - nearestY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= radius) {
      neighbors.push({
        zoneKey: key,
        name: zone.name,
        shortName: zone.shortName,
        terrain: zone.terrain,
        environment: zone.environment,
        distance: Math.round(dist),
        // Offset from current zone center to neighbor zone center
        // Client uses this to position neighbor terrain meshes
        offset: {
          x: zone.worldX - current.worldX,
          y: zone.worldY - current.worldY,
        },
        width: zone.width,
        height: zone.height,
      });
    }
  }

  // Sort by distance (closest first)
  neighbors.sort((a, b) => a.distance - b.distance);
  return neighbors;
}

/**
 * Get the atlas entry for a zone (if it exists).
 */
function getAtlasEntry(zoneKey) {
  return WORLD_ATLAS[zoneKey] || null;
}

/**
 * Get all zones on a given continent.
 */
function getContinent(continentName) {
  const zones = {};
  for (const [key, zone] of Object.entries(WORLD_ATLAS)) {
    if (zone.continent === continentName) zones[key] = zone;
  }
  return zones;
}

module.exports = {
  WORLD_ATLAS,
  getZoneBounds,
  localToWorld,
  worldToLocal,
  getNeighborZones,
  getAtlasEntry,
  getContinent,
};
