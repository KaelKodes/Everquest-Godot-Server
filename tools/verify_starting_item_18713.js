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
  const [r] = await c.query(
    'SELECT id, item_id, race_list, zone_id_list, class_list FROM starting_items WHERE item_id = 18713 AND status = 0'
  );
  console.log('starting_items with 18713:', r);
  await c.end();
})();
