/** One-off: list starting_items that look like guild summons / notes. */
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

  const [rows] = await c.query(`
    SELECT si.id, si.item_id, i.Name, si.zone_id_list, si.class_list, si.race_list, si.deity_list, si.inventory_slot
    FROM starting_items si
    JOIN items i ON i.id = si.item_id
    WHERE si.status = 0
      AND (
        i.Name LIKE '%Guild Summons%'
        OR i.Name LIKE '%Tattered Note%'
        OR i.Name LIKE '%Recruitment%'
        OR i.Name LIKE '%Recruit Letter%'
        OR i.Name LIKE '%Recruit%Letter%'
        OR i.Name LIKE '%Summons%'
      )
    ORDER BY i.Name, si.zone_id_list, si.class_list, si.race_list
  `);

  console.log('Matching rows:', rows.length);
  for (const r of rows) {
    console.log(
      `${r.Name} [item ${r.item_id}] row ${r.id} | zone_list ${r.zone_id_list} class ${r.class_list} race ${r.race_list} deity ${r.deity_list} slot ${r.inventory_slot}`
    );
  }

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
