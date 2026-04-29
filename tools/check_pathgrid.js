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
    const [qey] = await pool.query("SELECT count(*) as c FROM spawn2 WHERE zone = 'qeytoqrg' AND pathgrid > 0");
    console.log('Qeynos Hills pathgrid mobs:', qey[0].c);

    const [qeyWander] = await pool.query("SELECT count(*) as c FROM spawn2 WHERE zone = 'qeytoqrg' AND roambox > 0");
    console.log('Qeynos Hills roambox mobs:', qeyWander[0].c);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
test();
