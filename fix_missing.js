require('dotenv').config();
const mysql = require('mysql2/promise');
(async () => {
  const p = mysql.createPool({host:process.env.EQEMU_HOST,port:process.env.EQEMU_PORT,user:process.env.EQEMU_USER,password:process.env.EQEMU_PASSWORD,database:process.env.EQEMU_DATABASE});
  const [r] = await p.query("SELECT short_name FROM zone WHERE short_name LIKE '%split%' OR short_name LIKE '%erudin%'");
  console.log('Matches:', JSON.stringify(r));
  // Fix: splitpaw → paw, erudin → erudin (check if it exists)
  const updates = [
    ["UPDATE zone SET safe_x=-7, safe_y=-79, safe_z=0 WHERE short_name LIKE '%split%'"],
    ["UPDATE zone SET safe_x=-309, safe_y=109, safe_z=0 WHERE short_name LIKE '%erudin%' AND short_name NOT LIKE '%int%' AND short_name NOT LIKE '%ext%'"],
  ];
  for (const [sql] of updates) {
    const [res] = await p.query(sql);
    console.log(`${sql.substring(0,60)}... → ${res.affectedRows} rows`);
  }
  await p.end();
})();
