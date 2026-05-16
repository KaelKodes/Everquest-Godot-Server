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
  const [names] = await c.query(
    'SELECT name, COUNT(*) AS c FROM npc_types WHERE race = 240 GROUP BY name ORDER BY c DESC LIMIT 50'
  );
  console.log('race 240 names:', names);
  const [zones] = await c.query(`
    SELECT COUNT(DISTINCT s.zone) AS zone_count, COUNT(*) AS spawn_rows
    FROM spawn2 s
    JOIN spawnentry se ON s.spawngroupID = se.spawngroupID
    JOIN npc_types n ON se.npcID = n.id
    WHERE n.race = 240`);
  console.log('spawn coverage:', zones[0]);
  const [traps] = await c.query(
    "SELECT name, race, COUNT(*) c FROM npc_types WHERE name LIKE '%trap%' OR name LIKE '%bind%' GROUP BY name, race ORDER BY c DESC LIMIT 15"
  );
  console.log('trap/bind names:', traps);
  await c.end();
})();
