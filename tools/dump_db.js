// Dump the running MariaDB (Akk stack by default) into ../dumps/<DB>_<timestamp>.sql
//
// Used from this dev box to snapshot our PEQ database before shipping it to
// the public/LAN tester host. The output is a self-contained mysqldump:
//   --add-drop-database  → recreates the target DB on import (wipes whatever
//                          the Akk stack seeded on the new machine)
//   --routines/triggers/events  → carries SPs, triggers, scheduled events
//   --single-transaction → consistent snapshot of InnoDB tables
//
// Reads credentials and container name from server/.env. To override the
// container, set MARIADB_CONTAINER in .env (default: akk-stack-mariadb-1).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONTAINER = process.env.MARIADB_CONTAINER || 'akk-stack-mariadb-1';
const DB       = process.env.EQEMU_DATABASE || 'peq';
const USER     = process.env.EQEMU_USER || 'eqemu';
const PASS     = process.env.EQEMU_PASSWORD || '';

if (!PASS) {
    console.error('[DUMP] EQEMU_PASSWORD is empty. Run Edit_Server.bat first.');
    process.exit(1);
}

// Confirm container is up before we shell out.
const psCheck = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
if (psCheck.status !== 0) {
    console.error('[DUMP] `docker ps` failed. Is Docker Desktop running?');
    process.exit(1);
}
if (!psCheck.stdout.split(/\r?\n/).map(s => s.trim()).includes(CONTAINER)) {
    console.error(`[DUMP] Container '${CONTAINER}' is not running.`);
    console.error('[DUMP] Start the Akk stack (or set MARIADB_CONTAINER in .env) and try again.');
    process.exit(1);
}

const dumpsDir = path.join(__dirname, '..', 'dumps');
fs.mkdirSync(dumpsDir, { recursive: true });

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outFile = path.join(dumpsDir, `${DB}_${ts}.sql`);

console.log(`[DUMP] Dumping '${DB}' from ${CONTAINER}`);
console.log(`[DUMP]   → ${outFile}`);
console.log('[DUMP] This can take a few minutes for a full PEQ database…');

const args = [
    'exec', CONTAINER,
    'mysqldump',
    '--add-drop-database', '--databases', DB,
    '--routines', '--triggers', '--events',
    '--single-transaction',
    '--default-character-set=utf8mb4',
    `-u${USER}`, `-p${PASS}`,
];

const out = fs.openSync(outFile, 'w');
const result = spawnSync('docker', args, {
    stdio: ['ignore', out, 'inherit'],
    windowsHide: true,
});
fs.closeSync(out);

if (result.status !== 0) {
    console.error('[DUMP] mysqldump failed (see error output above).');
    process.exit(result.status || 1);
}

const sizeMb = fs.statSync(outFile).size / 1024 / 1024;
console.log(`[DUMP] ✓ Wrote ${sizeMb.toFixed(1)} MB`);
console.log('[DUMP] Copy this file to the new machine and run Import_DB.bat there.');
