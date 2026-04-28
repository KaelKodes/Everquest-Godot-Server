// Extract all pet data from the EQEmu database
const mysql = require('mysql2/promise');

(async () => {
  const p = mysql.createPool({
    host: '127.0.0.1', port: 3307,
    user: 'eqemu', password: 'bHqIbrW81WLuaZ4qaQGrRViIHHvz9nR',
    database: 'peq'
  });

  // Get ALL pets with their NPC stats
  const [rows] = await p.query(`
    SELECT p.id, p.type, p.petpower, p.npcID, p.temp, p.petcontrol,
           p.petnaming, p.monsterflag, p.equipmentset,
           n.name, n.level, n.hp, n.mindmg, n.maxdmg, n.race, n.gender,
           n.class, n.attack_delay, n.attack_speed,
           n.STR, n.STA, n.DEX, n.AGI, n.WIS, n.CHA,
           n.MR, n.FR, n.CR, n.DR, n.PR, n.AC,
           n.runspeed, n.hp_regen_rate, n.mana_regen_rate
    FROM pets p
    JOIN npc_types n ON p.npcID = n.id
    ORDER BY p.type, p.petpower, n.level
  `);

  // Group by type
  const byType = {};
  for (const r of rows) {
    if (!byType[r.type]) byType[r.type] = [];
    byType[r.type].push(r);
  }

  console.log(`Total pet records: ${rows.length}`);
  console.log(`Unique pet types: ${Object.keys(byType).length}\n`);

  // Print grouped
  for (const [type, pets] of Object.entries(byType)) {
    // Filter to just classic-era looking types
    if (type.startsWith('#')) continue; // Skip expansion-specific
    console.log(`=== ${type} (${pets.length} variants) ===`);
    for (const r of pets) {
      console.log(`  pw=${r.petpower} L${r.level} HP=${r.hp} DMG=${r.mindmg}-${r.maxdmg} DLY=${r.attack_delay} race=${r.race} AC=${r.AC} regen=${r.hp_regen_rate} class=${r.class} name=${r.name} npcID=${r.npcID}`);
    }
    console.log('');
  }

  await p.end();
  process.exit(0);
})();
