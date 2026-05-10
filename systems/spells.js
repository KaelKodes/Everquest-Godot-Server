const fs = require('fs');
const path = require('path');
const SpellDB = require('../data/spellDatabase');
const ItemDB = require('../data/itemDatabase');
const constants = require('../data/constants');
const eqemuDB = require('../eqemu_db');
const DB = require('../db');
const { send } = require('../utils');

const SPELLS = SpellDB.createLegacyProxy();

let sendCombatLog, sendStatus, calcEffectiveStatsFn, ensureZoneLoaded, getZoneDef, resolveZoneKey, handleStopCombat, handleSuccor, combat, handleMobDeath, broadcastTargetUpdate;

function init(deps) {
  sendCombatLog = deps.sendCombatLog;
  sendStatus = deps.sendStatus;
  calcEffectiveStatsFn = deps.calcEffectiveStats;
  ensureZoneLoaded = deps.ensureZoneLoaded;
  getZoneDef = deps.getZoneDef;
  resolveZoneKey = deps.resolveZoneKey;
  handleStopCombat = deps.handleStopCombat;
  handleSuccor = deps.handleSuccor;
  combat = deps.combat;
  handleMobDeath = deps.handleMobDeath;
  broadcastTargetUpdate = deps.broadcastTargetUpdate;

  // Internal function pointers
  module.exports.calcEffectiveStatsFn = deps.calcEffectiveStats;
  module.exports.DB = deps.db;
  module.exports.ITEMS = deps.items;
  module.exports.SUMMON_ITEM_MAP = deps.summonItemMap;
  module.exports.sendInventoryFn = deps.sendInventory;
  module.exports.zoneInstances = deps.zoneInstances;
}

function calcEffectiveStats(char, inventory, buffs) {
  // Use the injected function if available
  return calcEffectiveStatsFn ? calcEffectiveStatsFn(char, inventory, buffs) : {hp: char.maxHp, mana: char.maxMana};
}

/**
 * Centralized logic for processing an offensive spell target.
 * Handles player filtering, resistance checks, and initial aggression.
 * Returns { skip: true } if the target should be skipped, or { resistResult } on success.
 */
function processOffensiveTarget(mob, session, spellDef, events) {
    if (mob.char) return { skip: true }; // Skip players for now

    const resistResult = combat.calcSpellResist(mob, session.char.level, spellDef.resistType, spellDef.resistAdjust);
    if (resistResult === 'FULL_RESIST') {
        events.push({ event: 'RESIST', target: mob.name, spell: spellDef.name });
        return { skip: true };
    }

    if (!mob.target) mob.target = session;
    return { resistResult };
}

function calculateSpellDuration(spellDef, durMod, resistResult, defaultDur = 6) {
  let dur = spellDef.duration || defaultDur;
  if (durMod > 0) dur = Math.floor(dur * (1.0 + (durMod / 100.0)));
  if (resistResult === 'PARTIAL_RESIST') dur = Math.floor(dur / 2);
  return dur;
}

/**
 * Checks if a spell can stack on an entity and applies it if possible.
 * Enforces classic EQ stacking rules: slots, groups, and levels.
 */
function applyBuff(entity, spellDef, duration, casterName, isBeneficial = true, session = null, extraProps = {}) {
    if (!entity) return false;
    if (!Array.isArray(entity.buffs)) entity.buffs = [];

    const spellId = spellDef.id;
    const stackingGroup = spellDef.stackingGroup || 0;
    const spellLevel = spellDef.level || 1;

    // 1. Exact Spell Refresh
    const existingIdx = entity.buffs.findIndex(b => b.spellId === spellId);
    if (existingIdx !== -1) {
        entity.buffs[existingIdx].duration = duration;
        entity.buffs[existingIdx].maxDuration = duration;
        // Merge extra props
        Object.assign(entity.buffs[existingIdx], extraProps);
        return true;
    }

    // 2. Stacking Logic
    let blocked = false;
    const toRemove = [];

    for (let i = 0; i < entity.buffs.length; i++) {
        const b = entity.buffs[i];
        
        // Stacking Group Conflict
        if (stackingGroup !== 0 && b.stackingGroup === stackingGroup) {
            if (b.level > spellLevel) {
                blocked = true;
                break;
            } else {
                toRemove.push(i);
            }
        }
        
        // Heuristic: If it's the exact same name, it's a conflict
        if (b.name === (spellDef.buffName || spellDef.name)) {
            if (b.level > spellLevel) {
                blocked = true;
                break;
            } else {
                toRemove.push(i);
            }
        }
    }

    if (blocked) {
        if (session && isBeneficial) {
            if (sendCombatLog) {
                sendCombatLog(session, [{ event: 'MESSAGE', text: 'Your spell did not take hold.' }]);
            }
        }
        return false;
    }

    // Remove overwritten buffs
    toRemove.sort((a, b) => b - a).forEach(idx => entity.buffs.splice(idx, 1));

          // 3. Application
    const buffObj = {
        spellId: spellId,
        stackingGroup: stackingGroup,
        level: spellLevel,
        name: spellDef.buffName || spellDef.name,
        duration: duration,
        maxDuration: duration,
        beneficial: isBeneficial,
        casterSession: casterName,
        icon: spellDef.visual?.icon || 0,
        memIcon: spellDef.visual?.memIcon || 0,
        effects: spellDef.effects || [],
        ...extraProps
    };

    // Auto-calculate tickDamage if not provided and it's a detrimental spell
    if (!isBeneficial && !buffObj.tickDamage) {
        // SPA 0 = HP, SPA 79 = HP (common in later expansions), SPA 334 = HP (common for Bard songs)
        const dotEffect = buffObj.effects.find(e => (e.spa === 0 || e.spa === 79 || e.spa === 334) && e.base < 0);
        if (dotEffect) {
            buffObj.tickDamage = Math.abs(dotEffect.base);
        }
    }

    entity.buffs.push(buffObj);

    // If target is an NPC, broadcast status update to all observers
    if (!entity.char && broadcastTargetUpdate) {
      broadcastTargetUpdate(entity);
    }
    return true;
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

async function loadSpellbookFromFile(session) {
  try {
    const DB = require('../db');
    const spellbookData = await DB.getCharacterSpellbook(session.char.id);
    const loadoutsData = await DB.getCharacterSpellLoadouts(session.char.id);
    
    if (!spellbookData || spellbookData.length === 0) {
      buildStarterSpellbook(session);
      return;
    }
    
    session.spellbook = spellbookData;
    session.spellLoadouts = loadoutsData || {};
    console.log(`[SPELLBOOK] Loaded ${session.spellbook.length} scribed spells, ${session.spells.length} memorized, ${Object.keys(session.spellLoadouts).length} loadouts for ${session.char.name}`);
  } catch (e) {
    console.error(`[SPELLBOOK] Load error for ${session.char.name}: ${e.message}`);
    buildStarterSpellbook(session);
  }
}

async function saveSpellbookToFile(session) {
  try {
    const DB = require('../db');
    await DB.saveCharacterSpellbook(session.char.id, session.spellbook);
    await DB.saveCharacterSpellLoadouts(session.char.id, session.spellLoadouts);
  } catch (e) {
    console.error(`[SPELLBOOK] Save error for ${session.char.name}: ${e.message}`);
  }
}

async function loadBuffsFromFile(session) {
  try {
    const DB = require('../db');
    const restored = await DB.getCharacterBuffs(session.char.id);
    
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

async function saveBuffsToFile(session) {
  try {
    const DB = require('../db');
    await DB.saveCharacterBuffs(session.char.id, session.buffs);
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
  session.spellLoadouts = {};
  
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

  // Intentionally do not auto-scribe every level-1 class spell from SpellDB — that bypasses scrolls/PEQ and floods the book.
  saveSpellbookToFile(session).then(() => {});
  console.log(`[SPELLBOOK] Built starter spellbook for ${session.char.name}: ${session.spellbook.length} spells`);
}

/**
 * Scribe a new spell into the spellbook.
 * @param {string} spellKey
 * @param {number|null} preferredBookSlot  If set, must be empty (0–791).
 * @returns {number} bookSlot used, or -1 full / bad, -2 duplicate, -3 invalid slot index, -4 slot occupied
 */
function scribeSpellToBook(session, spellKey, preferredBookSlot = null) {
  const spellDef = SpellDB.getByKey(spellKey);
  if (!spellDef) return -1;

  if (session.spellbook.find(s => s.spell_key === spellKey)) return -2;

  const usedSlots = new Set(session.spellbook.map(s => s.bookSlot));
  let freeSlot = -1;

  if (preferredBookSlot != null && preferredBookSlot !== undefined) {
    const ps = Math.floor(Number(preferredBookSlot));
    if (!Number.isFinite(ps) || ps < 0 || ps >= 792) return -3;
    if (usedSlots.has(ps)) return -4;
    freeSlot = ps;
  } else {
    for (let i = 0; i < 792; i++) {
      if (!usedSlots.has(i)) { freeSlot = i; break; }
    }
    if (freeSlot < 0) return -1;
  }

  session.spellbook.push({
    bookSlot: freeSlot,
    spell_key: spellKey,
    id: spellDef._spellId || spellDef.id,
  });

  saveSpellbookToFile(session).then(() => {});
  return freeSlot;
}

function normalizedClassKey(classKey) {
  return (classKey || '').toLowerCase().replace(/_/g, '');
}

const SCRIBE_CURVE_MAX_LEVEL = parseInt(process.env.SCRIBE_CURVE_MAX_LEVEL || '60', 10);
const SCRIBE_MS_MIN = 2500;
const SCRIBE_MS_MAX = 15000;

function getScribeDurationMs(spellDef, session) {
  const norm = normalizedClassKey(session.char.class);
  const spellClassLevel = spellDef.classes && spellDef.classes[norm];
  let lvl = typeof spellClassLevel === 'number' && spellClassLevel !== 255 ? spellClassLevel : 1;
  const cap = Math.max(2, SCRIBE_CURVE_MAX_LEVEL);
  const lvlClamped = Math.min(Math.max(1, lvl), cap);
  const t = cap > 1 ? (lvlClamped - 1) / (cap - 1) : 1;
  const baseMs = SCRIBE_MS_MIN + (SCRIBE_MS_MAX - SCRIBE_MS_MIN) * Math.max(0, Math.min(1, t));
  const med = (session.char.skills && session.char.skills.meditate) ? session.char.skills.meditate : 0;
  const medFactor = 1 - 0.45 * Math.min(1, med / 252);
  return Math.max(1500, Math.round(baseMs * medFactor));
}

function validateScribeScroll(session, invSlot, requestedBookSlot) {
  const ITEMS = module.exports.ITEMS || {};
  const invRow = session.inventory.find(i => i.slot === invSlot);
  if (!invRow) return { ok: false, error: 'Item not found.' };

  const itemDef = ItemDB.getById(invRow.item_key) || ITEMS[invRow.item_key] || {};
  if (!itemDef || (itemDef.scrolleffect || 0) <= 0) {
    return { ok: false, error: 'That is not a spell scroll.' };
  }
  if ((itemDef.bagslots || 0) > 0) {
    return { ok: false, error: 'You cannot scribe from a container.' };
  }

  const CLASSES_MAP = constants.CLASSES;
  if (itemDef.classes && itemDef.classes !== 65535) {
    const classId = CLASSES_MAP[session.char.class] || 1;
    if (!(itemDef.classes & (1 << (classId - 1)))) {
      return { ok: false, error: 'Your class cannot use this scroll.' };
    }
  }
  if (itemDef.races && itemDef.races !== 65535) {
    const raceId = constants.RACES[session.char.race] || 1;
    const RACE_BIT = { 1:0, 2:1, 3:2, 4:3, 5:4, 6:5, 7:6, 8:7, 9:8, 10:9, 11:10, 12:11, 128:12, 130:13, 330:14 };
    const bit = RACE_BIT[raceId] ?? -1;
    if (bit >= 0 && !(itemDef.races & (1 << bit))) {
      return { ok: false, error: 'Your race cannot use this scroll.' };
    }
  }

  if (session.char.level < (itemDef.reqlevel || 0)) {
    return { ok: false, error: `You must be level ${itemDef.reqlevel} to use this scroll.` };
  }

  const spellDef = SpellDB.getById(itemDef.scrolleffect);
  if (!spellDef) return { ok: false, error: 'Unknown spell on this scroll.' };

  const norm = normalizedClassKey(session.char.class);
  const needLevel = spellDef.classes && spellDef.classes[norm];
  if (needLevel === undefined || needLevel === 255) {
    return { ok: false, error: 'Your class cannot learn this spell.' };
  }
  if (session.char.level < needLevel) {
    return { ok: false, error: `You must be at least level ${needLevel} to scribe this spell.` };
  }

  const spellKey = spellDef._key;
  if (!spellKey) return { ok: false, error: 'Could not resolve spell id.' };

  if (session.spellbook.find(s => s.spell_key === spellKey)) {
    const spellLabel = spellDef.name || spellKey;
    return { ok: false, error: `You already have ${spellLabel} scribed.` };
  }

  let targetBookSlot = null;
  if (requestedBookSlot != null && requestedBookSlot !== undefined) {
    const bs = Math.floor(Number(requestedBookSlot));
    if (!Number.isFinite(bs) || bs < 0 || bs >= 792) {
      return { ok: false, error: 'Invalid spellbook slot.' };
    }
    if (session.spellbook.some(s => s.bookSlot === bs)) {
      return { ok: false, error: 'That spellbook slot is not empty.' };
    }
    targetBookSlot = bs;
  } else {
    const usedSlots = new Set(session.spellbook.map(s => s.bookSlot));
    let freeSlot = -1;
    for (let i = 0; i < 792; i++) {
      if (!usedSlots.has(i)) { freeSlot = i; break; }
    }
    if (freeSlot < 0) return { ok: false, error: 'Your spellbook is full.' };
    targetBookSlot = freeSlot;
  }

  return {
    ok: true,
    invRow,
    itemDef,
    spellDef,
    spellKey,
    targetBookSlot,
  };
}

function rejectScribeBegin(session, reason, messageText) {
  if (!session.ws || session.ws.readyState !== 1) return;
  send(session.ws, { type: 'SCRIBE_REJECTED', reason: reason || 'unknown' });
  if (messageText) send(session.ws, { type: 'MESSAGE', text: messageText });
}

function handleBeginScribeScroll(session, msg) {
  if (!session.char || !session.ws) return;

  if (session.pendingScribe) {
    rejectScribeBegin(session, 'busy', 'You are already scribing a scroll.');
    return;
  }
  if (session.char.state !== 'medding') {
    rejectScribeBegin(session, 'not_sitting', 'You must be sitting to scribe.');
    return;
  }
  if (session.inCombat) {
    rejectScribeBegin(session, 'combat', 'You cannot scribe while fighting.');
    return;
  }
  const invSlot = msg.slot != null ? Math.floor(Number(msg.slot)) : null;
  if (invSlot == null || !Number.isFinite(invSlot)) {
    rejectScribeBegin(session, 'bad_request', null);
    return;
  }

  const v = validateScribeScroll(session, invSlot, msg.bookSlot);
  if (!v.ok) {
    rejectScribeBegin(session, 'validation', v.error);
    return;
  }

  const durationMs = getScribeDurationMs(v.spellDef, session);
  const now = Date.now();
  session.pendingScribe = {
    invSlot: v.invRow.slot,
    itemKey: v.invRow.item_key,
    bookSlot: v.targetBookSlot,
    spellKey: v.spellKey,
    endsAt: now + durationMs,
    startedAt: now,
    durationMs,
  };

  send(session.ws, {
    type: 'SCRIBE_STARTED',
    spellKey: v.spellKey,
    spellId: v.spellDef.id,
    spellName: v.spellDef.name,
    bookSlot: v.targetBookSlot,
    durationMs,
    endsAt: session.pendingScribe.endsAt,
  });
}

function cancelPendingScribe(session, reason, silent) {
  if (!session.pendingScribe) return;
  session.pendingScribe = null;
  if (!silent && session.ws && session.ws.readyState === 1) {
    send(session.ws, { type: 'SCRIBE_CANCELLED', reason: reason || 'interrupted' });
  }
}

function tickPendingScribe(session) {
  const p = session.pendingScribe;
  if (!p) return;
  if (session.inCombat || (session.char && session.char.state !== 'medding')) {
    cancelPendingScribe(session, session.inCombat ? 'combat' : 'stand', false);
    return;
  }
  if (Date.now() < p.endsAt) return;
  finalizePendingScribe(session).catch((err) => {
    console.error(`[SCRIBE] finalize error for ${session?.char?.name || 'unknown'}:`, err);
  });
}

async function finalizePendingScribe(session) {
  const p = session.pendingScribe;
  if (!p || Date.now() < p.endsAt) return;

  session.pendingScribe = null;
  const { invSlot, itemKey, bookSlot, spellKey } = p;

  if (!session.char) return;

  const v = validateScribeScroll(session, invSlot, bookSlot);
  if (!v.ok || v.spellKey !== spellKey) {
    if (session.ws && session.ws.readyState === 1) {
      send(session.ws, { type: 'SCRIBE_CANCELLED', reason: 'validation' });
      send(session.ws, { type: 'MESSAGE', text: v.ok ? 'Scribing failed.' : v.error });
    }
    return;
  }

  const slotUsed = scribeSpellToBook(session, spellKey, bookSlot);
  if (slotUsed < 0) {
    if (session.ws && session.ws.readyState === 1) {
      send(session.ws, { type: 'SCRIBE_CANCELLED', reason: 'book' });
      send(session.ws, { type: 'MESSAGE', text: 'Scribing failed (spellbook).' });
    }
    return;
  }

  const ok = await eqemuDB.consumeOneInventoryAtSlot(session.char.id, invSlot, itemKey);
  if (!ok) {
    session.spellbook = session.spellbook.filter(s => !(s.spell_key === spellKey && s.bookSlot === bookSlot));
    saveSpellbookToFile(session).then(() => {});
    if (session.ws && session.ws.readyState === 1) {
      send(session.ws, { type: 'SCRIBE_CANCELLED', reason: 'item' });
      send(session.ws, { type: 'MESSAGE', text: 'Scroll missing — scribing aborted.' });
    }
    return;
  }

  session.inventory = await DB.getInventory(session.char.id);
  if (calcEffectiveStatsFn) {
    session.effectiveStats = calcEffectiveStatsFn(session.char, session.inventory, session.buffs);
  }
  if (module.exports.sendInventoryFn) module.exports.sendInventoryFn(session);

  sendSpellbookFull(session);
  if (sendStatus) sendStatus(session);

  if (session.ws && session.ws.readyState === 1) {
    send(session.ws, {
      type: 'SCRIBE_COMPLETE',
      spellKey,
      bookSlot: slotUsed,
      spellName: v.spellDef.name || spellKey,
    });
  }
  if (sendCombatLog) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You have scribed ${v.spellDef.name || spellKey} into your spellbook.` }]);
  }
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
  
  saveSpellbookToFile(session).then(() => {});
  DB.memorizeSpell(session.char.id, spellKey, slot).then(() => {});
  sendSpellbook(session);
  
  const def = SPELLS[spellKey] || {};
  send(session.ws, { type: 'MESSAGE', text: `You have memorized ${def.name || spellKey}.` });
}

function handleForgetSpell(session, msg) {
  const { slot } = msg;
  if (slot == null || slot < 0 || slot >= 8) return;
  
  const existing = session.spells.find(s => s.slot === slot);
  session.spells = session.spells.filter(s => s.slot !== slot);
  
  saveSpellbookToFile(session).then(() => {});
  DB.forgetSpell(session.char.id, slot).then(() => {});
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
  
  saveSpellbookToFile(session).then(() => {});
  sendSpellbookFull(session);
}

function handleSaveSpellLoadout(session, msg) {
  const { name } = msg;
  if (!name) return;
  if (!session.spellLoadouts) session.spellLoadouts = {};
  
  // Save current memorized spells
  session.spellLoadouts[name] = JSON.parse(JSON.stringify(session.spells));
  saveSpellbookToFile(session).then(() => {});
  
  send(session.ws, { type: 'MESSAGE', text: `Saved spell loadout: ${name}` });
  sendSpellLoadouts(session);
}

function handleLoadSpellLoadout(session, msg) {
  const { name } = msg;
  if (!name || !session.spellLoadouts || !session.spellLoadouts[name]) return;
  
  // Must be sitting
  if (session.char.state !== 'medding') {
    send(session.ws, { type: 'MESSAGE', text: 'You must be sitting to memorize spells.' });
    return;
  }
  
  session.spells = JSON.parse(JSON.stringify(session.spellLoadouts[name]));
  saveSpellbookToFile(session).then(() => {});
  
  send(session.ws, { type: 'MESSAGE', text: `Loaded spell loadout: ${name}` });
  sendSpellbook(session);
}

function handleDeleteSpellLoadout(session, msg) {
  const { name } = msg;
  if (!name || !session.spellLoadouts || !session.spellLoadouts[name]) return;
  
  delete session.spellLoadouts[name];
  saveSpellbookToFile(session).then(() => {});
  
  send(session.ws, { type: 'MESSAGE', text: `Deleted spell loadout: ${name}` });
  sendSpellLoadouts(session);
}

function handleClearSpells(session) {
  session.spells = [];
  saveSpellbookToFile(session).then(() => {});
  
  send(session.ws, { type: 'MESSAGE', text: 'Cleared all memorized spells.' });
  sendSpellbook(session);
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

  // Also send full spellbook and loadouts
  sendSpellbookFull(session);
  sendSpellLoadouts(session);
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

function sendSpellLoadouts(session) {
  send(session.ws, {
    type: 'SPELL_LOADOUTS',
    loadouts: Object.keys(session.spellLoadouts || {})
  });
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



/**
 * Robust target selection for AOE spells.
 * Handles PB AE, Targeted AE, Group, and Group Pet target types.
 */
function getAoeTargets(session, spellDef, primaryTarget = null) {
    const targets = [];
    const isDetrimental = !spellDef.goodEffect;
    const aoeRange = spellDef.range?.aoeRange || 50;
    const rangeSq = aoeRange * aoeRange;

    // Target Types (Classic EQ IDs):
    // 1: Self
    // 3: Group v1 (Targeted or PB)
    // 4: PB AE (Point Blank Area Effect - centered on caster)
    // 5: Targeted AE (Centered on primary target)
    // 20: Target AE v2
    // 41: Group v2
    
    const tid = spellDef.targetType?.id;
    const isGroup = [3, 41].includes(tid) || spellDef.targetType?.name === 'groupPet' || (spellDef.derived?.isBardSong && !isDetrimental);
    const isPbAe = tid === 4 || (spellDef.derived?.isBardSong && isDetrimental && !spellDef.range?.range); // Detrimental songs with 0 range are PB AE
    const isTargetAe = [5, 20].includes(tid);

    const zone = module.exports.zoneInstances ? module.exports.zoneInstances[session.char.zoneId] : null;

    if (isGroup) {
        // Beneficial Group effect (Heals, Buffs, Songs)
        if (session.group && session.group.members) {
            for (const m of session.group.members) {
                const dx = (m.char.x || 0) - (session.char.x || 0);
                const dy = (m.char.y || 0) - (session.char.y || 0);
                const dz = (m.char.z || 0) - (session.char.z || 0);
                if ((dx*dx + dy*dy + dz*dz) <= rangeSq || m === session) {
                    targets.push(m);
                }
            }
        } else {
            targets.push(session);
        }
    } else if (isPbAe || isTargetAe) {
        // Area Effect (Centered on Caster or Target)
        const centerX = isPbAe ? session.char.x : (primaryTarget ? (primaryTarget.char ? primaryTarget.char.x : primaryTarget.x) : session.char.x);
        const centerY = isPbAe ? session.char.y : (primaryTarget ? (primaryTarget.char ? primaryTarget.char.y : primaryTarget.y) : session.char.y);
        const centerZ = isPbAe ? session.char.z : (primaryTarget ? (primaryTarget.char ? primaryTarget.char.z : primaryTarget.z) : session.char.z);

        if (isDetrimental) {
            // Detrimental AE: Targets enemies around center
            if (zone && zone.liveMobs) {
                for (const mob of zone.liveMobs) {
                    const dx = (mob.x || 0) - centerX;
                    const dy = (mob.y || 0) - centerY;
                    const dz = (mob.z || 0) - centerZ;
                    if ((dx*dx + dy*dy + dz*dz) <= rangeSq) {
                        targets.push(mob);
                    }
                }
            }
        } else {
            // Beneficial AE (Rare in EQ, but handled for completeness)
            targets.push(session);
        }
    } else if (primaryTarget) {
        // Single Target
        targets.push(primaryTarget);
    }

    return targets;
}

async function applySpellEffect(session, spellDef) {
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
  let instantTarget = session.char;
  let instantTargetSession = session;
  
  if (isDetrimental) {
      instantTarget = session.combatTarget || session.char;
  } else if (session.combatTarget) {
      if (session.combatTarget.char) { // It's a player session
          const combat = require('./combat');
          if (combat.canInteract(session, session.combatTarget, true)) {
              instantTargetSession = session.combatTarget;
              instantTarget = instantTargetSession.char;
          }
      } else if (session.combatTarget.npcType === 'pet') {
          instantTarget = session.combatTarget;
          instantTargetSession = null; // Pets don't have sessions
      }
  }
  
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
         const val = endEffect.base; // Val > 0 means restoring endurance
         if (val > 0) {
             instantTarget.fatigue = Math.max(0, (instantTarget.fatigue || 0) - val);
             if (instantTarget === session.char) events.push({ event: 'MESSAGE', text: `You feel invigorated.` });
         } else if (val < 0) {
             instantTarget.fatigue = Math.min(100, (instantTarget.fatigue || 0) + Math.abs(val));
             if (instantTarget === session.char) events.push({ event: 'MESSAGE', text: `You feel exhausted.` });
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
      const dur = calculateSpellDuration(spellDef, durMod, resistResult, 120);
      applyBuff(mob, spellDef, dur, session.char.name, false, session);
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
      const dur = calculateSpellDuration(spellDef, durMod, resistResult, 6);
      applyBuff(mob, spellDef, dur, session.char.name, false, session);
      mob.target = null; // Drop aggro target
      events.push({ event: 'MESSAGE', text: `${mob.name} has been mesmerized.` });
    }
    if (sendCombatLog) sendCombatLog(session, events);
    return;
  }

  // SPA 21: Stun
  const stunEffect = (spellDef.effects || []).find(e => e.spa === 21);
  if (stunEffect) {
    if (!session.combatTarget) {
      events.push({ event: 'MESSAGE', text: 'You must have a target to cast that spell.' });
      if (sendCombatLog) sendCombatLog(session, events);
      return;
    }
    const mob = session.combatTarget;
    // Max level check — stun won't land on mobs above the max field
    if (stunEffect.max && stunEffect.max > 0 && mob.level > stunEffect.max) {
      events.push({ event: 'MESSAGE', text: `${mob.name} is too powerful to be stunned.` });
      if (sendCombatLog) sendCombatLog(session, events);
      return;
    }
    const resistResult = combat.calcSpellResist(mob, session.char.level, spellDef.resistType, spellDef.resistAdjust);
    if (resistResult === 'FULL_RESIST') {
      events.push({ event: 'RESIST', target: mob.name, spell: spellDef.name });
    } else {
      const stunDur = calculateSpellDuration(spellDef, durMod, resistResult, (stunEffect.base || 4000) / 1000);
      applyBuff(mob, spellDef, stunDur, session.char.name, false, session);
      events.push({ event: 'MESSAGE', text: `${mob.name} has been stunned!` });
    }
    if (sendCombatLog) sendCombatLog(session, events);
    return;
  }

  // SPA 23: Fear
  const fearEffect = (spellDef.effects || []).find(e => e.spa === 23);
  if (fearEffect) {
    if (!session.combatTarget) {
      events.push({ event: 'MESSAGE', text: 'You must have a target to cast that spell.' });
      if (sendCombatLog) sendCombatLog(session, events);
      return;
    }
    const mob = session.combatTarget;
    if (fearEffect.max && fearEffect.max > 0 && mob.level > fearEffect.max) {
      events.push({ event: 'MESSAGE', text: `${mob.name} is too powerful to be feared.` });
      if (sendCombatLog) sendCombatLog(session, events);
      return;
    }
    const resistResult = combat.calcSpellResist(mob, session.char.level, spellDef.resistType, spellDef.resistAdjust);
    if (resistResult === 'FULL_RESIST') {
      events.push({ event: 'RESIST', target: mob.name, spell: spellDef.name });
    } else {
      const dur = calculateSpellDuration(spellDef, durMod, resistResult, 6);
      applyBuff(mob, spellDef, dur, session.char.name, false, session);
      mob.target = null; // Feared mobs drop target
      events.push({ event: 'MESSAGE', text: `${mob.name} flees in terror!` });
    }
    if (sendCombatLog) sendCombatLog(session, events);
    return;
  }

  // SPA 99: Root
  const rootEffect = (spellDef.effects || []).find(e => e.spa === 99);
  if (rootEffect) {
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
      const dur = calculateSpellDuration(spellDef, durMod, resistResult, 48);
      applyBuff(mob, spellDef, dur, session.char.name, false, session, { isRoot: true });
      events.push({ event: 'MESSAGE', text: `${mob.name}'s feet become entangled!` });
    }
    if (sendCombatLog) sendCombatLog(session, events);
    return;
  }

  // SPA 20: Blind
  const blindEffect = (spellDef.effects || []).find(e => e.spa === 20);
  if (blindEffect) {
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
      const dur = calculateSpellDuration(spellDef, durMod, resistResult, 12);
      applyBuff(mob, spellDef, dur, session.char.name, false, session, { isBlind: true });
      events.push({ event: 'MESSAGE', text: `${mob.name} has been blinded!` });
    }
    if (sendCombatLog) sendCombatLog(session, events);
    return;
  }

  // SPA 22: Charm
  const charmEffect = (spellDef.effects || []).find(e => e.spa === 22);
  if (charmEffect) {
    if (!session.combatTarget) {
      events.push({ event: 'MESSAGE', text: 'You must have a target to cast that spell.' });
      if (sendCombatLog) sendCombatLog(session, events);
      return;
    }
    const mob = session.combatTarget;
    if (mob.level > session.char.level) {
      events.push({ event: 'MESSAGE', text: `${mob.name} is too powerful to be charmed.` });
      if (sendCombatLog) sendCombatLog(session, events);
      return;
    }
    const resistResult = combat.calcSpellResist(mob, session.char.level, spellDef.resistType, spellDef.resistAdjust);
    if (resistResult === 'FULL_RESIST') {
      events.push({ event: 'RESIST', target: mob.name, spell: spellDef.name });
      // Failed charm = aggro
      if (!mob.target) mob.target = session;
      if (mob.hateList) mob.hateList.addEntToHateList(session.char.name, 500, 0);
    } else {
      const dur = calculateSpellDuration(spellDef, durMod, resistResult, 36);
      // Mark mob as charmed — the AI system will treat it like a pet
      applyBuff(mob, spellDef, dur, session.char.name, false, session, { isCharm: true });
      mob.isCharmed = true;
      mob.charmOwner = session;
      mob.target = null;
      if (mob.hateList) mob.hateList.wipeHateList();
      events.push({ event: 'MESSAGE', text: `${mob.name} regards you as an ally!` });
    }
    if (sendCombatLog) sendCombatLog(session, events);
    return;
  }

  // SPA 27: Dispel Magic (Cancel Magic)
  const dispelEffect = (spellDef.effects || []).find(e => e.spa === 27);
  if (dispelEffect) {
    if (!session.combatTarget) {
      events.push({ event: 'MESSAGE', text: 'You must have a target to cast that spell.' });
      if (sendCombatLog) sendCombatLog(session, events);
      return;
    }
    const target = session.combatTarget;
    // If target is an NPC mob
    if (Array.isArray(target.buffs) && target.buffs.length > 0) {
      // Dispel strips beneficial buffs — remove the highest level one
      const beneficialIdx = target.buffs.findIndex(b => b.beneficial);
      if (beneficialIdx >= 0) {
        const removed = target.buffs.splice(beneficialIdx, 1)[0];
        events.push({ event: 'MESSAGE', text: `${removed.name} has been dispelled from ${target.name}!` });
      } else {
        events.push({ event: 'MESSAGE', text: `${target.name} has no beneficial spells to dispel.` });
      }
    } else if (target.char) {
      // Target is a player — strip one beneficial buff
      const tgtSession = target;
      if (tgtSession.buffs && tgtSession.buffs.length > 0) {
        const beneficialIdx = tgtSession.buffs.findIndex(b => b.beneficial);
        if (beneficialIdx >= 0) {
          const removed = tgtSession.buffs.splice(beneficialIdx, 1)[0];
          events.push({ event: 'MESSAGE', text: `${removed.name} has been dispelled from ${tgtSession.char.name}!` });
          const { calcEffectiveStats } = require('./stats');
          tgtSession.effectiveStats = calcEffectiveStats(tgtSession.char, tgtSession.inventory, tgtSession.buffs);
          sendBuffs(tgtSession);
          sendStatus(tgtSession);
        } else {
          events.push({ event: 'MESSAGE', text: `${tgtSession.char.name} has no beneficial spells to dispel.` });
        }
      }
    } else {
      events.push({ event: 'MESSAGE', text: 'Your target has nothing to dispel.' });
    }
    if (sendCombatLog) sendCombatLog(session, events);
    return;
  }

  // SPA 57: Levitate (applied as buff flag)
  const levitateEffect = (spellDef.effects || []).find(e => e.spa === 57);
  if (levitateEffect && spellDef.goodEffect) {
    if (instantTargetSession) {
      const dur = calculateSpellDuration(spellDef, durMod, null, 270);
      applyBuff(instantTargetSession, spellDef, dur, session.char.name, true, session, { isLevitate: true });
      instantTargetSession.char.isLevitating = true;
      events.push({ event: 'MESSAGE', text: spellDef.messages?.castOnYou || 'You feel lighter.' });
      sendBuffs(instantTargetSession);
      sendStatus(instantTargetSession);
    }
    if (sendCombatLog) sendCombatLog(session, events);
    return;
  }

  // SPA 14: Water Breathing (Enduring Breath)
  const waterBreathEffect = (spellDef.effects || []).find(e => e.spa === 14);
  if (waterBreathEffect && spellDef.goodEffect) {
    if (instantTargetSession) {
      const dur = calculateSpellDuration(spellDef, durMod, null, 270);
      applyBuff(instantTargetSession, spellDef, dur, session.char.name, true, session, { isWaterBreathing: true });
      instantTargetSession.char.canWaterBreathe = true;
      events.push({ event: 'MESSAGE', text: spellDef.messages?.castOnYou || 'You feel as if you could breathe underwater.' });
      sendBuffs(instantTargetSession);
      sendStatus(instantTargetSession);
    }
    if (sendCombatLog) sendCombatLog(session, events);
    return;
  }
  // SPA 73: Bind Sight — see through target's eyes
  const bindSightEffect = (spellDef.effects || []).find(e => e.spa === 73);
  if (bindSightEffect) {
    // Requires a target (mob or player)
    const target = session.combatTarget || null;
    if (!target) {
      events.push({ event: 'MESSAGE', text: 'You must have a target to cast that spell.' });
      if (sendCombatLog) sendCombatLog(session, events);
      return;
    }

    let dur = calculateSpellDuration(spellDef, durMod, null, 840);

    // Remove any existing bind sight buff
    session.buffs = session.buffs.filter(b => !b.isBindSight);

    // Determine target identity for tracking
    const isTargetPlayer = !!target.char;
    const targetId = isTargetPlayer ? `player_${target.char.id}` : target.id;
    const targetName = isTargetPlayer ? target.char.name : target.name;

    session.buffs.push({
      name: spellDef.buffName || spellDef.name, duration: dur, maxDuration: dur,
      beneficial: true, effects: spellDef.effects || [],
      isBindSight: true,
      bindSightTargetId: targetId,
      icon: spellDef.visual?.icon || 0, memIcon: spellDef.visual?.memIcon || 0
    });

    // Store on session for quick access in game loop
    session.bindSightTarget = target;
    session.bindSightTargetId = targetId;

    events.push({ event: 'MESSAGE', text: spellDef.messages?.castOnYou || `You can now see through ${targetName}'s eyes.` });

    // Send initial BIND_SIGHT position to client
    const tX = isTargetPlayer ? target.char.x : target.x;
    const tY = isTargetPlayer ? target.char.y : target.y;
    const tZ = isTargetPlayer ? (target.char.z || 0) : (target.z || 0);
    const tH = isTargetPlayer ? (target.char.heading || 0) : (target.heading || 0);
    send(session.ws, {
      type: 'BIND_SIGHT',
      active: true,
      targetName: targetName,
      x: tX, y: tY, z: tZ, heading: tH
    });

    sendBuffs(session);
    if (sendCombatLog) sendCombatLog(session, events);
    return;
  }

  // SPA 85: Add Proc (weapon proc buff)
  const procEffect = (spellDef.effects || []).find(e => e.spa === 85);
  if (procEffect && spellDef.goodEffect) {
    if (instantTargetSession) {
      let dur = spellDef.duration || 36;
      if (durMod > 0) dur = Math.floor(dur * (1.0 + (durMod / 100.0)));
      instantTargetSession.buffs = instantTargetSession.buffs.filter(b => b.name !== spellDef.buffName);
      instantTargetSession.buffs.push({
        name: spellDef.buffName || spellDef.name, duration: dur, maxDuration: dur,
        beneficial: true, effects: spellDef.effects || [],
        procSpellId: procEffect.base, // The spell ID that fires on hit
        procRate: procEffect.limit || 100, // % chance modifier
        icon: spellDef.visual?.icon || 0, memIcon: spellDef.visual?.memIcon || 0
      });
      events.push({ event: 'MESSAGE', text: spellDef.messages?.castOnYou || `Your weapons are imbued with ${spellDef.name}.` });
      sendBuffs(instantTargetSession);
    }
    if (sendCombatLog) sendCombatLog(session, events);
    return;
  }

  // SPA 89: Model Size (Growth / Shrink)
  const sizeEffect = (spellDef.effects || []).find(e => e.spa === 89);
  if (sizeEffect) {
    const target = instantTarget || session.char;
    const targetSession = instantTargetSession || session;
    
    if (targetSession && targetSession.buffs) {
      let dur = spellDef.duration || 270;
      if (durMod > 0) dur = Math.floor(dur * (1.0 + (durMod / 100.0)));
      // Remove existing size buffs (only one size change at a time)
      targetSession.buffs = targetSession.buffs.filter(b => !b.isSizeMod);
      targetSession.buffs.push({
        name: spellDef.buffName || spellDef.name, duration: dur, maxDuration: dur,
        beneficial: spellDef.goodEffect !== false, effects: spellDef.effects || [],
        isSizeMod: true,
        icon: spellDef.visual?.icon || 0, memIcon: spellDef.visual?.memIcon || 0
      });
      // sizeMod is a percentage: 100 = normal, 125 = 25% bigger, 66 = 34% smaller
      target.sizeMod = sizeEffect.base || 100;
      // Invalidate cached networkData so the new size broadcasts
      if (target.networkData) target.networkData = null;
      
      const sizeText = sizeEffect.base > 100 ? 'You feel yourself growing.' : 'You feel yourself shrinking.';
      events.push({ event: 'MESSAGE', text: spellDef.messages?.castOnYou || sizeText });
      sendBuffs(targetSession);
      sendStatus(targetSession);
    }
    if (sendCombatLog) sendCombatLog(session, events);
    return;
  }

  // SPA 147: Percent Heal (e.g., Full Heal = 100%, Tunare's Renewal = 75%)
  const pctHealEffect = (spellDef.effects || []).find(e => e.spa === 147);
  if (pctHealEffect) {
    const pctHeal = Math.min(100, Math.max(1, pctHealEffect.base || 100));
    const target = instantTarget || session.char;
    const targetSession = instantTargetSession || session;
    const maxHp = targetSession.effectiveStats ? targetSession.effectiveStats.hp : (target.maxHp || 100);
    const healAmt = Math.floor(maxHp * (pctHeal / 100));
    target.hp = Math.min((target.hp || 0) + healAmt, maxHp);

    const targetName = target === session.char ? 'You' : (target.name || target.char?.name || 'someone');
    events.push({ event: 'SPELL_HEAL', source: 'You', target: targetName, spell: spellDef.name, amount: healAmt });

    // Heal aggro — same as regular heals
    const zoneInstances = module.exports.zoneInstances;
    const zone = zoneInstances ? zoneInstances[session.char.zoneId] : null;
    if (zone && zone.liveMobs) {
      const hateAmt = Math.floor(healAmt / 3);
      if (hateAmt > 0) {
        const targetEntityName = target === session.char ? session.char.name : (target.name || target.char?.name);
        for (const m of zone.liveMobs) {
          if (m.hateList && Array.isArray(m.hateList.entries) && m.hateList.entries.some(e => e.entityId === targetEntityName)) {
            m.hateList.addEntToHateList(session.char.name, hateAmt, 0);
          }
        }
      }
    }
    if (sendCombatLog) sendCombatLog(session, events);
    if (targetSession && targetSession !== session) sendStatus(targetSession);
    return;
  }

  switch (spellDef.effect) {
    case 'heal': {
      let healAmt = spellDef.amount || 10;
      if (healMod > 0) healAmt = Math.floor(healAmt * (1.0 + (healMod / 100.0)));
      
      const targets = getAoeTargets(session, spellDef, instantTargetSession || instantTarget);

      for (const target of targets) {
          const tChar = target.char || target;
          const tSess = target.char ? target : null;
          
          const maxHp = tSess && tSess.effectiveStats ? tSess.effectiveStats.hp : (tChar.maxHp || 100);
          tChar.hp = Math.min((tChar.hp || 0) + healAmt, maxHp);
          
          const targetName = tChar === session.char ? 'You' : (tChar.name || 'someone');
          events.push({ event: 'SPELL_HEAL', source: 'You', target: targetName, spell: spellDef.name, amount: healAmt });

          // AE Heal Aggro: Find all mobs that have the healed target on their hate list
          const zoneInstances = module.exports.zoneInstances;
          const zone = zoneInstances ? zoneInstances[session.char.zoneId] : null;
          if (zone && zone.liveMobs) {
            const hateAmt = Math.floor(healAmt / 3);
            if (hateAmt > 0) {
              for (const m of zone.liveMobs) {
                if (m.hateList && Array.isArray(m.hateList.entries) && m.hateList.entries.some(e => e.entityId === tChar.name)) {
                  // The mob is currently fighting the person who got healed. Add hate to the HEALER.
                  m.hateList.addEntToHateList(session.char.name, hateAmt, 0);
                }
              }
            }
          }
          if (tSess && typeof sendStatus === 'function') sendStatus(tSess);
      }
      break;
    }
    case 'dd': {
      const targets = getAoeTargets(session, spellDef, session.combatTarget);

      for (const mob of targets) {
          const result = processOffensiveTarget(mob, session, spellDef, events);
          if (result.skip) continue;
          
          const { resistResult } = result;
          let dmg = spellDef.damage || 10;
          if (dmgMod > 0) dmg = Math.floor(dmg * (1.0 + (dmgMod / 100.0)));
          if (resistResult === 'PARTIAL_RESIST') dmg = Math.floor(dmg / 2);

          // SPA 170: Spell Critical Chance
          let isSpellCrit = false;
          if (Array.isArray(session.buffs)) {
              let spellCritChance = 0;
              for (const buff of session.buffs) {
                  if (Array.isArray(buff.effects)) {
                      for (const eff of buff.effects) {
                          if (eff.spa === 170 && eff.base > 0) spellCritChance += eff.base;
                      }
                  }
              }
              if (spellCritChance > 0 && combat.chance(spellCritChance)) {
                  dmg = Math.floor(dmg * 2);
                  isSpellCrit = true;
              }
          }

          mob.hp -= dmg;
          if (mob.hateList) mob.hateList.addEntToHateList(session.char.name, dmg, dmg);
          breakMez(mob, events);
          if (isSpellCrit) {
              events.push({ event: 'SPELL_DAMAGE', source: 'You', target: mob.name, spell: spellDef.name, damage: dmg, text: 'Critical Blast!' });
          } else {
              events.push({ event: 'SPELL_DAMAGE', source: 'You', target: mob.name, spell: spellDef.name, damage: dmg });
          }
          if (mob.hp <= 0) {
              await handleMobDeath(session, mob, events);
          }
      }
      break;
    }
    case 'dot':
    case 'debuff': {
      const targets = getAoeTargets(session, spellDef, session.combatTarget);
      if (targets.length === 0 && spellDef.targetType?.id !== 4) {
          events.push({ event: 'MESSAGE', text: 'You must have a target to cast that spell.' });
          break;
      }

      for (const mob of targets) {
          const result = processOffensiveTarget(mob, session, spellDef, events);
          if (result.skip) continue;
          
          const { resistResult } = result;
          
          // Calculate instant damage (SPA 0 or 79)
          let instantDmg = spellDef.damage || 0;
          if (instantDmg === 0 && (spellDef.type === 'dd' || (spellDef.type === 'dot' && spellDef.duration === 0))) {
              const hpEffect = (spellDef.effects || []).find(e => (e.spa === 0 || e.spa === 79) && e.base < 0);
              if (hpEffect) {
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
                  continue;
              }
          }

          // Base hate for landing a debuff/dot
          let baseHate = spellDef.level ? spellDef.level * 4 : 50; 
          if (spellDef.name.toLowerCase().includes('tash')) baseHate += 200;
          if (spellDef.name.toLowerCase().includes('slow') || spellDef.name.toLowerCase().includes('drowsy')) baseHate += 300;
          if (mob.hateList) mob.hateList.addEntToHateList(session.char.name, baseHate, 0);

          // Add to mob buffs
          const dur = calculateSpellDuration(spellDef, durMod, resistResult, 6);
          
          let tickDamage = 0;
          if (spellDef.type === 'dot' || spellDef.derived?.isBardSong) {
              const dotEffect = (spellDef.effects || []).find(e => (e.spa === 0 || e.spa === 79 || e.spa === 334) && e.base < 0);
              if (dotEffect) {
                  tickDamage = Math.abs(dotEffect.base);
                  // Apply damage modifiers (e.g. Bard instruments)
                  if (dmgMod > 0) tickDamage = Math.floor(tickDamage * (1.0 + (dmgMod / 100.0)));
              }
          }

          applyBuff(mob, spellDef, dur, session.char.name, false, session, { tickDamage, isSong: spellDef.derived?.isBardSong === true, casterName: session.char.name });
          events.push({ event: 'MESSAGE', text: `${mob.name} is afflicted by ${spellDef.name}.` });
      }
      break;
    }
      case 'buff': {
      const targets = getAoeTargets(session, spellDef, instantTargetSession);

      let dur = spellDef.duration || 6;
      if (durMod > 0) dur = Math.floor(dur * (1.0 + (durMod / 100.0)));

      const runeEffect = (spellDef.effects || []).find(e => e.spa === 55);
      const runeHealth = runeEffect ? Math.max(0, runeEffect.base || 0) : 0;

      for (const target of targets) {
          const tSess = target.char ? target : null;
          if (!tSess) continue; // Buffs only apply to sessions for now

          applyBuff(tSess, spellDef, dur, session.char.name, true, session, {
              ac: spellDef.ac || 0,
              runeHealth: runeHealth,
              isSong: spellDef.derived?.isBardSong === true,
              casterName: session.char.name
          });

          const buffMsg = tSess === session
              ? (spellDef.messages?.castOnYou || `You feel ${spellDef.buffName || spellDef.name} take hold.`)
              : (spellDef.messages?.castOnOther ? `${tSess.char.name}${spellDef.messages.castOnOther}` : `${tSess.char.name} looks buffed.`);
      
          if (tSess === session) {
              events.push({ event: 'MESSAGE', text: buffMsg });
          } else if (tSess.ws) {
              tSess.ws.send(JSON.stringify({ type: 'CHAT', channel: 'system', text: spellDef.messages?.castOnYou || `You feel ${spellDef.buffName || spellDef.name} take hold.` }));
          }

          tSess.effectiveStats = calcEffectiveStats(tSess.char, tSess.inventory, tSess.buffs);
          tSess.char.maxHp = tSess.effectiveStats.hp;
          tSess.char.maxMana = tSess.effectiveStats.mana;
          sendBuffs(tSess);
          if (typeof sendStatus === 'function') sendStatus(tSess);
      }
      break;
    }
    case 'cure': {
      if (!instantTargetSession) break;
      const cureSpas = (spellDef.effects || []).map(e => e.spa);
      const curesPoison = cureSpas.includes(35) || spellDef.name.toLowerCase().includes('poison') || spellDef.name.toLowerCase().includes('antidote');
      const curesDisease = cureSpas.includes(36) || spellDef.name.toLowerCase().includes('disease');
      const curesCurse = cureSpas.includes(116) || spellDef.name.toLowerCase().includes('curse');
      const curesAll = spellDef.name.toLowerCase().includes('blood') || spellDef.name.toLowerCase().includes('aura');
      
      instantTargetSession.buffs = instantTargetSession.buffs.filter(b => {
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
      
      instantTargetSession.effectiveStats = calcEffectiveStats(instantTargetSession.char, instantTargetSession.inventory, instantTargetSession.buffs);
      instantTargetSession.char.maxHp = instantTargetSession.effectiveStats.hp;
      instantTargetSession.char.maxMana = instantTargetSession.effectiveStats.mana;
      sendBuffs(instantTargetSession);
      sendStatus(instantTargetSession);
      events.push({ event: 'MESSAGE', text: `You cured ${instantTargetSession === session ? 'yourself' : instantTargetSession.char.name}.` });
      if (instantTargetSession !== session && instantTargetSession.ws) {
         instantTargetSession.ws.send(JSON.stringify({ type: 'CHAT', channel: 'system', text: `You have been cured by ${session.char.name}.` }));
      }
      break;
    }
    case 'gate': {
      if (handleStopCombat) handleStopCombat(session);
      const bindZone = DB.getArchiveShortName(session.char.bindZoneId || session.char.zoneId);
      const curZone = DB.getArchiveShortName(session.char.zoneId);
      if (bindZone !== curZone) {
        if (ensureZoneLoaded) await ensureZoneLoaded(bindZone);
        session.char.zoneId = bindZone;
        const targetDef = getZoneDef ? getZoneDef(bindZone) : null;
        session.char.roomId = targetDef ? (targetDef.defaultRoom || '') : '';
        session.char.x = 0;
        session.char.y = 0;
        session.char.z = 0;
        session.pendingTeleport = { x: 0, y: 0, z: 0 };
        const DB = require('../db');
        DB.saveCharacterLocation(session.char.id, bindZone, session.char.x, session.char.y, session.char.z);
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
    const archiveZone = DB.getArchiveShortName(resolvedZone);
    const targetDef = getZoneDef ? getZoneDef(archiveZone) : null;
    
    if (!targetDef) {
      events.push({ event: 'MESSAGE', text: `${spellDef.name} opens a portal, but the destination is beyond your reach.` });
    } else {
      if (handleStopCombat) handleStopCombat(session);
      if (ensureZoneLoaded) await ensureZoneLoaded(archiveZone);
      
      session.char.zoneId = archiveZone;
      session.char.roomId = targetDef.defaultRoom || '';
      session.char.x = 0;
      session.char.y = 0;
      session.char.z = 0;
      session.pendingTeleport = { x: 0, y: 0, z: 0 };
      
      DB.saveCharacterLocation(session.char.id, archiveZone, session.char.x, session.char.y, session.char.z);
      const tpName = targetDef.name || archiveZone;
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
  getEligibleFocusEffects,
  applySpellEffect,
  loadSpellbookFromFile,
  saveSpellbookToFile,
  loadBuffsFromFile,
  saveBuffsToFile,
  buildStarterSpellbook,
  scribeSpellToBook,
  handleBeginScribeScroll,
  cancelPendingScribe,
  tickPendingScribe,
  handleMemorizeSpell,
  handleForgetSpell,
  handleSwapBookSpells,
  handleSaveSpellLoadout,
  handleLoadSpellLoadout,
  handleDeleteSpellLoadout,
  handleClearSpells,
  sendSpellLoadouts,
  sendSpellbook,
  sendSpellbookFull,
  sendBuffs,
  breakMez,
  getAoeTargets,
  init,
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
