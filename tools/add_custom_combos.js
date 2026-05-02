const mysql = require('mysql2/promise');

const CLASSES = { warrior:1, cleric:2, paladin:3, ranger:4, sk:5, druid:6, monk:7, bard:8, rogue:9, shaman:10, necro:11, wizard:12, magician:13, enchanter:14, beastlord:15, berserker:16 };
const RACES = { human:1, barbarian:2, erudite:3, wood_elf:4, high_elf:5, dark_elf:6, half_elf:7, dwarf:8, troll:9, ogre:10, halfling:11, gnome:12, iksar:128, vah_shir:130, froglok:330 };
const DEITIES = {
  bertox: 201, bertoxx: 201, bertoxxulous: 201,
  brell: 202, 'brell serilis': 202,
  cazic: 203, 'cazic-thule': 203, 'the faceless': 203,
  erollisi: 204, 'erollisi marr': 204,
  bristlebane: 205,
  innoruuk: 206,
  karana: 207, 'dark karana': 207,
  mithaniel: 208, 'mithaniel marr': 208,
  prexus: 209,
  quellious: 210,
  rallos: 211, 'rallos zek': 211,
  rodcet: 212, 'rodcet nife': 212,
  solusek: 213, 'solusek ro': 213,
  tribunal: 214, 'the tribunal': 214,
  tunare: 215,
  veeshan: 216,
  agnostic: 396
};

const ZONES = {
  halas: 29,
  sfg: 4,
  neriak: 42,
  kaladim: 60,
  paineel: 75,
  akanon: 55,
  kelethin: 54,
  qeynos: 1,
  rivervale: 19,
  felwithe: 61,
  qcat: 45,
  freeport: 10,
  cabilis: 82,
  oggok: 49,
  grobb: 52,
  shar_vahl: 155,
  gukta: 383
};

const COMBOS = [
  { race: 'barbarian', class: 'bard', deities: ['tribunal', 'mithaniel', 'bristlebane', 'rallos', 'agnostic'], zone: 'halas' },
  { race: 'barbarian', class: 'monk', deities: ['tribunal', 'quellious', 'rallos', 'agnostic'], zone: 'halas' },
  { race: 'barbarian', class: 'druid', deities: ['karana', 'tunare', 'tribunal', 'erollisi', 'agnostic'], zone: 'sfg' },
  { race: 'dark_elf', class: 'monk', deities: ['innoruuk', 'the faceless', 'agnostic'], zone: 'neriak' },
  { race: 'dark_elf', class: 'ranger', deities: ['innoruuk', 'bertox', 'solusek', 'dark karana', 'agnostic'], zone: 'neriak' },
  { race: 'dwarf', class: 'beastlord', deities: ['brell', 'agnostic'], zone: 'kaladim' },
  { race: 'dwarf', class: 'monk', deities: ['brell', 'tribunal', 'agnostic'], zone: 'kaladim' },
  { race: 'erudite', class: 'rogue', deities: ['cazic', 'innoruuk', 'agnostic'], zone: 'paineel' },
  { race: 'erudite', class: 'shaman', deities: ['cazic', 'innoruuk', 'agnostic'], zone: 'paineel' },
  { race: 'gnome', class: 'shaman', deities: ['brell', 'bristlebane', 'agnostic'], zone: 'akanon' },
  { race: 'half_elf', class: 'beastlord', deities: ['karana', 'mithaniel', 'tunare', 'agnostic'], zone: 'kelethin' },
  { race: 'half_elf', class: 'monk', deities: ['quellious', 'karana', 'tribunal', 'agnostic'], zone: 'qeynos' },
  { race: 'halfling', class: 'bard', deities: ['bristlebane', 'karana', 'agnostic'], zone: 'rivervale' },
  { race: 'halfling', class: 'shaman', deities: ['bristlebane', 'karana', 'agnostic'], zone: 'rivervale' },
  { race: 'high_elf', class: 'bard', deities: ['tunare', 'mithaniel', 'erollisi', 'solusek', 'agnostic'], zone: 'felwithe' },
  { race: 'high_elf', class: 'necro', deities: ['bertox', 'agnostic'], zone: 'qcat' },
  { race: 'high_elf', class: 'necro', deities: ['innoruuk'], zone: 'freeport' },
  { race: 'iksar', class: 'magician', deities: ['cazic', 'agnostic'], zone: 'cabilis' },
  { race: 'iksar', class: 'rogue', deities: ['cazic', 'agnostic'], zone: 'cabilis' },
  { race: 'ogre', class: 'bard', deities: ['rallos', 'cazic', 'agnostic'], zone: 'oggok' },
  { race: 'troll', class: 'necro', deities: ['cazic', 'innoruuk', 'agnostic'], zone: 'grobb' },
  { race: 'vah_shir', class: 'druid', deities: ['agnostic'], zone: 'shar_vahl' },
  { race: 'vah_shir', class: 'monk', deities: ['agnostic'], zone: 'shar_vahl' },
  { race: 'vah_shir', class: 'sk', deities: ['bertox', 'cazic', 'agnostic'], zone: 'qcat' },
  { race: 'vah_shir', class: 'sk', deities: ['innoruuk'], zone: 'freeport' },
  { race: 'wood_elf', class: 'monk', deities: ['tunare', 'quellious', 'agnostic'], zone: 'kelethin' },
  { race: 'wood_elf', class: 'shaman', deities: ['tunare', 'agnostic'], zone: 'kelethin' },
  { race: 'froglok', class: 'bard', deities: ['mithaniel', 'agnostic'], zone: 'gukta' },
  { race: 'froglok', class: 'beastlord', deities: ['mithaniel', 'tribunal', 'agnostic'], zone: 'gukta' },
  { race: 'froglok', class: 'druid', deities: ['mithaniel', 'tunare', 'agnostic'], zone: 'gukta' },
  { race: 'froglok', class: 'ranger', deities: ['mithaniel', 'tunare', 'agnostic'], zone: 'gukta' }
];

(async () => {
  const pool = await mysql.createPool({
    host: '127.0.0.1', port: 3307,
    user: 'eqemu', password: 'bHqIbrW81WLuaZ4qaQGrRViIHHvz9nR',
    database: 'peq'
  });

  console.log('Starting custom combinations script...');

  // Get next allocation_id
  const [maxAllocRow] = await pool.query('SELECT MAX(allocation_id) as maxAlloc FROM char_create_combinations');
  let nextAllocId = (maxAllocRow[0].maxAlloc || 0) + 1;

  for (const combo of COMBOS) {
    const raceId = RACES[combo.race];
    const classId = CLASSES[combo.class];
    const targetZoneId = ZONES[combo.zone];

    if (!raceId || !classId || !targetZoneId) {
      console.error(`Missing mappings for ${combo.race} ${combo.class} in ${combo.zone}`);
      continue;
    }

    console.log(`\nProcessing ${combo.race} ${combo.class}...`);

    // Check if this combo already has an allocation
    const [existingAlloc] = await pool.query(
      'SELECT allocation_id FROM char_create_combinations WHERE race = ? AND class = ? LIMIT 1',
      [raceId, classId]
    );

    let allocId;
    if (existingAlloc.length > 0) {
      allocId = existingAlloc[0].allocation_id;
      console.log(`  Already exists in char_create_combinations with alloc_id = ${allocId}`);
    } else {
      allocId = nextAllocId++;
      console.log(`  Assigning new alloc_id = ${allocId}`);

      // We need to create a char_create_point_allocations row.
      // Fetch base stats from a similar race/class or just use defaults.
      // Here we fetch the base stats of the race from an existing entry, and the class allocation from an existing entry.
      const [raceStats] = await pool.query('SELECT base_str, base_sta, base_dex, base_agi, base_int, base_wis, base_cha FROM char_create_point_allocations JOIN char_create_combinations ccc ON char_create_point_allocations.id = ccc.allocation_id WHERE ccc.race = ? LIMIT 1', [raceId]);
      
      const [classStats] = await pool.query('SELECT alloc_str, alloc_sta, alloc_dex, alloc_agi, alloc_int, alloc_wis, alloc_cha FROM char_create_point_allocations JOIN char_create_combinations ccc ON char_create_point_allocations.id = ccc.allocation_id WHERE ccc.class = ? LIMIT 1', [classId]);

      const base = raceStats[0] || { base_str:75, base_sta:75, base_dex:75, base_agi:75, base_int:75, base_wis:75, base_cha:75 };
      const alloc = classStats[0] || { alloc_str:0, alloc_sta:0, alloc_dex:0, alloc_agi:0, alloc_int:0, alloc_wis:0, alloc_cha:0 };

      await pool.query(
        'INSERT INTO char_create_point_allocations (id, base_str, base_sta, base_dex, base_agi, base_int, base_wis, base_cha, alloc_str, alloc_sta, alloc_dex, alloc_agi, alloc_int, alloc_wis, alloc_cha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [allocId, base.base_str, base.base_sta, base.base_dex, base.base_agi, base.base_int, base.base_wis, base.base_cha, alloc.alloc_str, alloc.alloc_sta, alloc.alloc_dex, alloc.alloc_agi, alloc.alloc_int, alloc.alloc_wis, alloc.alloc_cha]
      );
      console.log(`  Inserted new point allocation.`);
    }

    // Now insert the deities into char_create_combinations
    for (const dName of combo.deities) {
      const deityId = DEITIES[dName.toLowerCase()];
      if (!deityId) {
        console.error(`  ERROR: Unknown deity ${dName}`);
        continue;
      }

      // Check if combination already exists
      const [exists] = await pool.query('SELECT 1 FROM char_create_combinations WHERE race = ? AND class = ? AND deity = ?', [raceId, classId, deityId]);
      if (exists.length === 0) {
        await pool.query(
          'INSERT INTO char_create_combinations (allocation_id, race, class, deity, start_zone, expansions_req) VALUES (?, ?, ?, ?, ?, ?)',
          [allocId, raceId, classId, deityId, targetZoneId, 0]
        );
        console.log(`  Added deity ${dName} (${deityId}) to combinations.`);
      } else {
        console.log(`  Deity ${dName} (${deityId}) already exists for this combo.`);
      }
    }

    // Now insert the start_zones
    // Find a template to copy coordinates from
    const [template] = await pool.query('SELECT x, y, z, heading, bind_id, bind_x, bind_y, bind_z FROM start_zones WHERE zone_id = ? LIMIT 1', [targetZoneId]);
    const t = template[0] || { x:0, y:0, z:0, heading:0, bind_id:targetZoneId, bind_x:0, bind_y:0, bind_z:0 };

    for (const dName of combo.deities) {
      const deityId = DEITIES[dName.toLowerCase()];
      const [szExists] = await pool.query('SELECT 1 FROM start_zones WHERE player_race = ? AND player_class = ? AND player_deity = ?', [raceId, classId, deityId]);
      
      if (szExists.length === 0) {
        await pool.query(
          'INSERT INTO start_zones (x, y, z, heading, zone_id, bind_id, player_choice, player_class, player_deity, player_race, start_zone, bind_x, bind_y, bind_z, select_rank, min_expansion, max_expansion, content_flags, content_flags_disabled) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 0, -1, -1, NULL, NULL)',
          [t.x, t.y, t.z, t.heading, targetZoneId, t.bind_id, classId, deityId, raceId, targetZoneId, t.bind_x, t.bind_y, t.bind_z]
        );
        console.log(`  Added start_zone entry for deity ${dName}.`);
      }
    }
  }

  console.log('\nDone updating custom race/class combos!');
  await pool.end();
})();
