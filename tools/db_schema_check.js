const mysql = require('mysql2/promise');

(async () => {
  const pool = await mysql.createPool({
    host: '127.0.0.1', port: 3307,
    user: 'eqemu', password: 'bHqIbrW81WLuaZ4qaQGrRViIHHvz9nR',
    database: 'peq'
  });

  const describeTable = async (tableName) => {
    console.log(`\n=== DESCRIBE ${tableName} ===`);
    const [cols] = await pool.query(`DESCRIBE ${tableName}`);
    cols.forEach(c => console.log(`  ${c.Field} (${c.Type})`));
  };

  await describeTable('char_create_combinations');
  await describeTable('char_create_point_allocations');
  await describeTable('start_zones');
  await describeTable('zone');

  await pool.end();
})();
