const mysql = require('mysql2/promise');
async function run() {
  const pool = mysql.createPool({ host: '127.0.0.1', port: 3307, user: 'eqemu', password: 'bHqIbrW81WLuaZ4qaQGrRViIHHvz9nR', database: 'peq' });
  await pool.query("UPDATE character_data SET zone_id = 57 WHERE name = 'Xerts'");
  console.log('Fixed Xerts zone to 57 (lfaydark).');
  pool.end();
}
run();
