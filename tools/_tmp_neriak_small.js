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
  const zones = ['neriak', 'neriaka', 'neriakb', 'neriakc'];
  const [triggers] = await c.query(`
    SELECT s.zone, n.id, n.name, n.race, n.size, n.level, n.maxdmg, s.x, s.y
    FROM spawn2 s JOIN spawnentry se ON s.spawngroupID=se.spawngroupID
    JOIN npc_types n ON se.npcID=n.id
    WHERE s.zone IN (?) AND (n.race IN (127,240,224) OR n.name LIKE '%trap%' OR n.name LIKE 'Timer%')
    ORDER BY s.zone, n.name`, [zones]);
  console.log('triggers:', triggers);
  const [hostile] = await c.query(`
    SELECT s.zone, n.id, n.name, n.race, n.size, n.level, n.maxdmg, n.npc_faction_id, s.x, s.y
    FROM spawn2 s JOIN spawnentry se ON s.spawngroupID=se.spawngroupID
    JOIN npc_types n ON se.npcID=n.id
    WHERE s.zone IN (?) AND n.class=1 AND n.maxdmg > 500
    ORDER BY n.maxdmg DESC LIMIT 15`, [zones]);
  console.log('high dmg class1:', hostile);
  const [names] = await c.query(`
    SELECT s.zone, n.id, n.name, n.race, n.size, n.level, n.maxdmg
    FROM spawn2 s JOIN spawnentry se ON s.spawngroupID=se.spawngroupID
    JOIN npc_types n ON se.npcID=n.id
    WHERE s.zone LIKE 'neriak%' AND (n.name LIKE '%dark%' OR n.name LIKE '%shadow%')`, []);
  console.log('dark/shadow names:', names);
  await c.end();
})();
