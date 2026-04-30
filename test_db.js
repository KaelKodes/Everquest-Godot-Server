require('dotenv').config();
const mysql = require('mysql2/promise');
(async () => {
  const pool = mysql.createPool({
    host: process.env.EQEMU_HOST || '127.0.0.1',
    port: parseInt(process.env.EQEMU_PORT || '3307'),
    user: process.env.EQEMU_USER || 'eqemu',
    password: process.env.EQEMU_PASSWORD,
    database: process.env.EQEMU_DATABASE || 'eqemu',
  });
  const [rows] = await pool.query("SELECT doorid, name, pos_z, door_param, invert_state, size FROM doors WHERE zone='gfaydark' AND name LIKE '%LEVATOR%'");
  console.log(rows);
  pool.end();
})();
