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
  const [rows] = await c.query(
    `SELECT id, doorid, name, opentype, door_param, invert_state, triggerdoor, pos_x, pos_y, pos_z, heading, size
     FROM doors WHERE zone = 'neriakb' AND (name LIKE '%HHCELL%' OR id IN (6164, 6197))
     ORDER BY id`
  );
  console.log(rows);
  await c.end();
})();
