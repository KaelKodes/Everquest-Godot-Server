/** items.Name containing Guild Summons (exact-ish) */
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
    SELECT id, Name FROM items
    WHERE Name LIKE '%Guild Summons%' OR Name LIKE '%guild summons%'
    ORDER BY id
    LIMIT 200
  `);
  console.log('items matching Guild Summons in name:', rows.length);
  for (const r of rows) console.log(`  ${r.id}\t${r.Name}`);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
