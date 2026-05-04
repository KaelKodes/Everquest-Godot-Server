const mysql = require('mysql2/promise');
async function test() {
  const pool = mysql.createPool({ host: '127.0.0.1', user: 'peq', password: 'peq', database: 'peq' });
  const [rows] = await pool.query(`SELECT id, doorid, name, opentype FROM doors WHERE zone = 'gfaydark'`);
  console.log(rows);
  process.exit(0);
}
test();
