const mysql = require('mysql2/promise');

(async () => {
  const pool = mysql.createPool({
    host: '127.0.0.1', port: 3307,
    user: 'eqemu', password: 'bHqIbrW81WLuaZ4qaQGrRViIHHvz9nR',
    database: 'peq'
  });

  // Find any tables related to race
  const [tables] = await pool.query("SHOW TABLES LIKE '%race%'");
  console.log("Race tables:", JSON.stringify(tables));

  const [tables2] = await pool.query("SHOW TABLES LIKE '%model%'");
  console.log("Model tables:", JSON.stringify(tables2));

  const [tables3] = await pool.query("SHOW TABLES LIKE '%data%'");
  console.log("Data tables:", JSON.stringify(tables3));

  await pool.end();
})();
