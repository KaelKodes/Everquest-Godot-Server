const mysql = require('mysql2/promise');
(async () => {
  const p = mysql.createPool({ 
    host: '127.0.0.1',
    port: 3307,
    user: 'eqemu',
    password: 'bHqIbrW81WLuaZ4qaQGrRViIHHvz9nR',
    database: 'peq'
  });

  // Check felwithea zone points
  const [rows] = await p.query(`
    SELECT zp.number, zp.zone, zp.x, zp.y, zp.z, 
           zp.target_x, zp.target_y, zp.target_z,
           zp.target_zone_id, z.short_name as target_short
    FROM zone_points zp 
    JOIN zone z ON zp.target_zone_id = z.zoneidnumber 
    WHERE zp.zone = 'felwithea' AND zp.is_virtual = 0
    ORDER BY zp.number
  `);

  console.log(`\n=== FELWITHEA Zone Points (${rows.length}) ===`);
  for (const r of rows) {
    console.log(`  #${r.number}: trigger=(${r.x}, ${r.y}, ${r.z}) → ${r.target_short} target=(${r.target_x}, ${r.target_y}, ${r.target_z})`);
  }

  // gfaydark zone points
  const [rows3] = await p.query(`
    SELECT zp.number, zp.zone, zp.x, zp.y, zp.z, 
           zp.target_x, zp.target_y, zp.target_z,
           zp.target_zone_id, z.short_name as target_short
    FROM zone_points zp 
    JOIN zone z ON zp.target_zone_id = z.zoneidnumber 
    WHERE zp.zone = 'gfaydark' AND zp.is_virtual = 0
    ORDER BY zp.number
  `);

  console.log(`\n=== GFAYDARK All Zone Points (${rows3.length}) ===`);
  for (const r of rows3) {
    console.log(`  #${r.number}: trigger=(${r.x}, ${r.y}, ${r.z}) → ${r.target_short} target=(${r.target_x}, ${r.target_y}, ${r.target_z})`);
  }

  // Also check what the server logs as the final spawn position
  // Let's see the safe_x/y/z for gfaydark zone
  const [zoneMeta] = await p.query(`
    SELECT short_name, safe_x, safe_y, safe_z FROM zone WHERE short_name = 'gfaydark'
  `);
  console.log(`\n=== GFAYDARK Safe Coords ===`);
  console.log(JSON.stringify(zoneMeta[0]));

  await p.end();
  process.exit(0);
})();
