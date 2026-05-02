const fs = require('fs');
const path = require('path');
const SpellDB = require('../data/spellDatabase');
const DB = require('../db');
const { send } = require('../utils');

const SPELLS = SpellDB.createLegacyProxy();

function calcEffectiveStats(char, inventory, buffs) {
  // We'll need to pass this in from gameEngine context since it's defined there
  return module.exports.calcEffectiveStatsFn ? module.exports.calcEffectiveStatsFn(char, inventory, buffs) : {hp: char.maxHp, mana: char.maxMana};
}

/**
 * Breaks mesmerize effects if the entity takes damage.
 */
function breakMez(entity, events = null) {
  if (!entity || !Array.isArray(entity.buffs)) return false;
  let broke = false;
  entity.buffs = entity.buffs.filter(b => {
      if (b.isMez) {
          broke = true;
          const name = entity.name || entity.char?.name || 'Unknown';
          if (events) events.push({ event: 'MESSAGE', text: `${name} has been awakened.` });
          return false;
      }
      return true;
  });
  return broke;
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
        let icon = b.icon || 0;
        let memIcon = b.memIcon || 0;
        
        // Hydrate missing icons for older saves
        if (!icon || !memIcon) {
          const SpellDB = require('../data/spellDatabase');
          const sDef = SpellDB.getByName(b.name);
          if (sDef && sDef.visual) {
            if (!icon) icon = sDef.visual.icon || 0;
            if (!memIcon) memIcon = sDef.visual.memIcon || 0;
          }
        }

        restored.push({
          name: b.name,
          duration: remaining,
          maxDuration: b.maxDuration || remaining,
          beneficial: b.beneficial !== false,
          effects: b.effects || [],
          ac: b.ac || 0,
          icon: icon,
          memIcon: memIcon
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
        icon: b.icon || 0,
        memIcon: b.memIcon || 0
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
      icon: b.icon || 0,
      memIcon: b.memIcon || 0,
      isSong: b.isSong || false
    })),
  });
}


let combat, handleMobDeath, sendStatus, sendCombatLog, handleStopCombat, handleSuccor, ensureZoneLoaded, resolveZoneKey, getZoneDef;
function setDependencies(deps) {
  combat = deps.combat;
  handleMobDeath = deps.handleMobDeath;
  sendStatus = deps.sendStatus;
  sendCombatLog = deps.sendCombatLog;
  handleStopCombat = deps.handleStopCombat;
  handleSuccor = deps.handleSuccor;
  ensureZoneLoaded = deps.ensureZoneLoaded;
  resolveZoneKey = deps.resolveZoneKey;
  getZoneDef = deps.getZoneDef;
}

async function applySpellEffect(session, spellDef, spellKey) {
  const events = [];

  const eligibleFocuses = getEligibleFocusEffects(session, spellDef);
  let healMod = 0;
  let dmgMod = 0;
  let durMod = 0;
  
  for (const focus of eligibleFocuses) {
      for (const e of focus.effects) {
          if (e.spa === 125 && e.base > 0) { // Heal
              const val = Math.floor(Math.random() * e.base) + 1;
              if (val > healMod) healMod = val;
          } else if (e.spa === 124 && e.base > 0) { // Damage
              const val = Math.floor(Math.random() * e.base) + 1;
              if (val > dmgMod) dmgMod = val;
          } else if (e.spa === 128 && e.base > 0) { // Duration (Flat %)
              if (e.base > durMod) durMod = e.base;
          }
      }
  }

  // SPA 32: Summon Item
  const summonEffect = (spellDef.effects || []).find(e => e.spa === 32);
  if (summonEffect) {
    const eqItemId = summonEffect.base;
    const SUMMON_ITEM_MAP = module.exports.SUMMON_ITEM_MAP || {};
    const ITEMS = module.exports.ITEMS || {};
    let itemKey = SUMMON_ITEM_MAP[eqItemId];
    if (!itemKey) {
        const lname = spellDef.name.toLowerCase();
        if (lname.includes('food') || lname.includes('cornucopia')) itemKey = 'summoned_food';
        else if (lname.includes('drink') || lname.includes('everfount')) itemKey = 'summoned_drink';
        else if (lname.includes('arrow')) itemKey = 'summoned_arrows';
        else if (lname.includes('dagger') || lname.includes('fang')) itemKey = 'summoned_dagger';
        else if (lname.includes('hammer') || lname.includes('mace')) itemKey = 'summoned_hammer';
        else if (lname.includes('bandage')) itemKey = 'summoned_bandages';
        else if (lname.includes('light') || lname.includes('shine') || lname.includes('glow') || lname.includes('firefl')) itemKey = 'summoned_light';
    }
    if (itemKey && ITEMS[itemKey] && module.exports.DB) {
        await module.exports.DB.addItem(session.char.id, itemKey, 0, 0);
        session.inventory = await module.exports.DB.getInventory(session.char.id);
        if (module.exports.sendInventoryFn) module.exports.sendInventoryFn(session);
        events.push({ event: 'MESSAGE', text: `You summon ${ITEMS[itemKey].name}.` });
    } else {
        events.push({ event: 'MESSAGE', text: `${spellDef.name} conjures something, but it fizzles away.` });
    }
    if (sendCombatLog) sendCombatLog(session, events);
    return;
  }

  // Handle instant Mana / Endurance (SPA 15, 189)
  const isDetrimental = !spellDef.goodEffect;
  const instantTarget = isDetrimental ? session.combatTarget : session.char;
  
  if (instantTarget && !spellDef.duration) {
     const manaEffect = (spellDef.effects || []).find(e => e.spa === 15);
     const endEffect = (spellDef.effects || []).find(e => e.spa === 189);
     
     if (manaEffect) {
         const val = manaEffect.base;
         if (val > 0) {
             instantTarget.mana = Math.min((instantTarget.mana || 0) + val, instantTarget.maxMana || instantTarget.mana || 0);
             if (instantTarget === session.char) events.push({ event: 'MESSAGE', text: `You feel a sudden surge of mana.` });
         } else if (val < 0) {
             instantTarget.mana = Math.max(0, (instantTarget.mana || 0) - Math.abs(val));
             if (instantTarget === session.char) events.push({ event: 'MESSAGE', text: `You feel your mana draining away.` });
         }
     }
     
     if (endEffect) {
         const val = endEffect.base;
         if (val > 0) {
             instantTarget.endurance = Math.min((instantTarget.endurance || 0) + val, instantTarget.maxEndurance || instantTarget.endurance || 0);
         } else if (val < 0) {
             instantTarget.endurance = Math.max(0, (instantTarget.endurance || 0) - Math.abs(val));
         }
     }
     if ((manaEffect || endEffect) && instantTarget === session.char) sendStatus(session);
  }

  // SPA 30/86: Lull / Pacify
  const lullEffect = (spellDef.effects || []).find(e => e.spa === 30 || e.spa === 86);
  if (lullEffect) {
    if (!session.combatTarget) {
      events.push({ event: 'MESSAGE', text: 'You must have a target to cast that spell.' });
      if (sendCombatLog) sendCombatLog(session, events);
      return;
    }
    const mob = session.combatTarget;
    const resistResult = combat.calcSpellResist(mob, session.char.level, spellDef.resistType, spellDef.resistAdjust);
    if (resistResult === 'FULL_RESIST') {
      events.push({ event: 'RESIST', target: mob.name, spell: spellDef.name });
      // Lull critical resist causes aggro in EQ
      if (!mob.target) mob.target = session;
      events.push({ event: 'MESSAGE', text: `${mob.name} is enraged by your spell!` });
    } else {
      let dur = spellDef.duration || 120;
      if (durMod > 0) dur = Math.floor(dur * (1.0 + (durMod / 100.0)));
      if (resistResult === 'PARTIAL_RESIST') dur = Math.floor(dur / 2);
      
      if (!Array.isArray(mob.buffs)) mob.buffs = [];
      mob.buffs = mob.buffs.filter(b => b.name !== spellDef.name);
      mob.buffs.push({
        name: spellDef.name,
        duration: dur,
        maxDuration: dur,
        beneficial: false,
        effects: spellDef.effects,
        isLull: true,
        casterSession: session.char.name,
        icon: spellDef.visual?.icon || 0,
        memIcon: spellDef.visual?.memIcon || 0
      });
      const successMsg = spellDef.messages?.castOnOther ? `${mob.name}${spellDef.messages.castOnOther}` : `${mob.name} looks less aggressive.`;
      events.push({ event: 'MESSAGE', text: successMsg });
    }
    if (sendCombatLog) sendCombatLog(session, events);
    return;
  }

  // SPA 31: Mez
  const mezEffect = (spellDef.effects || []).find(e => e.spa === 31);
  if (mezEffect) {
    if (!session.combatTarget) {
      events.push({ event: 'MESSAGE', text: 'You must have a target to cast that spell.' });
      if (sendCombatLog) sendCombatLog(session, events);
      return;
    }
    const mob = session.combatTarget;
    const resistResult = combat.calcSpellResist(mob, session.char.level, spellDef.resistType, spellDef.resistAdjust);
    if (resistResult === 'FULL_RESIST') {
      events.push({ event: 'RESIST', target: mob.name, spell: spellDef.name });
    } else {
      let dur = spellDef.duration || 6;
      if (durMod > 0) dur = Math.floor(dur * (1.0 + (durMod / 100.0)));
      if (resistResult === 'PARTIAL_RESIST') dur = Math.floor(dur / 2);
      
      let maxDur = spellDef.duration || 6;
      if (durMod > 0) maxDur = Math.floor(maxDur * (1.0 + (durMod / 100.0)));
      
      if (!Array.isArray(mob.buffs)) mob.buffs = [];
      mob.buffs = mob.buffs.filter(b => b.name !== spellDef.name);
      mob.buffs.push({
        name: spellDef.name,
        duration: dur,
        maxDuration: maxDur,
        beneficial: false,
        effects: spellDef.effects,
        isMez: true,
        casterSession: session.char.name
      });
      mob.target = null; // Drop aggro target
      events.push({ event: 'MESSAGE', text: `${mob.name} has been mesmerized.` });
    }
    if (sendCombatLog) sendCombatLog(session, events);
    return;
  }

  switch (spellDef.effect) {
    case 'heal': {
      let healAmt = spellDef.amount || 10;
      if (healMod > 0) healAmt = Math.floor(healAmt * (1.0 + (healMod / 100.0)));
      session.char.hp = Math.min(session.char.hp + healAmt, session.effectiveStats.hp);
      events.push({ event: 'SPELL_HEAL', source: 'You', target: 'You', spell: spellDef.name, amount: healAmt });

      // AE Heal Aggro: Find all mobs that have the healed target on their hate list
      const zone = module.exports.zoneInstances ? module.exports.zoneInstances[session.char.zoneId] : null;
      if (zone && zone.liveMobs) {
        const hateAmt = Math.floor(healAmt / 3);
        if (hateAmt > 0) {
          for (const mob of zone.liveMobs) {
            if (mob.hateList && mob.hateList.entries.some(e => e.entityId === session.char.name)) {
              // The mob is currently fighting the person who got healed. Add hate to the HEALER.
              mob.hateList.addEntToHateList(session.char.name, hateAmt, 0);
            }
          }
        }
      }
      break;
    }
    case 'dd': {
      if (!session.combatTarget) {
        events.push({ event: 'MESSAGE', text: 'You must have a target to cast that spell.' });
        break;
      }
      const mob = session.combatTarget;
      
      const resistResult = combat.calcSpellResist(mob, session.char.level, spellDef.resistType, spellDef.resistAdjust);
      if (resistResult === 'FULL_RESIST') {
        events.push({ event: 'RESIST', target: mob.name, spell: spellDef.name });
        break;
      }
      
      if (!mob.target) mob.target = session;
      let dmg = spellDef.damage || 10;
      if (dmgMod > 0) dmg = Math.floor(dmg * (1.0 + (dmgMod / 100.0)));
      if (resistResult === 'PARTIAL_RESIST') dmg = Math.floor(dmg / 2);

      mob.hp -= dmg;
      if (mob.hateList) mob.hateList.addEntToHateList(session.char.name, dmg, dmg);
      breakMez(mob, events);
      events.push({ event: 'SPELL_DAMAGE', source: 'You', target: mob.name, spell: spellDef.name, damage: dmg });
      if (mob.hp <= 0) {
        await handleMobDeath(session, mob, events);
      }
      break;
    }
    case 'dot':
    case 'debuff': {
      if (!session.combatTarget) {
        events.push({ event: 'MESSAGE', text: 'You must have a target to cast that spell.' });
        break;
      }
      const mob = session.combatTarget;
      
      const resistResult = combat.calcSpellResist(mob, session.char.level, spellDef.resistType, spellDef.resistAdjust);
      if (resistResult === 'FULL_RESIST') {
        events.push({ event: 'RESIST', target: mob.name, spell: spellDef.name });
        break;
      }
      
      if (!mob.target) mob.target = session;
      
      // Calculate instant damage (SPA 0 or 79)
      let instantDmg = spellDef.damage || 0;
      if (instantDmg === 0) {
        const hpEffect = (spellDef.effects || []).find(e => e.spa === 0 || e.spa === 79);
        if (hpEffect && hpEffect.base < 0) {
          instantDmg = Math.abs(hpEffect.base);
        }
      }
      
      if (instantDmg > 0) {
        let actualDmg = instantDmg;
        if (dmgMod > 0) actualDmg = Math.floor(actualDmg * (1.0 + (dmgMod / 100.0)));
        if (resistResult === 'PARTIAL_RESIST') actualDmg = Math.floor(actualDmg / 2);

        mob.hp -= actualDmg;
        if (mob.hateList) mob.hateList.addEntToHateList(session.char.name, actualDmg, actualDmg);
        breakMez(mob, events);
        events.push({ event: 'SPELL_DAMAGE', source: 'You', target: mob.name, spell: spellDef.name, damage: actualDmg });
        if (mob.hp <= 0) {
          await handleMobDeath(session, mob, events);
          break;
        }
      }

      // Base hate for landing a debuff/dot (e.g. slow/tash generates huge hate in EQ)
      let baseHate = spellDef.level ? spellDef.level * 4 : 50; 
      if (spellDef.name.toLowerCase().includes('tash')) baseHate += 200;
      if (spellDef.name.toLowerCase().includes('slow') || spellDef.name.toLowerCase().includes('drowsy')) baseHate += 300;
      if (mob.hateList) mob.hateList.addEntToHateList(session.char.name, baseHate, 0);

      // Add to mob buffs
      let dur = spellDef.duration || 6;
      if (durMod > 0) dur = Math.floor(dur * (1.0 + (durMod / 100.0)));
      if (resistResult === 'PARTIAL_RESIST') dur = Math.floor(dur / 2);
      
      if (!Array.isArray(mob.buffs)) mob.buffs = [];
      mob.buffs = mob.buffs.filter(b => b.name !== spellDef.name);
      mob.buffs.push({
        name: spellDef.name,
        duration: dur,
        maxDuration: dur,
        beneficial: false,
        effects: spellDef.effects || [],
        casterSession: session.char.name,
        icon: spellDef.visual?.icon || 0,
        memIcon: spellDef.visual?.memIcon || 0
      });
      events.push({ event: 'MESSAGE', text: `${mob.name} is afflicted by ${spellDef.name}.` });
      break;
    }
    case 'buff': {
      session.buffs = session.buffs.filter(b => b.name !== spellDef.buffName);
      
      const runeEffect = (spellDef.effects || []).find(e => e.spa === 55);
      const runeHealth = runeEffect ? Math.abs(runeEffect.max || runeEffect.base) : 0;
      
      let dur = spellDef.duration;
      if (durMod > 0) dur = Math.floor(dur * (1.0 + (durMod / 100.0)));
      
      session.buffs.push({
        name: spellDef.buffName,
        duration: dur,
        maxDuration: dur,
        beneficial: true,
        effects: spellDef.effects || [],
        ac: spellDef.ac || 0,
        runeHealth: runeHealth,
        icon: spellDef.visual?.icon || 0,
        memIcon: spellDef.visual?.memIcon || 0,
        isSong: spellDef.derived?.isBardSong === true
      });
      const buffMsg = spellDef.messages?.castOnYou || `You feel ${spellDef.buffName} take hold.`;
      events.push({ event: 'MESSAGE', text: buffMsg });
      session.effectiveStats = calcEffectiveStats(session.char, session.inventory, session.buffs);
      session.char.maxHp = session.effectiveStats.hp;
      session.char.maxMana = session.effectiveStats.mana;
      sendBuffs(session);
      sendStatus(session);
      break;
    }
    case 'cure': {
      const cureSpas = (spellDef.effects || []).map(e => e.spa);
      const curesPoison = cureSpas.includes(35) || spellDef.name.toLowerCase().includes('poison') || spellDef.name.toLowerCase().includes('antidote');
      const curesDisease = cureSpas.includes(36) || spellDef.name.toLowerCase().includes('disease');
      const curesCurse = cureSpas.includes(116) || spellDef.name.toLowerCase().includes('curse');
      const curesAll = spellDef.name.toLowerCase().includes('blood') || spellDef.name.toLowerCase().includes('aura');
      
      session.buffs = session.buffs.filter(b => {
        if (b.beneficial) return true;
        if (curesAll) return false;
        if (Array.isArray(b.effects)) {
          const hasPois = b.effects.some(e => e.spa === 35);
          const hasDis = b.effects.some(e => e.spa === 36);
          const hasCurse = b.effects.some(e => e.spa === 116);
          if (curesPoison && hasPois) return false;
          if (curesDisease && hasDis) return false;
          if (curesCurse && hasCurse) return false;
        }
        return true;
      });
      events.push({ event: 'MESSAGE', text: `You have been cured.` });
      session.effectiveStats = calcEffectiveStats(session.char, session.inventory, session.buffs);
      sendBuffs(session);
      sendStatus(session);
      break;
    }
    case 'gate': {
      if (handleStopCombat) handleStopCombat(session);
      const bindZone = session.char.startZoneId || session.char.zoneId;
      if (bindZone !== session.char.zoneId) {
        if (ensureZoneLoaded) await ensureZoneLoaded(bindZone);
        session.char.zoneId = bindZone;
        const targetDef = getZoneDef ? getZoneDef(bindZone) : null;
        session.char.roomId = targetDef ? (targetDef.defaultRoom || '') : '';
        session.char.x = 0;
        session.char.y = 0;
        session.char.z = 0;
        session.pendingTeleport = { x: 0, y: 0, z: 0 };
        const DB = require('../db');
        DB.saveCharacterLocation(session.char.id, bindZone, session.char.roomId);
        sendStatus(session);
      }
      events.push({ event: 'MESSAGE', text: 'You feel yourself drifting away...' });
      break;
    }
  }

  // Portal/Ring/Translocate/Evacuate spells (SPA 83, shadowStep, or changeAggro with teleportZone)
  const spaIds = (spellDef.effects || []).map(e => e.spa);
  const spaNames = (spellDef.effects || []).map(e => e.spaName || '');
  const hasTeleportZone = spellDef.links && spellDef.links.teleportZone && spellDef.links.teleportZone.length > 0;
  
  if (hasTeleportZone && (spaIds.includes(83) || spaNames.includes('shadowStep') || spaNames.includes('changeAggro'))) {
    const targetZone = spellDef.links.teleportZone;
    const resolvedZone = resolveZoneKey ? resolveZoneKey(targetZone) : targetZone;
    const targetDef = getZoneDef ? getZoneDef(resolvedZone) : null;
    
    if (!targetDef) {
      events.push({ event: 'MESSAGE', text: `${spellDef.name} opens a portal, but the destination is beyond your reach.` });
    } else {
      if (handleStopCombat) handleStopCombat(session);
      if (ensureZoneLoaded) await ensureZoneLoaded(resolvedZone);
      
      session.char.zoneId = resolvedZone;
      session.char.roomId = targetDef.defaultRoom || '';
      session.char.x = 0;
      session.char.y = 0;
      session.char.z = 0;
      session.pendingTeleport = { x: 0, y: 0, z: 0 };
      
      const DB = require('../db');
      DB.saveCharacterLocation(session.char.id, resolvedZone, session.char.roomId);
      const tpName = targetDef.name || resolvedZone;
      events.push({ event: 'MESSAGE', text: `You feel the world shift around you. You have entered ${tpName}.` });
      sendStatus(session);
    }
  } else if (spaNames.includes('changeAggro') && !hasTeleportZone) {
    // Evacuate/Succor without a specific teleportZone
    if (handleStopCombat) handleStopCombat(session);
    events.push({ event: 'MESSAGE', text: 'You invoke an evacuation! Your group flees from combat.' });
    if (handleSuccor) await handleSuccor(session);
  }

  if (events.length > 0) sendCombatLog(session, events);
}

function getEligibleFocusEffects(session, castSpell) {
  const eligibleFocuses = [];
  if (!session || !session.inventory || !castSpell) return eligibleFocuses;

  const ItemDB = require('../data/itemDatabase');
  const SpellDB = require('../data/spellDatabase');

  for (const invItem of session.inventory) {
    if (!invItem.equipped || invItem.slot >= 22) continue;
    
    const itemDef = ItemDB.getById(invItem.item_key);
    if (!itemDef || !itemDef.focuseffect || itemDef.focuseffect <= 0) continue;

    const focusSpell = SpellDB.getById(itemDef.focuseffect);
    if (!focusSpell || !Array.isArray(focusSpell.effects)) continue;

    let isEligible = true;
    for (const e of focusSpell.effects) {
      // Limit: Max Level (134)
      if (e.spa === 134 && e.base > 0) {
        if (castSpell.level > e.base) { isEligible = false; break; }
      }
      // Limit: Spell Type (138)
      else if (e.spa === 138) {
        if (e.base === 0 && castSpell.goodEffect) { isEligible = false; break; } // Detrimental only
        if (e.base === 1 && !castSpell.goodEffect) { isEligible = false; break; } // Beneficial only
      }
      // Limit: Effect Exclusions (137)
      else if (e.spa === 137 && e.base < 0) {
        const excludedSpa = Math.abs(e.base);
        if (Array.isArray(castSpell.effects) && castSpell.effects.some(ce => ce.spa === excludedSpa)) {
          isEligible = false; break;
        }
      }
      // Limit: Minimum Duration (140)
      else if (e.spa === 140 && e.base > 0) {
        // Spell duration in ticks. Instant spells have duration 0.
        if (!castSpell.duration || castSpell.duration < e.base) { isEligible = false; break; }
      }
    }

    if (isEligible) {
      eligibleFocuses.push(focusSpell);
    }
  }
  return eligibleFocuses;
}

module.exports = {
  setDependencies,
  getEligibleFocusEffects,
  applySpellEffect,
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
  breakMez,
  setCalcEffectiveStatsFn: (fn) => { module.exports.calcEffectiveStatsFn = fn; },
  setDBFn: (db) => { module.exports.DB = db; },
  setItemsFn: (items) => { module.exports.ITEMS = items; },
  setSummonItemMapFn: (map) => { module.exports.SUMMON_ITEM_MAP = map; },
  setSendInventoryFn: (fn) => { module.exports.sendInventoryFn = fn; },
  setZoneInstancesFn: (zi) => { module.exports.zoneInstances = zi; },
  handleRemoveBuff: (session, msg) => {
    if (!msg.name) return;
    const buffName = msg.name;
    const index = session.buffs.findIndex(b => b.name === buffName && b.beneficial);
    if (index !== -1) {
      session.buffs.splice(index, 1);
      const { calcEffectiveStats } = require('./combat');
      session.effectiveStats = calcEffectiveStats(session.char, session.inventory, session.buffs);
      sendBuffs(session);
      if (sendStatus) sendStatus(session);
      if (sendCombatLog) sendCombatLog(session, [{ event: 'MESSAGE', text: `You removed ${buffName}.` }]);
    }
  }
};
