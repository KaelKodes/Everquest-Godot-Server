const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({
    host: process.env.EQEMU_HOST || '127.0.0.1',
    port: Number(process.env.EQEMU_PORT || 3307),
    user: process.env.EQEMU_USER || 'eqemu',
    password: process.env.EQEMU_PASSWORD,
    database: process.env.EQEMU_DATABASE || 'peq',
  });
  const [z] = await c.query(
    "SELECT id, zoneidnumber, short_name, long_name FROM zone WHERE short_name IN ('qeytoqrg','qeynos2','freportn','halas','rivervale','akanon') ORDER BY short_name"
  );
  console.table(z);
  const [sz] = await c.query(
    'SELECT player_race, player_class, player_deity, zone_id, start_zone FROM start_zones WHERE player_race=2 AND player_class=6 LIMIT 5'
  );
  console.table(sz);
  await c.end();
})();
