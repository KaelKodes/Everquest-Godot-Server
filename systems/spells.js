const fs = require('fs');
const path = require('path');
const SpellDB = require('../data/spellDatabase');
const DB = require('../db');
const { send } = require('../utils');

// Reference to global SPELLS from gameEngine (or SpellDB)
const SPELLS = SpellDB.SPELLS || {};

function calcEffectiveStats(char, inventory, buffs) {
  // We'll need to pass this in from gameEngine context since it's defined there
  return module.exports.calcEffectiveStatsFn ? module.exports.calcEffectiveStatsFn(char, inventory, buffs) : {hp: char.maxHp, mana: char.maxMana};
}

const SPELLBOOK_DIR = path.join(__dirname, 'data', 'spellbooks');

function getSpellbookPath(charName) {
  return path.join(SPELLBOOK_DIR, `${charName.toLowerCase()}.json`);
}

function loadSpellbookFromFile(session) {
  try {
    const filePath = getSpellbookPath(session.char.name);
    if (!fs.existsSync(filePath)) {
      // No saved spellbook — build from starter spells
      buildStarterSpellbook(session);
      return;
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    session.spellbook = data.spellbook || [];
    session.spells = data.memorized || [];
    console.log(`[SPELLBOOK] Loaded ${session.spellbook.length} scribed spells, ${session.spells.length} memorized for ${session.char.name}`);
  } catch (e) {
    console.error(`[SPELLBOOK] Load error for ${session.char.name}: ${e.message}`);
    buildStarterSpellbook(session);
  }
}

function saveSpellbookToFile(session) {
  try {
    if (!fs.existsSync(SPELLBOOK_DIR)) {
      fs.mkdirSync(SPELLBOOK_DIR, { recursive: true });
    }
    const data = {
      spellbook: session.spellbook,
      memorized: session.spells,
    };
    fs.writeFileSync(getSpellbookPath(session.char.name), JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`[SPELLBOOK] Save error for ${session.char.name}: ${e.message}`);
  }
}

// ── Buff Persistence (file-based) ───────────────────────────────────

const BUFFS_DIR = path.join(__dirname, 'data', 'buffs');

function getBuffsPath(charName) {
  return path.join(BUFFS_DIR, `${charName.toLowerCase()}.json`);
}

function loadBuffsFromFile(session) {
  try {
    const filePath = getBuffsPath(session.char.name);
    if (!fs.existsSync(filePath)) return;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(data.buffs)) return;

    // Calculate elapsed time since save and subtract from durations
    const savedAt = data.savedAt || 0;
    const elapsed = savedAt ? (Date.now() - savedAt) / 1000 : 0;

    const restored = [];
    for (const b of data.buffs) {
      const remaining = (b.duration || 0) - elapsed;
      if (remaining > 0) {
        restored.push({
          name: b.name,
          duration: remaining,
          maxDuration: b.maxDuration || remaining,
          beneficial: b.beneficial !== false,
          effects: b.effects || [],
          ac: b.ac || 0,
        });
      }
    }

    session.buffs = restored;
    if (restored.length > 0) {
      // Recalculate stats with restored buffs
      session.effectiveStats = calcEffectiveStats(session.char, session.inventory, session.buffs);
      session.char.maxHp = session.effectiveStats.hp;
      session.char.maxMana = session.effectiveStats.mana;
      console.log(`[BUFFS] Restored ${restored.length} active buffs for ${session.char.name}`);
    }
  } catch (e) {
    console.error(`[BUFFS] Load error for ${session.char.name}: ${e.message}`);
  }
}

function saveBuffsToFile(session) {
  try {
    if (!fs.existsSync(BUFFS_DIR)) {
      fs.mkdirSync(BUFFS_DIR, { recursive: true });
    }
    // Only save beneficial buffs with remaining duration (skip expired/instant)
    const activeBeneficial = (session.buffs || []).filter(b => b.duration > 0);
    const data = {
      savedAt: Date.now(),
      buffs: activeBeneficial.map(b => ({
        name: b.name,
        duration: b.duration,
        maxDuration: b.maxDuration,
        beneficial: b.beneficial !== false,
        effects: b.effects || [],
        ac: b.ac || 0,
      })),
    };
    fs.writeFileSync(getBuffsPath(session.char.name), JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`[BUFFS] Save error for ${session.char.name}: ${e.message}`);
  }
}

function buildStarterSpellbook(session) {
  const STARTER_SPELLS = {
    cleric: ['minor_healing', 'strike'],
    wizard: ['frost_bolt', 'minor_shielding'],
    necromancer: ['lifetap', 'minor_shielding'],
    enchanter: ['lull', 'minor_shielding'],
    magician: ['flare', 'minor_shielding'],
    druid: ['minor_healing', 'snare'],
    shaman: ['minor_healing', 'inner_fire'],
    bard: ['chant_of_battle'],
    ranger: ['salve'],
    paladin: ['salve'],
    shadow_knight: ['spike_of_disease'],
    warrior: [], monk: [], rogue: [],
  };

  const charClass = session.char.class;
  const starterKeys = STARTER_SPELLS[charClass] || [];
  
  session.spellbook = [];
  session.spells = [];
  
  let bookSlot = 0;
  let gemSlot = 0;
  for (const key of starterKeys) {
    const spellDef = SpellDB.getByKey(key);
    if (!spellDef) continue;
    
    // Scribe into book
    session.spellbook.push({
      bookSlot: bookSlot,
      spell_key: key,
      id: spellDef._spellId || spellDef.id || bookSlot + 1,
    });
    
    // Also memorize into first available gem slots
    if (gemSlot < 8) {
      session.spells.push({
        slot: gemSlot,
        spell_key: key,
        id: spellDef._spellId || spellDef.id || bookSlot + 1,
      });
      gemSlot++;
    }
    bookSlot++;
  }
  
  // Also add any spells the character should have from level-ups
  const allClassSpells = SpellDB.getSpellsForClass(charClass, session.char.level);
  for (const spell of allClassSpells) {
    const key = spell._key;
    if (session.spellbook.find(s => s.spell_key === key)) continue; // Already have it
    session.spellbook.push({
      bookSlot: bookSlot++,
      spell_key: key,
      id: spell._spellId || spell.id,
    });
  }
  
  saveSpellbookToFile(session);
  console.log(`[SPELLBOOK] Built starter spellbook for ${session.char.name}: ${session.spellbook.length} spells`);
}

/** Scribe a new spell into the first empty book slot. Returns the bookSlot used, or -1 if book is full. */
function scribeSpellToBook(session, spellKey) {
  const spellDef = SpellDB.getByKey(spellKey);
  if (!spellDef) return -1;
  
  // Already scribed?
  if (session.spellbook.find(s => s.spell_key === spellKey)) return -2;
  
  // Find first empty bookSlot (0-791 for 99 pages × 8)
  const usedSlots = new Set(session.spellbook.map(s => s.bookSlot));
  let freeSlot = -1;
  for (let i = 0; i < 792; i++) {
    if (!usedSlots.has(i)) { freeSlot = i; break; }
  }
  if (freeSlot < 0) return -1; // Book full
  
  session.spellbook.push({
    bookSlot: freeSlot,
    spell_key: spellKey,
    id: spellDef._spellId || spellDef.id,
  });
  
  saveSpellbookToFile(session);
  return freeSlot;
}

// ── Spellbook Message Handlers ──────────────────────────────────────

function handleMemorizeSpell(session, msg) {
  const { spellKey, slot } = msg;
  if (slot == null || slot < 0 || slot >= 8) return;
  if (!spellKey) return;
  
  // Must be sitting
  if (session.char.state !== 'medding') {
    send(session.ws, { type: 'MESSAGE', text: 'You must be sitting to memorize spells.' });
    return;
  }
  
  // Must be in spellbook
  const bookEntry = session.spellbook.find(s => s.spell_key === spellKey);
  if (!bookEntry) {
    send(session.ws, { type: 'MESSAGE', text: 'That spell is not in your spellbook.' });
    return;
  }
  
  // Remove from current gem slot if already memorized elsewhere
  session.spells = session.spells.filter(s => s.spell_key !== spellKey);
  // Remove whatever was in the target slot
  session.spells = session.spells.filter(s => s.slot !== slot);
  
  session.spells.push({
    slot,
    spell_key: spellKey,
    id: bookEntry.id,
  });
  
  saveSpellbookToFile(session);
  DB.memorizeSpell(session.char.id, spellKey, slot);
  sendSpellbook(session);
  
  const def = SPELLS[spellKey] || {};
  send(session.ws, { type: 'MESSAGE', text: `You have memorized ${def.name || spellKey}.` });
}

function handleForgetSpell(session, msg) {
  const { slot } = msg;
  if (slot == null || slot < 0 || slot >= 8) return;
  
  const existing = session.spells.find(s => s.slot === slot);
  session.spells = session.spells.filter(s => s.slot !== slot);
  
  saveSpellbookToFile(session);
  DB.forgetSpell(session.char.id, slot);
  sendSpellbook(session);
  
  if (existing) {
    const def = SPELLS[existing.spell_key] || {};
    send(session.ws, { type: 'MESSAGE', text: `You have forgotten ${def.name || existing.spell_key}.` });
  }
}

function handleSwapBookSpells(session, msg) {
  const { fromSlot, toSlot } = msg;
  if (fromSlot == null || toSlot == null) return;
  if (fromSlot < 0 || fromSlot >= 792 || toSlot < 0 || toSlot >= 792) return;
  
  const fromEntry = session.spellbook.find(s => s.bookSlot === fromSlot);
  const toEntry = session.spellbook.find(s => s.bookSlot === toSlot);
  
  if (fromEntry && toEntry) {
    // Swap
    fromEntry.bookSlot = toSlot;
    toEntry.bookSlot = fromSlot;
  } else if (fromEntry) {
    // Move to empty slot
    fromEntry.bookSlot = toSlot;
  }
  // If fromEntry is null, nothing to do
  
  saveSpellbookToFile(session);
  sendSpellbookFull(session);
}

// ── Send Functions ──────────────────────────────────────────────────

function sendSpellbook(session) {
  // Send memorized gems (spell bar)
  const spells = session.spells.map(row => {
    const def = SPELLS[row.spell_key] || {};
    return {
      slot: row.slot,
      spellId: row.id,
      spellKey: row.spell_key,
      name: def.name || row.spell_key,
      manaCost: def.manaCost || 0,
      castTime: def.castTime || 1.5,
      target: def.targetType ? def.targetType.name : (def.target || 'self'),
      effect: def.effect || 'unknown',
      level: def.level || 1,
      description: def.description || '',
      memIcon: def.visual ? def.visual.memIcon : 0,
      icon: def.visual ? def.visual.icon : 0,
      skill: def.skill ? def.skill.name : 'Unknown',
      range: def.range ? def.range.range : 0,
      duration: def.duration || 0,
      reflectable: def.properties ? (def.properties.reflectable > 0) : false,
      spellLine: def.visual ? (def.visual.spellAffectName || '') : '',
    };
  });
  send(session.ws, { type: 'SPELLBOOK_UPDATE', spells });

  // Also send full spellbook
  sendSpellbookFull(session);
}

function sendSpellbookFull(session) {
  const entries = session.spellbook.map(row => {
    const def = SPELLS[row.spell_key] || {};
    return {
      bookSlot: row.bookSlot,
      spellId: row.id,
      spellKey: row.spell_key,
      name: def.name || row.spell_key,
      manaCost: def.manaCost || 0,
      castTime: def.castTime || 1.5,
      effect: def.effect || 'unknown',
      level: def.level || 1,
      description: def.description || '',
      memIcon: def.visual ? def.visual.memIcon : 0,
      icon: def.visual ? def.visual.icon : 0,
      skill: def.skill ? def.skill.name : 'Unknown',
      target: def.targetType ? def.targetType.name : (def.target || 'self'),
      range: def.range ? def.range.range : 0,
      duration: def.duration || 0,
      reflectable: def.properties ? (def.properties.reflectable > 0) : false,
      spellLine: def.visual ? (def.visual.spellAffectName || '') : '',
    };
  });
  send(session.ws, { type: 'SPELLBOOK_FULL', entries });
}

function sendBuffs(session) {
  send(session.ws, {
    type: 'BUFFS_UPDATE',
    buffs: session.buffs.map(b => ({
      name: b.name,
      duration: b.duration,
      maxDuration: b.maxDuration,
      beneficial: b.beneficial !== false,
    })),
  });
}


module.exports = {
  loadSpellbookFromFile,
  saveSpellbookToFile,
  loadBuffsFromFile,
  saveBuffsToFile,
  buildStarterSpellbook,
  scribeSpellToBook,
  handleMemorizeSpell,
  handleForgetSpell,
  handleSwapBookSpells,
  sendSpellbook,
  sendSpellbookFull,
  sendBuffs,
  setCalcEffectiveStatsFn: (fn) => { module.exports.calcEffectiveStatsFn = fn; }
};
