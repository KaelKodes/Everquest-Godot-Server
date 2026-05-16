require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({
    host: process.env.EQEMU_HOST,
    port: Number(process.env.EQEMU_PORT || 3307),
    user: process.env.EQEMU_USER,
    password: process.env.EQEMU_PASSWORD,
    database: process.env.EQEMU_DATABASE,
  });

  const [traps] = await c.query(`
    SELECT n.id, n.name, n.race, n.class, n.size, n.level, s.x, s.y, s.z
    FROM spawn2 s
    JOIN spawnentry se ON s.spawngroupID = se.spawngroupID
    JOIN npc_types n ON se.npcID = n.id
    WHERE s.zone = 'kelethin'
      AND (n.race = 240 OR n.size > 15 OR n.name LIKE '%trap%' OR n.name LIKE '%bind%')
    ORDER BY n.size DESC, n.id
  `);
  console.log('=== trigger / huge spawns ===');
  console.log(traps);

  const [zp] = await c.query(`
    SELECT zp.number, zp.x, zp.y, zp.z, zp.target_zone_id, zp.buffer, zp.width, zp.height,
           z.short_name AS target_short
    FROM zone_points zp
    LEFT JOIN zone z ON zp.target_zone_id = z.zoneidnumber
    WHERE zp.zone = 'kelethin' AND zp.is_virtual = 0
    ORDER BY zp.number
  `);
  console.log('\n=== zone_points ===');
  console.log(zp);

  const [succor] = await c.query(
    `SELECT short_name, safe_x, safe_y, safe_z FROM zone WHERE short_name = 'kelethin'`
  );
  console.log('\n=== succor ===');
  console.log(succor);

  await c.end();
})();
