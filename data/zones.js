// ── Zone Definitions ────────────────────────────────────────
// All real zones now load dynamically from the EQEmu database via ensureZoneLoaded().
// Only cshome (Sunset Home / GM Admin Zone) is kept as a hardcoded fallback.

const ZONES = {
  cshome: {
    name: 'Sunset Home',
    environment: 'indoor',
    climate: 'temperate',
    shortName: 'cshome',
    levelRange: [1, 65],
    mapSize: { width: 500, length: 500 },
    centerOffset: { x: 0, y: 0 },
    mobs: [
      {
        id: "light_tuner_1",
        key: "light_tuner_1",
        name: "Light Tuner",
        x: 0,
        y: 0,
        z: 0,
        race: "capsule",
        eqClass: "warrior",
        level: 1,
        hp: 1000,
        maxHp: 1000
      }
    ]
  }
};

module.exports = ZONES;
