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
  const [i] = await c.query('SELECT id, Name, races FROM items WHERE id = 13510');
  console.log('Dried Grass Tunic:', i[0]);
  const [sz] = await c.query(
    `SELECT player_race, player_class, player_deity, zone_id, x, y, z, heading, bind_x, bind_y, bind_z
     FROM start_zones WHERE zone_id = 3 AND player_class = 6 ORDER BY player_race LIMIT 10`
  );
  console.log('start_zones druid zone_id=3:', sz);
  const [bd] = await c.query(
    `SELECT * FROM start_zones WHERE player_race = 2 AND player_class = 6`
  );
  console.log('barb druid start_zones:', bd);
  await c.end();
})();
