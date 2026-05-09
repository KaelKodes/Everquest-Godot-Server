/**
 * Read-only: dump starting_items + item display from PEQ `items`.
 * Run:  cd server && node tools/dump_starting_items.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { INV_CLASSES, INV_RACES } = require('../data/constants');

function parseList(s) {
  if (s == null || s === '' || String(s) === '0') return ['0'];
  return String(s).split(',').map((x) => x.trim()).filter(Boolean);
}

/** @param {string[]} ids @param {Record<number,string>} invMap */
function labelList(ids, invMap, anyLabel) {
  const parts = [];
  for (const id of ids) {
    if (id === '0') {
      parts.push(anyLabel);
      continue;
    }
    const n = Number(id);
    if (!Number.isFinite(n)) {
      parts.push(String(id));
      continue;
    }
    parts.push(invMap[n] ? `${invMap[n]} [${n}]` : `[id ${n}]`);
  }
  return parts.join(', ');
}

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.EQEMU_HOST || '127.0.0.1',
    port: Number(process.env.EQEMU_PORT || 3307),
    user: process.env.EQEMU_USER || 'eqemu',
    password: process.env.EQEMU_PASSWORD,
    database: process.env.EQEMU_DATABASE || 'peq',
  });

  const [nameRows] = await conn.query(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'items'
     AND COLUMN_NAME IN ('Name','name') LIMIT 1`
  );
  const nameCol = nameRows[0]?.c || null;
  if (!nameCol || !/^(Name|name)$/.test(nameCol)) {
    console.error('Could not find items.Name or items.name column.');
    process.exit(1);
  }

  const sql = `
    SELECT si.id AS row_id, si.zone_id_list, si.class_list, si.race_list, si.deity_list,
           si.item_id, si.item_charges, si.inventory_slot,
           i.\`${nameCol}\` AS item_name
    FROM starting_items si
    LEFT JOIN items i ON i.id = si.item_id
    WHERE si.status = 0
    ORDER BY si.zone_id_list, si.race_list, si.class_list, si.item_id, si.inventory_slot
  `;

  const [rows] = await conn.query(sql);

  console.log('=== starting_items (status=0) —', rows.length, 'rows ===');
  console.log('DB:', process.env.EQEMU_DATABASE || 'peq', '| items column:', nameCol);
  console.log('Legend: list "0" = any. inventory_slot = EQ inventory slot id.');
  console.log('');

  for (const r of rows) {
    const nm = r.item_name != null ? String(r.item_name).trim() : '';
    const label = nm || `(missing item row) #${r.item_id}`;
    const zones = labelList(parseList(r.zone_id_list), {}, '(any zone)');
    const classes = labelList(parseList(r.class_list), INV_CLASSES, '(any class)');
    const races = labelList(parseList(r.race_list), INV_RACES, '(any race)');
    const deities = labelList(parseList(r.deity_list), {}, '(any deity)');
    console.log(`row ${r.row_id} | ${label} [id=${r.item_id}] | charges=${r.item_charges} | inv_slot=${r.inventory_slot}`);
    console.log(`  zones:   ${zones}`);
    console.log(`  classes: ${classes}`);
    console.log(`  races:   ${races}`);
    console.log(`  deities: ${deities}`);
    console.log('');
  }

  const keyCount = new Map();
  for (const r of rows) {
    const k = `${r.race_list}|${r.class_list}|${r.zone_id_list}`;
    keyCount.set(k, (keyCount.get(k) || 0) + 1);
  }
  console.log('=== Row counts by race_list | class_list | zone_id_list ===');
  for (const [k, n] of [...keyCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${n}\t${k}`);
  }

  await conn.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
