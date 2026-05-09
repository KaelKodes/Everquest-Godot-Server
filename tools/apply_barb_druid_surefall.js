/**
 * One-time: Barbarian Druid → Surefall Glade (zoneidnumber 3 = qrg), guild note + tunic usable.
 * Run: node tools/apply_barb_druid_surefall.js
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

  // Match PEQ human druid (Karana) in qrg — proven coords; Te'Anara is nearby in-zone.
  const x = -430;
  const y = -209;
  const z = 6.75;
  const heading = 384;
  const zoneId = 3;

  await c.beginTransaction();

  const [sz] = await c.query(
    `UPDATE start_zones SET zone_id = ?, start_zone = ?, bind_id = ?,
       x = ?, y = ?, z = ?, heading = ?, bind_x = ?, bind_y = ?, bind_z = ?
     WHERE player_race = 2 AND player_class = 6`,
    [zoneId, zoneId, zoneId, x, y, z, heading, x, y, z]
  );
  console.log('start_zones (barb druid):', sz.affectedRows, 'rows');

  const [ccc] = await c.query(
    'UPDATE char_create_combinations SET start_zone = ? WHERE race = 2 AND class = 6',
    [zoneId]
  );
  console.log('char_create_combinations:', ccc.affectedRows, 'rows');

  // Tattered Note (18713) guild summons for druids starting in Surefall + tutorial
  const [si] = await c.query(
    `UPDATE starting_items SET race_list = ? WHERE id = 49 AND item_id = 18713`,
    ['1|2|7']
  );
  console.log('starting_items id 49:', si.affectedRows, 'rows (race_list includes barbarian)');

  // Human(1) + Wood Elf(4) + Half Elf(7) = 1+8+64 = 73; + Barbarian(2) bit = 2 → 75
  const [it] = await c.query(
    'UPDATE items SET races = 75 WHERE id = 13510 AND Name LIKE ?',
    ['Dried Grass Tunic%']
  );
  console.log('items Dried Grass Tunic:', it.affectedRows, 'rows (races bitmask includes BAR)');

  await c.commit();
  console.log('Done.');
  await c.end();
})().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
