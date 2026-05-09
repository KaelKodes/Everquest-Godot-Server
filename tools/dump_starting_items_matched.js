/** Simulate eqemu_db.createCharacter starting_items query for one combo. */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const [, , raceId = '1', classId = '1', deityId = '208', zoneId = '9'] = process.argv;

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.EQEMU_HOST || '127.0.0.1',
    port: Number(process.env.EQEMU_PORT || 3307),
    user: process.env.EQEMU_USER || 'eqemu',
    password: process.env.EQEMU_PASSWORD,
    database: process.env.EQEMU_DATABASE || 'peq',
  });

  const sql = `
    SELECT si.id, si.item_id, i.Name, si.item_charges, si.inventory_slot,
           si.class_list, si.race_list, si.zone_id_list, si.deity_list
    FROM starting_items si
    LEFT JOIN items i ON i.id = si.item_id
    WHERE si.status = 0
      AND (si.class_list = '0' OR FIND_IN_SET(?, REPLACE(si.class_list, '|', ',')))
      AND (si.race_list = '0' OR FIND_IN_SET(?, REPLACE(si.race_list, '|', ',')))
      AND (si.deity_list = '0' OR FIND_IN_SET(?, REPLACE(si.deity_list, '|', ',')))
      AND (si.zone_id_list = '0' OR FIND_IN_SET(?, REPLACE(si.zone_id_list, '|', ',')))
    ORDER BY si.item_id, si.inventory_slot
  `;
  const [rows] = await conn.query(sql, [classId, raceId, deityId, zoneId]);
  console.log(
    `Matched starting_items for race=${raceId} class=${classId} deity=${deityId} zone=${zoneId}: ${rows.length} rows`
  );
  for (const r of rows) {
    console.log(
      `  item ${r.item_id} | ${r.Name || '?'} | charges ${r.item_charges} | inv_slot ${r.inventory_slot} | row ${r.id}`
    );
  }
  await conn.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
