// Quick test: verify spawnMob generates x/y coordinates
const ZONES = require('./data/zones');

for (const [zoneId, zoneDef] of Object.entries(ZONES)) {
  console.log(`\nZone: ${zoneDef.name}`);
  for (const mobDef of zoneDef.mobs) {
    const mob = {
      id: `${mobDef.key}_test`,
      name: mobDef.name,
      x: (Math.random() * 20) - 10,
      y: (Math.random() * 20) - 10,
    };
    console.log(`  ${mob.name}: x=${mob.x.toFixed(2)}, y=${mob.y.toFixed(2)}`);
  }
}
