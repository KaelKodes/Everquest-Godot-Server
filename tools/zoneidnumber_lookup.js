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
  const [z] = await c.query(
    'SELECT zoneidnumber, short_name FROM zone WHERE zoneidnumber IN (1,2,3,4,8,9,10,19,23,24,29,41,42,45,49,50,52,54,55,60,61,106,155,189,382,383) ORDER BY zoneidnumber'
  );
  console.table(z);
  await c.end();
})();
