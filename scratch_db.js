const mysql = require('mysql2/promise');
async function run() {
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    port: 3307,
    user: 'eqemu',
    password: 'bHqIbrW81WLuaZ4qaQGrRViIHHvz9nR',
    database: 'peq'
  });
  
  const [rows] = await conn.execute('SELECT n.name, n.class, n.level FROM npc_types n JOIN spawnentry se ON n.id = se.npcID JOIN spawn2 s ON se.spawngroupID = s.spawngroupID WHERE s.zone = \'felwithea\' AND n.class = 2 GROUP BY n.name ORDER BY n.level DESC LIMIT 10');
  
  console.log('Top Clerics:');
  console.log(rows);
  
  await conn.end();
}
run().catch(console.error);
