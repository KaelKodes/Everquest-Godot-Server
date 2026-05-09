/** Guild-like starting_items for barbarian (race 2) druid (class 6) */
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
    SELECT si.id, si.item_id, i.Name, si.zone_id_list, si.class_list, si.race_list, si.deity_list
    FROM starting_items si
    JOIN items i ON i.id = si.item_id
    WHERE si.status = 0
      AND (si.class_list = '0' OR FIND_IN_SET('6', si.class_list))
      AND (si.race_list = '0' OR FIND_IN_SET('2', si.race_list))
      AND (
        i.Name LIKE '%Guild Summons%'
        OR i.Name LIKE '%Tattered Note%'
        OR i.Name LIKE '%Recruitment%'
        OR i.Name LIKE '%Summons%'
      )
    ORDER BY si.zone_id_list, i.Name
  `);

  console.log('Guild-like starting_items matching race Barbarian(2) + Druid(6):', rows.length);
  for (const r of rows) {
    console.log(
      `${r.Name} [${r.item_id}] row ${r.id} | zone ${r.zone_id_list} class ${r.class_list} race ${r.race_list} deity ${r.deity_list}`
    );
  }

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
