require('dotenv').config();
const mysql = require('mysql2/promise');
(async () => {
  const p = mysql.createPool({ 
    host: process.env.EQEMU_HOST || '127.0.0.1',
    port: process.env.EQEMU_PORT || 3307,
    user: process.env.EQEMU_USER || 'eqemu',
    password: process.env.EQEMU_PASSWORD || '',
    database: process.env.EQEMU_DATABASE || 'peq'
  });
  const [cols] = await p.query("SHOW COLUMNS FROM zone");
  const cc = cols.filter(c => /safe|succor|recall|graveyard|min_|max_/.test(c.Field)).map(c => c.Field);
  console.log('COORDINATE COLUMNS:', cc.join(', '));
  const [r] = await p.query('SELECT ' + cc.join(',') + " FROM zone WHERE short_name='arena'");
  console.log('ARENA:', JSON.stringify(r[0]));
  await p.end();
  process.exit(0);
})();
