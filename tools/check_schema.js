require('dotenv/config');
const mysql = require('mysql2/promise');

async function test() {
  const pool = mysql.createPool({
        host: process.env.EQEMU_HOST,
        user: process.env.EQEMU_USER,
        password: process.env.EQEMU_PASSWORD,
        database: process.env.EQEMU_DATABASE,
        port: process.env.EQEMU_PORT || 3306,
  });
  try {
    const [rows] = await pool.query('DESCRIBE spawngroup');
    console.log("spawngroup:", rows.map(r => r.Field).join(', '));
    const [rows2] = await pool.query('DESCRIBE spawnentry');
    console.log("spawnentry:", rows2.map(r => r.Field).join(', '));
    const [rows3] = await pool.query('DESCRIBE npc_types');
    console.log("npc_types:", rows3.map(r => r.Field).join(', '));
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
test();
