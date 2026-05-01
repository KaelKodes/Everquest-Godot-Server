const mysql = require('mysql2/promise');
async function run() {
  const pool = mysql.createPool({ host: '127.0.0.1', port: 3307, user: 'eqemu', password: 'bHqIbrW81WLuaZ4qaQGrRViIHHvz9nR', database: 'peq' });
  const [rows] = await pool.query("SELECT id, name, doorid, triggerdoor, invert_state, door_param FROM doors WHERE zone='felwithea'");
  console.log(rows);
  pool.end();
}
run();
