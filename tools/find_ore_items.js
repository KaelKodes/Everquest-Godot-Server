const db = require('../eqemu_db');

// Erudites can be: cleric(2), paladin(3), shadowknight(5), wizard(12), magician(13), enchanter(14)
// High Elves can be: cleric(2), paladin(3), wizard(12), magician(13), enchanter(14)
const TESTS = [
  { race: 3, name: 'Erudite',   classes: [2, 3, 5, 12, 13, 14] },
  { race: 5, name: 'High Elf',  classes: [2, 3, 12, 13, 14] },
];

(async () => {
  await db.init();
  
  for (const t of TESTS) {
    console.log(`\n=== ${t.name} (race ${t.race}) ===`);
    for (const cls of t.classes) {
      const result = await db.getStartZone(t.race, cls, 396);
      console.log(`  class ${cls}: ${result.zone_short} (zone_id=${result.zone_id})`);
    }
  }
  
  // Also grab NPC coords from those zones
  for (const zone of ['erudin', 'erudnext', 'erudnint', 'felwithea', 'felwitheb']) {
    try {
      const spawns = await db.getZoneSpawns(zone);
      if (!spawns || spawns.length === 0) { console.log(`\n${zone}: no spawns`); continue; }
      const merchants = spawns.filter(s => s.class === 41).slice(0, 5);
      if (merchants.length > 0) {
        console.log(`\n=== ${zone} merchants ===`);
        merchants.forEach(s => console.log(`  ${s.name} @ x=${s.x}, y=${s.y}, z=${s.z}`));
      }
    } catch(e) {
      console.log(`\n${zone}: ${e.message}`);
    }
  }
  
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
