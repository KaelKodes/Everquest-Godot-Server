require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');

(async () => {
  const pool = mysql.createPool({
    host: process.env.EQEMU_HOST || '127.0.0.1',
    port: process.env.EQEMU_PORT || 3307,
    user: process.env.EQEMU_USER || 'eqemu',
    password: process.env.EQEMU_PASSWORD || 'bHqIbrW81WLuaZ4qaQGrRViIHHvz9nR',
    database: process.env.EQEMU_DATABASE || 'peq',
    connectionLimit: 2
  });

  const [dbIds] = await pool.query("SELECT DISTINCT LOWER(idfile) as idf FROM items WHERE damage > 0 AND idfile IS NOT NULL AND idfile != ''");

  const meshDir = 'd:/Kael Kodes/EQMUD/server/tools/LanternExtractor/Exports/gequip/Meshes';
  const meshFiles = new Set(
    fs.readdirSync(meshDir)
      .filter(f => f.endsWith('.txt') && !f.includes('collision'))
      .map(f => f.replace('.txt', ''))
  );

  let matched = 0, missing = 0;
  for (const row of dbIds) {
    if (meshFiles.has(row.idf)) matched++;
    else missing++;
  }

  console.log('DB weapons with idfile: ' + dbIds.length);
  console.log('LanternExtractor meshes: ' + meshFiles.size);
  console.log('Matched: ' + matched + ' / ' + dbIds.length);
  console.log('Missing meshes: ' + missing);

  const missingList = dbIds.filter(r => !meshFiles.has(r.idf)).slice(0, 10);
  if (missingList.length > 0) console.log('Sample missing: ' + missingList.map(r => r.idf).join(', '));

  await pool.end();
})();
