/** start_zones: druids in zone 4 */
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

  const [rows] = await c.query(
    `SELECT player_race, player_class, player_deity, zone_id, start_zone
     FROM start_zones
     WHERE player_class = 6 AND zone_id = 4
     ORDER BY player_race, player_deity`
  );
  console.log('Druid (class 6) start_zones with zone_id=4:', rows.length);
  for (const r of rows) {
    console.log(`  race ${r.player_race} deity ${r.player_deity} zone ${r.zone_id} ${r.start_zone}`);
  }

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
