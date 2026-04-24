require('dotenv').config();
const mysql = require('mysql2/promise');
(async () => {
  const pool = mysql.createPool({
    host: process.env.EQEMU_HOST || '127.0.0.1',
    port: process.env.EQEMU_PORT || 3307,
    user: process.env.EQEMU_USER || 'eqemu',
    password: process.env.EQEMU_PASSWORD || '',
    database: process.env.EQEMU_DATABASE || 'peq',
  });
  
  const [fromCB] = await pool.query(
    "SELECT zp.number, zp.x, zp.y, zp.z, zp.target_x, zp.target_y, zp.target_z, zp.buffer, zp.height, zp.width, zp.is_virtual, z.short_name as target_short FROM zone_points zp JOIN zone z ON zp.target_zone_id = z.zoneidnumber WHERE zp.zone = 'crushbone' ORDER BY zp.number"
  );
  console.log('=== Zone Points IN Crushbone (exits) ===');
  for (const zp of fromCB) {
    console.log(`  #${zp.number}: EQ pos=(${zp.x}, ${zp.y}, ${zp.z}) -> ${zp.target_short} target=(${zp.target_x}, ${zp.target_y}, ${zp.target_z}) buf=${zp.buffer} h=${zp.height} w=${zp.width} virt=${zp.is_virtual}`);
    // Show what Godot coordinates this maps to
    const gx = -zp.x;
    const gz = -zp.y;
    console.log(`         Godot trigger pos: (${gx}, ${gz})`);
    const tgx = zp.target_x > 900000 ? 'KEEP' : -zp.target_x;
    const tgz = zp.target_y > 900000 ? 'KEEP' : -zp.target_y;
    console.log(`         Godot target spawn: (${tgx}, ${tgz})`);
  }

  const [toCB] = await pool.query(
    "SELECT zp.zone, zp.number, zp.x, zp.y, zp.z, zp.target_x, zp.target_y, zp.target_z, zp.buffer FROM zone_points zp JOIN zone z ON zp.target_zone_id = z.zoneidnumber WHERE z.short_name = 'crushbone' AND zp.is_virtual = 0"
  );
  console.log('\n=== Zone Points TO Crushbone (entries from other zones) ===');
  for (const zp of toCB) {
    console.log(`  From ${zp.zone}: EQ pos=(${zp.x}, ${zp.y}, ${zp.z}) -> EQ target=(${zp.target_x}, ${zp.target_y}, ${zp.target_z}) buf=${zp.buffer}`);
    const tgx = zp.target_x > 900000 ? 'KEEP' : -zp.target_x;
    const tgz = zp.target_y > 900000 ? 'KEEP' : -zp.target_y;
    console.log(`         Player lands at Godot: (${tgx}, ${tgz})`);
  }

  await pool.end();
})();
