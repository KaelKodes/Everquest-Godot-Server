/**
 * Discover content flag names from MariaDB (PEQ / Akk-style schema).
 * Usage: from server/:  node tools/list_content_flags.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

function splitFlags(cell) {
  if (cell == null || String(cell).trim() === '') return [];
  return String(cell)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function addTokens(set, cell) {
  for (const t of splitFlags(cell)) set.add(t);
}

async function tableExists(conn, name) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1',
    [name]
  );
  return rows.length > 0;
}

async function main() {
  if (!process.env.EQEMU_PASSWORD) {
    console.error('EQEMU_PASSWORD not set. Copy server/.env.example to server/.env and configure.');
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: process.env.EQEMU_HOST || '127.0.0.1',
    port: Number(process.env.EQEMU_PORT || 3307),
    user: process.env.EQEMU_USER || 'eqemu',
    password: process.env.EQEMU_PASSWORD,
    database: process.env.EQEMU_DATABASE || 'peq',
  });

  try {
    console.log('=== Database:', process.env.EQEMU_DATABASE || 'peq', '===\n');

    if (await tableExists(conn, 'content_flags')) {
      const [flags] = await conn.query(
        'SELECT id, flag_name, enabled, notes FROM content_flags ORDER BY flag_name'
      );
      console.log('--- content_flags table (global registry) ---');
      if (!flags.length) console.log('(empty)');
      else console.table(flags);
      console.log('');
    } else {
      console.log('--- content_flags table: NOT PRESENT ---\n');
    }

    const spawn2Cols = await tableExists(conn, 'spawn2');
    const spawnentryCols = await tableExists(conn, 'spawnentry');

    if (spawn2Cols) {
      const [rows] = await conn.query(`
        SELECT DISTINCT s.content_flags AS cf, s.content_flags_disabled AS cfd
        FROM spawn2 s
        WHERE (s.content_flags IS NOT NULL AND s.content_flags <> '')
           OR (s.content_flags_disabled IS NOT NULL AND s.content_flags_disabled <> '')
        ORDER BY s.content_flags, s.content_flags_disabled
      `);
      console.log('--- spawn2: distinct non-empty content_flags / content_flags_disabled ---');
      if (!rows.length) console.log('(none)');
      else console.table(rows);
      console.log('');
    }

    if (spawnentryCols) {
      const [rows] = await conn.query(`
        SELECT DISTINCT se.content_flags AS cf, se.content_flags_disabled AS cfd
        FROM spawnentry se
        WHERE (se.content_flags IS NOT NULL AND se.content_flags <> '')
           OR (se.content_flags_disabled IS NOT NULL AND se.content_flags_disabled <> '')
        ORDER BY se.content_flags, se.content_flags_disabled
      `);
      console.log('--- spawnentry: distinct non-empty content_flags / content_flags_disabled ---');
      if (!rows.length) console.log('(none)');
      else console.table(rows);
      console.log('');
    }

    if (spawn2Cols && spawnentryCols) {
      const [detail] = await conn.query(`
        SELECT s.zone, s.id AS spawn2_id, s.content_flags AS s_cf, s.content_flags_disabled AS s_cfd,
               se.npcID AS npc_id, se.content_flags AS se_cf, se.content_flags_disabled AS se_cfd,
               n.name AS npc_name
        FROM spawn2 s
        JOIN spawnentry se ON se.spawngroupID = s.spawngroupID
        JOIN npc_types n ON n.id = se.npcID
        WHERE (s.content_flags IS NOT NULL AND s.content_flags <> '')
           OR (s.content_flags_disabled IS NOT NULL AND s.content_flags_disabled <> '')
           OR (se.content_flags IS NOT NULL AND se.content_flags <> '')
           OR (se.content_flags_disabled IS NOT NULL AND se.content_flags_disabled <> '')
        ORDER BY s.zone, n.name, s.id
      `);
      console.log('--- spawns with any flag set (spawn2 ∪ spawnentry), with NPC ---');
      if (!detail.length) console.log('(none)');
      else if (detail.length <= 200) console.table(detail);
      else {
        console.log(`(${detail.length} rows; showing first 200 — full export: redirect to file)`);
        console.table(detail.slice(0, 200));
      }
      console.log('');
    }

    const tokenSet = new Set();
    if (spawn2Cols) {
      const [r] = await conn.query(
        'SELECT content_flags, content_flags_disabled FROM spawn2 WHERE (content_flags IS NOT NULL AND content_flags <> "") OR (content_flags_disabled IS NOT NULL AND content_flags_disabled <> "")'
      );
      for (const row of r) {
        addTokens(tokenSet, row.content_flags);
        addTokens(tokenSet, row.content_flags_disabled);
      }
    }
    if (spawnentryCols) {
      const [r] = await conn.query(
        'SELECT content_flags, content_flags_disabled FROM spawnentry WHERE (content_flags IS NOT NULL AND content_flags <> "") OR (content_flags_disabled IS NOT NULL AND content_flags_disabled <> "")'
      );
      for (const row of r) {
        addTokens(tokenSet, row.content_flags);
        addTokens(tokenSet, row.content_flags_disabled);
      }
    }

    const sorted = [...tokenSet].sort((a, b) => a.localeCompare(b));
    console.log('--- Unique flag tokens (split on comma) from spawn2 + spawnentry ---');
    if (!sorted.length) console.log('(none)');
    else sorted.forEach((t) => console.log(t));
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
