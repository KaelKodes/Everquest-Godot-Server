const db = require('./eqemu_db');
(async () => {
  await db.init();
  // Get arena zone ID
  const arenaId = db.getZoneIdByShortName('arena');
  console.log('Arena zone_id:', arenaId);
  
  if (arenaId) {
    // Direct query via the pool - need to access it
    const mysql = require('mysql2/promise');
    const p = mysql.createPool({
      host: process.env.EQEMU_HOST || '127.0.0.1',
      port: process.env.EQEMU_PORT || 3307,
      user: process.env.EQEMU_USER || 'eqemu',
      password: process.env.EQEMU_PASSWORD || '',
      database: process.env.EQEMU_DATABASE || 'peq',
    });
    
    const [chars] = await p.query("SELECT id, name, zone_id, x, y, z FROM character_data WHERE name = 'Smash'");
    console.log('Current:', JSON.stringify(chars, null, 2));
    
    if (chars.length > 0) {
      await p.query(`UPDATE character_data SET zone_id = ?, x = 0, y = 0, z = 5 WHERE name = 'Smash'`, [arenaId]);
      console.log(`Moved Smash to arena (zone_id=${arenaId}) at 0,0,5`);
    }
    await p.end();
  }
  process.exit(0);
})();
