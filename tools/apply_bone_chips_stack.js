/**
 * Classic Bone Chips (13073): stackable up to 100 (PEQ default).
 * Does not change other rows named "Bone Chips" (quest decoys).
 * Run: node tools/apply_bone_chips_stack.js
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

  const [upd] = await c.query(
    `UPDATE items SET stackable = 1, stacksize = 100
     WHERE id = 13073 AND Name = 'Bone Chips'`
  );
  console.log('Bone Chips (13073):', upd.affectedRows, 'rows → stackable=1, stacksize=100');

  const [rows] = await c.query(
    `SELECT id, Name, stackable, stacksize FROM items WHERE id = 13073`
  );
  console.log(JSON.stringify(rows, null, 2));

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
