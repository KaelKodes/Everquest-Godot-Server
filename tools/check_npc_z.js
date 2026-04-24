const eqemuDB = require('../eqemu_db');

(async () => {
  const rows = await eqemuDB.getZoneSpawns('gfaydark');
  
  // Show ground-level and high-Z NPCs for scaling comparison
  console.log('DB values for key NPCs:');
  console.log('(Player should fly to these NPCs in Godot and F6 to get Godot Y)');
  console.log('');
  
  const names = ['eaolan', 'endrick', 'ecaying'];
  for (const search of names) {
    const found = rows.filter(r => r.name && r.name.toLowerCase().includes(search));
    for (const r of found) {
      console.log(`${(r.name||'?').padEnd(30)}  EQ: x=${r.x.toFixed(1).padStart(8)}  y=${r.y.toFixed(1).padStart(8)}  z=${r.z.toFixed(1).padStart(8)}`);
    }
  }
  
  // The key question: what's the ratio between DB Z and Godot Y?
  // Weaolanae: DB z=161, Godot Y=74.1 → ratio = 74.1/161 = 0.4602
  // Ground level: DB z≈-7, Godot Y≈-7.1 → close to 1:1 at ground?
  // Wait... ground level Godot Y = -7.1, and DB ground z might be around -15?
  
  // Let's check what z values ground-level mobs have
  const groundMobs = rows.filter(r => r.z < 10 && r.z > -50);
  console.log(`\nGround-level mobs (z between -50 and 10): ${groundMobs.length}`);
  const sample = groundMobs.slice(0, 5);
  for (const r of sample) {
    console.log(`  ${(r.name||'?').padEnd(30)}  z=${r.z.toFixed(1)}`);
  }
  
  console.log('\n=== SCALING ANALYSIS ===');
  console.log('Weaolanae: DB z=161, Godot Y=74.1');
  console.log('Ratio: 74.1 / 161 = ' + (74.1/161).toFixed(4));
  console.log('Ground: DB z≈? , Godot Y=-7.1');
  console.log('');
  console.log('If its a linear scale: scale = 74.1/161 ≈ 0.46');
  console.log('Inverse: 161/74.1 ≈ 2.17');
  
  process.exit(0);
})();
