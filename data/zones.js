// ── EQ-Style Zone Definitions ────────────────────────────────────────
// Each zone has mobs with level-appropriate stats. Mobs respawn on a timer.

const QHILLS_MOBS = require('./mobs/qeynos_hills');
const WKARANA_MOBS = require('./mobs/west_karana');
const NKARANA_MOBS = require('./mobs/north_karana');

const ZONES = {
  qeynos_hills: {
    name: 'Qeynos Hills',
    environment: 'outdoor',
    climate: 'temperate',
    shortName: 'qeytoqrg',
    levelRange: [1, 5],
    mapSize: { width: 3500, length: 5600 },
    centerOffset: { x: -565, y: 2445 },
    zoneLines: [
      { target: 'surefall_glade', edge: 'north', width: 400, offset: 0 },
      { target: 'qeynos_city', edge: 'south', width: 800, offset: 0 },
      { target: 'blackburrow', edge: 'east', width: 400, offset: -1000 },
      { target: 'west_karana', edge: 'east', width: 600, offset: 1500 }
    ],
    defaultRoom: 'qh_0_0',
    rooms: {
      'qh_0_0': { id: 'qh_0_0', name: 'Qeynos Gates', x: 0, y: 0, exits: { n: 'qh_0_1', e: 'qh_1_0' }, description: 'The grand gates of Qeynos loom to the south. The hills open up to the north and east.' },
      'qh_0_1': { id: 'qh_0_1', name: 'Rolling Hills', x: 0, y: 1, exits: { s: 'qh_0_0', n: 'qh_0_2' }, description: 'Gentle green hills stretch across the horizon. You hear wolves howling nearby.' },
      'qh_0_2': { id: 'qh_0_2', name: 'Hadden\'s Lake', x: 0, y: 2, exits: { s: 'qh_0_1', e: 'qh_1_2' }, description: 'A serene lake sits quietly. A lone fisherman might be found here.' },
      'qh_1_0': { id: 'qh_1_0', name: 'Guard Tower', x: 1, y: 0, exits: { w: 'qh_0_0', e: 'qh_2_0' }, description: 'A sturdy stone guard tower stands watch over the main path.' },
      'qh_1_2': { id: 'qh_1_2', name: 'Blackburrow Entrance', x: 1, y: 2, exits: { w: 'qh_0_2' }, description: 'A gaping, muddy hole in the hillside pulses with the snarls of Gnolls. This is the entrance to Blackburrow.' },
      'qh_2_0': { id: 'qh_2_0', name: 'Path to Karana', x: 2, y: 0, exits: { w: 'qh_1_0' }, description: 'The dusty path extends eastward, hinting at the vast plains of Karana ahead.' }
    },
    mobs: QHILLS_MOBS,
  },

  west_karana: {
    name: 'West Karana',
    environment: 'outdoor',
    climate: 'temperate',
    shortName: 'qey2hh1',
    levelRange: [5, 15],
    mapSize: { width: 2000, length: 2000 },
    centerOffset: { x: 0, y: 0 },
    zoneLines: [
      { target: 'qeynos_hills', edge: 'west', width: 600, offset: -2500 },
      { target: 'north_karana', edge: 'east', width: 2000, offset: 0 }
    ],
    mobs: WKARANA_MOBS,
  },

  qeynos_city: {
    name: 'South Qeynos',
    environment: 'outdoor',
    climate: 'temperate',
    shortName: 'qeynos2', // Using South Qeynos
    levelRange: [1, 60],
    mapSize: { width: 1000, length: 1000 },
    centerOffset: { x: 0, y: 0 },
    zoneLines: [
      { target: 'qeynos_hills', edge: 'north', width: 800, offset: 0 }
    ],
    mobs: [],  // Safe city zone
    vendors: [
      { name: 'Innkeep Blargin', sells: ['bread', 'water'] },
    ],
  },

  north_karana: {
    name: 'North Karana',
    environment: 'outdoor',
    climate: 'temperate',
    shortName: 'northkarana',
    levelRange: [10, 25],
    mapSize: { width: 1500, length: 1500 },
    centerOffset: { x: 0, y: 0 },
    zoneLines: [
      { target: 'west_karana', edge: 'west', width: 2000, offset: 0 }
    ],
    mobs: NKARANA_MOBS,
  },

  arena: {
    name: 'Arena',
    environment: 'indoor',
    climate: 'temperate',
    shortName: 'arena',
    levelRange: [1, 65],
    mapSize: { width: 3000, length: 3000 },
    centerOffset: { x: 0, y: 0 },
    mobs: [],
  },

};

module.exports = ZONES;
