/**
 * One-off: node tools/lookup_npc_spawn.js Fabdabus
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const needle = process.argv[2] || 'Fabdabus';

async function main() {
  const c = await mysql.createConnection({
    host: process.env.EQEMU_HOST || '127.0.0.1',
    port: Number(process.env.EQEMU_PORT || 3307),
    user: process.env.EQEMU_USER || 'eqemu',
    password: process.env.EQEMU_PASSWORD,
    database: process.env.EQEMU_DATABASE || 'peq',
  });
  const like = `%${needle.replace(/%/g, '')}%`;
  const [n] = await c.query(
    'SELECT id, name FROM npc_types WHERE name LIKE ? ORDER BY id LIMIT 20',
    [like]
  );
  console.log('npc_types matches:', n);
  for (const row of n) {
    const [s] = await c.query(
      `SELECT s.id AS spawn2_id, s.zone, s.version, s.content_flags, s.content_flags_disabled,
              se.npcID, se.content_flags AS se_cf, se.content_flags_disabled AS se_cfd
       FROM spawn2 s
       JOIN spawnentry se ON s.spawngroupID = se.spawngroupID
       WHERE se.npcID = ?`,
      [row.id]
    );
    console.log('spawns for', row.id, row.name, ':', s);
  }
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
