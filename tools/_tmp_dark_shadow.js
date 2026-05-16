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
  const [n] = await c.query('SELECT id,name,race,class,size,level,hp,mindmg,maxdmg,npc_faction_id FROM npc_types WHERE id=170002');
  console.log('npc:', n[0]);
  const [s] = await c.query(`
    SELECT s.zone, s.x, s.y, s.z FROM spawn2 s
    JOIN spawnentry se ON s.spawngroupID = se.spawngroupID
    WHERE se.npcID = 170002`);
  console.log('spawns:', s);
  const [nerSmall] = await c.query(`
    SELECT s.zone, n.id, n.name, n.race, n.size, n.level, n.maxdmg, s.x, s.y
    FROM spawn2 s JOIN spawnentry se ON s.spawngroupID=se.spawngroupID
    JOIN npc_types n ON se.npcID=n.id
    WHERE s.zone LIKE 'neriak%' AND n.name LIKE '%shadow%'
    ORDER BY n.name`);
  console.log('neriak shadow:', nerSmall);
  await c.end();
})();
