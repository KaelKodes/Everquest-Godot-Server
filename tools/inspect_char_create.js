const mysql = require('mysql2/promise');

(async () => {
  const pool = await mysql.createPool({
    host: '127.0.0.1', port: 3307,
    user: 'eqemu', password: 'bHqIbrW81WLuaZ4qaQGrRViIHHvz9nR',
    database: 'peq'
  });

  // Get distinct allocation_ids and what race/class combos they map to
  console.log('=== Distinct allocation_ids with race/class ===');
  const [allocs] = await pool.query(`
    SELECT DISTINCT ccc.allocation_id, ccc.race, ccc.class
    FROM char_create_combinations ccc
    ORDER BY ccc.race, ccc.class
    LIMIT 60
  `);
  allocs.forEach(r => console.log(`  alloc=${r.allocation_id} race=${r.race} class=${r.class}`));

  // Get all point allocations to see the full stat data
  console.log('\n=== All char_create_point_allocations ===');
  const [pts] = await pool.query('SELECT * FROM char_create_point_allocations ORDER BY id');
  pts.forEach(r => console.log(`  id=${r.id}: base=[${r.base_str},${r.base_sta},${r.base_dex},${r.base_agi},${r.base_int},${r.base_wis},${r.base_cha}] alloc=[${r.alloc_str},${r.alloc_sta},${r.alloc_dex},${r.alloc_agi},${r.alloc_int},${r.alloc_wis},${r.alloc_cha}]`));

  // Count total allocation rows
  const [cnt] = await pool.query('SELECT COUNT(*) as cnt FROM char_create_point_allocations');
  console.log(`\nTotal allocation rows: ${cnt[0].cnt}`);

  // Check: does allocation_id correspond to id in point_allocations?
  console.log('\n=== Verify: allocation_id 58 stats ===');
  const [a58] = await pool.query('SELECT * FROM char_create_point_allocations WHERE id = 58');
  a58.forEach(r => console.log('  ', JSON.stringify(r)));

  // What's the range of allocation_ids?
  const [range] = await pool.query('SELECT MIN(allocation_id) as min_id, MAX(allocation_id) as max_id, COUNT(DISTINCT allocation_id) as unique_ids FROM char_create_combinations');
  console.log('\n=== Allocation ID range ===');
  console.log('  ', JSON.stringify(range[0]));

  // Also check starting_items table
  console.log('\n=== DESCRIBE starting_items ===');
  const [siCols] = await pool.query('DESCRIBE starting_items');
  siCols.forEach(c => console.log(`  ${c.Field} (${c.Type})`));

  console.log('\n=== SAMPLE starting_items (first 10) ===');
  const [siSample] = await pool.query('SELECT * FROM starting_items LIMIT 10');
  siSample.forEach(r => console.log('  ', JSON.stringify(r)));

  await pool.end();
})();
