// Apply a peq dump produced by tools/dump_db.js to the local MariaDB.
//
// Usage:
//   node tools/import_db.js                  (auto-picks newest .sql in dumps/)
//   node tools/import_db.js path\to\foo.sql  (explicit file)
//
// Reads credentials and container name from server/.env (the *new* machine's
// values — that's by design, we want to authenticate against the local DB).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONTAINER = process.env.MARIADB_CONTAINER || 'akk-stack-mariadb-1';
const USER      = process.env.EQEMU_USER || 'eqemu';
const PASS      = process.env.EQEMU_PASSWORD || '';

if (!PASS) {
    console.error('[IMPORT] EQEMU_PASSWORD is empty. Run Edit_Server.bat first.');
    process.exit(1);
}

// Container must be running
const psCheck = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
if (psCheck.status !== 0) {
    console.error('[IMPORT] `docker ps` failed. Is Docker Desktop running?');
    process.exit(1);
}
if (!psCheck.stdout.split(/\r?\n/).map(s => s.trim()).includes(CONTAINER)) {
    console.error(`[IMPORT] Container '${CONTAINER}' is not running.`);
    console.error('[IMPORT] Start the Akk stack (or set MARIADB_CONTAINER in .env) and try again.');
    process.exit(1);
}

let sqlFile = process.argv[2];
if (!sqlFile) {
    const dumpsDir = path.join(__dirname, '..', 'dumps');
    if (!fs.existsSync(dumpsDir)) {
        console.error('[IMPORT] No file given and ../dumps/ does not exist.');
        process.exit(1);
    }
    const files = fs.readdirSync(dumpsDir)
        .filter(f => f.toLowerCase().endsWith('.sql'))
        .map(f => ({ name: f, full: path.join(dumpsDir, f), mtime: fs.statSync(path.join(dumpsDir, f)).mtime }))
        .sort((a, b) => b.mtime - a.mtime);
    if (files.length === 0) {
        console.error('[IMPORT] No .sql files found in ../dumps/.');
        console.error('[IMPORT] Drop the dump from the dev box into server\\dumps\\ first.');
        process.exit(1);
    }
    sqlFile = files[0].full;
    console.log(`[IMPORT] No file given. Using most recent: ${files[0].name}`);
}

sqlFile = path.resolve(sqlFile);
if (!fs.existsSync(sqlFile)) {
    console.error(`[IMPORT] File not found: ${sqlFile}`);
    process.exit(1);
}

const sizeMb = fs.statSync(sqlFile).size / 1024 / 1024;
const baseName = path.basename(sqlFile);
const containerPath = `/tmp/${baseName}`;

console.log(`[IMPORT] Source:    ${sqlFile} (${sizeMb.toFixed(1)} MB)`);
console.log(`[IMPORT] Container: ${CONTAINER}:${containerPath}`);

// 1) Stream the file into the container
console.log('[IMPORT] Copying file into container…');
let r = spawnSync('docker', ['cp', sqlFile, `${CONTAINER}:${containerPath}`], { stdio: 'inherit', windowsHide: true });
if (r.status !== 0) { console.error('[IMPORT] docker cp failed.'); process.exit(r.status || 1); }

// 2) Import inside the container so we don't need a mysql client on the host
console.log('[IMPORT] Running mysql < dump (this can take a few minutes)…');
const shellCmd = `mysql -u${USER} -p${PASS} < ${containerPath}`;
r = spawnSync('docker', ['exec', CONTAINER, 'sh', '-c', shellCmd], { stdio: 'inherit', windowsHide: true });
if (r.status !== 0) { console.error('[IMPORT] mysql import failed.'); process.exit(r.status || 1); }

// 3) Tidy up inside the container
console.log('[IMPORT] Cleaning up…');
spawnSync('docker', ['exec', CONTAINER, 'rm', '-f', containerPath], { stdio: 'inherit', windowsHide: true });

console.log('[IMPORT] ✓ Import complete.');
console.log('[IMPORT] Verify with Edit_Server.bat → "Test DB Connection", then Start_Cluster.bat.');
