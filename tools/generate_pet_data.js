// Generate petData.js from EQEmu database + spell data
// Maps each pet spell to its authentic NPC stats from the database
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

(async () => {
  const pool = mysql.createPool({
    host: '127.0.0.1', port: 3307,
    user: 'eqemu', password: 'bHqIbrW81WLuaZ4qaQGrRViIHHvz9nR',
    database: 'peq'
  });

  // 1. Load all EQEmu pet definitions
  const [petRows] = await pool.query(`
    SELECT p.type, p.petpower, p.npcID, p.petnaming, p.equipmentset,
           n.name, n.level, n.hp, n.mindmg, n.maxdmg,
           n.attack_delay, n.race, n.AC, n.hp_regen_rate,
           n.class, n.runspeed
    FROM pets p
    JOIN npc_types n ON p.npcID = n.id
    ORDER BY p.type, p.petpower, n.level
  `);

  // Group by type string
  const petsByType = {};
  for (const r of petRows) {
    if (!petsByType[r.type]) petsByType[r.type] = [];
    petsByType[r.type].push(r);
  }

  // 2. Load spell data and extract teleportZone for pet spells
  const spellData = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'data', 'spells_classic.json'), 'utf8'
  ));
  
  const petSpells = spellData.spells.filter(s =>
    s.effects && s.effects.some(e => e.spa === 33 || e.spa === 71)
  );

  // 3. Build mapping: spell ID → EQEmu pet type → NPC stats
  const entries = [];
  const missing = [];

  for (const spell of petSpells) {
    const tz = spell.links?.teleportZone;
    if (!tz) {
      missing.push({ id: spell.id, name: spell.name, reason: 'no teleportZone' });
      continue;
    }

    const npcData = petsByType[tz];
    if (!npcData || npcData.length === 0) {
      missing.push({ id: spell.id, name: spell.name, tz, reason: 'no DB match' });
      continue;
    }

    // Get class info
    const classEntries = Object.entries(spell.classes)
      .filter(([, lvl]) => lvl !== 255)
      .sort((a, b) => a[1] - b[1]);

    // Determine pet element/category from type string
    let element = 'generic';
    const tzl = tz.toLowerCase();
    if (tzl.includes('earth')) element = 'earth';
    else if (tzl.includes('water')) element = 'water';
    else if (tzl.includes('air')) element = 'air';
    else if (tzl.includes('fire') && !tzl.includes('sword')) element = 'fire';
    else if (tzl.includes('skel') || tzl.includes('dead') || tzl.includes('sumdead')) element = 'skeleton';
    else if (tzl.includes('animation')) element = 'animation';
    else if (tzl.includes('spiritwolf') || tzl.includes('druid')) element = 'spirit';
    else if (tzl.includes('monster')) element = 'monster';
    else if (tzl.includes('hammer') || tzl.includes('cleric')) element = 'hammer';
    else if (tzl.includes('sword') || tzl.includes('wizard')) element = 'sword';
    else if (tzl.includes('epic') || tzl.includes('manifest')) element = 'epic';
    else if (tzl.includes('decoy') || tzl.includes('dyzil')) element = 'decoy';
    else if (tzl.includes('zomm') || tzl.includes('rage')) element = 'eye';

    // Determine reagent
    let reagent = null;
    const primaryClass = classEntries.length > 0 ? classEntries[0][0] : '';
    if (primaryClass === 'magician') {
      if (element === 'water') reagent = { name: 'Lapis Lazuli', itemId: 10029 };
      else reagent = { name: 'Malachite', itemId: 10028 };
    } else if (primaryClass === 'enchanter') {
      reagent = { name: 'Tiny Dagger', itemId: 13073 };
    } else if (primaryClass === 'necromancer' || primaryClass === 'shadowknight') {
      reagent = { name: 'Bone Chips', itemId: 10016 };
    }

    // Build innate spells from element type
    let innateSpells = [];
    if (element === 'earth') innateSpells = ['root'];
    else if (element === 'water') innateSpells = ['iceBolt'];
    else if (element === 'air') innateSpells = ['stun'];
    else if (element === 'fire') innateSpells = ['fireBolt', 'damageShield'];

    // Use first NPC variant for stats (petpower=0 is base)
    const npc = npcData[0];

    // If multiple variants exist with different petpower, note the range
    const levels = npcData.map(n => n.level);
    const hps = npcData.map(n => n.hp);
    const minLevel = Math.min(...levels);
    const maxLevel = Math.max(...levels);

    entries.push({
      spellId: spell.id,
      spellName: spell.name,
      eqemuType: tz,
      element,
      name: npc.name.replace(/_/g, ' ').replace(/\d+$/, '').trim(),
      race: npc.race,
      npcClass: npc.class,
      levelRange: npcData.length > 1 ? [minLevel, maxLevel] : [npc.level, npc.level],
      hpRange: npcData.length > 1 ? [Math.min(...hps), Math.max(...hps)] : [npc.hp, npc.hp],
      minDmg: npc.mindmg,
      maxDmg: npc.maxdmg,
      attackDelay: npc.attack_delay / 10, // Convert to seconds
      ac: npc.AC,
      hpRegen: npc.hp_regen_rate,
      runspeed: npc.runspeed,
      manaCost: spell.cost.mana,
      classes: classEntries.map(([c, l]) => ({ class: c, level: l })),
      reagent,
      innateSpells,
      npcVariants: npcData.length,
    });
  }

  // 4. Sort by spell ID
  entries.sort((a, b) => a.spellId - b.spellId);

  // 5. Generate JavaScript output
  let output = `// ── Pet Data ────────────────────────────────────────────────────────
// Auto-generated from EQEmu database (pets + npc_types tables)
// Maps spell IDs to authentic pet NPC stats.
// ────────────────────────────────────────────────────────────────────

// Skill progression by pet level (from P99 wiki)
const PET_SKILL_TIERS = {
  11: ['magicWeapons'],           // Attacks count as magic
  20: ['dodge', 'parry', 'doubleAttack'], // Non-fire pets
  39: ['fastRegen'],              // 30 HP/tick (up from 6)
  44: ['innateNoDualWield'],      // Dual wield without weapons
  49: ['doubleKickBash'],         // Double kick/bash (non-fire)
};

// Pet names by element (EQ uses random names from a pool)
const PET_NAMES = {
  earth:     ['Gabaner', 'Gabartik', 'Gabekish', 'Gabeker', 'Gabek', 'Gaber', 'Gabertik'],
  water:     ['Gibeker', 'Gibekish', 'Gibaner', 'Gibartik', 'Gibek', 'Giber'],
  air:       ['Gikeker', 'Gikekish', 'Gikaner', 'Gikartik', 'Gikek', 'Giker'],
  fire:      ['Gakeker', 'Gakekish', 'Gakaner', 'Gakartik', 'Gakek', 'Gaker'],
  skeleton:  ['Kabaner', 'Kabartik', 'Kabekish', 'Kabeker', 'Kabek', 'Kaber'],
  animation: [], // Uses caster's name + "'s Animation"
  spirit:    ['Spirit Wolf', 'Spirit Guardian', 'Spirit Companion'],
  monster:   [], // Uses random zone NPC model
  hammer:    ['Hammer of Faith'],
  sword:     ['Sword of Xuzl'],
  epic:      ['Manifest Element'],
  decoy:     ['Deafening Decoy'],
  eye:       ['Eye of Zomm'],
  generic:   ['Servant'],
};

// Main pet spell data table
const PET_SPELLS = {
`;

  for (const e of entries) {
    output += `  // ${e.spellName} — ${e.classes.map(c => c.class + ' L' + c.level).join(', ')}
  ${e.spellId}: {
    name: ${JSON.stringify(e.name)},
    eqemuType: ${JSON.stringify(e.eqemuType)},
    element: ${JSON.stringify(e.element)},
    race: ${e.race},
    npcClass: ${e.npcClass},
    levelRange: [${e.levelRange.join(', ')}],
    hpRange: [${e.hpRange.join(', ')}],
    minDmg: ${e.minDmg}, maxDmg: ${e.maxDmg},
    attackDelay: ${e.attackDelay},
    ac: ${e.ac},
    hpRegen: ${e.hpRegen},
    manaCost: ${e.manaCost},
    reagent: ${e.reagent ? JSON.stringify(e.reagent) : 'null'},
    innateSpells: ${JSON.stringify(e.innateSpells)},
  },
`;
  }

  output += `};

module.exports = { PET_SPELLS, PET_SKILL_TIERS, PET_NAMES };
`;

  // Write output
  const outPath = path.join(__dirname, '..', 'data', 'petData.js');
  fs.writeFileSync(outPath, output);
  console.log(`Generated ${outPath}`);
  console.log(`  ${entries.length} pet spells mapped`);
  
  if (missing.length > 0) {
    console.log(`\n  ${missing.length} spells with missing data:`);
    for (const m of missing) {
      console.log(`    ${m.id}: ${m.name} — ${m.reason}${m.tz ? ' (type=' + m.tz + ')' : ''}`);
    }
  }

  await pool.end();
  process.exit(0);
})();
