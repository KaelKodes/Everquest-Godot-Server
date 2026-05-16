require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({
    host: process.env.EQEMU_HOST,
    port: Number(process.env.EQEMU_PORT || 3307),
    user: process.env.EQEMU_USER,
    password: process.env.EQEMU_PASSWORD,
    database: process.env.EQEMU_DATABASE,
  });

  const zones = ['neriak', 'neriaka', 'neriakb', 'neriakc', 'neriakcommons'];
  for (const zone of zones) {
    const [n] = await c.query(
      `SELECT n.id, n.name, n.race, n.class, n.size, n.level, n.hp, n.mindmg, n.maxdmg, n.npc_faction_id
       FROM npc_types n
       WHERE n.name LIKE '%shadow%' OR n.name LIKE '%dark%shadow%'
       ORDER BY n.id LIMIT 30`
    );
    if (n.length) {
      console.log('\n=== npc_types shadow matches (global sample) ===');
      console.log(n.slice(0, 15));
    }
  }

  const [spawns] = await c.query(`
    SELECT s.zone, n.id, n.name, n.race, n.class, n.size, n.level, n.hp, n.mindmg, n.maxdmg,
           s.x, s.y, s.z
    FROM spawn2 s
    JOIN spawnentry se ON s.spawngroupID = se.spawngroupID
    JOIN npc_types n ON se.npcID = n.id
    WHERE s.zone IN ('neriak', 'neriaka', 'neriakb', 'neriakc')
      AND (n.name LIKE '%shadow%' OR n.race = 240 OR n.name LIKE '%trap%')
    ORDER BY s.zone, n.name
  `);
  console.log('\n=== neriak* spawns (shadow/trap/race240) ===');
  console.log(spawns);

  const [danger] = await c.query(`
    SELECT s.zone, n.id, n.name, n.race, n.size, n.level, n.hp, n.mindmg, n.maxdmg, s.x, s.y, s.z
    FROM spawn2 s
    JOIN spawnentry se ON s.spawngroupID = se.spawngroupID
    JOIN npc_types n ON se.npcID = n.id
    WHERE s.zone LIKE 'neriak%'
      AND (n.name LIKE '%dark%' OR n.name LIKE '%night%' OR n.name LIKE '%bind%'
           OR n.race IN (127, 240) OR n.size > 10 OR n.level > 50)
    ORDER BY n.maxdmg DESC, n.hp DESC
    LIMIT 40
  `);
  console.log('\n=== neriak dangerous / huge / triggers ===');
  console.log(danger);

  const [byName] = await c.query(
    `SELECT id, name, race, size, level, hp, mindmg, maxdmg FROM npc_types
     WHERE name LIKE '%dark%shadow%' OR name LIKE '%Dark%Shadow%' OR name = 'Nightfall'`
  );
  console.log('\n=== exact dark shadow name ===');
  console.log(byName);

  const [darkShadowSpawn] = await c.query(`
    SELECT s.zone, s.x, s.y, s.z, n.*
    FROM spawn2 s
    JOIN spawnentry se ON s.spawngroupID = se.spawngroupID
    JOIN npc_types n ON se.npcID = n.id
    WHERE se.npcID = 170002
  `);
  console.log('\n=== a_dark_shadow (170002) spawns ===');
  console.log(darkShadowSpawn);

  await c.end();
})();
