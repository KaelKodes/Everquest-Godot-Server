#!/usr/bin/env node
/**
 * Compare PEQ zone.short_name rows to zone archives in a local EverQuest install.
 * Uses the same Lantern basename rules as eqemu_db.getLanternArchiveBase().
 *
 * Usage (from repo root):
 *   node server/scripts/audit_zone_s3d.js "D:\everquest_rof2\everquest_rof2"
 *
 * Requires server/.env (EQEMU_* mysql) like the game server.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const eqemuDB = require('../eqemu_db');

function findZoneS3d(installRoot, want) {
  if (!installRoot || !want) return null;
  want = String(want).trim().toLowerCase();
  const direct = (dir) => {
    for (const ext of ['.s3d', '.S3D', '.S3d']) {
      const p = path.join(dir, want + ext);
      if (fs.existsSync(p)) return p;
    }
    return null;
  };
  try {
    let hit = direct(installRoot);
    if (hit) return hit;
    const entries = fs.readdirSync(installRoot, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile() || !e.name.toLowerCase().endsWith('.s3d')) continue;
      if (path.basename(e.name, path.extname(e.name)).toLowerCase() === want) return path.join(installRoot, e.name);
    }
    const subHints = new Set(['resources', 'Resources', 'zones', 'Zones', 'maps', 'Maps', 'zonemeshes', 'ZoneMeshes', 'assets', 'Assets', 'data', 'Data']);
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const sub = path.join(installRoot, e.name);
      hit = direct(sub);
      if (hit) return hit;
    }
    for (const e of entries) {
      if (!e.isDirectory() || subHints.has(e.name)) continue;
      hit = direct(path.join(installRoot, e.name));
      if (hit) return hit;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const sub = path.join(installRoot, e.name);
      let subEntries;
      try {
        subEntries = fs.readdirSync(sub, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e2 of subEntries) {
        if (!e2.isDirectory()) continue;
        hit = direct(path.join(sub, e2.name));
        if (hit) return hit;
      }
    }
  } catch (err) {
    console.error('[audit]', err.message);
  }
  return null;
}

async function main() {
  const eqRoot = process.argv[2];
  if (!eqRoot || !fs.existsSync(eqRoot)) {
    console.error('Usage: node server/scripts/audit_zone_s3d.js <path-to-eq-install-root>');
    process.exit(1);
  }

  await eqemuDB.init();
  const pool = mysql.createPool({
    host: process.env.EQEMU_HOST || '127.0.0.1',
    port: process.env.EQEMU_PORT || 3307,
    user: process.env.EQEMU_USER || 'eqemu',
    password: process.env.EQEMU_PASSWORD,
    database: process.env.EQEMU_DB || 'peq',
    waitForConnections: true,
    connectionLimit: 2
  });

  const [rows] = await pool.query('SELECT short_name FROM zone ORDER BY short_name');
  const missing = [];
  const aliased = [];
  for (const r of rows) {
    const sn = String(r.short_name).trim();
    const base = eqemuDB.getLanternArchiveBase(sn);
    if (base !== sn.toLowerCase()) aliased.push({ short_name: sn, archiveBase: base });
    const hit = findZoneS3d(eqRoot, base);
    if (!hit) missing.push({ short_name: sn, lookedFor: base });
  }
  await pool.end();

  console.log(`EQ root: ${eqRoot}`);
  console.log(`Zones in DB: ${rows.length}`);
  console.log(`Missing .s3d (after Lantern basename rules): ${missing.length}`);
  if (aliased.length) {
    console.log(`\nDB short_name → archive basename (${aliased.length} alias rules):`);
    for (const a of aliased) console.log(`  ${a.short_name} → ${a.archiveBase}`);
  }
  if (missing.length) {
    console.log('\nMissing (first 80):');
    for (const m of missing.slice(0, 80)) console.log(`  ${m.short_name} (expected ${m.lookedFor}.s3d)`);
    if (missing.length > 80) console.log(`  ... and ${missing.length - 80} more`);
    process.exitCode = 2;
  } else {
    console.log('\nAll zone rows resolve to an on-disk .s3d under this install (per search rules).');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
