/**
 * Compare Barbarian Druid start (zone 4) to other Druid starting_items in same zone.
 * Also verify Allakhazam item 49468 vs local items.id.
 */
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

  const [i49468] = await c.query('SELECT id, Name FROM items WHERE id = ?', [49468]);
  console.log('items.id 49468:', i49468[0] || '(not in this database)');

  // Druid (class 6) + zoneidnumber 4 (qeytoqrg) — same FIND_IN_SET logic as createCharacter uses on start zone id
  const [druidZ4] = await c.query(
    `
    SELECT si.id, si.item_id, i.Name, si.item_charges, si.inventory_slot,
           si.zone_id_list, si.class_list, si.race_list, si.deity_list
    FROM starting_items si
    LEFT JOIN items i ON i.id = si.item_id
    WHERE si.status = 0
      AND (si.class_list = '0' OR FIND_IN_SET('6', si.class_list))
      AND (si.zone_id_list = '0' OR FIND_IN_SET('4', si.zone_id_list))
    ORDER BY si.race_list, si.deity_list, si.item_id
    `
  );

  console.log('\nAll starting_items rows matching class Druid(6) + zone 4:', druidZ4.length);
  for (const r of druidZ4) {
    console.log(
      `  row ${r.id} item ${r.item_id} ${r.Name} | race ${r.race_list} class ${r.class_list} zone ${r.zone_id_list} deity ${r.deity_list} slot ${r.inventory_slot}`
    );
  }

  // Barbarian = race 2: same filter as createCharacter for barbarian druid karana
  const [barbDruid] = await c.query(
    `
    SELECT si.id, si.item_id, i.Name, si.item_charges, si.inventory_slot,
           si.zone_id_list, si.class_list, si.race_list, si.deity_list
    FROM starting_items si
    LEFT JOIN items i ON i.id = si.item_id
    WHERE si.status = 0
      AND (si.class_list = '0' OR FIND_IN_SET('6', si.class_list))
      AND (si.race_list = '0' OR FIND_IN_SET('2', si.race_list))
      AND (si.deity_list = '0' OR FIND_IN_SET('207', si.deity_list))
      AND (si.zone_id_list = '0' OR FIND_IN_SET('4', si.zone_id_list))
    ORDER BY si.item_id
    `,
    []
  );
  console.log('\nStrict: race Barbarian(2) + Druid(6) + deity Karana(207) + zone 4:', barbDruid.length);
  for (const r of barbDruid) {
    console.log(`  row ${r.id} item ${r.item_id} ${r.Name}`);
  }

  // Any druid row that is NOT universal (not all four list 0) for zone 4 — "could reuse" candidates
  const specific = druidZ4.filter(
    (r) =>
      String(r.zone_id_list) !== '0' ||
      String(r.class_list) !== '0' ||
      String(r.race_list) !== '0' ||
      String(r.deity_list) !== '0'
  );
  console.log('\nDruid+zone4 rows that are NOT fully-universal filters:', specific.length);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
