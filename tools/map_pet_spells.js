// Generate petData.js from EQEmu database pet/npc_types data + spell data
// This reads the spell database and maps each pet spell to authentic EQEmu NPC stats.
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

(async () => {
  const p = mysql.createPool({
    host: '127.0.0.1', port: 3307,
    user: 'eqemu', password: 'bHqIbrW81WLuaZ4qaQGrRViIHHvz9nR',
    database: 'peq'
  });

  // Get ALL pet NPC data
  const [rows] = await p.query(`
    SELECT p.type, p.petpower, p.npcID, p.petnaming,
           n.name, n.level, n.hp, n.mindmg, n.maxdmg,
           n.attack_delay, n.race, n.AC, n.hp_regen_rate,
           n.class, n.npc_spells_id, n.runspeed
    FROM pets p
    JOIN npc_types n ON p.npcID = n.id
    ORDER BY p.type, p.petpower, n.level
  `);

  // Group by type
  const byType = {};
  for (const r of rows) {
    if (!byType[r.type]) byType[r.type] = [];
    byType[r.type].push(r);
  }

  // Load spell data to map spell IDs
  const spellData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'spells_classic.json'), 'utf8'));
  const petSpells = spellData.spells.filter(s => 
    s.effects && s.effects.some(e => e.spa === 33 || e.spa === 71)
  );

  // EQEmu pet type string → the teleportZone field in the spell holds the pet type key
  // Actually, the teleportZone/field3 column in the raw spell data stores the pet type string
  // Let's check what field3 (teleportZone) holds for pet spells
  const rawSpells = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'spells_parsed.json'), 'utf8'));

  // Map: spell.teleportZone matches pets.type in the DB
  // The spells_classic.json may not have teleportZone. Let's check the raw parsed data.
  // Actually, let's look at field index 3 in the raw spell file
  
  console.log('=== Checking pet spell → EQEmu type mapping ===\n');
  
  // Read raw spells_us.txt if available, else use parsed
  // The field at index 3 in EQ spell data is the "teleportZone" / pet type string
  let rawLines;
  const rawPath = path.join(__dirname, '..', 'data', 'spells_us.txt');
  if (fs.existsSync(rawPath)) {
    rawLines = fs.readFileSync(rawPath, 'utf8').split('\n');
  }

  // For each pet spell, find what EQEmu type it maps to
  for (const spell of petSpells.slice(0, 10)) {
    // The parsed data might have teleportZone
    const parsed = spellData.spells.find(s => s.id === spell.id);
    console.log(`Spell ${spell.id}: ${spell.name}`);
    console.log(`  teleportZone: ${parsed?.teleportZone || parsed?.links?.teleportZone || 'N/A'}`);
    console.log(`  field3 (if in parsed): ${parsed?.field3 || 'N/A'}`);
    
    // Check if the raw parsed data has it
    if (rawLines) {
      const line = rawLines.find(l => l.startsWith(spell.id + '^'));
      if (line) {
        const fields = line.split('^');
        console.log(`  Raw field[3]: "${fields[3]}"`);
      }
    }
    console.log('');
  }

  await p.end();
  process.exit(0);
})();
