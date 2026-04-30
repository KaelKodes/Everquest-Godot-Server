const fs = require('fs');
const path = require('path');
const ZONES = require('./data/zones');
const SpellDB = require('./data/spellDatabase');
let SPELLS; // Legacy proxy, initialized after SpellDB loads
const { Skills, RACIAL_STARTING_SKILLS } = require('./data/skills');
const { STARTER_GEAR, SUMMON_ITEM_MAP } = require('./data/items');
const ItemDB = require('./data/itemDatabase');
let ITEMS; // Legacy proxy, initialized after ItemDB loads
const DB = require('./db');
const combat = require('./combat');
const { NPC_TYPES, HAIL_RANGE } = require('./data/npcTypes');
const MERCHANT_INVENTORIES = require('./data/npcs/merchants');
const QuestDialogs = require('./data/npcs/quests');
const MiningData = require('./data/miningNodes');
const { PET_SPELLS, PET_SKILL_TIERS, PET_NAMES } = require('./data/petData');
const { VISION_MODES, RACE_VISION, SPELL_VISION_MODES, AMBIENT_LIGHT } = require('./data/visionModes');
const Calendar = require('./data/calendar');
const WorldAtlas = require('./data/worldAtlas');
const { send } = require('./utils');
const VisionSystem = require('./systems/vision');
const AISystem = require('./systems/ai');
const QuestManager = require('./questManager');

// Precise zone line trigger data extracted from EQ S3D client files (BSP regions)
let ZONE_TRIGGERS = {};
try { ZONE_TRIGGERS = require('./data/zone_triggers.json'); } catch (e) { console.warn('[ENGINE] No zone_triggers.json found, using DB defaults for all triggers'); }

/**
 * Map EQEmu npc_types.class to our NPC_TYPES.
 * EQEmu classes: 1=Warrior, 41=Merchant, 40=Banker, 61=LDoN Merchant, etc.
 * Guild Master classes: 20=Warrior_GM, 21=Cleric_GM, 22=Paladin_GM, 23=Ranger_GM,
 *   25=ShadowKnight_GM, 26=Druid_GM, 27=Monk_GM, 28=Bard_GM, 31=Wizard_GM,
 *   32=Magician_GM, 33=Necromancer_GM, 34=Enchanter_GM, 35=Shaman_GM, 63=LDoN_Recruiter
 */
function mapEqemuClassToNpcType(eqClass) {
  if (eqClass === 41 || eqClass === 61) return NPC_TYPES.MERCHANT;
  if (eqClass === 40) return NPC_TYPES.BANK;
  if ((eqClass >= 20 && eqClass <= 35) || eqClass === 63) return NPC_TYPES.TRAINER;
  return NPC_TYPES.MOB;
}

// Map EQEmu Guild Master NPC class to player class
const GUILD_MASTER_CLASS = {
  20: 'warrior', 21: 'cleric', 22: 'paladin', 23: 'ranger',
  24: 'rogue',   25: 'shadowknight', 26: 'druid', 27: 'monk',
  28: 'bard',    29: 'rogue', 31: 'wizard', 32: 'magician',
  33: 'necromancer', 34: 'enchanter', 35: 'shaman'
};

// Training cost formula (P99 community polynomial: cost in copper per point)
function getTrainingCostCopper(currentSkillValue) {
  if (currentSkillValue <= 0) return 0; // First point is always free
  const x = currentSkillValue;
  // Cost in platinum (3rd-order polynomial from P99 data fitting)
  const pp = 9.99389e-6 * x*x*x - 2.97456e-4 * x*x + 2.68839e-3 * x;
  return Math.max(0, Math.round(pp * 1000)); // Convert pp to copper (1pp = 1000cp)
}

// Break copper into pp/gp/sp/cp
function copperToCoins(totalCopper) {
  const pp = Math.floor(totalCopper / 1000);
  const gp = Math.floor((totalCopper % 1000) / 100);
  const sp = Math.floor((totalCopper % 100) / 10);
  const cp = totalCopper % 10;
  return { pp, gp, sp, cp };
}

// Skill rank label based on current value vs cap
function getSkillRank(value, cap) {
  if (cap <= 0) return 'N/A';
  const pct = (value / cap) * 100;
  if (pct >= 91) return 'Master';
  if (pct >= 81) return 'Excellent';
  if (pct >= 71) return 'Very Good';
  if (pct >= 61) return 'Good';
  if (pct >= 51) return 'Above Avg';
  if (pct >= 41) return 'Average';
  if (pct >= 31) return 'Below Avg';
  if (pct >= 21) return 'Bad';
  if (pct >= 11) return 'Very Bad';
  if (pct >= 6) return 'Feeble';
  return 'Awful';
}

const TICK_RATE = 2000; // 2 second game ticks
const VIEW_DISTANCE = 99999; // Disable proximity culling for authentic zone experience
const SYNC_RATE = 10; // Sync world every 10 ticks (20s) to refresh state

const State = require('./state');
const sessions = State.sessions;
const authSessions = State.authSessions;
const zoneInstances = State.zoneInstances;
let worldCalendar = State.worldCalendar;

// See combat.js for math helpers

function getDistanceSq(x1, y1, x2, y2) {
    const dx = (x1 || 0) - (x2 || 0);
    const dy = (y1 || 0) - (y2 || 0);
    return dx * dx + dy * dy;
}

function getDistance(x1, y1, x2, y2) {
    return Math.sqrt(getDistanceSq(x1, y1, x2, y2));
}

// ── Vision System ───────────────────────────────────────────────────
// Computes the character's current vision state from:
//   1. Zone environment (outdoor/indoor, time of day, weather)
//   2. Player-selected vision mode (racial, normal, or spell-granted)
//   3. Active buff overrides (SPA 68 Infravision, SPA 69 Ultravision)
//   4. Equipped light sources
//   5. Light sensitivity penalties (bright light / torch glare)
//   6. View distance based on mode + conditions
//
// Returns an object suitable for both server-side gameplay logic
// and sending to the Godot client for rendering.
// ────────────────────────────────────────────────────────────────────

// ── Vision System moved to systems/vision.js ──────────────────────

function calcEffectiveStats(char, inventory, buffs = []) {
  const stats = {
    str: char.str, sta: char.sta, agi: char.agi,
    dex: char.dex, wis: char.wis, intel: char.intel, cha: char.cha,
    ac: 0, hp: 0, mana: 0,
  };

  // Apply equipment stat bonuses first (so HP/mana calc uses buffed STA/WIS/INT)
  for (const row of inventory) {
    if (row.equipped !== 1) continue;
    const itemDef = ITEMS[row.item_key];
    if (!itemDef) continue;
    if (itemDef.ac) stats.ac += itemDef.ac;
    if (itemDef.str) stats.str += itemDef.str;
    if (itemDef.sta) stats.sta += itemDef.sta;
    if (itemDef.agi) stats.agi += itemDef.agi;
    if (itemDef.dex) stats.dex += itemDef.dex;
    if (itemDef.wis) stats.wis += itemDef.wis;
    if (itemDef.intel) stats.intel += itemDef.intel;
    if (itemDef.cha) stats.cha += itemDef.cha;
  }

  // Apply buff SPA effects (stat buffs before HP/mana calc, flat bonuses after)
  // First pass: stat buffs (SPAs 1-10) — applied before HP/mana calculation
  if (Array.isArray(buffs)) {
    for (const buff of buffs) {
      if (!Array.isArray(buff.effects)) {
        // Legacy fallback: old-style buff with just .ac
        if (buff.ac) stats.ac += buff.ac;
        continue;
      }
      for (const eff of buff.effects) {
        switch (eff.spa) {
          case 1:  stats.ac  += eff.base; break;  // armorClass
          case 2:  /* ATK — stored for combat calc */ break;
          case 4:  stats.str += eff.base; break;   // STR
          case 5:  stats.dex += eff.base; break;   // DEX
          case 6:  stats.agi += eff.base; break;   // AGI
          case 7:  stats.sta += eff.base; break;   // STA
          case 8:  stats.intel += eff.base; break;  // INT
          case 9:  stats.wis += eff.base; break;   // WIS
          case 10: stats.cha += eff.base; break;   // CHA
        }
      }
    }
  }

  // Compute max HP and mana from class/level/stats using classic EQ formulas
  // (uses buffed STA/WIS/INT so stat buffs affect HP/mana pools)
  stats.hp = combat.calcMaxHP(char.class, char.level, stats.sta);
  stats.mana = combat.calcMaxMana(char.class, char.level, stats);

  // Add flat HP/mana from equipment
  for (const row of inventory) {
    if (row.equipped !== 1) continue;
    const itemDef = ITEMS[row.item_key];
    if (!itemDef) continue;
    if (itemDef.hp) stats.hp += itemDef.hp;
    if (itemDef.mana) stats.mana += itemDef.mana;
  }

  // Second pass: flat HP/mana bonuses from buffs (after base calc)
  if (Array.isArray(buffs)) {
    for (const buff of buffs) {
      if (!Array.isArray(buff.effects)) continue;
      for (const eff of buff.effects) {
        switch (eff.spa) {
          case 79: stats.hp += eff.base; break;    // maxCurrentHP (flat HP bonus)
          case 15: stats.mana += eff.base; break;   // currentMana (flat mana bonus)
        }
      }
    }
  }

  return stats;
}

function getWeaponStats(inventory) {
  let damage = 2, delay = 30;
  for (const row of inventory) {
    if (row.equipped === 1 && row.slot === 13) {
      const itemDef = ITEMS[row.item_key];
      if (itemDef && itemDef.damage) {
        damage = itemDef.damage;
        delay = itemDef.delay || 30;
      }
      break;
    }
  }
  return { damage, delay };
}

// Map EQEmu itemtype to weapon skill name for skill-ups
// EQEmu itemtype values: 0=1HS, 1=2HS, 2=Piercing, 3=1HB, 4=2HB, 5=Archery,
// 7=Throwing, 35=H2H, 36=2HPiercing, 45=H2H(monk special)
function getWeaponSkillName(inventory) {
  for (const row of inventory) {
    if (row.equipped === 1 && row.slot === 13) {
      const itemDef = ITEMS[row.item_key];
      if (itemDef) {
        switch (itemDef.itemtype) {
          case 0:  return '1h_slashing';
          case 1:  return '2h_slashing';
          case 2:  return 'piercing';
          case 3:  return '1h_blunt';
          case 4:  return '2h_blunt';
          case 5:  return 'archery';
          case 7:  return 'throwing';
          case 35: case 45: return 'hand_to_hand';
          case 36: return 'piercing'; // 2H piercing uses piercing skill
          default: return '1h_slashing';
        }
      }
      break;
    }
  }
  // No weapon equipped — fists
  return 'hand_to_hand';
}

// ── Zone Management ─────────────────────────────────────────────────

// Pick one NPC from a spawn pool using weighted chance percentages.
// Each entry has a `chance` (0-100). The pool re-rolls fresh each spawn.
function pickFromPool(pool) {
  if (!pool || pool.length === 0) return null;
  if (pool.length === 1) return pool[0];

  // If all chances are 0, treat as equal probability
  const totalChance = pool.reduce((sum, p) => sum + p.chance, 0);
  if (totalChance <= 0) {
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Weighted random selection
  const roll = Math.random() * totalChance;
  let cumulative = 0;
  for (const entry of pool) {
    cumulative += entry.chance;
    if (roll < cumulative) return entry;
  }
  return pool[pool.length - 1]; // safety fallback
}

// Reverse map EQEmu short_names → our internal zone keys
const SHORTNAME_TO_KEY = {};
for (const [key, def] of Object.entries(ZONES)) {
  if (def.shortName) SHORTNAME_TO_KEY[def.shortName] = key;
}

// Resolve an EQEmu short_name to our internal key (if we have one), else pass through
function resolveZoneKey(zoneIdOrShort) {
  return SHORTNAME_TO_KEY[zoneIdOrShort] || zoneIdOrShort;
}

// Get zone definition from static ZONES or from dynamic zoneInstances
function getZoneDef(zoneKey) {
  return ZONES[zoneKey] || (zoneInstances[zoneKey] && zoneInstances[zoneKey].def) || null;
}

async function initZones() {
  // Load spell database
  SpellDB.loadSpells();
  SPELLS = SpellDB.createLegacyProxy();
  console.log(`[ENGINE] Spell database: ${SpellDB.count()} spells loaded.`);

  // Load item database
  await ItemDB.loadItems();
  ITEMS = ItemDB.createLegacyProxy();
  
  // Pre-initialize hardcoded zones (only cshome — all real zones load dynamically)
  for (const [zoneId, zoneDef] of Object.entries(ZONES)) {
    zoneInstances[zoneId] = {
      def: zoneDef,
      liveMobs: [],
      spawnPointState: [],
      liveNodes: [],
      nodeSpawnState: [],
      weather: Calendar.createZoneWeather(zoneDef.climate || 'temperate'),
      grids: {},
      doors: []
    };
    console.log(`[ZONE] ${zoneId} (${zoneDef.name}) pre-initialized.`);
  }
  console.log(`[ENGINE] Initialized ${Object.keys(zoneInstances).length} zone(s). All other zones load dynamically.`);
}

// Dynamically load a zone from MySQL if it isn't already running
async function ensureZoneLoaded(zoneKey) {
  if (zoneInstances[zoneKey]) return; // Already loaded

  console.log(`[ENGINE] Dynamically loading zone '${zoneKey}'...`);

  // Look up zone metadata from the DB cache (long_name, zone_type, etc.)
  const eqemuDB = require('./eqemu_db');
  const zoneMeta = eqemuDB.getZoneMetadata(zoneKey);

  // Map EQEmu castoutdoor to our environment string
  // castoutdoor=1 means outdoor spells work (outdoor zone), 0 means indoor
  const envType = (zoneMeta && zoneMeta.castoutdoor === 1) ? 'outdoor' : 'indoor';
  const displayName = (zoneMeta && zoneMeta.long_name) || zoneKey;

  // Create a minimal zone definition (mapSize will be computed from data)
  const isPreset = !!ZONES[zoneKey];
  const zoneDef = ZONES[zoneKey] || {
    name: displayName,
    environment: envType,
    shortName: zoneKey,
    levelRange: [1, 60],
    mapSize: null, // Will be computed
    centerOffset: null,
    zoneLines: [],
    mobs: [],
  };

  // Enrich zone definition with world atlas data if available
  const atlasEntry = WorldAtlas.getAtlasEntry(zoneKey);
  const zoneClimate = (zoneDef.climate) || (atlasEntry && atlasEntry.climate) || (envType === 'indoor' ? 'underground' : 'temperate');
  if (!zoneDef.climate && atlasEntry) {
    zoneDef.climate = atlasEntry.climate;
    zoneDef.terrain = atlasEntry.terrain;
  }

  zoneInstances[zoneKey] = {
    def: zoneDef,
    liveMobs: [],
    spawnPointState: [],
    liveNodes: [],
    nodeSpawnState: [],
    weather: Calendar.createZoneWeather(zoneClimate),
    grids: {},
    doors: []
  };

  // Track bounding box from all coordinates
  let allCoords = [];

  // ── Load Grids ──
  try {
    const zoneIdNumber = eqemuDB.getZoneIdByShortName(zoneDef.shortName || zoneKey);
    if (zoneIdNumber) {
      zoneInstances[zoneKey].grids = await eqemuDB.getZoneGrids(zoneIdNumber);
    }
  } catch (e) {
    console.log(`[ENGINE] No grid data found for '${zoneKey}':`, e.message);
  }

  // Load spawns from EQEmu MySQL
  try {
    const rawSpawns = await eqemuDB.getZoneSpawns(zoneDef.shortName || zoneKey);

    const spawnPoints = new Map();
    for (const row of rawSpawns) {
      if (!spawnPoints.has(row.spawn2_id)) {
        spawnPoints.set(row.spawn2_id, {
          x: row.x, y: row.y, z: row.z, heading: row.heading || 0,
          respawntime: row.respawntime || 420,
          pathgrid: row.pathgrid || 0,
          wanderDist: row.wander_dist || 0,
          pool: []
        });
        allCoords.push({ x: row.x, y: row.y });
      }
      spawnPoints.get(row.spawn2_id).pool.push({
        npc_id: row.npc_id,
        name: row.name ? row.name.replace(/_/g, ' ').replace(/[0-9]/g, '').trim() : "Unknown",
        level: row.level,
        hp: row.hp,
        mindmg: row.mindmg,
        maxdmg: row.maxdmg,
        race: row.race || 1,
        gender: row.gender || 0,
        npcClass: row.class || 1,
        chance: row.chance || 0
      });
    }

    for (const [spawnId, point] of spawnPoints) {
      const picked = pickFromPool(point.pool);
      if (!picked) continue;

      const mobDef = {
        key: picked.npc_id.toString(),
        name: picked.name,
        level: picked.level,
        race: picked.race || 1,
        gender: picked.gender || 0,
        type: mapEqemuClassToNpcType(picked.npcClass),
        eqClass: picked.npcClass || 0,
        pathgrid: point.pathgrid,
        wanderDist: point.wanderDist,
        maxHp: picked.hp > 0 ? picked.hp : picked.level * 20,
        minDmg: picked.mindmg || Math.max(1, Math.floor(picked.level / 2)),
        maxDmg: picked.maxdmg || Math.max(4, picked.level * 2),
        attackDelay: 3,
        xpBase: picked.level * picked.level * 15,
        respawnTime: point.respawntime
      };

      const mobState = {
        spawnId, mobKey: mobDef.key,
        x: point.x, y: point.y, z: point.z,
        currentMobId: null, respawnTimer: 0,
        mobDef, pool: point.pool, respawnTime: point.respawntime, pathgrid: point.pathgrid
      };

      const newMob = spawnMob(zoneKey, mobDef, point.x, point.y, point.z, point.heading);
      if (newMob) mobState.currentMobId = newMob.id;
      zoneInstances[zoneKey].spawnPointState.push(mobState);
    }

    console.log(`[ENGINE] Dynamically loaded ${spawnPoints.size} spawn points (from ${rawSpawns.length} pool entries) for '${zoneKey}'.`);
  } catch (e) {
    console.log(`[ENGINE] No spawn data found for '${zoneKey}':`, e.message);
  }

  // ── Load Doors ──
  try {
    zoneInstances[zoneKey].doors = await eqemuDB.getZoneDoors(zoneDef.shortName || zoneKey);
    zoneInstances[zoneKey].doorStates = {}; // Map of doorid -> { isOpen: boolean, closeTimer: NodeJS.Timeout }
    console.log(`[ENGINE] Loaded ${zoneInstances[zoneKey].doors.length} doors for '${zoneKey}'.`);
  } catch (e) {
    console.log(`[ENGINE] No door data found for '${zoneKey}':`, e.message);
  }

  // ── Mining Node Spawning ──
  spawnMiningNodes(zoneKey);
  // ── Mining NPC Spawning ──
  spawnMiningNPCs(zoneKey);

  // Load zone connections from zone_points table
  let zonePoints = [];
  try {
    zonePoints = await eqemuDB.getZonePoints(zoneDef.shortName || zoneKey);
    // Include zone point positions in bounding box
    for (const zp of zonePoints) {
      if (zp.x !== 0 || zp.y !== 0) {
        allCoords.push({ x: zp.x, y: zp.y, isZonePoint: true });
      }
    }
  } catch (e) {
    console.log(`[ENGINE] No zone connections found for '${zoneKey}':`, e.message);
  }

  // Compute mapSize and centerOffset from actual data (only for dynamic zones)
  if (!isPreset) {
    // Use zone points if they give a reasonable spread, otherwise all coords
    let boundsCoords = allCoords.filter(c => c.isZonePoint);
    // Need at least 3 zone points for a meaningful boundary, else use all data
    if (boundsCoords.length < 3) boundsCoords = allCoords;
    
    if (boundsCoords.length > 0) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const c of boundsCoords) {
        if (c.x < minX) minX = c.x;
        if (c.x > maxX) maxX = c.x;
        if (c.y < minY) minY = c.y;
        if (c.y > maxY) maxY = c.y;
      }
      // Add padding so zone lines sit on edges
      const pad = 200;
      minX -= pad; maxX += pad; minY -= pad; maxY += pad;
      
      // Enforce minimum dimensions
      let w = maxX - minX;
      let h = maxY - minY;
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      if (w < 500) w = 500;
      if (h < 500) h = 500;
      
      zoneDef.mapSize = { width: w, length: h };
      zoneDef.centerOffset = { x: cx, y: cy };
      console.log(`[ENGINE] Computed map bounds for '${zoneKey}': ${Math.round(w)}x${Math.round(h)}, center=(${Math.round(cx)}, ${Math.round(cy)})`);
    } else {
      zoneDef.mapSize = { width: 3000, length: 3000 };
      zoneDef.centerOffset = { x: 0, y: 0 };
    }
  }

  // Convert zone points to zone line triggers
  if (zonePoints.length > 0) {
    // Only include real zone exits. Note: we no longer filter out 0,0 as it is a valid coordinate in some zones (e.g. Arena).
    const realZonePoints = zonePoints;
    
    // For dynamic zones, pass raw EQ coordinates directly to the client.
    // The client will place triggers at exact positions, not on map edges.
    //
    // EQ coordinate system (EQEmu DB convention):
    //   X axis = East/West,  Y axis = North/South
    //
    // Godot mapping (done client-side):
    //   Godot X = -EQ_X,  Godot Z = -EQ_Y
    //
    // Orientation inference from 999999 target markers:
    //   999999 means "keep player's current coordinate on that axis"
    //   If target_x = 999999: player's X preserved → trigger runs N/S (vertical)
    //     (you walk E/W through it, your X stays the same)
    //   If target_y = 999999: player's Y preserved → trigger runs E/W (horizontal)
    //     (you walk N/S through it, your Y stays the same)
    // Check for BSP-derived precise trigger data from S3D files
    const bspTriggers = ZONE_TRIGGERS[zoneKey] || [];

    zoneDef.zoneLines = realZonePoints.map((zp, idx) => {
      let orientation = 'ns'; // default: vertical on map
      if (zp.target_x > 900000) orientation = 'ns'; // wall runs north-south (vertical)
      else if (zp.target_y > 900000) orientation = 'ew'; // wall runs east-west (horizontal)

      const targetMeta = eqemuDB.getZoneMetadata(zp.target_short);
      const targetLongName = (targetMeta && targetMeta.long_name) || zp.target_short;

      // Match BSP trigger by referenceIndex (zone_points 'number' field = 1-based)
      const bsp = bspTriggers.find(t => t.referenceIndex === zp.number);

      if (bsp) {
        // Use precise BSP-derived trigger geometry from S3D client files
        console.log(`[ENGINE] Using BSP trigger data for ${zoneKey} ZL#${zp.number} → ${zp.target_short}: center=(${bsp.eq_center.x},${bsp.eq_center.y}), size=${bsp.eq_size.width}x${bsp.eq_size.depth}x${bsp.eq_size.height}`);
        return {
          target: zp.target_short,
          targetLongName,
          targetZoneId: zp.target_zone_id,
          x: bsp.eq_center.x,
          y: bsp.eq_center.y,
          z: bsp.eq_center.z,
          orientation,
          width: bsp.eq_size.depth,   // trigger thickness (how deep the trigger is)
          length: bsp.eq_size.width,  // trigger span (how wide the doorway is)
          triggerHeight: bsp.eq_size.height,
          // Send the full BSP AABB to the client for exact trigger placement
          bspMin: bsp.eq_min,
          bspMax: bsp.eq_max,
          targetX: zp.target_x, targetY: zp.target_y, targetZ: zp.target_z,
        };
      }

      // Fallback: use DB dimensions (EQEmu default: 75-unit proximity check)
      const dbBuffer = zp.buffer || 75;
      const dbWidth  = zp.width  || dbBuffer;
      const dbHeight = zp.height || 75;

      return {
        target: zp.target_short,
        targetLongName,
        targetZoneId: zp.target_zone_id,
        x: zp.x,
        y: zp.y,
        z: zp.z,
        orientation,
        width: dbBuffer,  // trigger thickness (depth you walk through)
        length: dbWidth,  // trigger span (how wide the doorway is)
        triggerHeight: dbHeight,
        targetX: zp.target_x, targetY: zp.target_y, targetZ: zp.target_z,
      };
    });
    console.log(`[ENGINE] Loaded ${realZonePoints.length} zone connections for '${zoneKey}': ${zoneDef.zoneLines.map(zl => `${zl.target}(${zl.x},${zl.y},${zl.orientation})`).join(', ')}`);
  }
}

function spawnMob(zoneId, mobDef, forcedX = null, forcedY = null, forcedZ = null, forcedHeading = null) {
  const zone = zoneInstances[zoneId];
  if (!zone) return;

  let roomId = null;
  if (zone.def && zone.def.rooms) {
      const roomKeys = Object.keys(zone.def.rooms);
      if (roomKeys.length > 0) {
          // Drop them in a random grid room
          roomId = roomKeys[Math.floor(Math.random() * roomKeys.length)];
      }
  } else if (zone.def && zone.def.defaultRoom) {
      roomId = zone.def.defaultRoom;
  }

  let spawnX = (forcedX !== null) ? forcedX : 0;
  let spawnY = (forcedY !== null) ? forcedY : 0;

    if (forcedX === null) {
      if (roomId === 'random') {
        if (zone.def && zone.def.mapSize) {
          const ox = (zone.def.centerOffset && zone.def.centerOffset.x) || 0;
          const oy = (zone.def.centerOffset && zone.def.centerOffset.y) || 0;
          const hw = zone.def.mapSize.width / 2;
          const hl = zone.def.mapSize.length / 2;
          spawnX = ox + (Math.random() * zone.def.mapSize.width) - hw;
          spawnY = oy + (Math.random() * zone.def.mapSize.length) - hl;
        } else {
          spawnX = (Math.random() * 300) - 150;
          spawnY = (Math.random() * 300) - 150;
        }
      }
    }

  const npcType = mobDef.type || NPC_TYPES.MOB;

  const newMob = {
    id: `${mobDef.key}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    roomId: roomId,
    key: mobDef.key,
    name: mobDef.name,
    level: mobDef.level,
    race: mobDef.race || 1,
    gender: mobDef.gender || 0,
    npcType: npcType,
    eqClass: mobDef.eqClass || 0,
    x: spawnX,
    y: spawnY,
    z: (forcedZ !== null) ? forcedZ : 0,
    heading: (forcedHeading !== null) ? forcedHeading : 0,
    spawnX: spawnX,    // Remember spawn position for leash reset
    spawnY: spawnY,
    hp: mobDef.maxHp,
    maxHp: mobDef.maxHp,
    minDmg: mobDef.minDmg,
    maxDmg: mobDef.maxDmg,
    attackDelay: mobDef.attackDelay,
    attackTimer: 0,
    xpBase: mobDef.xpBase,
    loot: mobDef.loot || [],
    target: null,
  };

  // Initialize roaming logic if pathgrid is present
  if (mobDef.pathgrid > 0 && zone.grids && zone.grids[mobDef.pathgrid]) {
    newMob.gridId = mobDef.pathgrid;
    newMob.gridEntries = zone.grids[mobDef.pathgrid];
    newMob.gridIndex = 0;
    newMob.gridPauseTimer = 0;
    newMob.isRoaming = true;
  } else if (mobDef.wanderDist > 0) {
    newMob.wanderDist = mobDef.wanderDist;
    newMob.isRoaming = true;
    newMob.gridPauseTimer = 0; // Use the same pause timer for wander delays
  }
  
  zone.liveMobs.push(newMob);
  return newMob;
}

// ═══════════════════════════════════════════════════════════════════
//  Mining System — Node Spawning, Mine Handler, Respawns
// ═══════════════════════════════════════════════════════════════════

function spawnMiningNodes(zoneId) {
  const zone = zoneInstances[zoneId];
  if (!zone) return;

  // Resolve zone key to mining spawn data
  const shortName = zone.def && zone.def.shortName ? zone.def.shortName : zoneId;
  const spawnConfig = MiningData.ZONE_MINING_SPAWNS[zoneId] || MiningData.ZONE_MINING_SPAWNS[shortName];
  if (!spawnConfig) return;

  // Spawn primary node type
  spawnNodeGroup(zoneId, spawnConfig.nodeType, spawnConfig.activeCount, spawnConfig.spawnLocations);

  // Spawn additional node types (e.g., T2 nodes in a T1 zone)
  if (spawnConfig.additionalNodeTypes) {
    for (const extra of spawnConfig.additionalNodeTypes) {
      spawnNodeGroup(zoneId, extra.nodeType, extra.activeCount, extra.spawnLocations);
    }
  }

  console.log(`[MINING] Spawned ${zone.liveNodes.length} mining nodes in ${zoneId}`);
}

function spawnMiningNPCs(zoneId) {
  const zone = zoneInstances[zoneId];
  if (!zone) return;

  // Check if this zone has a Dougal spawn point
  const shortName = zone.def && zone.def.shortName ? zone.def.shortName : zoneId;
  const spawnPoint = MiningData.MINING_NPC_SPAWNS[zoneId] || MiningData.MINING_NPC_SPAWNS[shortName];
  if (!spawnPoint) return;

  // Don't double-spawn — check if Dougal is already in the zone
  const already = zone.liveMobs.find(m => m.key === 'dougal_coalbeard');
  if (already) return;

  const npcDef = MiningData.MINING_NPC_DEF;
  const newMob = spawnMob(zoneId, npcDef, spawnPoint.x, spawnPoint.y, spawnPoint.z);
  if (newMob) {
    console.log(`[MINING] Spawned Dougal Coalbeard in ${zoneId} at (${spawnPoint.x}, ${spawnPoint.y}, ${spawnPoint.z})`);
  }
}

function spawnNodeGroup(zoneId, nodeType, activeCount, spawnLocations) {
  const zone = zoneInstances[zoneId];
  const nodeDef = MiningData.MINING_NODES[nodeType];
  if (!nodeDef || !spawnLocations || spawnLocations.length === 0) return;

  // Shuffle spawn locations and pick activeCount of them
  const shuffled = [...spawnLocations].sort(() => Math.random() - 0.5);
  const count = Math.min(activeCount, shuffled.length);

  for (let i = 0; i < count; i++) {
    const loc = shuffled[i];
    const node = {
      id: `node_${nodeType}_${zoneId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      nodeType: nodeType,
      name: nodeDef.name,
      tier: nodeDef.tier,
      hp: nodeDef.hp,
      maxHp: nodeDef.hp,
      x: loc.x,
      y: loc.y,
      z: loc.z || 0,
      alive: true,
    };
    zone.liveNodes.push(node);
  }

  // Track spawn state for respawning
  zone.nodeSpawnState.push({
    nodeType,
    activeCount,
    spawnLocations,
    respawnTime: nodeDef.respawnTime || 300,
    pendingRespawns: [], // { timer, usedLocations }
  });
}

function processMiningRespawns(zoneId, dt) {
  const zone = zoneInstances[zoneId];
  if (!zone || !zone.nodeSpawnState) return;

  for (const state of zone.nodeSpawnState) {
    // Count how many alive nodes of this type exist
    const aliveCount = zone.liveNodes.filter(n => n.nodeType === state.nodeType && n.alive).length;
    const deficit = state.activeCount - aliveCount - state.pendingRespawns.length;

    // Queue respawns for any missing nodes
    for (let i = 0; i < deficit; i++) {
      state.pendingRespawns.push({ timer: state.respawnTime });
    }

    // Tick down pending respawns
    for (let i = state.pendingRespawns.length - 1; i >= 0; i--) {
      state.pendingRespawns[i].timer -= dt;
      if (state.pendingRespawns[i].timer <= 0) {
        // Find a location not currently occupied by a live node
        const usedPositions = new Set(
          zone.liveNodes
            .filter(n => n.nodeType === state.nodeType && n.alive)
            .map(n => `${n.x},${n.y},${n.z}`)
        );
        const available = state.spawnLocations.filter(
          loc => !usedPositions.has(`${loc.x},${loc.y},${loc.z || 0}`)
        );

        if (available.length > 0) {
          const loc = available[Math.floor(Math.random() * available.length)];
          const nodeDef = MiningData.MINING_NODES[state.nodeType];
          const node = {
            id: `node_${state.nodeType}_${zoneId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            nodeType: state.nodeType,
            name: nodeDef.name,
            tier: nodeDef.tier,
            hp: nodeDef.hp,
            maxHp: nodeDef.hp,
            x: loc.x,
            y: loc.y,
            z: loc.z || 0,
            alive: true,
          };
          zone.liveNodes.push(node);
        }
        state.pendingRespawns.splice(i, 1);
      }
    }
  }

  // Clean up dead nodes from the array
  zone.liveNodes = zone.liveNodes.filter(n => n.alive);
}

function handleMine(session, msg) {
  const events = [];
  const char = session.char;
  const zone = zoneInstances[char.zoneId];
  if (!zone) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You cannot mine here.' }]);
    return;
  }

  // ── 1. Check for mining pick in PRIMARY slot ──
  let pickDef = null;
  let equippedItem = null;
  for (const row of session.inventory) {
    if (row.equipped === 1 && row.slot === 13) { // PRIMARY slot
      const itemDef = ITEMS[row.item_key] || ItemDB.getById(row.item_key);
      if (itemDef) {
        // Check by item ID first, then by name pattern
        pickDef = MiningData.PICK_BY_ITEM_ID[row.item_key];
        if (!pickDef) {
          const itemName = (itemDef.name || '').toLowerCase();
          if (itemName.includes('pick') && (itemName.includes('mining') || itemName.includes('forged') || itemName.includes('silvered') || itemName.includes('velium'))) {
            // Match by name to pick data
            const legacyKey = ItemDB.generateKey(itemDef.name);
            pickDef = MiningData.PICK_BY_ITEM_KEY[legacyKey];
          }
        }
        equippedItem = itemDef;
      }
      break;
    }
  }

  if (!pickDef) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You must equip a mining pick to mine.' }]);
    return;
  }

  // ── 2. Check mining cooldown (swing timer based on pick delay) ──
  if (!session.miningCooldown) session.miningCooldown = 0;
  if (session.miningCooldown > 0) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You are already swinging your pick...' }]);
    return;
  }
  session.miningCooldown = pickDef.delay / 10; // Convert delay to seconds

  // ── 3. Find target node ──
  const targetId = msg.targetId;
  if (!targetId) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You must target a mining node.' }]);
    return;
  }

  const nodeId = targetId.startsWith('node_') ? targetId : targetId;
  const node = zone.liveNodes.find(n => n.id === nodeId && n.alive);
  if (!node) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'That mining node is no longer available.' }]);
    return;
  }

  // ── 4. Proximity check ──
  const dx = (char.x || 0) - node.x;
  const dy = (char.y || 0) - node.y;
  const distSq = dx * dx + dy * dy;
  if (distSq > 625) { // Mining range
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You are too far away to mine that.' }]);
    session.miningCooldown = 0;
    return;
  }

  // ── 5. Tier gating ──
  const tierMult = MiningData.getTierMultiplier(pickDef.tier, node.tier);
  if (tierMult <= 0) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `Your ${pickDef.name || 'pick'} cannot penetrate the ${node.name}. You need a stronger pick.` }]);
    session.miningCooldown = 0;
    return;
  }

  // ── 6. Hit chance from mining skill ──
  const nodeDef = MiningData.MINING_NODES[node.nodeType];
  const miningSkill = combat.getCharSkill(char, 'mining');
  const hitChance = MiningData.getMiningHitChance(miningSkill, nodeDef.minSkill);
  const hitRoll = Math.random() * 100;

  // Try skill-up on every attempt (hit or miss)
  combat.trySkillUp(session, 'mining');

  if (hitRoll > hitChance) {
    // ── MISS ──
    events.push({ event: 'MINING_MISS', text: `Your pick glances off the ${node.name}.` });
    flushSkillUps(session);
    sendCombatLog(session, events);
    return;
  }

  // ── 7. Calculate and apply damage ──
  const baseDamage = pickDef.damage;
  const damage = Math.max(1, Math.floor(baseDamage * tierMult));
  node.hp -= damage;

  events.push({
    event: 'MINING_HIT',
    text: `You strike the ${node.name} for ${damage} damage. (${Math.max(0, node.hp)}/${node.maxHp} HP)`,
    nodeId: node.id,
    damage: damage,
    nodeHp: Math.max(0, node.hp),
    nodeMaxHp: node.maxHp,
  });

  // ── 8. Check for node depletion ──
  if (node.hp <= 0) {
    node.alive = false;

    // Roll loot
    const lootKey = MiningData.rollLoot(node.nodeType);
    let lootName = lootKey ? lootKey.replace(/_/g, ' ') : 'nothing';

    // Try to find the item in the database and give it to the player
    if (lootKey) {
      const lootItem = ITEMS[lootKey] || ItemDB.getByKey(lootKey);
      if (lootItem) {
        lootName = lootItem.name;
        // Add to player inventory
        const itemId = lootItem._id || lootKey;
        DB.addInventoryItem(char.id, itemId, 0, 0).then(() => {
          // Refresh inventory display
          DB.getInventory(char.id).then(inv => {
            session.inventory = inv;
            sendInventory(session);
          });
        });
      }
    }

    events.push({
      event: 'NODE_SHATTER',
      text: `The ${node.name} shatters! You receive: ${lootName}.`,
      nodeId: node.id,
      lootName: lootName,
    });

    // Broadcast node destruction to all players in the zone
    for (const [, s] of sessions) {
      if (s.char && s.char.zoneId === char.zoneId && s !== session) {
        send(s.ws, {
          type: 'NODE_DESTROYED',
          nodeId: node.id,
        });
      }
    }
  }

  flushSkillUps(session);
  sendCombatLog(session, events);
}

function processRespawns(zoneId) {
  const zone = zoneInstances[zoneId];
  if (!zone || !zone.spawnPointState) return;

  for (const spawn of zone.spawnPointState) {
    // Check if the mob at this specific point is alive
    const alive = zone.liveMobs.some(m => m.id === spawn.currentMobId);
    
    if (!alive) {
      if (spawn.respawnTimer === 0) {
        // Just died, start the timer using the spawn2 respawntime
        spawn.respawnTimer = Math.max(spawn.respawnTime || 420, 60); // Min 60s, default 7m
      }
      
      spawn.respawnTimer -= TICK_RATE / 1000;
      
      if (spawn.respawnTimer <= 0) {
        // Re-roll from the pool — a different NPC might spawn this time!
        let mobDef = spawn.mobDef;
        if (spawn.pool && spawn.pool.length > 0) {
          const picked = pickFromPool(spawn.pool);
          if (picked) {
            mobDef = {
              key: picked.npc_id.toString(),
              name: picked.name,
              level: picked.level,
              type: NPC_TYPES.MOB,
              pathgrid: spawn.pathgrid || 0,
              maxHp: picked.hp > 0 ? picked.hp : picked.level * 20,
              minDmg: picked.mindmg || Math.max(1, Math.floor(picked.level / 2)),
              maxDmg: picked.maxdmg || Math.max(4, picked.level * 2),
              attackDelay: 3,
              xpBase: picked.level * picked.level * 15,
              respawnTime: spawn.respawnTime
            };
            spawn.mobDef = mobDef; // Update cached def
            spawn.mobKey = mobDef.key;
          }
        }

        if (mobDef) {
          const newMob = spawnMob(zoneId, mobDef, spawn.x, spawn.y, spawn.z);
          if (newMob) {
            spawn.currentMobId = newMob.id;
            spawn.respawnTimer = 0; // Reset for next death cycle
          }
        }
      }
    }
  }
}

// ── Session Management ──────────────────────────────────────────────

async function createSession(ws, char) {
  // Map EQEmu short_name to our internal zone key (qeytoqrg → qeynos_hills)
  char.zoneId = resolveZoneKey(char.zoneId);

  // Ensure the player's zone is loaded (dynamically loads spawns if needed)
  await ensureZoneLoaded(char.zoneId);

  const inventory = await DB.getInventory(char.id);
  const spells = await DB.getSpells(char.id);
  const skillsList = await DB.getSkills(char.id);

  const skills = {};
  if (Array.isArray(skillsList)) {
    for (const row of skillsList) {
      skills[row.skill_id] = row.value;
    }
  }

  // ── Racial Skill Migration ──
  // Grant missing vision/starting skills from RACIAL_STARTING_SKILLS for this race
  const raceKey = char.race.toLowerCase().replace(/ /g, '_');
  const racialBonus = RACIAL_STARTING_SKILLS[raceKey];
  
  if (racialBonus) {
    let migrated = false;
    for (const [skillKey, value] of Object.entries(racialBonus)) {
      if (skills[skillKey] === undefined) {
        skills[skillKey] = value;
        migrated = true;
      }
    }
    if (migrated) {
      console.log(`[ENGINE] Migrated missing racial skills for ${char.name} (${char.race})`);
      // Persist immediately so it's not lost
      DB.saveCharacterSkills(char.id, skills);
    }
  }

  char.skills = skills;

  const session = {
    ws,
    char,
    inventory,
    spells,        // memorized gems (slot 0-7)
    spellbook: [],  // all scribed spells (bookSlot 0-791)
    effectiveStats: calcEffectiveStats(char, inventory),
    inCombat: false,
    autoFight: false,
    combatTarget: null,
    attackTimer: 0,
    buffs: [],
    casting: null,
    activeVisionMode: null,  // null = auto (racial/spell), or explicit mode key
  };

  // Load spellbook from file
  loadSpellbookFromFile(session);

  // Load persisted buffs (with elapsed-time calculation)
  loadBuffsFromFile(session);

  const zoneDef = getZoneDef(char.zoneId);
  if (!session.char.roomId && zoneDef && zoneDef.defaultRoom) {
      session.char.roomId = zoneDef.defaultRoom;
  }

  sessions.set(ws, session);

  // Ensure the player spawns at their stored coordinates
  if (char.x !== 0 || char.y !== 0) {
    session.pendingTeleport = { x: char.x, y: char.y, z: char.z || 0 };
  }

  return session;
}

function removeSession(ws) {
  const session = sessions.get(ws);
  if (session) {
    if (session.combatTarget) {
      session.combatTarget.target = null;
    }
    DB.updateCharacterState(session.char);
    DB.saveCharacterSkills(session.char.id, session.char.skills);
    saveBuffsToFile(session);
    // Despawn pet on disconnect
    if (session.pet) {
      despawnPet(session);
    }
    sessions.delete(ws);
  }
  authSessions.delete(ws);
}

// ── Message Handling ────────────────────────────────────────────────

async function handleMessage(ws, msg) {
  const session = sessions.get(ws);

  switch (msg.type) {
    case 'LOGIN_ACCOUNT': return await handleLoginAccount(ws, msg);
    case 'CREATE_ACCOUNT': return await handleCreateAccount(ws, msg);
    case 'SELECT_CHARACTER': return await handleSelectCharacter(ws, msg);
    case 'DELETE_CHARACTER': return await handleDeleteCharacter(ws, msg);
    case 'REQUEST_DEITIES': return await handleRequestDeities(ws, msg);
    case 'REQUEST_CHAR_CREATE_DATA': return await handleRequestCharCreateData(ws, msg);
    case 'LOGIN': return await handleLogin(ws, msg);
    case 'CREATE_CHARACTER': return await handleCreateCharacter(ws, msg);
  }

  if (!session) return send(ws, { type: 'ERROR', message: 'Not logged in.' });

  switch (msg.type) {
    case 'SIT': return handleSit(session);
    case 'STAND': return handleStand(session);
    case 'START_COMBAT': return handleStartCombat(session);
    case 'ATTACK_TARGET': return handleAttackTarget(session, msg);
    case 'STOP_COMBAT': return handleStopCombat(session);
    case 'SET_TARGET': return handleSetTarget(session, msg);
    case 'CLEAR_TARGET': return handleClearTarget(session);
    case 'UPDATE_RANGE': 
      session.isOutOfRange = msg.outOfRange;
      return;
    case 'CAST_SPELL': return handleCastSpell(session, msg);
    case 'EQUIP_ITEM': return handleEquipItem(session, msg);
    case 'UNEQUIP_ITEM': return handleUnequipItem(session, msg);
    case 'ZONE': return handleZone(session, msg);
    // 'MOVE' — removed (legacy room-grid system, 3D client uses UPDATE_POS)
    case 'UPDATE_POS': return handleUpdatePos(session, msg);
    case 'UPDATE_SNEAK': return handleUpdateSneak(session, msg);
    case 'USE_HIDE': return handleHide(session, msg);
    case 'CAMP': return handleCamp(session);
    case 'TRAIN_SKILL': return handleTrainSkill(session, parsed);
    case 'ABILITY': return handleAbility(session, msg);
    case 'SET_TACTIC': return handleTactic(session, msg);
    case 'HAIL': return handleHail(session, msg);
    case 'SAY': return handleSay(session, msg);
    case 'BUY': return handleBuy(session, msg);
    case 'SELL': return handleSell(session, msg);
    case 'NPC_GIVE_ITEMS': return handleNPCGiveItems(session, msg);
    case 'NPC_GIVE_CANCEL': 
      sendInventory(session);
      return;
    case 'DESTROY_ITEM': return handleDestroyItem(session, msg);
    case 'MOVE_ITEM': return handleMoveItem(session, msg);
    case 'AUTO_EQUIP': return handleAutoEquip(session, msg);
    case 'MEMORIZE_SPELL': return handleMemorizeSpell(session, msg);
    case 'FORGET_SPELL': return handleForgetSpell(session, msg);
    case 'SWAP_BOOK_SPELLS': return handleSwapBookSpells(session, msg);
    // 'LOOK' — removed (legacy MUD command, 3D client uses periodic ZONE_STATE sync)
    case 'SENSE_HEADING': {
      return handleSenseHeading(session);
    }
    case 'CONSIDER': return handleConsider(session);
    case 'EMOTE': return handleEmote(session, msg);
    case 'MINE': return handleMine(session, msg);
    case 'SET_VISION_MODE': return handleSetVisionMode(session, msg);
    case 'SUCCOR': return await handleSuccor(session);
    case 'PET_COMMAND': return handlePetCommand(session, msg);
    case 'DOOR_CLICK': return handleDoorClick(session, msg);
    // ── Chat Channels ──
    case 'SHOUT': return handleShout(session, msg);
    case 'OOC': return handleOOC(session, msg);
    case 'YELL': return handleYell(session, msg);
    case 'WHISPER': return handleWhisper(session, msg);
    case 'GROUP': return handleGroup(session, msg);
    case 'GUILD': return handleGuild(session, msg);
    case 'RAID': return handleRaid(session, msg);
    case 'ANNOUNCEMENT': return handleAnnouncement(session, msg);
    default:
      console.log(`[ENGINE] Unknown message type: ${msg.type}`);
  }
}

// ── Account Authentication ──────────────────────────────────────────

async function handleLoginAccount(ws, msg) {
  const username = (msg.username || '').trim();
  const password = msg.password || '';

  if (username.length < 2 || username.length > 30) {
    return send(ws, { type: 'ERROR', message: 'Account name must be 2-30 characters.' });
  }

  const result = await DB.loginAccount(username, password);
  if (!result) {
    return send(ws, { type: 'ERROR', message: 'Account not found.' });
  }
  if (result.error) {
    return send(ws, { type: 'ERROR', message: result.error });
  }

  // Store auth session (status >= 200 = GM/Admin in EQEmu convention)
  authSessions.set(ws, { accountId: result.id, accountName: result.name, status: result.status || 0 });

  // Send character list
  const characters = await DB.getCharactersByAccount(result.id);
  send(ws, { type: 'ACCOUNT_OK', accountName: result.name, characters });
  console.log(`[ENGINE] Account '${result.name}' logged in with ${characters.length} characters.`);
}

async function handleCreateAccount(ws, msg) {
  const username = (msg.username || '').trim();
  const password = msg.password || '';

  if (username.length < 2 || username.length > 30) {
    return send(ws, { type: 'ERROR', message: 'Account name must be 2-30 characters.' });
  }
  if (password.length < 4) {
    return send(ws, { type: 'ERROR', message: 'Password must be at least 4 characters.' });
  }

  const result = await DB.createAccount(username, password);
  if (result.error) {
    return send(ws, { type: 'ERROR', message: result.error });
  }

  // Auto-login after creation
  authSessions.set(ws, { accountId: result.id, accountName: result.name });
  send(ws, { type: 'ACCOUNT_OK', accountName: result.name, characters: [] });
  console.log(`[ENGINE] Account '${result.name}' created (id=${result.id}).`);
}

async function handleSelectCharacter(ws, msg) {
  const auth = authSessions.get(ws);
  if (!auth) {
    return send(ws, { type: 'ERROR', message: 'Not authenticated. Please login first.' });
  }

  const charName = msg.name;
  if (!charName) {
    return send(ws, { type: 'ERROR', message: 'No character name provided.' });
  }

  const char = await DB.getCharacter(charName);
  if (!char) {
    return send(ws, { type: 'ERROR', message: 'Character not found.' });
  }

  // Verify this character belongs to the authenticated account
  // (getCharacter doesn't return account_id, so we verify via the list)
  const characters = await DB.getCharactersByAccount(auth.accountId);
  const owns = characters.some(c => c.name === char.name);
  if (!owns) {
    return send(ws, { type: 'ERROR', message: 'That character does not belong to your account.' });
  }

  const session = await createSession(ws, char);
  
  // Safety: If inventory is empty, grant starter gear
  if (session.inventory.length === 0) {
    const starterItems = STARTER_GEAR[char.class] || STARTER_GEAR.warrior;
    for (const gear of starterItems) {
      await DB.addItem(char.id, gear.itemId, 1, gear.slot);
    }
    session.inventory = await DB.getInventory(char.id);
    console.log(`[ENGINE] Granted missing starter gear to ${char.name}.`);
  }

  console.log(`[ENGINE] ${char.name} entered world (level ${char.level} ${char.class}).`);
  sendFullState(session);
}

async function handleDeleteCharacter(ws, msg) {
  const auth = authSessions.get(ws);
  if (!auth) {
    return send(ws, { type: 'ERROR', message: 'Not authenticated.' });
  }

  const charName = msg.name;
  if (!charName) {
    return send(ws, { type: 'ERROR', message: 'No character name provided.' });
  }

  // Verify ownership
  const characters = await DB.getCharactersByAccount(auth.accountId);
  const target = characters.find(c => c.name === charName);
  if (!target) {
    return send(ws, { type: 'ERROR', message: 'Character not found or does not belong to your account.' });
  }

  // Delete from DB
  const eqemuDB = require('./eqemu_db');
  try {
    await eqemuDB.deleteCharacter(target.id);
  } catch (e) {
    return send(ws, { type: 'ERROR', message: 'Failed to delete character.' });
  }

  console.log(`[ENGINE] Character '${charName}' (id=${target.id}) deleted from account '${auth.accountName}'.`);

  // Send updated character list
  const updatedChars = await DB.getCharactersByAccount(auth.accountId);
  send(ws, { type: 'CHARACTER_DELETED', name: charName, characters: updatedChars });
}

// Authentic EQ deity names
const DEITY_NAMES = {
  201: 'Bertoxxulous', 202: 'Brell Serilis', 203: 'Cazic-Thule', 204: 'Erollisi Marr',
  205: 'Bristlebane', 206: 'Innoruuk', 207: 'Karana', 208: 'Mithaniel Marr',
  209: 'Prexus', 210: 'Quellious', 211: 'Rallos Zek', 212: 'Rodcet Nife',
  213: 'Solusek Ro', 214: 'The Tribunal', 215: 'Tunare', 216: 'Veeshan',
  396: 'Agnostic'
};

async function handleRequestDeities(ws, msg) {
  const raceId = msg.raceId || 1;
  const classId = msg.classId || 1;
  
  const deityIds = await DB.getValidDeities(raceId, classId);
  const deities = deityIds.map(id => ({ id, name: DEITY_NAMES[id] || `Unknown (${id})` }));
  
  send(ws, { type: 'DEITY_LIST', deities, raceId, classId });
}

async function handleRequestCharCreateData(ws, msg) {
  const raceId = msg.raceId || 1;
  const eqemuDB = require('./eqemu_db');
  const data = await eqemuDB.getCharCreateData(raceId);

  // Attach deity names for the client
  for (const cls of data.classes) {
    cls.deityNames = cls.deities.map(id => ({ id, name: DEITY_NAMES[id] || `Unknown (${id})` }));
  }

  // Scan for real face variant GLBs: {code}_face1.glb, {code}_face2.glb, etc.
  const fs = require('fs');
  const path = require('path');
  const raceModelsPath = path.join(__dirname, '..', 'eqmud', 'Data', 'race_models.json');
  const charsDir = path.join(__dirname, '..', 'eqmud', 'Data', 'Characters');
  let faceCountMale = 1, faceCountFemale = 1;
  try {
    const raceModels = JSON.parse(fs.readFileSync(raceModelsPath, 'utf8'));
    const entry = raceModels[String(raceId)];
    if (entry) {
      const countFaces = (code) => {
        try {
          const files = fs.readdirSync(charsDir);
          const pattern = new RegExp(`^${code}_face\\d+\\.glb$`, 'i');
          return 1 + files.filter(f => pattern.test(f)).length; // base + variants
        } catch { return 1; }
      };
      faceCountMale = countFaces(entry.m);
      faceCountFemale = countFaces(entry.f);
    }
  } catch (e) {
    console.log('[ENGINE] Could not scan face variants:', e.message);
  }
  data.faceCountMale = faceCountMale;
  data.faceCountFemale = faceCountFemale;

  send(ws, { type: 'CHAR_CREATE_DATA', ...data });
  console.log(`[ENGINE] Sent char create data for race ${raceId}: ${data.classes.length} classes, faces: M=${faceCountMale} F=${faceCountFemale}.`);
}

async function handleLogin(ws, msg) {
  const char = await DB.getCharacter(msg.name || 'Hero');
  if (!char) {
    send(ws, { type: 'ERROR', message: 'Character not found. Send CREATE_CHARACTER.' });
    return;
  }

  const session = await createSession(ws, char);

  // Safety: If inventory is empty, grant starter gear (fixes migration issues)
  if (session.inventory.length === 0) {
    const STARTER_GEAR = require('./data/items').STARTER_GEAR;
    const starterItems = STARTER_GEAR[char.class] || STARTER_GEAR.warrior;
    for (const gear of starterItems) {
      await DB.addItem(char.id, gear.itemId, 1, gear.slot);
    }
    session.inventory = await DB.getInventory(char.id);
    console.log(`[ENGINE] Granted missing starter gear to ${char.name}.`);
  }

  // Migration: Grant missing racial vision skills to existing characters
  let visionChanged = false;
  const racialSkills = RACIAL_STARTING_SKILLS[char.race] || {};
  const visionSkillKeys = ['normal_vision', 'weak_normal_vision', 'infravision', 'ultravision', 'cat_eye', 'serpent_sight'];
  for (const vSkill of visionSkillKeys) {
    if (racialSkills[vSkill]) {
      const val = combat.getCharSkill(char, vSkill);
      if (val <= 0) {
        if (!char.skills) char.skills = {};
        char.skills[vSkill] = 1;
        visionChanged = true;
      }
    }
  }
  if (visionChanged) {
    await DB.saveCharacterSkills(char.id, char.skills);
    console.log(`[ENGINE] Migrated missing vision skills for ${char.name}.`);
  }

  console.log(`[ENGINE] ${char.name} logged in (level ${char.level} ${char.class}).`);
  sendFullState(session);
}

async function handleCreateCharacter(ws, msg) {
  const auth = authSessions.get(ws);
  if (!auth) {
    return send(ws, { type: 'ERROR', message: 'Not authenticated. Please login first.' });
  }

  const name = msg.name || 'Hero';
  const charClass = msg.class || 'warrior';
  const race = msg.race || 'human';
  const deity = msg.deity || 396; // Default to Agnostic

  // Look up numeric IDs for validation
  const eqemuDB = require('./eqemu_db');
  const CLASSES_MAP = { warrior:1, cleric:2, paladin:3, ranger:4, shadow_knight:5, druid:6, monk:7, bard:8, rogue:9, shaman:10, necromancer:11, wizard:12, magician:13, enchanter:14, beastlord:15, berserker:16 };
  const RACES_MAP = { human:1, barbarian:2, erudite:3, wood_elf:4, high_elf:5, dark_elf:6, half_elf:7, dwarf:8, troll:9, ogre:10, halfling:11, gnome:12, iksar:128, vah_shir:130, froglok:330 };
  const raceId = RACES_MAP[race] || 1;
  const classId = CLASSES_MAP[charClass] || 1;

  // Validate race/class/deity combo against the DB
  const createData = await eqemuDB.getCharCreateData(raceId);
  const classEntry = createData.classes.find(c => c.classId === classId);
  if (!classEntry) {
    return send(ws, { type: 'ERROR', message: `${race} cannot be a ${charClass}.` });
  }
  if (!classEntry.deities.includes(deity)) {
    return send(ws, { type: 'ERROR', message: `That deity is not available for this race/class combination.` });
  }

  // Use DB base stats + player-allocated bonus points
  const dbAlloc = classEntry.allocation;
  const totalPool = (dbAlloc.alloc_str || 0) + (dbAlloc.alloc_sta || 0) + (dbAlloc.alloc_dex || 0) +
                    (dbAlloc.alloc_agi || 0) + (dbAlloc.alloc_int || 0) + (dbAlloc.alloc_wis || 0) +
                    (dbAlloc.alloc_cha || 0);

  // Accept player-allocated stats if provided, otherwise use DB defaults
  let allocStr, allocSta, allocDex, allocAgi, allocInt, allocWis, allocCha;
  if (msg.stats && typeof msg.stats === 'object') {
    allocStr = Math.max(0, msg.stats.str || 0);
    allocSta = Math.max(0, msg.stats.sta || 0);
    allocDex = Math.max(0, msg.stats.dex || 0);
    allocAgi = Math.max(0, msg.stats.agi || 0);
    allocInt = Math.max(0, msg.stats.int || 0);
    allocWis = Math.max(0, msg.stats.wis || 0);
    allocCha = Math.max(0, msg.stats.cha || 0);
    const spent = allocStr + allocSta + allocDex + allocAgi + allocInt + allocWis + allocCha;
    if (spent > totalPool) {
      return send(ws, { type: 'ERROR', message: `You spent ${spent} stat points but only have ${totalPool}.` });
    }
  } else {
    // Use DB default allocation
    allocStr = dbAlloc.alloc_str || 0;
    allocSta = dbAlloc.alloc_sta || 0;
    allocDex = dbAlloc.alloc_dex || 0;
    allocAgi = dbAlloc.alloc_agi || 0;
    allocInt = dbAlloc.alloc_int || 0;
    allocWis = dbAlloc.alloc_wis || 0;
    allocCha = dbAlloc.alloc_cha || 0;
  }

  const finalStats = {
    str: dbAlloc.base_str + allocStr,
    sta: dbAlloc.base_sta + allocSta,
    agi: dbAlloc.base_agi + allocAgi,
    dex: dbAlloc.base_dex + allocDex,
    wis: dbAlloc.base_wis + allocWis,
    intel: dbAlloc.base_int + allocInt,
    cha: dbAlloc.base_cha + allocCha,
  };

  // Compute starting HP/mana from the classic EQ formulas
  const startHp = combat.calcMaxHP(charClass, 1, finalStats.sta);
  const startMana = combat.calcMaxMana(charClass, 1, finalStats);

  // Extract appearance fields from client
  const appearance = {
    gender:    msg.gender    || 0,
    face:      msg.face      || 0,
    hairStyle: msg.hairStyle || 0,
    hairColor: msg.hairColor || 0,
    beard:     msg.beard     || 0,
    beardColor:msg.beardColor|| 0,
    eyeColor:  msg.eyeColor  || 0,
  };

  const createResult = await DB.createCharacter(
     auth.accountId, name, charClass, race, deity,
     finalStats.str, finalStats.sta, finalStats.agi, finalStats.dex, finalStats.wis, finalStats.intel, finalStats.cha,
     startHp, startMana, appearance
  );

  if (createResult && createResult.error) {
    return send(ws, { type: 'ERROR', message: createResult.error });
  }

  const char = await DB.getCharacter(name);

  // Give starter gear
  const starterItems = STARTER_GEAR[charClass] || STARTER_GEAR.warrior;
  for (const gear of starterItems) {
    await DB.addItem(char.id, gear.itemId, 1, gear.slot);
  }

  // Give starter spells — canonical EQ guild master hand-out (1-2 spells only)
  // Players must buy/scribe additional spells from spell vendors
  const STARTER_SPELLS = {
    cleric:       ['minor_healing', 'strike'],
    wizard:       ['frost_bolt', 'minor_shielding'],
    necromancer:  ['lifetap', 'minor_shielding'],
    enchanter:    ['lull', 'minor_shielding'],
    magician:     ['flare', 'minor_shielding'],
    druid:        ['minor_healing', 'snare'],
    shaman:       ['minor_healing', 'inner_fire'],
    bard:         ['chant_of_battle'],
    ranger:       ['salve'],
    paladin:      ['salve'],
    shadow_knight:['spike_of_disease'],
    // Melee classes — no starting spells
    warrior:      [],
    monk:         [],
    rogue:        [],
  };

  const starterKeys = STARTER_SPELLS[charClass] || [];
  if (starterKeys.length > 0) {
    let slotIdx = 0;
    for (const key of starterKeys) {
      const spellDef = SpellDB.getByKey(key);
      if (spellDef) {
        DB.memorizeSpell(char.id, spellDef._key, slotIdx++);
      } else {
        console.warn(`[ENGINE] Starter spell '${key}' not found in spell DB for ${charClass}`);
      }
    }
    console.log(`[ENGINE] Gave ${slotIdx} starter spells to ${charClass} "${name}": ${starterKeys.join(', ')}`);
  }

  console.log(`[ENGINE] Created ${charClass} "${name}" (${race}) on account '${auth.accountName}' with stats STR=${finalStats.str} STA=${finalStats.sta} AGI=${finalStats.agi} DEX=${finalStats.dex} WIS=${finalStats.wis} INT=${finalStats.intel} CHA=${finalStats.cha}.`);

  // Apply racial starting skill bonuses (e.g., Dwarves +10 Mining)
  const racialSkills = RACIAL_STARTING_SKILLS[race];
  if (racialSkills) {
    await DB.saveCharacterSkills(char.id, racialSkills);
    console.log(`[ENGINE] Applied racial skill bonuses for ${race}: ${JSON.stringify(racialSkills)}`);
  }

  // Send updated character list back to character select
  const characters = await DB.getCharactersByAccount(auth.accountId);
  send(ws, { type: 'CHARACTER_CREATED', name: char.name, characters });
}

function handleDoorClick(session, msg) {
  const doorId = msg.door_id;
  console.log(`[ENGINE] ${session.char.name} interacted with door ${doorId} in ${session.char.zoneId}`);

  const zone = zoneInstances[session.char.zoneId];
  if (!zone || !zone.doors) return;

  // Find the clicked door using its primary key 'id'
  console.log(`[ENGINE] Searching for door with id ${doorId} (type: ${typeof doorId})`);
  const clickedDoor = zone.doors.find(d => d.id === doorId);
  if (!clickedDoor) {
    console.log(`[ENGINE] Failed to find door with id ${doorId}! Available ids: ${zone.doors.map(d => d.id).slice(0, 10).join(', ')}...`);
    return;
  }

  // Check if it triggers another door (like an elevator button)
  // triggerdoor links to the target's local zone 'doorid', NOT the primary key 'id'
  let targetDoor = clickedDoor;
  if (clickedDoor.triggerdoor && clickedDoor.triggerdoor > 0) {
    targetDoor = zone.doors.find(d => d.doorid === clickedDoor.triggerdoor) || clickedDoor;
  }

  // Toggle state using the primary key 'id'
  let doorState = zone.doorStates[targetDoor.id];
  if (!doorState) {
    doorState = { isOpen: false, closeTimer: null };
    zone.doorStates[targetDoor.id] = doorState;
  }

  // If it's already in motion/open and we don't want to interrupt, we just return.
  // Actually, EQ elevators don't respond while moving, but if they are static and open, they stay open or auto close.
  // We'll toggle it.
  doorState.isOpen = !doorState.isOpen;

  console.log(`[ENGINE] Door ${targetDoor.id} (${targetDoor.name}) state changed to ${doorState.isOpen}`);

  // Broadcast to all players in the zone using the primary key 'id'
  const payload = JSON.stringify({
    type: 'DOOR_STATE_CHANGE',
    doorId: targetDoor.id,
    isOpen: doorState.isOpen
  });

  for (const [, client] of sessions) {
    if (client.char && client.char.zoneId === session.char.zoneId && client.ws.readyState === 1) {
      client.ws.send(payload);
    }
  }

  // Auto-close elevators after 10 seconds (standard EQ logic)
  if (targetDoor.opentype === 59 || targetDoor.opentype === 54 || targetDoor.name.includes("LEVATOR")) {
    if (doorState.closeTimer) clearTimeout(doorState.closeTimer);
    
    // Only auto-close if it just opened
    if (doorState.isOpen) {
      doorState.closeTimer = setTimeout(() => {
        if (zone.doorStates[targetDoor.id]) {
          zone.doorStates[targetDoor.id].isOpen = false;
          const closePayload = JSON.stringify({
            type: 'DOOR_STATE_CHANGE',
            doorId: targetDoor.id,
            isOpen: false
          });
          for (const [, client] of sessions) {
            if (client.char && client.char.zoneId === session.char.zoneId && client.ws.readyState === 1) {
              client.ws.send(closePayload);
            }
          }
        }
      }, 15000); // 15 seconds
    }
  }
}

function handleSit(session) {
  if (session.autoFight) {
    return sendCombatLog(session, [{ event: 'MESSAGE', text: 'You must stop attacking before sitting.' }]);
  }
  session.char.state = 'medding';
  sendCombatLog(session, [{ event: 'MESSAGE', text: 'You sit down and begin to rest.' }]);
  sendStatus(session);
}

function handleStand(session) {
  session.char.state = 'standing';
  sendCombatLog(session, [{ event: 'MESSAGE', text: 'You stand up.' }]);
  sendStatus(session);
}

function handleStartCombat(session) {
  if (session.char.state === 'medding') {
    session.char.state = 'standing';
  }

  // Only engage if we already have a combat target set via ATTACK_TARGET
  if (session.combatTarget && !session.inCombat) {
    session.inCombat = true;
    session.autoFight = true;
    // Don't set mob.target here — mob only aggros when first melee hit lands in range
    session.attackTimer = 0;
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You engage ${session.combatTarget.name}!` }]);
  } else if (!session.combatTarget) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You have no target to attack.' }]);
  }
  sendStatus(session);
}

function handleStopCombat(session) {
  session.autoFight = false;
  session.inCombat = false;
  session.combatTarget = null;
  sendCombatLog(session, [{ event: 'MESSAGE', text: 'You cease your attack.' }]);
  sendStatus(session);
}

function handleSetTarget(session, msg) {
  const targetId = msg.targetId;
  if (!targetId) return;

  const mobId = targetId.startsWith('mob_') ? targetId.substring(4) : targetId;
  const zone = zoneInstances[session.char.zoneId];
  if (!zone || !zone.liveMobs) return;

  // Check if targeting a mining node
  if (targetId.startsWith('node_') && zone.liveNodes) {
    const node = zone.liveNodes.find(n => n.id === targetId && n.alive);
    if (node) {
      session.miningTarget = node;
      session.combatTarget = null; // Can't combat-target a rock
      send(session.ws, {
        type: 'TARGET_UPDATE',
        target: {
          id: node.id,
          name: node.name,
          hp: node.hp,
          maxHp: node.maxHp,
          level: node.tier,
          type: 'mining_node',
        },
      });
      return;
    }
  }

  session.miningTarget = null; // Clear mining target when targeting a mob

  let mob = zone.liveMobs.find(m => m.id === mobId || m.id === targetId);
  if (mob) {
    // Only set as informational target — never starts combat
    // combatTarget is set here for spells/info, but autoFight stays false
    if (!session.autoFight) {
      session.combatTarget = mob;
    }
    sendStatus(session);
  }
}

function handleClearTarget(session) {
  // If actively fighting, stop combat first
  if (session.autoFight) {
      handleStopCombat(session);
  }
  session.combatTarget = null;
  sendStatus(session);
}

function handleAttackTarget(session, msg) {
  const targetId = msg.targetId;
  if (!targetId) {
    // No target specified, fall back to auto-engage
    return handleStartCombat(session);
  }

  // targetId from the client is like "mob_a_fire_beetle_1234_ab12"
  // Strip the "mob_" prefix to get the actual mob ID
  const mobId = targetId.startsWith('mob_') ? targetId.substring(4) : targetId;

  const zone = zoneInstances[session.char.zoneId];
  if (!zone || !zone.liveMobs) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'There is nothing to fight here.' }]);
    return;
  }

  let mob = zone.liveMobs.find(m => m.id === mobId || m.id === targetId);
  
  if (!mob) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'Your target is no longer available.' }]);
    return;
  }

  // Prevent attacking non-mob NPCs (merchants, quest givers, etc.)
  if (mob.npcType && mob.npcType !== NPC_TYPES.MOB) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You cannot attack ${mob.name}. Try hailing them instead.` }]);
    return;
  }

  if (mob.target && mob.target !== session) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `${mob.name} is already engaged by another player.` }]);
    return;
  }

  session.inCombat = true;
  session.autoFight = true;
  session.combatTarget = mob;
  // NOTE: Do NOT set mob.target here — mob only becomes aggressive
  // when the player's first melee swing actually goes through in range.
  // This prevents aggro from cycling targets with auto-attack on.
  session.attackTimer = 0;

  sendCombatLog(session, [{ event: 'MESSAGE', text: `You engage ${mob.name}!` }]);
  sendStatus(session);
}

function engageNextMob(session) {
  const zone = zoneInstances[session.char.zoneId];
  if (!zone || zone.liveMobs.length === 0) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'There is nothing to fight here.' }]);
    return false;
  }

  // Only auto-engage hostile mobs, skip NPCs
  const mob = zone.liveMobs.find(m => m.target === null && (m.roomId === session.char.roomId || !m.roomId) && (!m.npcType || m.npcType === NPC_TYPES.MOB));
  if (!mob) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'All targets are engaged.' }]);
    return false;
  }

  session.inCombat = true;
  session.combatTarget = mob;
  mob.target = session;
  session.attackTimer = 0;

  sendCombatLog(session, [{ event: 'MESSAGE', text: `You engage ${mob.name}!` }]);
  sendStatus(session);
  return true;
}

async function handleCastSpell(session, msg) {
  const slotIndex = msg.slot;
  const spellRow = session.spells.find(s => s.slot === slotIndex);
  if (!spellRow) return;

  const spellDef = SPELLS[spellRow.spell_key];
  if (!spellDef) return;

  // Can't cast while already casting
  if (session.casting) {
    return sendCombatLog(session, [{ event: 'MESSAGE', text: 'You are already casting a spell!' }]);
  }

  if (session.char.mana < spellDef.manaCost) {
    return sendCombatLog(session, [{ event: 'MESSAGE', text: 'Insufficient mana.' }]);
  }
  if (session.char.state === 'medding') {
    return sendCombatLog(session, [{ event: 'MESSAGE', text: 'You must stand before casting!' }]);
  }

  // Range check for offensive spells
  const spellRange = spellDef.range?.range || 200;
  if (spellDef.target === 'enemy') {
    if (!session.combatTarget) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: 'You must have a target to cast that spell.' }]);
    }
    // Check distance to target mob
    const mob = session.combatTarget;
    if (mob.x != null && session.char.x != null) {
      const dx = session.char.x - mob.x;
      const dy = session.char.y - mob.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > spellRange * spellRange) {
        return sendCombatLog(session, [{ event: 'MESSAGE', text: 'Your target is out of range.' }]);
      }
    }
  }

  // Calculate cast time in seconds (EQ data stores milliseconds)
  const castTimeSec = (spellDef.timing?.castTime || 1500) / 1000;

  // Deduct mana up front (classic EQ behavior)
  session.char.mana -= spellDef.manaCost;

  // Casting breaks sneak and hide
  breakSneak(session);
  breakHide(session);

  // Record cast-start position for movement interruption detection
  const castStartPos = { x: session.char.x || 0, y: session.char.y || 0 };

  // Instant-cast spells (0 cast time) fire immediately
  if (castTimeSec <= 0) {
    await applySpellEffect(session, spellDef, spellRow.spell_key);
    session.ws.send(JSON.stringify({ type: 'CAST_COMPLETE', spellName: spellDef.name }));
    sendStatus(session);
    return;
  }

  // Start casting state
  session.casting = {
    spellDef,
    spellKey: spellRow.spell_key,
    slotIndex,
    castTime: castTimeSec,
    elapsed: 0,
    startPos: castStartPos,
  };

  // Notify client to show cast bar
  session.ws.send(JSON.stringify({
    type: 'CAST_START',
    spellName: spellDef.name,
    castTime: castTimeSec,
    slot: slotIndex,
  }));

  sendCombatLog(session, [{ event: 'MESSAGE', text: `You begin casting ${spellDef.name}.` }]);
  sendStatus(session);
}

/**
 * Process ongoing casting each tick.
 * Called from the main game loop for every session.
 */
async function processCasting(session, dt) {
  if (!session.casting) return;

  session.casting.elapsed += dt;

  // Check if cast is complete
  if (session.casting.elapsed >= session.casting.castTime) {
    const { spellDef, spellKey } = session.casting;
    session.casting = null;

    await applySpellEffect(session, spellDef, spellKey);
    session.ws.send(JSON.stringify({ type: 'CAST_COMPLETE', spellName: spellDef.name }));
    sendStatus(session);
  }
}

/**
 * Attempt to interrupt a casting spell (called when player takes damage).
 * Classic EQ interruption: roughly 75% base chance, modified by level difference.
 */
function tryInterruptCasting(session, source) {
  if (!session.casting) return;

  // Base 75% interrupt chance, reduced by level (higher level = harder to interrupt)
  const interruptChance = Math.max(0.25, 0.75 - (session.char.level * 0.005));
  if (Math.random() < interruptChance) {
    interruptCasting(session, `Your spell is interrupted!`);
  }
}

/**
 * Force-interrupt the current cast (movement, death, etc.)
 */
function interruptCasting(session, message) {
  if (!session.casting) return;
  const spellName = session.casting.spellDef.name;
  session.casting = null;

  session.ws.send(JSON.stringify({ type: 'CAST_INTERRUPTED', spellName }));
  sendCombatLog(session, [{ event: 'MESSAGE', text: message || 'Your spell is interrupted!' }]);
  sendStatus(session);
}

async function applySpellEffect(session, spellDef, spellKey) {
  const events = [];

  switch (spellDef.effect) {
    case 'heal': {
      const healAmt = spellDef.amount || 10;
      session.char.hp = Math.min(session.char.hp + healAmt, session.effectiveStats.hp);
      events.push({ event: 'SPELL_HEAL', source: 'You', target: 'You', spell: spellDef.name, amount: healAmt });
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
      
      let dmg = spellDef.damage || 10;
      if (resistResult === 'PARTIAL_RESIST') dmg = Math.floor(dmg / 2);

      mob.hp -= dmg;
      events.push({ event: 'SPELL_DAMAGE', source: 'You', target: mob.name, spell: spellDef.name, damage: dmg });
      if (mob.hp <= 0) {
        await handleMobDeath(session, mob, events);
      }
      break;
    }
    case 'buff': {
      session.buffs = session.buffs.filter(b => b.name !== spellDef.buffName);
      session.buffs.push({
        name: spellDef.buffName,
        duration: spellDef.duration,
        maxDuration: spellDef.duration,
        beneficial: true,
        effects: spellDef.effects || [],  // Store full SPA effects array
        ac: spellDef.ac || 0,             // Legacy fallback
      });
      const buffMsg = spellDef.messages?.castOnYou || `You feel ${spellDef.buffName} take hold.`;
      events.push({ event: 'MESSAGE', text: buffMsg });
      // Recalculate effective stats so buff actually modifies HP/AC/stats
      session.effectiveStats = calcEffectiveStats(session.char, session.inventory, session.buffs);
      session.char.maxHp = session.effectiveStats.hp;
      session.char.maxMana = session.effectiveStats.mana;
      sendBuffs(session);
      sendStatus(session);
      break;
    }
    case 'cure': {
      // Remove poison and disease debuffs from player
      const beforeCount = session.buffs.length;
      const cureSpas = (spellDef.effects || []).map(e => e.spa);
      // Cure poison (SPA 35), cure disease (SPA 36)
      const curesPoison = cureSpas.includes(35) || spellDef.name.toLowerCase().includes('poison') || spellDef.name.toLowerCase().includes('antidote');
      const curesDisease = cureSpas.includes(36) || spellDef.name.toLowerCase().includes('disease');
      const curesAll = spellDef.name.toLowerCase().includes('blood') || spellDef.name.toLowerCase().includes('aura');
      
      session.buffs = session.buffs.filter(b => {
        if (b.beneficial) return true; // Keep beneficial buffs
        if (curesAll) return false; // Remove all debuffs
        // Check if debuff has matching poison/disease effects
        if (Array.isArray(b.effects)) {
          const hasPois = b.effects.some(e => e.spa === 35);
          const hasDis = b.effects.some(e => e.spa === 36);
          if (curesPoison && hasPois) return false;
          if (curesDisease && hasDis) return false;
        }
        return true;
      });
      
      if (session.buffs.length < beforeCount) {
        events.push({ event: 'MESSAGE', text: 'You feel the ailment leave your body.' });
        session.effectiveStats = calcEffectiveStats(session.char, session.inventory, session.buffs);
        sendBuffs(session);
      } else {
        events.push({ event: 'MESSAGE', text: 'You feel a brief rush of cleansing energy.' });
      }
      break;
    }
    case 'root':
      if (session.combatTarget) {
        const mob = session.combatTarget;
        const resistResult = combat.calcSpellResist(mob, session.char.level, spellDef.resistType, spellDef.resistAdjust);
        if (resistResult === 'FULL_RESIST') {
          events.push({ event: 'RESIST', target: mob.name, spell: spellDef.name });
        } else {
          events.push({ event: 'MESSAGE', text: `${mob.name} has been rooted to the ground!` });
        }
      } else {
        events.push({ event: 'MESSAGE', text: 'You must have a target to cast that spell.' });
      }
      break;
    case 'dot': {
      if (!session.combatTarget) {
        events.push({ event: 'MESSAGE', text: 'You must have a target to cast that spell.' });
        break;
      }
      const dotMob = session.combatTarget;
      const dotResist = combat.calcSpellResist(dotMob, session.char.level, spellDef.resistType, spellDef.resistAdjust);
      if (dotResist === 'FULL_RESIST') {
        events.push({ event: 'RESIST', target: dotMob.name, spell: spellDef.name });
      } else {
        if (!dotMob.buffs) dotMob.buffs = [];
        dotMob.buffs = dotMob.buffs.filter(b => b.name !== spellDef.buffName);
        const dotDmg = Math.abs(spellDef.damage || 5);
        dotMob.buffs.push({
          name: spellDef.buffName,
          duration: dotResist === 'PARTIAL_RESIST' ? Math.floor(spellDef.duration / 2) : spellDef.duration,
          maxDuration: spellDef.duration,
          beneficial: false,
          effects: spellDef.effects || [],
          tickDamage: dotResist === 'PARTIAL_RESIST' ? Math.floor(dotDmg / 2) : dotDmg,
          tickInterval: 6,    // Classic EQ: 1 tick = 6 seconds
          tickTimer: 6,       // Time until next tick
          casterSession: session.char.name,
        });
        events.push({ event: 'MESSAGE', text: `${dotMob.name} has been afflicted by ${spellDef.name}!` });
      }
      break;
    }
    case 'info':
      events.push({ event: 'MESSAGE', text: spellDef.description });
      break;
    // Duration-based beneficial effects — apply as buffs with SPA effects
    case 'haste':
    case 'rune':
    case 'damageShield':
    case 'hot': {
      session.buffs = session.buffs.filter(b => b.name !== spellDef.buffName);
      session.buffs.push({
        name: spellDef.buffName,
        duration: spellDef.duration,
        maxDuration: spellDef.duration,
        beneficial: true,
        effects: spellDef.effects || [],
        ac: spellDef.ac || 0,
      });
      const msg2 = spellDef.messages?.castOnYou || `You feel ${spellDef.buffName} take hold.`;
      events.push({ event: 'MESSAGE', text: msg2 });
      session.effectiveStats = calcEffectiveStats(session.char, session.inventory, session.buffs);
      session.char.maxHp = session.effectiveStats.hp;
      session.char.maxMana = session.effectiveStats.mana;
      sendBuffs(session);
      sendStatus(session);
      break;
    }
    // Debuffs / enemy-targeted duration spells
    case 'snare':
    case 'debuff':
    case 'slow': {
      if (!session.combatTarget) {
        events.push({ event: 'MESSAGE', text: 'You must have a target to cast that spell.' });
        break;
      }
      const tgt = session.combatTarget;
      const rr = combat.calcSpellResist(tgt, session.char.level, spellDef.resistType, spellDef.resistAdjust);
      if (rr === 'FULL_RESIST') {
        events.push({ event: 'RESIST', target: tgt.name, spell: spellDef.name });
      } else {
        // Apply debuff to mob's buff array
        if (!tgt.buffs) tgt.buffs = [];
        tgt.buffs = tgt.buffs.filter(b => b.name !== spellDef.buffName);
        tgt.buffs.push({
          name: spellDef.buffName,
          duration: rr === 'PARTIAL_RESIST' ? Math.floor(spellDef.duration / 2) : spellDef.duration,
          maxDuration: spellDef.duration,
          beneficial: false,
          effects: spellDef.effects || [],
        });
        const debuffVerb = spellDef.effect === 'snare' ? 'has been snared' :
                           spellDef.effect === 'slow' ? 'has been slowed' : 'looks weakened';
        events.push({ event: 'MESSAGE', text: `${tgt.name} ${debuffVerb}!` });
      }
      break;
    }
    case 'lull': {
      if (!session.combatTarget) {
        events.push({ event: 'MESSAGE', text: 'You must have a target to cast that spell.' });
        break;
      }
      const lullTgt = session.combatTarget;
      const lr = combat.calcSpellResist(lullTgt, session.char.level, spellDef.resistType, spellDef.resistAdjust);
      if (lr === 'FULL_RESIST') {
        events.push({ event: 'RESIST', target: lullTgt.name, spell: spellDef.name });
      } else {
        events.push({ event: 'MESSAGE', text: `${lullTgt.name} looks less aggressive.` });
      }
      break;
    }
    // Crowd Control: Mesmerize
    case 'mez': {
      if (!session.combatTarget) {
        events.push({ event: 'MESSAGE', text: 'You must have a target to cast that spell.' });
        break;
      }
      const mezMob = session.combatTarget;
      const mezResist = combat.calcSpellResist(mezMob, session.char.level, spellDef.resistType, spellDef.resistAdjust);
      if (mezResist === 'FULL_RESIST') {
        events.push({ event: 'RESIST', target: mezMob.name, spell: spellDef.name });
      } else {
        if (!mezMob.buffs) mezMob.buffs = [];
        mezMob.buffs = mezMob.buffs.filter(b => b.name !== spellDef.buffName);
        const mezDur = mezResist === 'PARTIAL_RESIST' ? Math.floor(spellDef.duration / 2) : spellDef.duration;
        mezMob.buffs.push({
          name: spellDef.buffName,
          duration: mezDur,
          maxDuration: spellDef.duration,
          beneficial: false,
          effects: spellDef.effects || [],
          isMez: true,
        });
        // Mez stops the mob from attacking
        mezMob.target = null;
        events.push({ event: 'MESSAGE', text: `${mezMob.name} has been mesmerized!` });
        // Drop combat if this was the only target
        if (session.combatTarget === mezMob) {
          session.inCombat = false;
          session.autoFight = false;
          session.combatTarget = null;
        }
      }
      break;
    }
    // Crowd Control: Fear
    case 'fear': {
      if (!session.combatTarget) {
        events.push({ event: 'MESSAGE', text: 'You must have a target to cast that spell.' });
        break;
      }
      const fearMob = session.combatTarget;
      const fearResist = combat.calcSpellResist(fearMob, session.char.level, spellDef.resistType, spellDef.resistAdjust);
      if (fearResist === 'FULL_RESIST') {
        events.push({ event: 'RESIST', target: fearMob.name, spell: spellDef.name });
      } else {
        if (!fearMob.buffs) fearMob.buffs = [];
        fearMob.buffs = fearMob.buffs.filter(b => b.name !== spellDef.buffName);
        fearMob.buffs.push({
          name: spellDef.buffName,
          duration: fearResist === 'PARTIAL_RESIST' ? Math.floor(spellDef.duration / 2) : spellDef.duration,
          maxDuration: spellDef.duration,
          beneficial: false,
          effects: spellDef.effects || [],
          isFear: true,
        });
        fearMob.target = null; // Feared mobs stop attacking
        events.push({ event: 'MESSAGE', text: `${fearMob.name} flees in terror!` });
      }
      break;
    }
    // Crowd Control: Stun
    case 'stun': {
      if (!session.combatTarget) {
        events.push({ event: 'MESSAGE', text: 'You must have a target to cast that spell.' });
        break;
      }
      const stunMob = session.combatTarget;
      const stunResist = combat.calcSpellResist(stunMob, session.char.level, spellDef.resistType, spellDef.resistAdjust);
      if (stunResist === 'FULL_RESIST') {
        events.push({ event: 'RESIST', target: stunMob.name, spell: spellDef.name });
      } else {
        if (!stunMob.buffs) stunMob.buffs = [];
        stunMob.buffs.push({
          name: spellDef.buffName,
          duration: spellDef.duration || 6,
          maxDuration: spellDef.duration || 6,
          beneficial: false,
          effects: spellDef.effects || [],
          isStun: true,
        });
        events.push({ event: 'MESSAGE', text: `${stunMob.name} has been stunned!` });
      }
      break;
    }
    // Charm — convert targeted mob into a controllable charmed pet
    case 'charm': {
      if (!session.combatTarget) {
        events.push({ event: 'MESSAGE', text: 'You must have a target to cast that spell.' });
        break;
      }
      const charmTarget = session.combatTarget;
      if (charmTarget.isPet) {
        events.push({ event: 'MESSAGE', text: 'You cannot charm a pet.' });
        break;
      }
      if (charmTarget.npcType && charmTarget.npcType !== NPC_TYPES.MOB) {
        events.push({ event: 'MESSAGE', text: 'You cannot charm that target.' });
        break;
      }
      const charmResist = combat.calcSpellResist(charmTarget, session.char.level, spellDef.resistType, spellDef.resistAdjust);
      if (charmResist === 'FULL_RESIST') {
        events.push({ event: 'RESIST', target: charmTarget.name, spell: spellDef.name });
      } else {
        const charmEvents = charmMob(session, charmTarget, spellDef);
        events.push(...charmEvents);
      }
      break;
    }
    // Invisibility — self buff
    case 'invisibility': {
      session.buffs = session.buffs.filter(b => b.name !== spellDef.buffName);
      session.buffs.push({
        name: spellDef.buffName,
        duration: spellDef.duration,
        maxDuration: spellDef.duration,
        beneficial: true,
        effects: spellDef.effects || [],
      });
      const invisMsg = spellDef.messages?.castOnYou || 'You fade from sight.';
      events.push({ event: 'MESSAGE', text: invisMsg });
      sendBuffs(session);
      break;
    }
    // Lifetap — damage target + heal self
    case 'lifetap':
    case 'lifetapDot': {
      if (!session.combatTarget) {
        events.push({ event: 'MESSAGE', text: 'You must have a target to cast that spell.' });
        break;
      }
      const ltMob = session.combatTarget;
      const ltResist = combat.calcSpellResist(ltMob, session.char.level, spellDef.resistType, spellDef.resistAdjust);
      if (ltResist === 'FULL_RESIST') {
        events.push({ event: 'RESIST', target: ltMob.name, spell: spellDef.name });
      } else {
        let ltDmg = Math.abs(spellDef.damage || 10);
        if (ltResist === 'PARTIAL_RESIST') ltDmg = Math.floor(ltDmg / 2);
        ltMob.hp -= ltDmg;
        session.char.hp = Math.min(session.char.hp + ltDmg, session.effectiveStats.hp);
        events.push({ event: 'SPELL_DAMAGE', source: 'You', target: ltMob.name, spell: spellDef.name, damage: ltDmg });
        events.push({ event: 'SPELL_HEAL', source: 'You', target: 'You', spell: spellDef.name, amount: ltDmg });
        if (ltMob.hp <= 0) {
          await handleMobDeath(session, ltMob, events);
        }
      }
      break;
    }
    // Dispel — remove a buff from target
    case 'dispel': {
      if (!session.combatTarget) {
        events.push({ event: 'MESSAGE', text: 'You must have a target to cast that spell.' });
        break;
      }
      const dispelMob = session.combatTarget;
      if (Array.isArray(dispelMob.buffs) && dispelMob.buffs.length > 0) {
        const removed = dispelMob.buffs.shift(); // Remove first (top) buff
        events.push({ event: 'MESSAGE', text: `${removed.name} has been dispelled from ${dispelMob.name}!` });
      } else {
        events.push({ event: 'MESSAGE', text: `${dispelMob.name} has no effects to dispel.` });
      }
      break;
    }
    // Mana drain
    case 'manaDrain': {
      if (!session.combatTarget) {
        events.push({ event: 'MESSAGE', text: 'You must have a target to cast that spell.' });
        break;
      }
      // For our MUD, mana drain on mobs is just flavor (mobs don't have mana)
      events.push({ event: 'MESSAGE', text: `You drain mana from ${session.combatTarget.name}!` });
      break;
    }
    // Utility spells — sub-classified by SPA effects
    case 'utility': {
      const spaIds = (spellDef.effects || []).map(e => e.spa);
      const spaNames = (spellDef.effects || []).map(e => e.spaName);

      // SPA 71 (summonSkeleton) = Necro/SK pet spells misclassified as utility
      if (spaIds.includes(71)) {
        // Redirect to pet summoning
        const skelPetDef = PET_SPELLS[spellDef._spellId || spellDef.id];
        if (skelPetDef) {
          // Check for reagent (Bone Chips)
          if (skelPetDef.reagent) {
            const hasReagent = session.inventory.some(i => {
              const def = ItemDB.getById(i.item_key);
              return def && def.name && def.name.toLowerCase().includes(skelPetDef.reagent.name.toLowerCase());
            });
            if (!hasReagent) {
              events.push({ event: 'MESSAGE', text: `You need ${skelPetDef.reagent.name} to cast this spell.` });
              break;
            }
          }
          const result = spawnPet(session, skelPetDef, spellDef);
          events.push(...result.events);
        } else {
          events.push({ event: 'MESSAGE', text: 'You summon a creature, but the binding fails.' });
        }
        break;
      }
      
      // Portal/Ring/Translocate/Evacuate spells (SPA 83, shadowStep, or changeAggro with teleportZone)
      const hasTeleportZone = spellDef.links?.teleportZone && spellDef.links.teleportZone.length > 0;
      if (hasTeleportZone && (spaIds.includes(83) || spaNames.includes('shadowStep') || spaNames.includes('changeAggro'))) {
        const targetZone = spellDef.links.teleportZone;
        const resolvedZone = resolveZoneKey(targetZone);
        const targetDef = getZoneDef(resolvedZone);
        if (!targetDef) {
          events.push({ event: 'MESSAGE', text: `${spellDef.name} opens a portal, but the destination is beyond your reach.` });
          break;
        }
        handleStopCombat(session);
        await ensureZoneLoaded(resolvedZone);
        session.char.zoneId = resolvedZone;
        session.char.roomId = targetDef.defaultRoom || '';
        session.char.x = 0;
        session.char.y = 0;
        session.char.z = 0;
        session.pendingTeleport = { x: 0, y: 0, z: 0 };
        DB.saveCharacterLocation(session.char.id, resolvedZone, session.char.roomId);
        const tpName = targetDef.name || resolvedZone;
        events.push({ event: 'MESSAGE', text: `You feel the world shift around you. You have entered ${tpName}.` });
        sendStatus(session);
        break;
      }
      // Evacuate/Succor without a specific teleportZone — just break combat and flee
      if (spaNames.includes('changeAggro') && !hasTeleportZone) {
        handleStopCombat(session);
        events.push({ event: 'MESSAGE', text: 'You invoke an evacuation! Your group flees from combat.' });
        break;
      }
      
      // Feign Death (SPA 74)
      if (spaIds.includes(74)) {
        const fdSkill = spellDef.effects.find(e => e.spa === 74);
        const fdChance = fdSkill ? fdSkill.base : 85; // Success chance
        if (Math.random() * 100 < fdChance) {
          // Success: drop combat and aggro
          if (session.combatTarget) {
            const mob = session.combatTarget;
            mob.target = null; // Mob forgets about player
          }
          session.inCombat = false;
          session.autoFight = false;
          session.combatTarget = null;
          session.char.state = 'feigning';
          events.push({ event: 'MESSAGE', text: 'You have fallen to the ground. You appear to be dead.' });
        } else {
          events.push({ event: 'MESSAGE', text: 'You try to feign death but fail!' });
        }
        break;
      }
      
      // Memory Blur / Mind Wipe (SPA 63 = sentinelCall, solo — not paired with mez)
      if (spaNames.includes('sentinelCall') && !spaIds.includes(31)) {
        if (!session.combatTarget) {
          events.push({ event: 'MESSAGE', text: 'You must have a target to cast that spell.' });
          break;
        }
        const blurMob = session.combatTarget;
        const blurResist = combat.calcSpellResist(blurMob, session.char.level, spellDef.resistType, spellDef.resistAdjust);
        if (blurResist === 'FULL_RESIST') {
          events.push({ event: 'RESIST', target: blurMob.name, spell: spellDef.name });
        } else {
          blurMob.target = null; // Mob forgets about player
          session.inCombat = false;
          session.autoFight = false;
          session.combatTarget = null;
          events.push({ event: 'MESSAGE', text: `${blurMob.name}'s mind has been wiped!` });
        }
        break;
      }
      
      // Sense Animals/Undead/Summoned — list nearby entities
      if (spaNames.includes('senseAnimals') || spaNames.includes('senseUndead') ||
          spaIds.includes(52) || spaIds.includes(53)) {
        // In our MUD, just list mobs in the zone
        const zone = zoneInstances[session.char.zoneId];
        if (zone && zone.liveMobs) {
          const nearby = zone.liveMobs.filter(m => m.hp > 0).slice(0, 5);
          if (nearby.length > 0) {
            const names = nearby.map(m => m.name).join(', ');
            events.push({ event: 'MESSAGE', text: `You sense nearby creatures: ${names}` });
          } else {
            events.push({ event: 'MESSAGE', text: 'You sense nothing nearby.' });
          }
        } else {
          events.push({ event: 'MESSAGE', text: 'You sense nothing nearby.' });
        }
        break;
      }
      
      // Infravision / Ultravision (SPA 68, 69) — apply as duration buff
      if (spaIds.includes(68) || spaIds.includes(69)) {
        session.buffs = session.buffs.filter(b => b.name !== spellDef.buffName);
        session.buffs.push({
          name: spellDef.buffName,
          duration: spellDef.duration,
          maxDuration: spellDef.duration,
          beneficial: true,
          effects: spellDef.effects || [],
        });
        const visionType = spaIds.includes(69) ? 'Thermal Vision' : 'Starlight Vision';
        const visionMsg = spellDef.messages?.castOnYou || `Your eyes shimmer as ${visionType} takes hold.`;
        events.push({ event: 'MESSAGE', text: visionMsg });
        sendBuffs(session);
        break;
      }

      // True North (name match)
      if (spellDef.name === 'True North') {
        const dirs = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'];
        const dir = dirs[Math.floor(Math.random() * dirs.length)];
        events.push({ event: 'MESSAGE', text: `You sense that north is to the ${dir} of your current facing.` });
        break;
      }
      
      // Cure Poison/Disease variants classified as utility
      if (spaNames.includes('poison') || spaNames.includes('disease')) {
        const beforeCount = session.buffs.length;
        session.buffs = session.buffs.filter(b => {
          if (b.beneficial) return true;
          if (Array.isArray(b.effects)) {
            return !b.effects.some(e => e.spa === 35 || e.spa === 36);
          }
          return true;
        });
        if (session.buffs.length < beforeCount) {
          events.push({ event: 'MESSAGE', text: 'You feel the ailment leave your body.' });
          session.effectiveStats = calcEffectiveStats(session.char, session.inventory, session.buffs);
          sendBuffs(session);
        } else {
          events.push({ event: 'MESSAGE', text: 'You feel a brief rush of cleansing energy.' });
        }
        break;
      }
      
      // Fallthrough for unrecognized utility spells
      events.push({ event: 'MESSAGE', text: spellDef.description || `${spellDef.name} has no discernible effect.` });
      break;
    }
    // Summon Item — create items in player inventory
    case 'summonItem': {
      const summonEffect = (spellDef.effects || []).find(e => e.spa === 32);
      if (summonEffect) {
        const eqItemId = summonEffect.base;
        let itemKey = SUMMON_ITEM_MAP[eqItemId];
        
        // If no direct mapping, try to infer from spell name
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
        
        if (itemKey && ITEMS[itemKey]) {
          await DB.addItem(session.char.id, itemKey, 0, 0);
          session.inventory = await DB.getInventory(session.char.id);
          sendInventory(session);
          events.push({ event: 'MESSAGE', text: `You summon ${ITEMS[itemKey].name}.` });
        } else {
          // Generic fallback for unmapped summons — show flavor text
          events.push({ event: 'MESSAGE', text: `${spellDef.name} conjures something, but it fizzles away.` });
        }
      } else {
        events.push({ event: 'MESSAGE', text: `${spellDef.name} conjures something, but it fizzles away.` });
      }
      break;
    }
    // Gate — return to bind point (starting zone)
    case 'gate': {
      handleStopCombat(session);
      // Use starting zone as bind point (TODO: proper bind system)
      const bindZone = session.char.startZoneId || session.char.zoneId;
      if (bindZone !== session.char.zoneId) {
        await ensureZoneLoaded(bindZone);
        session.char.zoneId = bindZone;
        const bindDef = getZoneDef(bindZone);
        session.char.roomId = (bindDef && bindDef.defaultRoom) || '';
        // Reset position to zone center/default
        session.char.x = 0;
        session.char.y = 0;
        session.char.z = 0;
        session.pendingTeleport = { x: 0, y: 0, z: 0 };
        DB.saveCharacterLocation(session.char.id, bindZone, session.char.roomId);
        const zoneName = (bindDef && bindDef.name) || bindZone;
        events.push({ event: 'MESSAGE', text: `You feel yourself yanked through the void. You have entered ${zoneName}.` });
      } else {
        events.push({ event: 'MESSAGE', text: 'You are already at your bind point.' });
      }
      sendStatus(session);
      break;
    }
    // Teleport — zone to specific target zone
    case 'teleport': {
      const targetZone = spellDef.links?.teleportZone || spellDef.teleportZone;
      if (!targetZone) {
        events.push({ event: 'MESSAGE', text: `${spellDef.name} fizzles. No destination found.` });
        break;
      }
      // Resolve the target zone key
      const resolvedZone = resolveZoneKey(targetZone);
      const targetDef = getZoneDef(resolvedZone);
      if (!targetDef) {
        events.push({ event: 'MESSAGE', text: `${spellDef.name} fizzles. The destination is unreachable.` });
        break;
      }
      handleStopCombat(session);
      await ensureZoneLoaded(resolvedZone);
      session.char.zoneId = resolvedZone;
      session.char.roomId = targetDef.defaultRoom || '';
      session.char.x = 0;
      session.char.y = 0;
      session.char.z = 0;
      session.pendingTeleport = { x: 0, y: 0, z: 0 };
      DB.saveCharacterLocation(session.char.id, resolvedZone, session.char.roomId);
      const tpName = targetDef.name || resolvedZone;
      events.push({ event: 'MESSAGE', text: `You feel the world shift around you. You have entered ${tpName}.` });
      sendStatus(session);
      break;
    }
    // Pet summoning — placeholder until pet AI system exists
    case 'pet': {
      // Look up pet stats from petData.js by spell ID
      const petSpellId = spellDef._spellId || spellDef.id;
      const petDef = PET_SPELLS[petSpellId];
      if (!petDef) {
        events.push({ event: 'MESSAGE', text: `You begin to summon a creature, but the binding fails. (Unknown pet spell ${petSpellId})` });
        break;
      }
      // Check for reagent
      if (petDef.reagent) {
        const hasReagent = session.inventory.some(i => {
          const def = ItemDB.getById(i.item_key);
          return def && def.name && def.name.toLowerCase().includes(petDef.reagent.name.toLowerCase());
        });
        if (!hasReagent) {
          events.push({ event: 'MESSAGE', text: `You need ${petDef.reagent.name} to cast this spell.` });
          break;
        }
      }
      const petResult = spawnPet(session, petDef, spellDef);
      events.push(...petResult.events);
      break;
    }
    // Resurrect — placeholder until corpse system exists
    case 'resurrect': {
      events.push({ event: 'MESSAGE', text: `You channel resurrection magic... but there is no corpse to target. (Corpse system coming soon!)` });
      break;
    }
    default:
      events.push({ event: 'MESSAGE', text: `${spellDef.name} has no effect.` });
  }

  if (events.length > 0) sendCombatLog(session, events);
}

function handleAbility(session, msg) {
  const ability = (msg.ability || '').toLowerCase().trim();
  const char = session.char;

  // ── Non-combat utility skills (no combat/target required) ──
  if (ability === 'hide') return handleHide(session, { hiding: true });
  if (ability === 'sneak') return handleUpdateSneak(session, { sneaking: true });

  if (ability === 'sensehead' || ability === 'sense_heading' || ability === 'sense heading') {
    return handleSenseHeading(session);
  }

  if (ability === 'forage') {
    if (!session.abilityCooldowns) session.abilityCooldowns = {};
    if (session.abilityCooldowns['forage'] > 0) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `You need to wait before foraging again.` }]);
    }
    if (session.inCombat) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `You can't forage while in combat!` }]);
    }
    const skill = combat.getCharSkill(char, 'forage');
    if (skill <= 0) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `You have no idea how to forage.` }]);
    }
    const roll = Math.floor(Math.random() * 200) + 1;
    const success = roll <= (skill + 25);
    combat.trySkillUp(session, 'forage');

    if (success) {
      // Zone-aware forage table — common generic items
      const FORAGE_TABLE = [
        { name: 'Roots', weight: 0.1 },
        { name: 'Berries', weight: 0.1 },
        { name: 'Pod of Water', weight: 0.4 },
        { name: 'Fishing Grubs', weight: 0.1 },
        { name: 'Vegetables', weight: 0.2 },
        { name: 'Fruit', weight: 0.2 },
        { name: 'Rabbit Meat', weight: 0.3 },
      ];
      const item = FORAGE_TABLE[Math.floor(Math.random() * FORAGE_TABLE.length)];
      sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=green]You have foraged ${item.name}![/color]` }]);
    } else {
      sendCombatLog(session, [{ event: 'MESSAGE', text: `You fail to find anything useful.` }]);
    }
    session.abilityCooldowns['forage'] = 10;
    flushSkillUps(session);
    return;
  }

  if (ability === 'mend') {
    if (!session.abilityCooldowns) session.abilityCooldowns = {};
    if (session.abilityCooldowns['mend'] > 0) {
      const remaining = Math.ceil(session.abilityCooldowns['mend']);
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `Mend is not ready yet. (${remaining}s)` }]);
    }
    // Monk self-heal: 25% base, can crit for 50%, can fail or crit-fail
    const maxHp = session.effectiveStats.hp;
    const mendRoll = Math.random();
    if (mendRoll < 0.05) {
      const dmg = Math.floor(maxHp * 0.05);
      char.hp = Math.max(1, char.hp - dmg);
      sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=red]You attempt to mend your wounds but make them worse! (${dmg} damage)[/color]` }]);
    } else if (mendRoll < 0.25) {
      sendCombatLog(session, [{ event: 'MESSAGE', text: `You attempt to mend your wounds but fail.` }]);
    } else if (mendRoll < 0.85) {
      const heal = Math.floor(maxHp * 0.25);
      char.hp = Math.min(maxHp, char.hp + heal);
      sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=green]You mend your wounds for ${heal} hit points.[/color]` }]);
    } else {
      const heal = Math.floor(maxHp * 0.50);
      char.hp = Math.min(maxHp, char.hp + heal);
      sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=green]You expertly mend your wounds for ${heal} hit points![/color]` }]);
    }
    session.abilityCooldowns['mend'] = 360; // 6 minute cooldown like classic EQ
    sendStatus(session);
    return;
  }

  if (ability === 'track') {
    const skill = combat.getCharSkill(char, 'tracking');
    if (skill <= 0) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `You don't know how to track.` }]);
    }
    // List mobs and players within tracking range (skill * 3 units)
    const trackRange = skill * 3;
    const instance = zoneInstances[char.zoneId];
    const results = [];
    if (instance) {
      for (const mob of instance.liveMobs) {
        const dist = getDistance(mob.x, mob.y, char.x, char.y);
        if (dist <= trackRange) {
          results.push({ name: mob.name, dist: Math.floor(dist) });
        }
      }
    }
    // Other players in the zone
    for (const [, other] of sessions) {
      if (other.char && other.char.zoneId === char.zoneId && other.char.id !== char.id) {
        const dist = getDistance(other.char.x, other.char.y, char.x, char.y);
        if (dist <= trackRange) {
          results.push({ name: `(PC) ${other.char.name}`, dist: Math.floor(dist) });
        }
      }
    }
    results.sort((a, b) => a.dist - b.dist);
    combat.trySkillUp(session, 'tracking');
    flushSkillUps(session);

    if (results.length === 0) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `You don't sense any nearby creatures.` }]);
    }
    const lines = results.slice(0, 20).map(r => ({ event: 'MESSAGE', text: `  [color=cyan]${r.name}[/color] (${r.dist} units)` }));
    lines.unshift({ event: 'MESSAGE', text: `[color=yellow]-- Tracking Results (${results.length}) --[/color]` });
    return sendCombatLog(session, lines);
  }

  if (ability === 'bindwound' || ability === 'bind_wound' || ability === 'bind wound') {
    if (!session.abilityCooldowns) session.abilityCooldowns = {};
    if (session.abilityCooldowns['bindwound'] > 0) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `You need to wait before binding wounds again.` }]);
    }
    if (session.inCombat) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `You can't bind wounds while in combat!` }]);
    }
    const maxHp = session.effectiveStats.hp;
    // Can only heal up to 50% HP via bind wound (classic EQ limit without AAs)
    if (char.hp >= Math.floor(maxHp * 0.5)) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `You are not wounded enough to bind wounds.` }]);
    }
    const bwSkill = combat.getCharSkill(char, 'bind_wound');
    const healAmount = Math.max(1, Math.floor(bwSkill / 4) + Math.floor(Math.random() * 4));
    char.hp = Math.min(Math.floor(maxHp * 0.5), char.hp + healAmount);
    combat.trySkillUp(session, 'bind_wound');
    flushSkillUps(session);
    session.abilityCooldowns['bindwound'] = 15;
    sendStatus(session);
    return sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=green]You bind your wounds and heal ${healAmount} hit points.[/color]` }]);
  }

  if (ability === 'fishing') {
    if (!session.abilityCooldowns) session.abilityCooldowns = {};
    if (session.abilityCooldowns['fishing'] > 0) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `You need to wait before fishing again.` }]);
    }
    const fishSkill = combat.getCharSkill(char, 'fishing');
    const fishRoll = Math.floor(Math.random() * 200) + 1;
    combat.trySkillUp(session, 'fishing');
    flushSkillUps(session);
    session.abilityCooldowns['fishing'] = 12;
    if (fishRoll <= fishSkill + 10) {
      const catches = ['a Fish', 'a Tattered Cloth Sandal', 'a Rusty Dagger', 'a Fresh Fish', 'some Seaweed'];
      const caught = catches[Math.floor(Math.random() * catches.length)];
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=green]You caught ${caught}![/color]` }]);
    }
    return sendCombatLog(session, [{ event: 'MESSAGE', text: `You didn't catch anything.` }]);
  }

  if (ability === 'begging') {
    if (!session.abilityCooldowns) session.abilityCooldowns = {};
    if (session.abilityCooldowns['begging'] > 0) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `You need to wait before begging again.` }]);
    }
    const begSkill = combat.getCharSkill(char, 'begging');
    const begRoll = Math.floor(Math.random() * 200) + 1;
    combat.trySkillUp(session, 'begging');
    flushSkillUps(session);
    session.abilityCooldowns['begging'] = 8;
    if (begRoll <= begSkill) {
      const copper = Math.floor(Math.random() * 3) + 1;
      if (!char.currency) char.currency = { platinum: 0, gold: 0, silver: 0, copper: 0 };
      char.currency.copper += copper;
      sendStatus(session);
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=green]Someone takes pity on you and gives you ${copper} copper.[/color]` }]);
    }
    return sendCombatLog(session, [{ event: 'MESSAGE', text: `You beg unsuccessfully.` }]);
  }

  if (ability === 'picklock') {
    const plSkill = combat.getCharSkill(char, 'pick_lock');
    if (plSkill <= 0) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `You don't know how to pick locks.` }]);
    }
    combat.trySkillUp(session, 'pick_lock');
    flushSkillUps(session);
    return sendCombatLog(session, [{ event: 'MESSAGE', text: `You attempt to pick the lock... but there is nothing to pick nearby.` }]);
  }

  // ── Vision Mode Toggle (non-combat) ──
  // Normalize: client sends display names with spaces, server uses underscore keys
  const abilityNormalized = ability.replace(/[\s-]+/g, '_');
  const visionAbilities = {
    'normal_vision': 'normal',
    'weak_normal_vision': 'normal_weak',
    'infravision': 'infravision',
    'ultravision': 'ultravision',
    'cat_eye': 'cateye',
    'serpent_sight': 'serpentsight',
  };
  if (visionAbilities[abilityNormalized]) {
    const skillVal = combat.getCharSkill(char, abilityNormalized);
    if (skillVal <= 0) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: `You do not possess ${ability.replace(/_/g, ' ')}.` }]);
    }
    const newVision = visionAbilities[abilityNormalized];
    session.activeVisionMode = newVision;
    const modeDef = VISION_MODES[newVision] || VISION_MODES.normal;
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You focus your eyes. ${modeDef.description}` }]);
    sendStatus(session);
    return;
  }

  // ── Combat abilities (require active combat) ──
  if (!session.inCombat || !session.combatTarget) {
    return sendCombatLog(session, [{ event: 'MESSAGE', text: `You must be in combat to use ${msg.ability}.` }]);
  }
  
  if (!session.abilityCooldowns) session.abilityCooldowns = {};
  if (session.abilityCooldowns[msg.ability] > 0) {
    return sendCombatLog(session, [{ event: 'MESSAGE', text: `Ability ${msg.ability} is not ready yet.` }]);
  }

  const mob = session.combatTarget;
  if (msg.ability === 'kick') {
    const dmg = combat.calcKickDamage(session);
    if (dmg > 0) {
       mob.hp -= dmg;
       sendCombatLog(session, [{ event: 'MELEE_HIT', source: 'You', target: mob.name, damage: dmg, text: 'Kick!' }]);
    } else {
       sendCombatLog(session, [{ event: 'MELEE_MISS', source: 'You', target: mob.name, text: 'Kick missed' }]);
    }
    session.abilityCooldowns[msg.ability] = 6;
  } else if (msg.ability === 'bash') {
    const dmg = combat.calcBashDamage(session);
    if (dmg > 0) {
       mob.hp -= dmg;
       sendCombatLog(session, [{ event: 'MELEE_HIT', source: 'You', target: mob.name, damage: dmg, text: 'Bash!' }]);
    } else {
       sendCombatLog(session, [{ event: 'MELEE_MISS', source: 'You', target: mob.name, text: 'Bash missed' }]);
    }
    session.abilityCooldowns[msg.ability] = 6;
  } else if (msg.ability === 'taunt') {
    const tauntSkill = combat.getCharSkill(char, 'taunt');
    const tauntRoll = Math.floor(Math.random() * 200) + 1;
    const tauntSuccess = tauntRoll <= (tauntSkill + 30);
    combat.trySkillUp(session, 'taunt');
    if (tauntSuccess) {
      // Lock aggro on this player — mob focuses on taunter
      mob.taunted = true;
      mob.tauntedBy = session;
      sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=yellow]You taunt ${mob.name}, grabbing its attention![/color]` }]);
    } else {
      sendCombatLog(session, [{ event: 'MESSAGE', text: `You try to taunt ${mob.name} but fail to get its attention.` }]);
    }
    session.abilityCooldowns[msg.ability] = 6;
  } else if (msg.ability === 'backstab') {
    const weapon = getWeaponStats(char.inventory || []);
    const dmg = combat.calcBackstabDamage(session, weapon.damage);
    if (dmg > 0) {
      mob.hp -= dmg;
      sendCombatLog(session, [{ event: 'MELEE_HIT', source: 'You', target: mob.name, damage: dmg, text: 'Backstab!' }]);
    } else {
      sendCombatLog(session, [{ event: 'MELEE_MISS', source: 'You', target: mob.name, text: 'Backstab missed' }]);
    }
    session.abilityCooldowns[msg.ability] = 10;
  } else if (msg.ability === 'disarm') {
    const disarmSkill = combat.getCharSkill(char, 'disarm');
    const disarmRoll = Math.floor(Math.random() * 200) + 1;
    const disarmSuccess = disarmRoll <= (disarmSkill + 10);
    combat.trySkillUp(session, 'disarm');
    if (disarmSuccess && mob.maxDmg > 1) {
      // Temporarily halve the mob's damage for 30 seconds
      const origMax = mob.maxDmg;
      const origMin = mob.minDmg;
      mob.maxDmg = Math.floor(mob.maxDmg * 0.5);
      mob.minDmg = Math.max(1, Math.floor(mob.minDmg * 0.5));
      sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=yellow]You disarm ${mob.name}![/color]` }]);
      // Restore after 30 seconds
      setTimeout(() => {
        if (mob) { mob.maxDmg = origMax; mob.minDmg = origMin; }
      }, 30000);
    } else {
      sendCombatLog(session, [{ event: 'MESSAGE', text: `You fail to disarm ${mob.name}.` }]);
    }
    session.abilityCooldowns[msg.ability] = 60;
  }

  flushSkillUps(session);
}

function handleTactic(session, msg) {
  session.tactic = msg.tactic;
  sendCombatLog(session, [{ event: 'MESSAGE', text: `Combat tactic set to: ${msg.tactic}` }]);
}

// ── NPC Interaction Handlers ────────────────────────────────────────

async function handleHail(session, msg) {
  const char = session.char;
  const zone = zoneInstances[char.zoneId];

  // If no target, just hail into the void
  if (!session.combatTarget) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You say, 'Hail!'` }]);
    return;
  }

  const target = session.combatTarget;

  // Proximity check — must be within HAIL_RANGE
  const distSq = getDistanceSq(char.x, char.y, target.x, target.y);
  if (distSq > HAIL_RANGE * HAIL_RANGE) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You are too far away to speak with ${target.name}.` }]);
    return;
  }

  // Turn NPC to face player (0-512 scale)
  let dx = char.x - target.x;
  let dy = char.y - target.y;
  let newHeading = (Math.atan2(dx, dy) / (2 * Math.PI)) * 512;
  if (newHeading < 0) newHeading += 512;
  target.heading = newHeading;

  // All non-KOS NPCs will wave back (currently all are indifferent)
  send(session.ws, {
    type: 'EMOTE',
    charName: target.name,
    emote: 'wave',
    heading: target.heading
  });

  const events = [];
  events.push({ event: 'MESSAGE', text: `You say, 'Hail, ${target.name}!'` });

  // Fire Quest Engine for 'Hail' text
  const zoneShortName = char.zoneId;
  const eData = { message: 'hail', joined: false, trade: {} };
  const actions = await QuestManager.triggerEvent(zoneShortName, target, char, 'EVENT_SAY', eData);
  
  let questHijackedDialog = false;
  if (actions && actions.length > 0) {
    processQuestActions(session, target, actions);
    questHijackedDialog = true;
  }

  // If it's a regular mob and no quest triggered, just regard indifferently
  if (!questHijackedDialog && (!target.npcType || target.npcType === NPC_TYPES.MOB)) {
    events.push({ event: 'MESSAGE', text: `${target.name} regards you indifferently.` });
    sendCombatLog(session, events);
    return;
  }

  switch (target.npcType) {
    case NPC_TYPES.MERCHANT: {
      // Check for static merchant inventory first, then fall back to DB merchantlist
      const shopData = MERCHANT_INVENTORIES[target.key];
      let merchantItems = [];

      if (shopData) {
        events.push({ event: 'MESSAGE', text: `${target.name} says, '${shopData.greeting}'` });
        merchantItems = shopData.items.map(si => {
          const itemDef = ITEMS[si.itemKey];
          const price = si.price || (itemDef ? itemDef.value || 10 : 10);
          return {
            itemKey: si.itemKey,
            name: itemDef ? itemDef.name : si.itemKey,
            price: price,
            priceText: formatCurrency(price),
            type: itemDef ? itemDef.type : 'misc',
            ac: itemDef ? itemDef.ac || 0 : 0,
            damage: itemDef ? itemDef.damage || 0 : 0,
            delay: itemDef ? itemDef.delay || 0 : 0,
            hp: itemDef ? itemDef.hp || 0 : 0,
            mana: itemDef ? itemDef.mana || 0 : 0,
            str: itemDef ? itemDef.str || 0 : 0,
            sta: itemDef ? itemDef.sta || 0 : 0,
            weight: itemDef ? itemDef.weight || 0 : 0,
            classes: itemDef ? itemDef.classes || 65535 : 65535,
            reclevel: itemDef ? itemDef.reclevel || 0 : 0,
            scrolllevel: itemDef ? itemDef.scrolllevel || 0 : 0,
            itemtype: itemDef ? itemDef.itemtype || 0 : 0,
          };
        });
      } else {
        // Fall back to EQEmu merchantlist table
        const eqemuDB = require('./eqemu_db');
        const dbItems = await eqemuDB.getMerchantItems(parseInt(target.key));
        if (dbItems.length > 0) {
          events.push({ event: 'MESSAGE', text: `${target.name} says, 'Welcome! Browse my wares.'` });
          merchantItems = dbItems.map(di => ({
            itemKey: di.itemKey,
            name: di.name,
            price: di.price,
            priceText: formatCurrency(di.price),
            type: di.damage > 0 ? 'weapon' : (di.ac > 0 ? 'armor' : 'misc'),
            ac: di.ac, damage: di.damage, delay: di.delay,
            hp: di.hp, mana: di.mana,
            str: di.str, sta: di.sta,
            weight: di.weight,
            classes: di.classes || 65535,
            reclevel: di.reclevel || 0,
            scrolllevel: di.scrolllevel || 0,
            itemtype: di.itemtype || 0,
          }));
        } else {
          events.push({ event: 'MESSAGE', text: `${target.name} says, 'I have nothing for sale at the moment.'` });
        }
      }

      if (merchantItems.length > 0) {
        // Compute player's class bitmask for client-side filtering
        const CLASSES_MAP = { warrior:1, cleric:2, paladin:3, ranger:4, shadow_knight:5, druid:6, monk:7, bard:8, rogue:9, shaman:10, necromancer:11, wizard:12, magician:13, enchanter:14, beastlord:15, berserker:16 };
        const classId = CLASSES_MAP[char.class] || 1;
        const playerClassBitmask = 1 << (classId - 1);

        send(session.ws, {
          type: 'OPEN_MERCHANT',
          npcId: target.id,
          npcName: target.name,
          items: merchantItems,
          playerClassBitmask: playerClassBitmask,
          playerLevel: char.level,
        });
      }
      break;
    }

    case NPC_TYPES.QUEST: {
      const hailResponse = QuestDialogs.getHailResponse(target.key, char);
      if (hailResponse) {
        events.push({ event: 'NPC_SAY', npcName: target.name, text: hailResponse, keywords: QuestDialogs.extractKeywords(hailResponse) });
      } else {
        events.push({ event: 'MESSAGE', text: `${target.name} nods at you.` });
      }
      break;
    }

    case NPC_TYPES.TRAINER: {
      // Determine which class this trainer teaches
      const trainerClass = GUILD_MASTER_CLASS[target.eqClass];
      const playerClass = session.char.class;

      if (trainerClass && trainerClass !== playerClass) {
        events.push({ event: 'MESSAGE', text: `${target.name} says, 'I have nothing to teach you, ${session.char.name}. You should seek out your own guild master.'` });
        break;
      }

      events.push({ event: 'MESSAGE', text: `${target.name} says, 'Welcome, ${session.char.name}. I can train you in various skills.'` });

      // Build complete skill list for this class
      const skillList = [];
      const charSkills = session.char.skills || {};
      for (const [key, skillDef] of Object.entries(Skills)) {
        const classData = skillDef.classes[playerClass];
        if (!classData) continue;

        const currentValue = charSkills[key] || 0;
        const levelCap = Math.min(classData.capFormula(session.char.level), classData.maxCap);
        const rank = getSkillRank(currentValue, classData.maxCap);
        const atCap = currentValue >= levelCap;
        const tooLowLevel = session.char.level < classData.levelGranted;

        let costCopper = 0;
        let costCoins = { pp: 0, gp: 0, sp: 0, cp: 0 };
        let canTrain = false;

        if (!atCap && !tooLowLevel) {
          canTrain = true;
          costCopper = getTrainingCostCopper(currentValue);
          costCoins = copperToCoins(costCopper);
        }

        skillList.push({
          key,
          name: skillDef.name,
          type: skillDef.type,
          value: currentValue,
          cap: levelCap,
          maxCap: classData.maxCap,
          rank,
          canTrain,
          costPp: canTrain ? costCoins.pp : null,
          costGp: canTrain ? costCoins.gp : null,
          costSp: canTrain ? costCoins.sp : null,
          costCp: canTrain ? costCoins.cp : null,
          costTotalCopper: canTrain ? costCopper : 0,
          levelGranted: classData.levelGranted,
        });
      }

      send(session.ws, {
        type: 'OPEN_TRAINER',
        npcId: target.id,
        npcName: target.name,
        trainerClass: trainerClass || playerClass,
        practices: session.char.practices || 0,
        copper: session.char.copper || 0,
        skills: skillList,
      });
      break;
    }

    case NPC_TYPES.BANK: {
      events.push({ event: 'MESSAGE', text: `${target.name} says, 'Welcome to the bank. How may I assist you?'` });
      send(session.ws, {
        type: 'OPEN_BANK',
        npcId: target.id,
        npcName: target.name,
        // TODO: retrieve player bank contents
        bankSlots: [],
      });
      break;
    }

    case NPC_TYPES.BIND: {
      events.push({ event: 'MESSAGE', text: `${target.name} says, 'Shall I bind your soul to this location? [bind]'` });
      break;
    }

    case NPC_TYPES.BLANK:
    default: {
      events.push({ event: 'MESSAGE', text: `${target.name} nods at you.` });
      break;
    }
  }

  if (events.length > 0) sendCombatLog(session, events);
}

function processQuestActions(session, npc, actions) {
  const events = [];
  for (const act of actions) {
    switch (act.action) {
      case 'say':
      case 'shout':
      case 'emote':
        // Send to the triggering player's UI
        events.push({ event: 'NPC_SAY', npcName: npc.name, text: act.msg || act.text, keywords: [] });
        // Broadcast to spatial channel
        const mockSession = { char: { name: npc.name, zoneId: npc.zoneId, x: npc.x, y: npc.y }, ws: null };
        broadcastChat(mockSession, act.action === 'shout' ? 'shout' : 'say', act.msg || act.text, act.action === 'shout' ? 600 : 200);
        break;
      case 'message':
        events.push({ event: 'MESSAGE', text: act.text });
        break;
      case 'summonitem':
      case 'reward':
        if (act.item_id && act.item_id > 0) {
            events.push({ event: 'MESSAGE', text: `You receive an item!` });
        }
        if (act.exp && act.exp > 0) {
            events.push({ event: 'MESSAGE', text: `You gain experience!!` });
        }
        break;
      case 'anim':
        // Broadcast animation to zone
        broadcastToZone(npc.zoneId, { type: 'NPC_ANIM', id: npc.id, anim: act.anim });
        break;
    }
  }
  if (events.length > 0) sendCombatLog(session, events);
}

async function handleSay(session, msg) {
  const char = session.char;
  const text = (msg.text || '').trim();
  if (!text) return;

  // Echo the player's speech via CHAT
  send(session.ws, { type: 'CHAT', channel: 'say', sender: char.name, text: text });

  // If we have a targeted NPC, check for keyword responses
  if (session.combatTarget && session.combatTarget.npcType) {
    const target = session.combatTarget;

    // Proximity check
    const distSq = getDistanceSq(char.x, char.y, target.x, target.y);
    if (distSq > HAIL_RANGE * HAIL_RANGE) {
      // Still broadcast to other players even if NPC is too far
      broadcastChat(session, 'say', text, 200);
      return;
    }

    // Process new Dual-Engine Quest Scripts
    const zoneShortName = char.zoneId;
    const eData = { message: text, joined: false, trade: {} };
    const actions = await QuestManager.triggerEvent(zoneShortName, target, char, 'EVENT_SAY', eData);
    
    if (actions && actions.length > 0) {
      processQuestActions(session, target, actions);
      return; // Handled by quest engine
    }

    // Quest NPCs and merchants with dialog respond to keywords (Legacy Fallback)
    if (target.npcType === NPC_TYPES.QUEST || target.npcType === NPC_TYPES.MERCHANT) {
      const response = QuestDialogs.getKeywordResponse(target.key, text, char);
      if (response) {
        const keywords = QuestDialogs.extractKeywords(response);
        sendCombatLog(session, [{ event: 'NPC_SAY', npcName: target.name, text: response, keywords: keywords }]);
        return;
      }
    }

    // Merchant fallback: 'buy', 'wares', 'shop' re-opens the merchant window
    if (target.npcType === NPC_TYPES.MERCHANT) {
      const lowerText = text.toLowerCase();
      if (lowerText === 'buy' || lowerText === 'wares' || lowerText === 'shop') {
        handleHail(session, msg);
        return;
      }
    }

    // Bind keyword check
    if (target.npcType === NPC_TYPES.BIND && text.toLowerCase() === 'bind') {
      sendCombatLog(session, [{ event: 'MESSAGE', text: `${target.name} begins to cast a spell.` }]);
      sendCombatLog(session, [{ event: 'MESSAGE', text: `You feel your soul bound to this location.` }]);
      // TODO: Actually save bind point
      return;
    }
  }

  // Broadcast to other players within say range (200 units)
  broadcastChat(session, 'say', text, 200);
}

// ── Chat Channel Utility ────────────────────────────────────────────
// Broadcasts a CHAT message to players within radius (same zone).
function broadcastChat(session, channel, text, radius) {
  const char = session.char;
  for (const [ws, other] of sessions) {
    if (other !== session && other.char.zoneId === char.zoneId) {
      const pDistSq = getDistanceSq(other.char.x, other.char.y, char.x, char.y);
      if (pDistSq <= radius * radius) {
        send(other.ws, { type: 'CHAT', channel: channel, sender: char.name, text: text });
      }
    }
  }
}

// ── /shout — 3x say radius (600u), local only ───────────────────────
function handleShout(session, msg) {
  const char = session.char;
  const text = (msg.text || '').trim();
  if (!text) return;
  send(session.ws, { type: 'CHAT', channel: 'shout', sender: char.name, text: text });
  broadcastChat(session, 'shout', text, 600);
}

// ── /ooc — same as say radius (200u), local only ────────────────────
function handleOOC(session, msg) {
  const char = session.char;
  const text = (msg.text || '').trim();
  if (!text) return;
  send(session.ws, { type: 'CHAT', channel: 'ooc', sender: char.name, text: text });
  broadcastChat(session, 'ooc', text, 200);
}

// ── /yell — 2x say radius (400u) + guard AI assist ─────────────────
function handleYell(session, msg) {
  const char = session.char;
  const text = (msg.text || '').trim() || 'Help!!';
  send(session.ws, { type: 'CHAT', channel: 'yell', sender: char.name, text: text });
  broadcastChat(session, 'yell', text, 400);

  // Guard AI: nearby guards respond to the yell
  const instance = zoneInstances[char.zoneId];
  if (!instance) return;

  for (const mob of instance.liveMobs) {
    if (!mob.alive) continue;
    // Identify guards by key prefix (guard_ or watchman_)
    const isGuard = mob.key && (mob.key.startsWith('guard_') || mob.key.startsWith('watchman_'));
    if (!isGuard) continue;

    const guardDistSq = getDistanceSq(mob.x, mob.y, char.x, char.y);
    if (guardDistSq > 160000) continue; // Guard must hear the yell

    // Check if the player is being attacked by a mob
    // Find mobs that are targeting this player
    for (const attacker of instance.liveMobs) {
      if (!attacker.alive || attacker === mob) continue;
      if (attacker.target && attacker.target === char.name) {
        // Don't help if the attacker IS a guard (guards help each other)
        const attackerIsGuard = attacker.key && (attacker.key.startsWith('guard_') || attacker.key.startsWith('watchman_'));
        if (attackerIsGuard) {
          // Player is fighting guards — guards assist each other, not the player
          continue;
        }
        // Don't help in PvP (attacker is a player session, not a mob)
        if (!attacker.npcType) continue;

        // Guard engages the mob attacking the player
        mob.target = attacker.id || attacker.name;
        mob.inCombat = true;
        sendCombatLog(session, [{ event: 'MESSAGE', text: `${mob.name} shouts, 'I'll protect you, citizen!'` }]);
        break; // Guard only assists against one attacker
      }
    }
  }
}

// ── /whisper — global private message ───────────────────────────────
function handleWhisper(session, msg) {
  const char = session.char;
  const targetName = (msg.target || '').trim();
  const text = (msg.text || '').trim();
  if (!text || !targetName) {
    send(session.ws, { type: 'CHAT', channel: 'system', sender: '', text: 'Usage: /whisper <player> <message>' });
    return;
  }

  // Find target player across all zones
  let targetSession = null;
  for (const [ws, other] of sessions) {
    if (other.char.name.toLowerCase() === targetName.toLowerCase()) {
      targetSession = other;
      break;
    }
  }

  if (!targetSession) {
    send(session.ws, { type: 'CHAT', channel: 'system', sender: '', text: `${targetName} is not online.` });
    return;
  }

  // Send to recipient
  send(targetSession.ws, { type: 'CHAT', channel: 'whisper', sender: char.name, text: text, direction: 'from' });
  // Echo to sender
  send(session.ws, { type: 'CHAT', channel: 'whisper', sender: targetName, text: text, direction: 'to' });
}

// ── /group — global (stub: not implemented) ─────────────────────────
function handleGroup(session, msg) {
  const text = (msg.text || '').trim();
  if (!text) return;

  // TODO: Implement group system
  // For now, check if player is in a group
  if (!session.group) {
    send(session.ws, { type: 'CHAT', channel: 'system', sender: '', text: 'You are not in a group.' });
    return;
  }

  // When groups are implemented, broadcast to group members:
  // for (const member of session.group.members) {
  //   send(member.ws, { type: 'CHAT', channel: 'group', sender: session.char.name, text: text });
  // }
}

// ── /guild — global (stub: not implemented) ─────────────────────────
function handleGuild(session, msg) {
  const text = (msg.text || '').trim();
  if (!text) return;

  if (!session.guild) {
    send(session.ws, { type: 'CHAT', channel: 'system', sender: '', text: 'You are not in a guild.' });
    return;
  }
}

// ── /raid — global (stub: not implemented) ──────────────────────────
function handleRaid(session, msg) {
  const text = (msg.text || '').trim();
  if (!text) return;

  if (!session.raid) {
    send(session.ws, { type: 'CHAT', channel: 'system', sender: '', text: 'You are not in a raid.' });
    return;
  }
}

// ── /announcement — admin-only global broadcast ─────────────────────
function handleAnnouncement(session, msg) {
  const text = (msg.text || '').trim();
  if (!text) return;

  // Check admin status (EQEmu: status >= 200 = GM)
  const auth = authSessions.get(session.ws);
  if (!auth || (auth.status || 0) < 200) {
    send(session.ws, { type: 'CHAT', channel: 'system', sender: '', text: 'You do not have permission to use this command.' });
    return;
  }

  // Broadcast to ALL connected players
  for (const [ws, other] of sessions) {
    send(other.ws, { type: 'CHAT', channel: 'announcement', sender: session.char.name, text: text });
  }
}

async function handleBuy(session, msg) {
  const { npcId, itemKey } = msg;
  const char = session.char;
  const instance = zoneInstances[char.zoneId];

  if (!instance) return;

  const merchant = instance.liveMobs.find(m => m.id === npcId);
  if (!merchant || merchant.npcType !== NPC_TYPES.MERCHANT) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'That merchant is no longer available.' }]);
    return;
  }

  // Proximity check
  const distSq = getDistanceSq(char.x, char.y, merchant.x, merchant.y);
  if (distSq > HAIL_RANGE * HAIL_RANGE) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You are too far away to trade.' }]);
    return;
  }

  // Try static merchant data first, then DB merchantlist
  let itemName = String(itemKey);
  let basePrice = 10;

  const shopData = MERCHANT_INVENTORIES[merchant.key];
  if (shopData) {
    const itemInfo = shopData.items.find(i => i.itemKey === itemKey);
    if (!itemInfo) {
      sendCombatLog(session, [{ event: 'MESSAGE', text: `${merchant.name} doesn't seem to have that item.` }]);
      return;
    }
    const itemDef = ITEMS[itemKey];
    itemName = itemDef ? itemDef.name : itemKey;
    basePrice = itemInfo.price || (itemDef ? itemDef.value || 10 : 10);
  } else {
    // DB-sourced merchant — validate against cached merchantlist
    const eqemuDB = require('./eqemu_db');
    const dbItems = await eqemuDB.getMerchantItems(parseInt(merchant.key));
    const parsedKey = parseInt(itemKey) || itemKey;
    const dbItem = dbItems.find(i => i.itemKey === parsedKey || i.itemKey === itemKey);
    if (!dbItem) {
      sendCombatLog(session, [{ event: 'MESSAGE', text: `${merchant.name} doesn't seem to have that item.` }]);
      return;
    }
    itemName = dbItem.name;
    basePrice = dbItem.price;
  }

  const price = Math.max(1, Math.floor(basePrice * getChaBuyMod(session)));

  if (char.copper < price) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You don't have enough money! That costs ${formatCurrency(price)}.` }]);
    return;
  }

  // Transaction — use the numeric itemKey for DB items
  char.copper -= price;
  const addKey = parseInt(itemKey) || itemKey;
  await DB.addItem(char.id, addKey, 0, 0);
  await DB.updateCharacterState(char);

  session.inventory = await DB.getInventory(char.id);
  session.effectiveStats = calcEffectiveStats(char, session.inventory, session.buffs);

  sendInventory(session);
  sendCombatLog(session, [{ event: 'MESSAGE', text: `You bought ${itemName} for ${formatCurrency(price)}.` }]);
  sendStatus(session);
}

async function handleSell(session, msg) {
  const { npcId, itemId, slotId } = msg;
  const char = session.char;
  const instance = zoneInstances[char.zoneId];
  if (!instance) return;

  // Verify merchant is nearby
  const merchant = instance.liveMobs.find(m => m.id === npcId);
  if (!merchant || merchant.npcType !== NPC_TYPES.MERCHANT) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'That merchant is no longer available.' }]);
    return;
  }
  const distSq = getDistanceSq(char.x, char.y, merchant.x, merchant.y);
  if (distSq > HAIL_RANGE * HAIL_RANGE) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You are too far away to trade.' }]);
    return;
  }

  // Find the item in player inventory
  const invRow = session.inventory.find(i => i.id === itemId);
  if (!invRow) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You don\'t have that item.' }]);
    return;
  }
  
  // Can't sell equipped items
  if (invRow.equipped === 1) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You must unequip that item before selling it.' }]);
    return;
  }

  // Calculate sell price (25% base, modified by CHA, minimum 1 cp)
  const itemDef = ItemDB.getById(invRow.item_key) || ITEMS[invRow.item_key];
  const itemName = itemDef ? itemDef.name : String(invRow.item_key);
  const baseSell = (itemDef ? itemDef.value || 1 : 1) * 0.25;

  // Check for merchant-specific sell bonus (e.g., mining NPCs pay more for ore)
  const shopData = MERCHANT_INVENTORIES[merchant.key];
  let bonusMult = 1.0;
  if (shopData && shopData.sellBonus && shopData.sellBonusCategories) {
    const itemNameLower = (itemDef ? itemDef.name || '' : '').toLowerCase();
    if (shopData.sellBonusCategories.some(cat => itemNameLower.includes(cat))) {
      bonusMult = 1.0 + shopData.sellBonus;
    }
  }
  const sellPrice = Math.max(1, Math.floor(baseSell * getChaSellMod(session) * bonusMult));

  // Transaction
  await DB.deleteItem(char.id, invRow.item_key, invRow.slot);
  char.copper += sellPrice;
  DB.updateCharacterState(char);

  // Refresh inventory
  session.inventory = await DB.getInventory(char.id);
  session.effectiveStats = calcEffectiveStats(char, session.inventory, session.buffs);

  sendInventory(session);
  sendCombatLog(session, [{ event: 'LOOT', text: `You sold ${itemName} to ${merchant.name} for ${formatCurrency(sellPrice)}.` }]);
  sendStatus(session);
}

async function handleNPCGiveItems(session, msg) {
  const char = session.char;
  const targetId = msg.npcId;
  const items = msg.items || [];
  
  if (items.length === 0) {
    sendInventory(session);
    return;
  }

  let target = null;
  const zoneKey = char.zoneId;
  const zoneDef = ZONES[zoneKey] || (zoneInstances[zoneKey] && zoneInstances[zoneKey].def);
  if (zoneDef && zoneDef.mobs) {
    target = zoneDef.mobs.find(m => String(m.id) === String(targetId));
  }

  if (!target) {
    sendCombatLog(session, [{ event: 'ERROR', text: "That NPC is no longer there." }]);
    sendInventory(session);
    return;
  }

  // Trigger Event
  const zoneShortName = char.zoneId;
  const trade = {};
  for (const it of items) {
    trade[`item${it.slot}`] = it.item_id;
  }
  
  const eData = { trade: trade, rawItems: items };
  const actions = await QuestManager.triggerEvent(zoneShortName, target, char, 'EVENT_TRADE', eData);
  
  let itemsToConsume = [...items];

  if (actions && actions.length > 0) {
    for (const act of actions) {
      if (act.action === 'return_items') {
        if (Array.isArray(act.returned)) {
          for (const r_id of act.returned) {
            const idx = itemsToConsume.findIndex(i => i.item_id === r_id);
            if (idx !== -1) itemsToConsume.splice(idx, 1);
          }
        }
      }
    }
    processQuestActions(session, target, actions);
  }

  // Delete only the consumed items from inventory
  for (const it of itemsToConsume) {
    if (it.inst_id) {
      await DB.pool.query('DELETE FROM inventory WHERE id = ? AND char_id = ?', [it.inst_id, char.id]);
    }
  }
  
  // Refresh inventory
  session.inventory = await DB.getInventory(char.id);
  session.effectiveStats = calcEffectiveStats(char, session.inventory, session.buffs);
  sendInventory(session);
}

async function handleDestroyItem(session, msg) {
  const { itemId, slotId } = msg;
  const char = session.char;

  const invRow = session.inventory.find(i => i.id === itemId);
  if (!invRow) return;

  // Can't destroy equipped items
  if (invRow.equipped === 1) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You must unequip that item first.' }]);
    return;
  }

  const itemDef = ItemDB.getById(invRow.item_key) || ITEMS[invRow.item_key];
  const itemName = itemDef ? itemDef.name : String(invRow.item_key);

  await DB.deleteItem(char.id, invRow.item_key, invRow.slot);
  
  // Refresh inventory
  session.inventory = await DB.getInventory(char.id);
  session.effectiveStats = calcEffectiveStats(char, session.inventory, session.buffs);
  
  sendInventory(session);
  sendCombatLog(session, [{ event: 'MESSAGE', text: `You destroy ${itemName}.` }]);
}

/**
 * Format copper value into EQ-style pp/gp/sp/cp string.
 * 1 plat = 1000 cp, 1 gold = 100 cp, 1 silver = 10 cp
 */
function formatCurrency(copper) {
  const pp = Math.floor(copper / 1000);
  const gp = Math.floor((copper % 1000) / 100);
  const sp = Math.floor((copper % 100) / 10);
  const cp = copper % 10;
  const parts = [];
  if (pp > 0) parts.push(`${pp}pp`);
  if (gp > 0) parts.push(`${gp}gp`);
  if (sp > 0) parts.push(`${sp}sp`);
  if (cp > 0 || parts.length === 0) parts.push(`${cp}cp`);
  return parts.join(' ');
}

/**
 * CHA-based vendor price modifiers (classic EQ).
 * Baseline CHA = 75. ~0.4% improvement per point above/below.
 * Buy mod: lower is better (you pay less). Clamped 0.7 - 1.15
 * Sell mod: higher is better (you get more). Clamped 0.85 - 1.4
 */
function getChaBuyMod(session) {
  const cha = session.effectiveStats?.cha || session.char?.cha || 75;
  const mod = 1.0 - (cha - 75) * 0.004;
  return Math.max(0.7, Math.min(1.15, mod));
}

function getChaSellMod(session) {
  const cha = session.effectiveStats?.cha || session.char?.cha || 75;
  const mod = 1.0 + (cha - 75) * 0.004;
  return Math.max(0.85, Math.min(1.4, mod));
}

async function handleEquipItem(session, msg) {
  const { itemId, slot } = msg;
  const invRow = session.inventory.find(i => i.id === itemId);
  if (!invRow) return;

  const itemDef = ITEMS[invRow.item_key];
  if (!itemDef) return;

  const targetSlot = slot || itemDef.slot;
  if (targetSlot <= 0) return;

  // Class/Race restriction check (EQEmu bitmask: bit N = class/race ID N+1; 65535 = all)
  const CLASSES_MAP = { warrior:1, cleric:2, paladin:3, ranger:4, shadow_knight:5, druid:6, monk:7, bard:8, rogue:9, shaman:10, necromancer:11, wizard:12, magician:13, enchanter:14, beastlord:15, berserker:16 };
  const RACES_MAP = { human:1, barbarian:2, erudite:3, wood_elf:4, high_elf:5, dark_elf:6, half_elf:7, dwarf:8, troll:9, ogre:10, halfling:11, gnome:12, iksar:128, vah_shir:130, froglok:330 };
  if (itemDef.classes && itemDef.classes !== 65535) {
    const classId = CLASSES_MAP[session.char.class] || 1;
    if (!(itemDef.classes & (1 << (classId - 1)))) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: 'Your class cannot use this item.' }]);
    }
  }
  if (itemDef.races && itemDef.races !== 65535) {
    const raceId = RACES_MAP[session.char.race] || 1;
    // EQEmu race bitmask for standard races uses sequential bits 0-11
    // For Iksar/VahShir/Froglok it's bit 12/13/14
    const RACE_BIT = { 1:0, 2:1, 3:2, 4:3, 5:4, 6:5, 7:6, 8:7, 9:8, 10:9, 11:10, 12:11, 128:12, 130:13, 330:14 };
    const bit = RACE_BIT[raceId] ?? -1;
    if (bit >= 0 && !(itemDef.races & (1 << bit))) {
      return sendCombatLog(session, [{ event: 'MESSAGE', text: 'Your race cannot use this item.' }]);
    }
  }

  await DB.unequipSlot(session.char.id, targetSlot);
  await DB.equipItem(invRow.id, session.char.id, targetSlot);

  session.inventory = await DB.getInventory(session.char.id);
  session.effectiveStats = calcEffectiveStats(session.char, session.inventory, session.buffs);

  sendInventory(session);
  sendStatus(session);
}

async function handleUnequipItem(session, msg) {
  const { itemId } = msg;
  await DB.unequipItem(itemId, session.char.id);
  session.inventory = await DB.getInventory(session.char.id);
  session.effectiveStats = calcEffectiveStats(session.char, session.inventory, session.buffs);
  sendInventory(session);
  sendStatus(session);
}

async function handleMoveItem(session, msg) {
  const { fromSlot, toSlot } = msg;
  if (fromSlot === toSlot) return;

  await DB.moveItem(session.char.id, fromSlot, toSlot);

  session.inventory = await DB.getInventory(session.char.id);
  session.effectiveStats = calcEffectiveStats(session.char, session.inventory, session.buffs);
  sendInventory(session);
  sendStatus(session);
}

async function handleAutoEquip(session, msg) {
  const { itemId } = msg;
  const invRow = session.inventory.find(i => i.id === itemId);
  if (!invRow) return;

  const def = ItemDB.getById(invRow.item_key) || ITEMS[invRow.item_key] || {};
  const slotBitmask = def.slot || 0;
  if (slotBitmask <= 0) {
    send(session.ws, { type: 'SYSTEM_MSG', message: 'This item cannot be equipped.' });
    return;
  }

  // Find the first matching equipment slot from the bitmask
  // EQEmu slot bitmask: bit 0 = slot 0 (charm), bit 1 = slot 1 (ear1), bit 2 = slot 2 (head), etc.
  let targetSlot = -1;
  for (let bit = 0; bit < 22; bit++) {
    if (slotBitmask & (1 << bit)) {
      targetSlot = bit;
      break;
    }
  }
  if (targetSlot < 0) {
    send(session.ws, { type: 'SYSTEM_MSG', message: 'Cannot determine equipment slot.' });
    return;
  }

  // Class/Race restriction check
  const CLASSES_MAP = { warrior:1, cleric:2, paladin:3, ranger:4, shadow_knight:5, druid:6, monk:7, bard:8, rogue:9, shaman:10, necromancer:11, wizard:12, magician:13, enchanter:14, beastlord:15, berserker:16 };
  const RACES_MAP = { human:1, barbarian:2, erudite:3, wood_elf:4, high_elf:5, dark_elf:6, half_elf:7, dwarf:8, troll:9, ogre:10, halfling:11, gnome:12, iksar:128, vah_shir:130, froglok:330 };
  if (def.classes && def.classes !== 65535) {
    const classId = CLASSES_MAP[session.char.class] || 1;
    if (!(def.classes & (1 << (classId - 1)))) {
      return send(session.ws, { type: 'SYSTEM_MSG', message: 'Your class cannot use this item.' });
    }
  }
  if (def.races && def.races !== 65535) {
    const raceId = RACES_MAP[session.char.race] || 1;
    const RACE_BIT = { 1:0, 2:1, 3:2, 4:3, 5:4, 6:5, 7:6, 8:7, 9:8, 10:9, 11:10, 12:11, 128:12, 130:13, 330:14 };
    const bit = RACE_BIT[raceId] ?? -1;
    if (bit >= 0 && !(def.races & (1 << bit))) {
      return send(session.ws, { type: 'SYSTEM_MSG', message: 'Your race cannot use this item.' });
    }
  }

  // Unequip whatever is in that slot, then equip this item
  await DB.unequipSlot(session.char.id, targetSlot);
  await DB.equipItem(invRow.id, session.char.id, targetSlot);

  session.inventory = await DB.getInventory(session.char.id);
  session.effectiveStats = calcEffectiveStats(session.char, session.inventory, session.buffs);
  sendInventory(session);
  sendStatus(session);
}

async function handleZone(session, msg) {
  const currentZone = session.char.zoneId;
  const targetZone = msg.zoneId;

  // Zone transition cooldown — prevent instant bounce-back between adjacent zones
  const now = Date.now();
  if (session.lastZoneTime && (now - session.lastZoneTime) < 3000) {
    return; // Silently ignore rapid zone requests
  }

  const zoneDef = getZoneDef(currentZone);
  const zoneLine = zoneDef && zoneDef.zoneLines && zoneDef.zoneLines.find(zl => zl.target === targetZone);

  if (!zoneLine) {
    return sendCombatLog(session, [{ event: 'MESSAGE', text: 'You cannot go that way.' }]);
  }

  handleStopCombat(session);
  // Despawn pet on zone transition (P99: pets don't zone)
  if (session.pet) {
    despawnPet(session, 'Your pet could not follow you.');
  }
  session.lastZoneTime = now;

  // Dynamically load the target zone if needed
  await ensureZoneLoaded(targetZone);

  session.char.zoneId = targetZone;

  const newZoneDef = getZoneDef(targetZone);
  session.char.roomId = (newZoneDef && newZoneDef.defaultRoom) || '';
  
  DB.saveCharacterLocation(session.char.id, targetZone, session.char.roomId);

  // Use the zone_point's target coordinates for spawn position
  // 999999 means "keep the player's current coordinate on that axis"
  let spawnX = zoneLine.targetX || 0;
  let spawnY = zoneLine.targetY || 0;
  let spawnZ = zoneLine.targetZ || 0;

  if (spawnX > 900000) spawnX = session.char.x || 0;
  if (spawnY > 900000) spawnY = session.char.y || 0;
  if (spawnZ > 900000) spawnZ = session.char.z || 0;



  session.char.x = spawnX;
  session.char.y = spawnY;
  session.char.z = spawnZ;
  session.pendingTeleport = { x: spawnX, y: spawnY, z: spawnZ };
  
  const zoneName = (newZoneDef && newZoneDef.name) || targetZone;
  sendCombatLog(session, [{ event: 'MESSAGE', text: `You have entered ${zoneName}.` }]);
  sendStatus(session);
}

function handleUpdatePos(session, msg) {
  if (session.char) {
    if (msg.x != null) session.char.x = msg.x;
    if (msg.y != null) session.char.y = msg.y;

    // Movement interrupts casting
    if (session.casting && session.casting.startPos) {
      const dx = session.char.x - session.casting.startPos.x;
      const dy = session.char.y - session.casting.startPos.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > 25) { // Small threshold to avoid jitter false-positives
        interruptCasting(session, 'Your spell is interrupted!');
      }
    }
  }
}

function handleUpdateSneak(session, msg) {
  if (!session.char) return;
  const char = session.char;

  // Turning sneak OFF
  if (!msg.sneaking) {
    const wasSneaking = char.isSneaking;
    const wasHidden = char.isHidden;
    char.isSneaking = false;
    // Turning off sneak also breaks hide
    if (wasHidden) {
      char.isHidden = false;
      broadcastEntityState(session, 'ENTITY_HIDE', { hidden: false });
    }
    broadcastEntityState(session, 'ENTITY_SNEAK', { sneaking: false });
    // Only show "stop sneaking" if they were actually sneaking (had the skill)
    if (wasSneaking) {
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'You stop sneaking.' }]);
    }
    return;
  }

  // Turning sneak ON — skill check
  const sneakSkill = combat.getCharSkill(char, 'sneak');
  if (sneakSkill <= 0) {
    // No sneak skill — still allow the crouch visual, just no stealth benefit
    // Don't spam "You do not have the Sneak skill" every time they press Ctrl
    broadcastEntityState(session, 'ENTITY_SNEAK', { sneaking: true });
    return;
  }

  // Cooldown check (10s on failure)
  if (!session.skillCooldowns) session.skillCooldowns = {};
  if (session.skillCooldowns.sneak > 0) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You must wait before sneaking again.' }]);
    send(session.ws, { type: 'SNEAK_RESULT', success: false });
    return;
  }

  // Skill check: higher skill = better chance. At 200 skill, near-guaranteed.
  const successChance = Math.min(95, sneakSkill * 0.5 + 5);
  const succeeded = Math.random() * 100 < successChance;

  if (succeeded) {
    char.isSneaking = true;
    combat.trySkillUp(session, 'sneak');

    // Rogue gets explicit success message
    if (char.class === 'rogue') {
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'You are as quiet as a cat stalking its prey.' }]);
    } else {
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'You begin to move silently.' }]);
    }
    broadcastEntityState(session, 'ENTITY_SNEAK', { sneaking: true });
    send(session.ws, { type: 'SNEAK_RESULT', success: true });
  } else {
    // Failed — 10s cooldown
    session.skillCooldowns.sneak = 10;
    if (char.class === 'rogue') {
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'You are as quiet as a herd of stampeding elephants.' }]);
    } else {
      // Non-rogues don't get explicit failure message (authentic behavior)
      // but we still need to tell the client it failed
    }
    send(session.ws, { type: 'SNEAK_RESULT', success: false });
  }

  // Send skill-up messages if any
  flushSkillUps(session);
}

function handleHide(session, msg) {
  if (!session.char) return;
  const char = session.char;

  // Turning hide OFF
  if (msg && msg.hiding === false) {
    char.isHidden = false;
    broadcastEntityState(session, 'ENTITY_HIDE', { hidden: false });
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You are no longer hidden.' }]);
    send(session.ws, { type: 'HIDE_RESULT', success: false, action: 'off' });
    return;
  }

  // Turning hide ON — skill check
  const hideSkill = combat.getCharSkill(char, 'hide');
  if (hideSkill <= 0) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You do not have the Hide skill.' }]);
    send(session.ws, { type: 'HIDE_RESULT', success: false });
    return;
  }

  // Cooldown check (10s reuse)
  if (!session.skillCooldowns) session.skillCooldowns = {};
  if (session.skillCooldowns.hide > 0) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You must wait before hiding again.' }]);
    send(session.ws, { type: 'HIDE_RESULT', success: false });
    return;
  }

  // Skill check
  const successChance = Math.min(95, hideSkill * 0.5 + 5);
  const succeeded = Math.random() * 100 < successChance;

  if (succeeded) {
    char.isHidden = true;
    combat.trySkillUp(session, 'hide');

    if (char.class === 'rogue') {
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'You have hidden yourself from view.' }]);
    }
    // Non-rogues: no explicit success message (authentic — you see yourself hide but don't know if it worked)
    broadcastEntityState(session, 'ENTITY_HIDE', { hidden: true });
    send(session.ws, { type: 'HIDE_RESULT', success: true });
  } else {
    session.skillCooldowns.hide = 10;
    if (char.class === 'rogue') {
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'You failed to hide yourself.' }]);
    }
    send(session.ws, { type: 'HIDE_RESULT', success: false });
  }

  flushSkillUps(session);
}

// ── Sneak/Hide Break Helpers ────────────────────────────────────────

/** Break sneak state (called when hit by spell/melee, or casting) */
function breakSneak(session) {
  if (!session.char || !session.char.isSneaking) return;
  session.char.isSneaking = false;
  broadcastEntityState(session, 'ENTITY_SNEAK', { sneaking: false });
  sendCombatLog(session, [{ event: 'MESSAGE', text: 'Your sneaking has been interrupted!' }]);
  send(session.ws, { type: 'SNEAK_BROKEN' });
}

/** Break hide state (called when moving without sneak, hit, casting) */
function breakHide(session) {
  if (!session.char || !session.char.isHidden) return;
  session.char.isHidden = false;
  broadcastEntityState(session, 'ENTITY_HIDE', { hidden: false });
  sendCombatLog(session, [{ event: 'MESSAGE', text: 'You are no longer hidden.' }]);
  send(session.ws, { type: 'HIDE_BROKEN' });
}

/** Broadcast an entity state change (sneak/hide) to other players in the zone */
function broadcastEntityState(session, msgType, extraFields) {
  const payload = JSON.stringify({
    type: msgType,
    id: `player_${session.char.id}`,
    ...extraFields
  });
  for (const [ws, other] of sessions) {
    if (other !== session && other.char && other.char.zoneId === session.char.zoneId) {
      try { ws.send(payload); } catch(e) {}
    }
  }
}

/** Broadcast mob movement to all players in the zone */
function broadcastMobMove(mob, zoneId) {
  const payload = JSON.stringify({
    type: 'MOB_MOVE',
    id: mob.id,
    x: mob.x,
    y: mob.y,
    z: mob.z || 0,
    heading: mob.heading || 0
  });
  for (const [ws, other] of sessions) {
    if (other.char && other.char.zoneId === zoneId) {
      try { ws.send(payload); } catch(e) {}
    }
  }
}

/** Flush pending skill-up messages */
function flushSkillUps(session) {
  if (session.skillUpMessages && session.skillUpMessages.length > 0) {
    const logs = session.skillUpMessages.map(m => ({
      event: 'MESSAGE',
      text: `[color=yellow]You have become better at ${m.skillName}! (${m.newLevel})[/color]`
    }));
    sendCombatLog(session, logs);
    session.skillUpMessages = [];
  }
}

// handleMove / getDirName — removed (legacy room-grid movement, not used by 3D client)


// ── Pet System ──────────────────────────────────────────────────────

/**
 * Spawn a summoned pet for a player session.
 * @param {Object} session - Player session
 * @param {Object} petDef - Entry from PET_SPELLS table
 * @param {Object} spellDef - The spell definition
 * @returns {{ pet: Object, events: Array }}
 */
function spawnPet(session, petDef, spellDef) {
  const events = [];
  const zoneId = session.char.zoneId;
  const zone = zoneInstances[zoneId];
  if (!zone) return { pet: null, events: [{ event: 'MESSAGE', text: 'You cannot summon a pet here.' }] };

  // Kill existing pet if any
  if (session.pet) {
    despawnPet(session, 'Your previous pet fades away.');
  }

  // Roll level within range
  const [minLvl, maxLvl] = petDef.levelRange;
  const level = minLvl + Math.floor(Math.random() * (maxLvl - minLvl + 1));

  // Interpolate HP between hpRange
  const [minHp, maxHp] = petDef.hpRange;
  const hp = minLvl === maxLvl ? minHp : Math.floor(minHp + (maxHp - minHp) * ((level - minLvl) / Math.max(1, maxLvl - minLvl)));

  // Pick a name from the name pool
  const namePool = PET_NAMES[petDef.element] || PET_NAMES.generic;
  let petName;
  if (petDef.element === 'animation') {
    petName = `${session.char.name}'s Animation`;
  } else if (namePool.length > 0) {
    petName = namePool[Math.floor(Math.random() * namePool.length)];
  } else {
    petName = petDef.name || 'Pet';
  }

  // Determine race for rendering
  let petRace = petDef.race || 75;
  if (petDef.element === 'animation') {
    petRace = session.char.raceId || 1; // Animations match caster race
  }

  // Build pet skills based on level tier
  const petSkills = {};
  for (const [tierLevel, skills] of Object.entries(PET_SKILL_TIERS)) {
    if (level >= parseInt(tierLevel)) {
      for (const sk of skills) {
        petSkills[sk] = true;
      }
    }
  }
  // Fire pets don't get dodge/parry/doubleAttack
  if (petDef.element === 'fire') {
    delete petSkills.dodge;
    delete petSkills.parry;
    delete petSkills.doubleAttack;
    delete petSkills.doubleKickBash;
  }

  const pet = {
    id: `pet_${session.char.name}_${Date.now()}`,
    name: petName,
    ownerSession: session,
    ownerId: session.char.id,
    isPet: true,
    isCharmed: false,

    // Combat stats
    level: level,
    hp: hp,
    maxHp: hp,
    minDmg: petDef.minDmg,
    maxDmg: petDef.maxDmg,
    attackDelay: petDef.attackDelay || 3.0,
    attackTimer: 0,
    ac: petDef.ac || 0,
    race: petRace,
    gender: 0,
    npcType: NPC_TYPES.MOB, // So it renders, but isPet flag differentiates

    // Position (spawns near owner)
    x: (session.char.x || 0) + 3,
    y: (session.char.y || 0) + 3,
    z: session.char.z || 0,
    spawnX: session.char.x || 0,
    spawnY: session.char.y || 0,

    // AI state
    state: 'follow',       // follow | guard | sit
    guardX: null,
    guardY: null,
    target: null,
    hateList: [],          // [{mob, hate}]
    taunting: true,
    alive: true,

    // Regen
    regen: petSkills.fastRegen ? 30 : 6, // HP per 6-second tick
    regenTimer: 0,

    // Skills & innate spells
    skills: petSkills,
    innateSpells: petDef.innateSpells || [],
    innateSpellCooldowns: {},

    // Pet inventory (QoL: full player control)
    equipment: {},
    inventory: [],

    // Summoning info (for Reclaim Energy)
    summonManaCost: petDef.manaCost || spellDef.manaCost || 0,
    summonSpellId: spellDef.id || spellDef._spellId || 0,

    // Damage tracking for XP penalty
    totalDamageDealt: 0,
  };

  // Add pet to session and zone
  session.pet = pet;
  zone.liveMobs.push(pet);

  events.push({ event: 'MESSAGE', text: `You have summoned a pet.` });
  events.push({ event: 'MESSAGE', text: `[color=cyan]${petName} says, 'I live to serve you, master.'[/color]` });

  return { pet, events };
}

/**
 * Despawn a pet, removing it from the zone and clearing session reference.
 */
function despawnPet(session, message) {
  if (!session.pet) return;
  const pet = session.pet;
  const zone = zoneInstances[session.char.zoneId];
  if (zone) {
    zone.liveMobs = zone.liveMobs.filter(m => m.id !== pet.id);
  }
  // If charmed, revert mob to hostile
  if (pet.isCharmed && pet._originalTarget !== undefined) {
    pet.isPet = false;
    pet.isCharmed = false;
    pet.target = session; // Attack the charmer
    // Don't remove from liveMobs — it's still an active mob
    if (zone && !zone.liveMobs.includes(pet)) {
      zone.liveMobs.push(pet);
    }
  }
  session.pet = null;
  if (message) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: message }]);
  }
}

/**
 * Convert a mob into a charmed pet.
 */
function charmMob(session, mob, spellDef) {
  const events = [];

  // Kill existing pet
  if (session.pet) {
    despawnPet(session, 'Your previous pet fades away.');
  }

  // Calculate charm duration
  const baseTicks = spellDef.duration ? (spellDef.duration.ticks || spellDef.duration / 6) : 205;
  const chaBonusTicks = Math.max(0, Math.floor(((session.effectiveStats?.cha || session.char.cha) - 75) / 25));
  const totalDuration = (baseTicks + chaBonusTicks) * 6; // Convert ticks to seconds

  // Store original state for uncharm
  mob._originalTarget = mob.target;
  mob.isPet = true;
  mob.isCharmed = true;
  mob.ownerSession = session;
  mob.ownerId = session.char.id;
  mob.state = 'follow';
  mob.guardX = null;
  mob.guardY = null;
  mob.target = null;
  mob.hateList = [];
  mob.taunting = true;
  mob.charmDuration = totalDuration;
  mob.charmTickTimer = 6; // Check for break every 6 seconds
  mob.totalDamageDealt = 0;
  mob.alive = true;
  // Give pet equipment/inventory structures
  if (!mob.equipment) mob.equipment = {};
  if (!mob.inventory) mob.inventory = [];

  session.pet = mob;

  // Stop combat
  session.inCombat = false;
  session.autoFight = false;
  session.combatTarget = null;

  events.push({ event: 'MESSAGE', text: `${mob.name} regards you as an ally!` });
  events.push({ event: 'MESSAGE', text: `[color=cyan]${mob.name} is now under your command.[/color]` });

  return events;
}

/**
 * Handle pet commands from the player.
 */
function handlePetCommand(session, msg) {
  if (!session.pet || !session.pet.alive) {
    return sendCombatLog(session, [{ event: 'MESSAGE', text: 'You do not have a pet.' }]);
  }

  const pet = session.pet;
  const cmd = (msg.command || '').toLowerCase();
  const events = [];

  switch (cmd) {
    case 'follow':
      pet.state = 'follow';
      pet.guardX = null;
      pet.guardY = null;
      events.push({ event: 'MESSAGE', text: `${pet.name} begins to follow you.` });
      break;

    case 'guard':
      pet.state = 'guard';
      pet.guardX = pet.x;
      pet.guardY = pet.y;
      events.push({ event: 'MESSAGE', text: `${pet.name} guards this position.` });
      break;

    case 'sit':
      pet.state = 'sit';
      events.push({ event: 'MESSAGE', text: `${pet.name} sits down.` });
      break;

    case 'attack': {
      // Attack owner's current target
      const targetMob = session.combatTarget;
      if (!targetMob) {
        events.push({ event: 'MESSAGE', text: 'You must have a target for your pet to attack.' });
        break;
      }
      if (targetMob.isPet) {
        events.push({ event: 'MESSAGE', text: 'Your pet refuses to attack another pet.' });
        break;
      }
      // Add to hate list
      const existingHate = pet.hateList.find(h => h.mob === targetMob);
      if (existingHate) {
        existingHate.hate += 1000;
      } else {
        pet.hateList.push({ mob: targetMob, hate: 1000 });
      }
      pet.state = 'follow'; // Wake up from sit/guard
      events.push({ event: 'MESSAGE', text: `${pet.name} attacks ${targetMob.name}!` });
      break;
    }

    case 'backoff':
      pet.hateList = [];
      pet.target = null;
      events.push({ event: 'MESSAGE', text: `${pet.name} backs off.` });
      break;

    case 'taunt':
      pet.taunting = !pet.taunting;
      events.push({ event: 'MESSAGE', text: `${pet.name} will ${pet.taunting ? 'now' : 'no longer'} taunt enemies.` });
      break;

    case 'getlost':
      events.push({ event: 'MESSAGE', text: `${pet.name} says, 'As you wish, master.' and fades away.` });
      despawnPet(session);
      break;

    case 'health': {
      const hpPct = Math.floor((pet.hp / pet.maxHp) * 100);
      let condition;
      if (hpPct >= 90) condition = 'is in excellent health';
      else if (hpPct >= 75) condition = 'is slightly injured';
      else if (hpPct >= 50) condition = 'is moderately wounded';
      else if (hpPct >= 25) condition = 'is badly wounded';
      else condition = 'is near death';
      events.push({ event: 'MESSAGE', text: `${pet.name} ${condition}. (${pet.hp}/${pet.maxHp} HP)` });
      break;
    }

    case 'leader':
      events.push({ event: 'MESSAGE', text: `[color=cyan]${pet.name} says, 'My leader is ${session.char.name}.'[/color]` });
      break;

    case 'target':
      // Set owner's target to the pet itself (for healing, buffs, etc.)
      session.combatTarget = pet;
      events.push({ event: 'MESSAGE', text: `You target ${pet.name}.` });
      break;

    case 'asyouwere':
      pet.hateList = [];
      pet.target = null;
      pet.state = 'follow';
      events.push({ event: 'MESSAGE', text: `${pet.name} returns to your side.` });
      break;

    default:
      events.push({ event: 'MESSAGE', text: `Unknown pet command: ${cmd}. Try: follow, guard, sit, attack, backoff, taunt, getlost, health, leader, target` });
  }

  if (events.length > 0) sendCombatLog(session, events);
}

/**
 * Process pet AI for a single pet during the mob AI tick.
 * Called from processMobAI for mobs with isPet === true.
 */
function processPetAI(pet, zone, zoneId, dt) {
  if (!pet.alive || !pet.ownerSession) return;

  const owner = pet.ownerSession;
  if (!owner.char || owner.char.zoneId !== zoneId) {
    // Owner left the zone — despawn pet
    despawnPet(owner, 'Your pet fades away as you leave.');
    return;
  }

  // ── Charm Break Check ──
  if (pet.isCharmed) {
    pet.charmDuration -= dt;
    pet.charmTickTimer -= dt;
    if (pet.charmDuration <= 0) {
      // Charm expired
      sendCombatLog(owner, [{ event: 'MESSAGE', text: `[color=red]Your charm has worn off! ${pet.name} turns hostile![/color]` }]);
      pet.isPet = false;
      pet.isCharmed = false;
      pet.target = owner; // Attack the charmer
      owner.pet = null;
      return;
    }
    if (pet.charmTickTimer <= 0) {
      pet.charmTickTimer = 6; // Check every 6 seconds
      // Periodic resist check — chance to break early
      const breakChance = 5 + Math.max(0, (pet.level - owner.char.level) * 2); // Higher level = more likely to break
      if (Math.random() * 100 < breakChance) {
        sendCombatLog(owner, [{ event: 'MESSAGE', text: `[color=red]Your charm has been broken! ${pet.name} turns hostile![/color]` }]);
        pet.isPet = false;
        pet.isCharmed = false;
        pet.target = owner;
        owner.pet = null;
        return;
      }
    }
  }

  // ── Regen ──
  pet.regenTimer -= dt;
  if (pet.regenTimer <= 0) {
    pet.regenTimer = 6; // 6-second EQ tick
    if (pet.hp < pet.maxHp) {
      const regenAmt = pet.state === 'sit' ? Math.floor(pet.regen * 1.5) : pet.regen;
      pet.hp = Math.min(pet.maxHp, pet.hp + regenAmt);
    }
  }

  // ── Combat ──
  // Clean up dead targets from hate list
  pet.hateList = pet.hateList.filter(h => h.mob && h.mob.hp > 0);

  // If no hate list targets, clear combat target
  if (pet.hateList.length === 0) {
    pet.target = null;
  } else {
    // Select highest-hate target
    pet.hateList.sort((a, b) => b.hate - a.hate);
    pet.target = pet.hateList[0].mob;
  }

  // ── Movement ──
  const MELEE_RANGE = 15;
  const FOLLOW_DISTANCE = 8;
  const PET_SPEED = 8 + (pet.level || 1) * 0.3;

  if (pet.target && pet.target.hp > 0) {
    // Combat chase — move toward target
    const dx = pet.target.x - pet.x;
    const dy = pet.target.y - pet.y;
    const distSq = dx * dx + dy * dy;

    if (distSq > MELEE_RANGE * MELEE_RANGE) {
      const moveAmt = PET_SPEED * dt;
      pet.x += (dx / dist) * Math.min(moveAmt, dist);
      pet.y += (dy / dist) * Math.min(moveAmt, dist);
    }

    // ── Pet Melee Attack ──
    if (dist <= MELEE_RANGE) {
      pet.attackTimer -= dt;
      if (pet.attackTimer <= 0) {
        pet.attackTimer = pet.attackDelay;

        const target = pet.target;
        const events = [];

        // Hit chance based on level difference
        const hitChance = Math.min(95, Math.max(30, 60 + (pet.level - target.level) * 3));
        if (Math.random() * 100 < hitChance) {
          // Damage roll
          const dmgRange = pet.maxDmg - pet.minDmg;
          let dmg = pet.minDmg + Math.floor(Math.random() * (dmgRange + 1));

          // Check for equipped weapon — use weapon damage if higher
          if (pet.equipment && pet.equipment.primary) {
            const wpnDmg = pet.equipment.primary.damage || 0;
            if (wpnDmg > dmg) dmg = wpnDmg;
          }

          // Double attack check
          let totalDmg = dmg;
          if (pet.skills.doubleAttack && Math.random() < 0.3) {
            const dmg2 = pet.minDmg + Math.floor(Math.random() * (dmgRange + 1));
            totalDmg += dmg2;
          }

          target.hp -= totalDmg;
          pet.totalDamageDealt += totalDmg;

          // Make the target aggro back on the pet if taunting
          if (pet.taunting && target.target !== pet) {
            target.target = pet; // Mob now attacks the pet instead of player
          }

          events.push({ event: 'MELEE_HIT', source: pet.name, target: target.name, damage: totalDmg });
        } else {
          events.push({ event: 'MELEE_MISS', source: pet.name, target: target.name });
        }

        // Pet innate spells
        if (pet.innateSpells && pet.innateSpells.length > 0 && target.hp > 0) {
          for (const innate of pet.innateSpells) {
            if (!pet.innateSpellCooldowns[innate] || pet.innateSpellCooldowns[innate] <= 0) {
              let innateDmg = 0;
              let innateMsg = '';
              switch (innate) {
                case 'fireBolt':
                  innateDmg = Math.floor(pet.level * 2.5 + 10);
                  innateMsg = 'Fire Bolt';
                  pet.innateSpellCooldowns[innate] = 8;
                  break;
                case 'iceBolt':
                  innateDmg = Math.floor(pet.level * 2 + 8);
                  innateMsg = 'Ice Bolt';
                  pet.innateSpellCooldowns[innate] = 8;
                  break;
                case 'stun':
                  innateDmg = Math.floor(pet.level * 0.5);
                  innateMsg = 'Stun';
                  pet.innateSpellCooldowns[innate] = 12;
                  // Apply brief stun to target
                  if (!target.buffs) target.buffs = [];
                  target.buffs.push({ name: 'Pet Stun', duration: 2, isStun: true });
                  break;
                case 'root':
                  innateDmg = 0;
                  innateMsg = 'Root';
                  pet.innateSpellCooldowns[innate] = 15;
                  if (!target.buffs) target.buffs = [];
                  target.buffs.push({ name: 'Pet Root', duration: 8, isRoot: true });
                  break;
                case 'damageShield':
                  // Passive — handled elsewhere
                  break;
              }
              if (innateDmg > 0) {
                target.hp -= innateDmg;
                pet.totalDamageDealt += innateDmg;
                events.push({ event: 'SPELL_DAMAGE', source: pet.name, target: target.name, spell: innateMsg, damage: innateDmg });
              } else if (innateMsg && innateMsg !== 'Root') {
                events.push({ event: 'MESSAGE', text: `${pet.name} casts ${innateMsg} on ${target.name}!` });
              }
              break; // Only one innate per tick
            }
          }
        }

        // Send combat events to owner
        if (events.length > 0) sendCombatLog(owner, events);

        // Check if target died
        if (target.hp <= 0) {
          // Find the session that was fighting this mob for XP credit
          let xpSession = null;
          for (const [, s] of sessions) {
            if (s.combatTarget === target) { xpSession = s; break; }
          }
          if (!xpSession) xpSession = owner; // Owner gets XP if no one else is fighting
          handleMobDeath(xpSession, target, []);
          pet.hateList = pet.hateList.filter(h => h.mob !== target);
          pet.target = null;
        }
      }
    }
  } else {
    // No combat target — movement based on state
    if (pet.state === 'follow') {
      const dx = owner.char.x - pet.x;
      const dy = owner.char.y - pet.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > FOLLOW_DISTANCE * FOLLOW_DISTANCE) {
        const dist = Math.sqrt(distSq);
        const moveAmt = PET_SPEED * dt;
        pet.x += (dx / dist) * Math.min(moveAmt, dist - FOLLOW_DISTANCE + 1);
        pet.y += (dy / dist) * Math.min(moveAmt, dist - FOLLOW_DISTANCE + 1);
      }
    } else if (pet.state === 'guard' && pet.guardX != null) {
      // Return to guard position if displaced by combat
      const dx = pet.guardX - pet.x;
      const dy = pet.guardY - pet.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > 9) {
        const dist = Math.sqrt(distSq);
        const moveAmt = PET_SPEED * dt;
        pet.x += (dx / dist) * Math.min(moveAmt, dist);
        pet.y += (dy / dist) * Math.min(moveAmt, dist);
      }
    }
    // sit: pet stays still
  }

  // Cooldown innate spell timers
  for (const key of Object.keys(pet.innateSpellCooldowns)) {
    if (pet.innateSpellCooldowns[key] > 0) {
      pet.innateSpellCooldowns[key] -= dt;
    }
  }
}

/**
 * Handle pet death — called when pet HP reaches 0.
 */
function handlePetDeath(pet, zone) {
  if (!pet.ownerSession) return;
  const owner = pet.ownerSession;

  sendCombatLog(owner, [{ event: 'MESSAGE', text: `[color=red]${pet.name} has been slain![/color]` }]);

  // Remove from zone
  if (zone) {
    zone.liveMobs = zone.liveMobs.filter(m => m.id !== pet.id);
  }

  // Clear session reference
  owner.pet = null;
}


// ── Combat Processing ───────────────────────────────────────────────

async function processCombatTick(session, dt) {
  if (!session.inCombat || !session.combatTarget) return;

  const mob = session.combatTarget;
  const events = [];

  // Player auto-attack & AI Behaviors
  session.attackTimer -= dt;

  let skipMelee = false;

  // -- The Rogue Loop --
  if (session.char.class === 'rogue') {
    if ((!session.abilityCooldowns['backstab'] || session.abilityCooldowns['backstab'] <= 0) && session.attackTimer <= 0) {
      const { damage } = getWeaponStats(session.inventory);
      const bsDmg = combat.calcBackstabDamage(session, damage);
      if (bsDmg > 0) {
        mob.hp -= bsDmg;
        events.push({ event: 'MELEE_HIT', source: 'You', target: mob.name, damage: bsDmg, text: 'Backstab!' });
      } else {
        events.push({ event: 'MELEE_MISS', source: 'You', target: mob.name, text: 'Backstab missed' });
      }
      session.abilityCooldowns['backstab'] = 10; // 10s cooldown
    }
  } 
  // -- The Cleric Loop --
  else if (session.char.class === 'cleric') {
    if (session.char.hp < session.effectiveStats.hp * 0.5 && session.char.mana >= 20 && !session.abilityCooldowns['cast']) {
      session.char.mana -= 20;
      session.char.hp = Math.min(session.char.hp + 60, session.effectiveStats.hp);
      events.push({ event: 'SPELL_HEAL', source: 'You', target: 'You', spell: 'Lesser Healing', amount: 60 });
      session.abilityCooldowns['cast'] = 4; 
      skipMelee = true;
    } else if (session.char.hp > session.effectiveStats.hp * 0.7 && session.char.mana < session.effectiveStats.mana * 0.9) {
      if (session.char.state === 'standing') {
        session.char.state = 'medding';
        events.push({ event: 'MESSAGE', text: 'You sit down to conserve mana.' });
      }
      skipMelee = true;
    } else {
      if (session.char.state === 'medding') session.char.state = 'standing';
    }
  } 
  // -- The Wizard Loop --
  else if (session.char.class === 'wizard') {
    if (session.char.mana >= 30 && !session.abilityCooldowns['cast']) {
      session.char.mana -= 30;
      const resist = combat.calcSpellResist(mob, session.char.level, 'magic');
      if (resist === 'FULL_RESIST') {
        events.push({ event: 'RESIST', target: mob.name, spell: 'Shock of Lightning' });
      } else {
        let dmg = 45;
        if (resist === 'PARTIAL_RESIST') dmg = Math.floor(dmg / 2);
        mob.hp -= dmg;
        events.push({ event: 'SPELL_DAMAGE', source: 'You', target: mob.name, spell: 'Shock of Lightning', damage: dmg });
      }
      session.abilityCooldowns['cast'] = 6;
      skipMelee = true;
    } else if (session.char.mana < 30) {
      if (session.char.state === 'standing') {
        session.char.state = 'medding';
        events.push({ event: 'MESSAGE', text: 'You sit down to meditate.' });
      }
      skipMelee = true;
    } else {
      if (session.char.state === 'medding') session.char.state = 'standing';
    }
  }

  if (session.attackTimer <= 0 && !skipMelee && session.char.state === 'standing') {
    const { damage, delay } = getWeaponStats(session.inventory);
    // Check for haste buffs (SPA 11 with positive base = attack speed increase)
    let hasteMod = 1.0;
    if (Array.isArray(session.buffs)) {
      for (const buff of session.buffs) {
        if (Array.isArray(buff.effects)) {
          const hasteEff = buff.effects.find(e => e.spa === 11 && e.base > 0);
          if (hasteEff) hasteMod = Math.min(2.0, 1.0 + (hasteEff.base / 100)); // e.g. +30 = 1.3x speed
        }
      }
    }
    session.attackTimer = (delay / 10) / hasteMod; // Haste reduces delay

    if (session.isOutOfRange) {
      events.push({ event: 'MESSAGE', text: 'You cannot reach your target!' });
    } else {
      // First successful swing in range triggers mob aggro
      if (mob.target !== session) {
        mob.target = session;
      }
      const atk = combat.calcPlayerATK(session);
      const def = combat.calcMobDefense(mob);
      const charLvl = session.char.level;

      const executeAttack = (isOffhand) => {
        const wpnSkill = getWeaponSkillName(session.inventory);
        combat.trySkillUp(session, wpnSkill);
        combat.trySkillUp(session, 'offense');

        const hitChance = combat.calcHitChance(atk, def, charLvl - mob.level);
        if (combat.chance(hitChance)) {
          let dmgRoll = combat.calcPlayerDamage(session, damage, delay);
          const isCrit = combat.checkCritical(session.char.class, charLvl);
          const isCripple = combat.checkCripplingBlow(charLvl, mob.level);
          
          if (isCrit || isCripple) dmgRoll *= 2;
          mob.hp -= dmgRoll;

          let txt = isOffhand ? '' : null;
          if (isCrit) txt = isOffhand ? '(Offhand Crit)' : 'Critical hit!';
          else if (isCripple) txt = isOffhand ? '(Offhand Cripple)' : 'Crippling blow!';
          else if (isOffhand) txt = 'Offhand hit';

          if (txt) {
            events.push({ event: 'MELEE_HIT', source: 'You', target: mob.name, damage: dmgRoll, text: txt });
          } else {
            events.push({ event: 'MELEE_HIT', source: 'You', target: mob.name, damage: dmgRoll });
          }
        } else {
          events.push({ event: 'MELEE_MISS', source: 'You', target: mob.name, text: isOffhand ? 'Offhand miss' : null });
        }
      };

      // Main hand
      executeAttack(false);

      // Double attack
      if (mob.hp > 0 && combat.checkDoubleAttack(session)) {
        events.push({ event: 'MESSAGE', text: 'You double attack!' });
        executeAttack(false);
      }

      // Dual wield
      if (mob.hp > 0 && combat.checkDualWield(session)) {
        setTimeout(() => {
          if (session.inCombat && session.char.state === 'standing' && mob.hp > 0 && !session.isOutOfRange) {
             executeAttack(true);
             if (events.length > 0) sendCombatLog(session, events);
          }
        }, 150);
      }
    }
  }

  // Mob auto-attack moved to game loop!

  // Check mob death
  if (mob.hp <= 0) {
    await handleMobDeath(session, mob, events);
  }

  // Check player death
  if (session.char.hp <= 0) {
    session.char.hp = 0;
    events.push({ event: 'DEATH', who: 'YOU' });
    events.push({ event: 'MESSAGE', text: 'You have been slain! You return to your bind point.' });

    session.char.hp = Math.floor(session.effectiveStats.hp * 0.5);
    session.char.mana = Math.floor(session.effectiveStats.mana * 0.5);
    session.char.state = 'standing';
    session.inCombat = false;
    session.combatTarget = null;
    // Despawn pet on owner death
    if (session.pet) {
      despawnPet(session, 'Your pet has lost its master and fades away.');
    }

    const xpPenalty = Math.floor(combat.xpForLevel(session.char.level) * 0.05);
    session.char.experience = Math.max(0, session.char.experience - xpPenalty);
    events.push({ event: 'MESSAGE', text: `You lost ${xpPenalty} experience.` });
  }

  if (session.skillUpMessages && session.skillUpMessages.length > 0) {
    for (const msg of session.skillUpMessages) {
       events.push({ event: 'MESSAGE', text: `[color=yellow]You have become better at ${msg.skillName}! (${msg.newLevel})[/color]` });
    }
    session.skillUpMessages = [];
  }

  if (events.length > 0) sendCombatLog(session, events);
}

async function handleMobDeath(session, mob, events) {
  events.push({ event: 'DEATH', who: mob.name });

  // XP
  const zone = zoneInstances[session.char.zoneId];
  const zem = zone && zone.def ? zone.def.zem : 1.0;
  const xp = combat.calcXPGain(session.char.level, mob.level, mob.xpBase, zem);
  
  if (xp > 0) {
    session.char.experience += xp;
    events.push({ event: 'XP_GAIN', amount: xp });
  } else {
    events.push({ event: 'MESSAGE', text: 'You gain no experience for such a trivial opponent.' });
  }

  // Level up check (supports multi-level-up, capped at 60)
  let levelsGained = 0;
  while (session.char.level < 60 && levelsGained < 5) {
    const nextLevelXp = combat.xpForLevel(session.char.level + 1);
    if (session.char.experience < nextLevelXp) break;
    
    session.char.level++;
    levelsGained++;
    // Award 5 practice points per level
    session.char.practices = (session.char.practices || 0) + 5;
    session.effectiveStats = calcEffectiveStats(session.char, session.inventory, session.buffs);
    session.char.maxHp = session.effectiveStats.hp;
    session.char.maxMana = session.effectiveStats.mana;
    session.char.hp = session.char.maxHp;
    session.char.mana = session.char.maxMana;
    events.push({ event: 'LEVEL_UP', level: session.char.level });

    const newSpells = SpellDB.getNewSpellsAtLevel(session.char.class, session.char.level);
    for (const spell of newSpells) {
      const result = scribeSpellToBook(session, spell._key);
      if (result >= 0) {
        events.push({ event: 'MESSAGE', text: `You have learned ${spell.name}! It has been scribed to your spellbook.` });
      }
    }
    if (newSpells.length > 0) sendSpellbookFull(session);
  }

  // Loot
  for (const lootEntry of mob.loot) {
    if (Math.random() < lootEntry.chance) {
      const itemDef = ITEMS[lootEntry.itemKey];
      if (itemDef) {
        // Stackable items check
        if (itemDef.type !== 'weapon' && itemDef.type !== 'armor' && itemDef.type !== 'shield' && itemDef.type !== 'clothing') {
            const existing = session.inventory.find(i => i.item_key === lootEntry.itemKey);
            if (existing) {
                DB.updateItemQuantity(existing.id, session.char.id, 1);
            } else {
                DB.addItem(session.char.id, lootEntry.itemKey, 0, 0, 1);
            }
        } else {
            DB.addItem(session.char.id, lootEntry.itemKey, 0, 0, 1);
        }
        
        session.inventory = await DB.getInventory(session.char.id);
        events.push({ event: 'LOOT', item: itemDef.name, source: mob.name });
      }
    }
  }

  // Remove mob
  if (zone) {
    zone.liveMobs = zone.liveMobs.filter(m => m.id !== mob.id);
  }

  session.combatTarget = null;
  session.inCombat = false;
  session.autoFight = false; // Stop auto-attacking new targets after death

  sendFullState(session);
}

function handleCamp(session) {
  // Must be sitting to camp
  if (session.char.state !== 'medding') {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You must be sitting to camp.' }]);
    return;
  }

  // Can't camp while in combat
  if (session.autoFight || session.inCombat) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You cannot camp while in combat!' }]);
    return;
  }

  // Already camping?
  if (session.campTimer) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You are already camping.' }]);
    return;
  }

  // Start the 15-second countdown
  session.campCountdown = 15;
  sendCombatLog(session, [{ event: 'MESSAGE', text: `It will take about ${session.campCountdown} seconds to camp.` }]);

  session.campTimer = setInterval(() => {
    // Cancel if player stood up, entered combat, or disconnected
    if (!sessions.has(session.ws)) {
      clearInterval(session.campTimer);
      session.campTimer = null;
      return;
    }

    if (session.char.state !== 'medding' || session.autoFight || session.inCombat) {
      clearInterval(session.campTimer);
      session.campTimer = null;
      session.campCountdown = 0;
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'You have stopped camping.' }]);
      return;
    }

    session.campCountdown--;

    if (session.campCountdown <= 0) {
      // Camp complete!
      clearInterval(session.campTimer);
      session.campTimer = null;

      // Save character state
      DB.updateCharacterState(session.char);
      DB.saveCharacterSkills(session.char.id, session.char.skills);
      saveBuffsToFile(session);
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'You have safely camped out.' }]);

      // Tell the client to return to character select
      send(session.ws, { type: 'CAMP_COMPLETE' });

      // Remove session
      sessions.delete(session.ws);
    } else {
      sendCombatLog(session, [{ event: 'MESSAGE', text: `Remain camping for ${session.campCountdown} seconds to log out.` }]);
    }
  }, 1000);
}

function handleTrainSkill(session, msg) {
  const skillKey = msg.skillKey;
  if (!skillKey) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'No skill specified.' }]);
    return;
  }

  const skillDef = Skills[skillKey];
  if (!skillDef) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'Unknown skill.' }]);
    return;
  }

  const playerClass = session.char.class;
  const classData = skillDef.classes[playerClass];
  if (!classData) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You cannot learn ${skillDef.name}.` }]);
    return;
  }

  // Level requirement check
  if (session.char.level < classData.levelGranted) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You are not high enough level to train ${skillDef.name}.` }]);
    return;
  }

  // Cap check
  const currentValue = (session.char.skills || {})[skillKey] || 0;
  const levelCap = Math.min(classData.capFormula(session.char.level), classData.maxCap);
  if (currentValue >= levelCap) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `Your ${skillDef.name} skill is already at its maximum for your level.` }]);
    return;
  }

  // Determine payment method
  const usePractice = msg.usePractice !== false; // Default to using practice points
  let paid = false;

  if (usePractice && (session.char.practices || 0) > 0) {
    // Spend a practice point (free training)
    session.char.practices--;
    paid = true;
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You have increased your ${skillDef.name} skill to ${currentValue + 1}! (${session.char.practices} practice points remaining)` }]);
  } else {
    // Pay with coin
    const costCopper = getTrainingCostCopper(currentValue);
    if (costCopper > 0 && (session.char.copper || 0) < costCopper) {
      const coins = copperToCoins(costCopper);
      const costStr = [];
      if (coins.pp > 0) costStr.push(`${coins.pp}pp`);
      if (coins.gp > 0) costStr.push(`${coins.gp}gp`);
      if (coins.sp > 0) costStr.push(`${coins.sp}sp`);
      if (coins.cp > 0) costStr.push(`${coins.cp}cp`);
      sendCombatLog(session, [{ event: 'MESSAGE', text: `You cannot afford to train ${skillDef.name}. Cost: ${costStr.join(' ')}.` }]);
      return;
    }
    session.char.copper = (session.char.copper || 0) - costCopper;
    paid = true;
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You have trained ${skillDef.name} to ${currentValue + 1}!` }]);
  }

  if (!paid) return;

  // Increment the skill
  if (!session.char.skills) session.char.skills = {};
  session.char.skills[skillKey] = currentValue + 1;

  // Persist immediately
  DB.saveCharacterSkills(session.char.id, session.char.skills);
  DB.updateCharacterState(session.char);

  // Resend the full trainer window so costs/ranks refresh
  const skillList = [];
  const charSkills = session.char.skills;
  for (const [key, sDef] of Object.entries(Skills)) {
    const cData = sDef.classes[playerClass];
    if (!cData) continue;
    const val = charSkills[key] || 0;
    const cap = Math.min(cData.capFormula(session.char.level), cData.maxCap);
    const rank = getSkillRank(val, cData.maxCap);
    const atCap = val >= cap;
    const tooLow = session.char.level < cData.levelGranted;
    let costC = 0, costCoins = { pp: 0, gp: 0, sp: 0, cp: 0 }, canTrain = false;
    if (!atCap && !tooLow) {
      canTrain = true;
      costC = getTrainingCostCopper(val);
      costCoins = copperToCoins(costC);
    }
    skillList.push({
      key, name: sDef.name, type: sDef.type,
      value: val, cap, maxCap: cData.maxCap, rank, canTrain,
      costPp: canTrain ? costCoins.pp : null,
      costGp: canTrain ? costCoins.gp : null,
      costSp: canTrain ? costCoins.sp : null,
      costCp: canTrain ? costCoins.cp : null,
      costTotalCopper: canTrain ? costC : 0,
      levelGranted: cData.levelGranted,
    });
  }

  send(session.ws, {
    type: 'OPEN_TRAINER',
    npcId: msg.npcId || 0,
    npcName: msg.npcName || 'Trainer',
    trainerClass: playerClass,
    practices: session.char.practices || 0,
    copper: session.char.copper || 0,
    skills: skillList,
  });
}

// ── Movement & Zoning ───────────────────────────────────────────────────────────

function processRegen(session, dt) {
  if (!session.abilityCooldowns) session.abilityCooldowns = {};
  for (let key in session.abilityCooldowns) {
    if (session.abilityCooldowns[key] > 0) session.abilityCooldowns[key] -= dt;
  }

  const char = session.char;
  const effective = session.effectiveStats;
  if (char.hp <= 0) return;

  const rates = combat.getRegenRates(char.class, char.level, effective);

  if (char.state === 'medding') {
    char.hp = combat.clamp(char.hp + rates.hpSitting, 0, effective.hp);
    if (effective.mana > 0) {
      char.mana = combat.clamp(char.mana + rates.manaSitting, 0, effective.mana);
    }
  } else if (!session.inCombat) {
    char.hp = combat.clamp(char.hp + rates.hpStanding, 0, effective.hp);
    if (effective.mana > 0) {
      char.mana = combat.clamp(char.mana + rates.manaStanding, 0, effective.mana);
    }
  }
}

// ── Buff Processing ─────────────────────────────────────────────────

function processBuffs(session, dt) {
  let changed = false;
  for (let i = session.buffs.length - 1; i >= 0; i--) {
    const buff = session.buffs[i];
    buff.duration -= dt;

    // Tick HoT effects (SPA 0 with positive base = heal over time)
    if (Array.isArray(buff.effects)) {
      const hotEffect = buff.effects.find(e => e.spa === 0 && e.base > 0);
      if (hotEffect) {
        if (!buff.tickTimer) buff.tickTimer = 6;
        buff.tickTimer -= dt;
        if (buff.tickTimer <= 0) {
          buff.tickTimer = 6; // Reset to 6-second EQ tick
          const healAmt = hotEffect.base;
          session.char.hp = Math.min(session.char.hp + healAmt, session.effectiveStats.hp);
          sendCombatLog(session, [{ event: 'SPELL_HEAL', source: buff.name, target: 'You', spell: buff.name, amount: healAmt }]);
        }
      }
    }

    if (buff.duration <= 0) {
      // Send fade message
      sendCombatLog(session, [{ event: 'MESSAGE', text: `${buff.name} has worn off.` }]);
      session.buffs.splice(i, 1);
      changed = true;
    }
  }
  if (changed) {
    // Recalculate stats when a buff expires (remove its bonuses)
    session.effectiveStats = calcEffectiveStats(session.char, session.inventory, session.buffs);
    session.char.maxHp = session.effectiveStats.hp;
    session.char.maxMana = session.effectiveStats.mana;
    // Cap current HP/mana to new max
    if (session.char.hp > session.effectiveStats.hp) session.char.hp = session.effectiveStats.hp;
    if (session.char.mana > session.effectiveStats.mana) session.char.mana = session.effectiveStats.mana;
    sendBuffs(session);
  }
}

// ── Network Helpers ─────────────────────────────────────────────────


// Compute per-slot armor material indices and weapon model IDs from equipped items
// Returns: { head: 0, chest: 0, ..., primaryWeapon: 'IT10', secondaryWeapon: 'IT215' }
function getEquipVisuals(session) {
  const visuals = { head: 0, chest: 0, arms: 0, wrist: 0, hands: 0, legs: 0, feet: 0, primaryWeapon: '', secondaryWeapon: '' };
  if (!session || !session.inventory) return visuals;

  // EQEmu equip slot -> body part mapping
  const slotMap = {
    2: 'head',    // HEAD
    7: 'arms',    // ARMS
    9: 'wrist',   // WRIST1
    10: 'wrist',  // WRIST2
    12: 'hands',  // HANDS
    17: 'chest',  // CHEST
    18: 'legs',   // LEGS
    19: 'feet',   // FEET
  };

  for (const inv of session.inventory) {
    if (inv.equipped !== 1) continue;
    const itemDef = ItemDB.getById(inv.item_key);
    if (!itemDef) continue;

    // Armor material
    const bodyPart = slotMap[inv.slot];
    if (bodyPart && itemDef.material !== undefined) {
      visuals[bodyPart] = itemDef.material;
    }

    // Primary weapon (slot 13)
    if (inv.slot === 13 && itemDef.idfile) {
      visuals.primaryWeapon = itemDef.idfile.toLowerCase();
    }
    // Secondary weapon/shield (slot 14)
    if (inv.slot === 14 && itemDef.idfile) {
      visuals.secondaryWeapon = itemDef.idfile.toLowerCase();
    }
  }

  // console.log(`[ENGINE] equipVisuals: ${JSON.stringify(visuals)}`);
  return visuals;
}

function sendFullState(session) {
  sendLoginOk(session);
  sendInventory(session);
  sendSpellbook(session);
  sendSpellbookFull(session);
  sendBuffs(session);
  sendStatus(session);
  handleLook(session);
}

function sendLoginOk(session) {
  const char = session.char;
  const effective = session.effectiveStats;
  const zone = getZoneDef(char.zoneId);

  send(session.ws, {
    type: 'LOGIN_OK',
    character: {
      name: char.name,
      class: char.class,
      race: char.race,
      raceId: char.raceId || 1,
      gender: char.gender || 0,
      face: char.face || 0,
      level: char.level,
      experience: char.experience,
      nextLevelXp: combat.xpForLevel(char.level + 1),
      hp: char.hp,
      maxHp: effective.hp,
      mana: char.mana,
      maxMana: effective.mana,
      state: char.state,
      inCombat: session.inCombat,
      zone: zone ? zone.name : 'Unknown',
      zoneId: char.zoneId,
      connections: zone ? zone.connections : [],
      copper: char.copper,
      x: char.x,
      y: char.y,
      z: char.z || 0,
      stats: {
        str: effective.str, sta: effective.sta, agi: effective.agi,
        dex: effective.dex, wis: effective.wis, intel: effective.intel,
        cha: effective.cha, ac: effective.ac,
      },
      equipVisuals: getEquipVisuals(session),
    },
  });
}

function sendStatus(session) {
  const char = session.char;
  const effective = session.effectiveStats;
  const zone = getZoneDef(char.zoneId);

  // Pick out basic room data if it exists
  let roomName = null;
  let roomId = null;
  let mapData = null;
  
  if (!session.visitedRooms) session.visitedRooms = new Set();
  
  if (zone && zone.rooms && char.roomId) {
     session.visitedRooms.add(char.roomId);
     const rm = zone.rooms[char.roomId];
     if (rm) {
       roomName = rm.name;
       roomId = rm.id;
       mapData = Object.values(zone.rooms).map(r => ({
          id: r.id, name: r.name, x: r.x, y: r.y, exits: r.exits,
          visited: session.visitedRooms.has(r.id)
       }));
     }
  }

  // Determine which abilities & skills the character has unlocked to send to the UI
  const availableAbilities = [];  // Combat actions → Abilities tab
  const availableSkills = [];     // Utility actions → Skills tab
  for (const skillKey of Object.keys(Skills)) {
      const skVal = combat.getCharSkill(char, skillKey);
      if (Skills[skillKey].type === 'ability' && skVal > 0) {
          availableAbilities.push(Skills[skillKey].name.toLowerCase());
      } else if (Skills[skillKey].type === 'skill' && skVal > 0) {
          availableSkills.push(Skills[skillKey].name.toLowerCase());
      }
  }

  // Build Extended Targets list (only mobs actively in combat with this player)
  const extendedTargets = [];
  if (zone && zone.liveMobs) {
      for (const m of zone.liveMobs) {
          if (m.target === session && m.hp > 0) {
              extendedTargets.push({
                  id: m.id,
                  name: m.name,
                  hp: m.hp,
                  maxHp: m.maxHp,
                  level: m.level
              });
          }
      }
  }

  send(session.ws, {
    type: 'STATUS',
    character: {
      name: char.name,
      raceId: char.raceId || 1,
      gender: char.gender || 0,
      face: char.face || 0,
      hp: char.hp, maxHp: effective.hp,
      mana: char.mana, maxMana: effective.mana,
      str: effective.str, sta: effective.sta, agi: effective.agi,
      dex: effective.dex, wis: effective.wis, intel: effective.intel, cha: effective.cha,
      ac: effective.ac,
      state: char.state,
      inCombat: session.inCombat,
      autoFight: session.autoFight,
      level: char.level,
      experience: char.experience,
      nextLevelXp: combat.xpForLevel(char.level + 1),
      zone: zone ? zone.name : 'Unknown',
      zoneId: char.zoneId,
      roomId: roomId,
      roomName: roomName,
      x: char.x,
      y: char.y,
      mapSize: zone ? zone.mapSize : { width: 400, length: 400 },
      centerOffset: zone ? zone.centerOffset : { x: 0, y: 0 },
      zoneLines: zone ? zone.zoneLines : [],
      connections: zone && zone.connections ? zone.connections : [], // Legacy
      spawnPos: session.pendingTeleport || null,
      equipVisuals: getEquipVisuals(session),
      mapData: mapData,
      worldAtlas: (() => {
        const atlas = WorldAtlas.getAtlasEntry(char.zoneId);
        if (!atlas) return null;
        const worldPos = WorldAtlas.localToWorld(char.zoneId, char.x || 0, char.y || 0);
        // Use vision viewDistance or fallback to 15000 for neighbor search
        const visionState = getVisionState(session);
        const searchRadius = Math.max(visionState.viewDistance || 15000, 15000);
        const neighbors = WorldAtlas.getNeighborZones(char.zoneId, char.x || 0, char.y || 0, searchRadius);
        return {
          worldX: worldPos.x,
          worldY: worldPos.y,
          zoneCenter: { x: atlas.worldX, y: atlas.worldY },
          zoneSize: { width: atlas.width, height: atlas.height },
          continent: atlas.continent,
          terrain: atlas.terrain,
          neighbors: neighbors,
        };
      })(),
      abilityCooldowns: session.abilityCooldowns || {},
      availableAbilities: availableAbilities,
      availableSkills: availableSkills,
      skills: char.skills || {},
      practices: char.practices || 0,
      extendedTargets: extendedTargets,
      target: session.combatTarget ? {
        id: session.combatTarget.id,
        name: session.combatTarget.name,
        hp: session.combatTarget.hp,
        level: session.combatTarget.level,
        maxHp: session.combatTarget.maxHp
      } : null,
      vision: (() => {
        const zoneInst = zoneInstances[session.char.zoneId];
        const v = VisionSystem.getVisionState(session, zoneInst ? zoneInst.def : null);
        return {
          mode: v.mode,
          modeName: v.modeName,
          renderStyle: v.renderStyle,
          effectiveness: v.effectiveness,
          isBlind: v.isBlind,
          viewDistance: v.viewDistance,
          ambientLight: v.ambientLight,
          sensitivityPenalty: v.sensitivityPenalty,
          timeOfDay: v.timeOfDay,
          weather: v.weather,
          weatherName: v.weatherName,
          weatherIntensity: v.weatherIntensity,
          weatherRenderEffect: v.weatherRenderEffect,
          worldHour: v.worldHour,
          isOutdoor: v.isOutdoor,
          hasLightSource: v.hasLightSource,
          canSeeUnlit: v.canSeeUnlit,
          availableModes: v.availableModes,
          season: v.season,
          dawn: v.dawn,
          dusk: v.dusk,
          moons: v.moons,
        };
      })(),
      calendar: {
        date: Calendar.formatDate(worldCalendar),
        time: Calendar.formatTime(worldCalendar.hour),
        hour: worldCalendar.hour,
        day: worldCalendar.day,
        month: Calendar.getMonth(worldCalendar.month).name,
        monthIndex: worldCalendar.month,
        year: worldCalendar.year,
        season: Calendar.getSeason(worldCalendar.month).name,
        dayOfWeek: Calendar.getDayOfWeek(worldCalendar.totalDays),
      },
      pet: session.pet ? {
        id: session.pet.id,
        name: session.pet.name,
        hp: session.pet.hp,
        maxHp: session.pet.maxHp,
        level: session.pet.level,
        state: session.pet.state,
        taunting: session.pet.taunting,
        isCharmed: session.pet.isCharmed || false,
        target: session.pet.target ? session.pet.target.name : null,
        x: session.pet.x,
        y: session.pet.y,
        race: session.pet.race,
      } : null,
    },
  });
  
  // Clear the teleport queue once sent to client
  if (session.pendingTeleport) {
      session.pendingTeleport = null;
  }
}

function sendInventory(session) {
  const inventory = session.inventory.map(row => {
    // item_key is now a numeric EQEmu item ID
    const def = ItemDB.getById(row.item_key) || ITEMS[row.item_key] || {};
    const itemName = def.name || String(row.item_key);
    const legacyKey = ItemDB.generateKey(itemName);
    return {
      item_id: row.id,
      eq_item_id: row.item_key,
      itemKey: legacyKey,
      itemName: itemName,
      equipped: row.equipped,
      slotId: row.slot,
      slot: row.equipped ? row.slot : (def.slot || 0),
      quantity: row.quantity || 1,
      type: def.type || 'misc',
      damage: def.damage || 0,
      delay: def.delay || 0,
      ac: def.ac || 0,
      hp: def.hp || 0,
      mana: def.mana || 0,
      str: def.str || 0, sta: def.sta || 0, agi: def.agi || 0,
      dex: def.dex || 0, wis: def.wis || 0, int: def.intel || 0,
      cha: def.cha || 0,
      weight: def.weight || 0,
      value: def.value || 0,
      sellValue: Math.max(1, Math.floor((def.value || 1) * 0.25 * getChaSellMod(session))),
      classes: def.classes || 0,
      races: def.races || 0,
      itemtype: def.itemtype || 0,
      equipSlot: def.slot || 0,
    };
  });

  send(session.ws, { type: 'INVENTORY_UPDATE', inventory });
}

// ── Spellbook Persistence (file-based) ──────────────────────────────

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
      target: def.target || 'self',
      effect: def.effect || 'unknown',
      level: def.level || 1,
      description: def.description || '',
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

function sendCombatLog(session, events) {
  send(session.ws, { type: 'COMBAT_LOG', events });
}

// ── Skill Cooldown Processing ───────────────────────────────────────

function processSkillCooldowns(session, dt) {
  if (!session.skillCooldowns) return;
  for (const key of Object.keys(session.skillCooldowns)) {
    if (session.skillCooldowns[key] > 0) {
      session.skillCooldowns[key] -= dt;
      if (session.skillCooldowns[key] <= 0) {
        session.skillCooldowns[key] = 0;
      }
    }
  }
}

// ── Main Game Loop ──────────────────────────────────────────────────

let saveCounter = 0;

function startGameLoop() {
  let tickCount = 0;
  setInterval(() => {
    const dt = TICK_RATE / 1000;
    tickCount++;
    processEnvironment();

    for (const [ws, session] of sessions) {
      processRegen(session, dt);
      processCasting(session, dt);
      processCombatTick(session, dt);
      processBuffs(session, dt);
      processSkillCooldowns(session, dt);
      sendStatus(session);

      // --- Proximity Sync ---
      // Periodically refresh the world state to handle LoadRadius pop-ins/outs
      if (tickCount % SYNC_RATE === 0) {
          handleLook(session, true); // skipText = true
      }
    }

    const aiApi = {
      broadcastMobMove, processPetAI, handlePetDeath, sendCombatLog,
      sessions, handleMobDeath, getWeaponStats, tryInterruptCasting,
      breakSneak, breakHide, despawnPet
    };

    for (const zoneId of Object.keys(zoneInstances)) {
      AISystem.processMobAI(zoneInstances[zoneId], zoneId, dt, aiApi);
      processRespawns(zoneId);
      processMiningRespawns(zoneId, dt);
    }

    // Process mining cooldowns
    for (const [, session] of sessions) {
      if (session.miningCooldown && session.miningCooldown > 0) {
        session.miningCooldown -= dt;
        if (session.miningCooldown < 0) session.miningCooldown = 0;
      }
    }

    // Persist every 10 ticks (~20 seconds)
    saveCounter++;
    if (saveCounter >= 10) {
      saveCounter = 0;
      for (const [, session] of sessions) {
        DB.updateCharacterState(session.char);
        DB.saveCharacterSkills(session.char.id, session.char.skills);
        saveBuffsToFile(session);
      }
    }
  }, TICK_RATE);

  console.log(`[ENGINE] Game loop started (${TICK_RATE}ms tick rate).`);
}

// ── AI System moved to systems/ai.js ────────────────────────────────
function processEnvironment() {
  State.envTickCounter++;
  // Every 45 ticks (90 seconds at 2s tick) = 1 in-game hour
  if (State.envTickCounter >= 45) {
    State.envTickCounter = 0;

    // Advance the Norrathian calendar by one hour
    const calendarEvents = Calendar.advanceHour(worldCalendar);
    const currentSeason = Calendar.getMonth(worldCalendar.month).season;
    const isDay = Calendar.isDaytime(worldCalendar.hour, worldCalendar.month);

    // Roll weather changes for each loaded zone
    for (const [zoneId, zone] of Object.entries(zoneInstances)) {
      if (!zone.weather) continue;
      const result = Calendar.rollWeatherChange(zone.weather, currentSeason);

      // If weather changed, notify players in that zone
      if (result && result.changed && result.message) {
        const zoneDef = zone.def || getZoneDef(zoneId);
        const isOutdoor = zoneDef && zoneDef.environment === 'outdoor';
        if (isOutdoor) {
          for (const [, session] of sessions) {
            if (session.char.zoneId === zoneId) {
              sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=gray]${result.message}[/color]` }]);
            }
          }
        }
      }
    }

    // Broadcast calendar events (dawn, dusk, new month, season changes)
    for (const evt of calendarEvents) {
      for (const [, session] of sessions) {
        const zoneDef = getZoneDef(session.char.zoneId);
        const isOutdoor = zoneDef && zoneDef.environment === 'outdoor';

        if (evt.type === 'DAWN' || evt.type === 'DUSK') {
          if (isOutdoor) {
            sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=gold]${evt.message}[/color]` }]);
          }
        } else if (evt.type === 'SEASON_CHANGE') {
          sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=cyan]${evt.message}[/color]` }]);
        } else if (evt.type === 'NEW_MONTH' || evt.type === 'NEW_YEAR') {
          sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=gray]${evt.message}[/color]` }]);
        } else if (evt.type === 'TWIN_FULL_MOON') {
          if (isOutdoor) {
            sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=gold]${evt.message}[/color]` }]);
          }
        } else if (evt.type === 'FULL_MOON' || evt.type === 'NEW_MOON') {
          if (isOutdoor) {
            sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=silver]${evt.message}[/color]` }]);
          }
        }
      }
    }

    // Broadcast environment update to sync day/night cycles on clients
    const daylight = Calendar.getDaylightHours(worldCalendar.month);
    for (const [, session] of sessions) {
      if (!session.char) continue;
      session.ws.send(JSON.stringify({
        type: 'ENVIRONMENT_UPDATE',
        worldHour: worldCalendar.hour,
        dawn: daylight.dawn,
        dusk: daylight.dusk,
        season: currentSeason.name,
        moons: Calendar.getMoonPhases(worldCalendar.totalDays)
      }));
    }
  }
}

function handleLook(session, skipText = false) {
  try {
  const char = session.char;
  const zoneDef = getZoneDef(char.zoneId);
  if (!zoneDef) { console.log('[ENGINE] handleLook: no zoneDef for', char.zoneId); return; }

  // Vision Calculation (uses extracted getVisionState)
  const vision = VisionSystem.getVisionState(session, zoneDef);

  // Mobs
  const instance = zoneInstances[char.zoneId];
  const entities = [];

  // Random color helper
  const rHex = () => '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
  
  if (instance) {
      // Send ALL zone mobs to the 3D client — the 3D world is open space, not rooms
      for (const mob of instance.liveMobs) {
          // Distance Check: loadRadius (Robust)
          const distSq = getDistanceSq(mob.x, mob.y, char.x, char.y);
          if (distSq > VIEW_DISTANCE * VIEW_DISTANCE) continue;

          if (!mob.networkData) {
              if (!mob.appearance) {
                  mob.appearance = {
                      hat: rHex(), skin: rHex(), torso: rHex(), legs: rHex(), feet: rHex()
                  };
              }
              // Map npcType to client-side entity type for rendering
              let clientType = 'enemy';
              if (mob.isPet) {
                clientType = 'pet';
              } else if (mob.npcType && mob.npcType !== NPC_TYPES.MOB) {
                clientType = 'npc'; // All non-mob NPCs render as friendly
              }
              mob.networkData = {
                  id: mob.id, name: mob.name, type: clientType, npcType: mob.npcType || NPC_TYPES.MOB,
                  race: mob.race || 1, gender: mob.gender || 0, appearance: mob.appearance,
                  isPet: mob.isPet || false, ownerName: mob.ownerSession ? mob.ownerSession.char.name : null
              };
          }
          entities.push({ ...mob.networkData, x: mob.x, y: mob.y, z: mob.z || 0, heading: mob.heading || 0 });
      }

      // ── Mining Nodes ──
      if (instance.liveNodes) {
        for (const node of instance.liveNodes) {
          if (!node.alive) continue;
          const nodeDistSq = getDistanceSq(node.x, node.y, char.x, char.y);
          if (nodeDistSq > VIEW_DISTANCE * VIEW_DISTANCE) continue;

          if (!node.networkData) {
            node.networkData = {
              id: node.id,
              name: node.name,
              type: 'mining_node',
              nodeType: node.nodeType,
              tier: node.tier,
              maxHp: node.maxHp
            };
          }
          entities.push({
            ...node.networkData,
            hp: node.hp,
            x: node.x,
            y: node.y,
            z: node.z || 0,
          });
        }
      }
  }

  // Other players (skip self — we already have a local player capsule)
  for (const [ws, other] of sessions) {
      if (other.char.zoneId === char.zoneId && other.char.id !== char.id) {
          // Distance check for other players (Robust)
          const pDistSq = getDistanceSq(other.char.x, other.char.y, char.x, char.y);
          if (pDistSq > VIEW_DISTANCE * VIEW_DISTANCE) continue;

          if (!other.char.appearance) {
              other.char.appearance = {
                  hat: rHex(), skin: rHex(), torso: rHex(), legs: rHex(), feet: rHex()
              };
          }
          if (!other.char.networkData) {
              other.char.networkData = {
                  id: `player_${other.char.id}`, name: other.char.name, type: 'player',
                  race: other.char.raceId || 1, gender: other.char.gender || 0,
                  face: other.char.face || 0, appearance: other.char.appearance
              };
          }
          entities.push({
              ...other.char.networkData,
              sneaking: other.char.isSneaking, hidden: other.char.isHidden,
              equipVisuals: getEquipVisuals(other),
              x: other.char.x, y: other.char.y, z: other.char.z || 0, heading: other.char.heading || 0
          });
      }
  }

  const payload = { type: 'ZONE_STATE', entities, doors: instance ? (instance.doors || []) : [], vision: {
    mode: vision.mode,
    renderStyle: vision.renderStyle,
    effectiveness: vision.effectiveness,
    isBlind: vision.isBlind,
    viewDistance: vision.viewDistance,
    ambientLight: vision.ambientLight,
    sensitivityPenalty: vision.sensitivityPenalty,
    timeOfDay: vision.timeOfDay,
    weather: vision.weather,
    weatherName: vision.weatherName,
    weatherIntensity: vision.weatherIntensity,
    weatherRenderEffect: vision.weatherRenderEffect,
    worldHour: vision.worldHour,
    isOutdoor: vision.isOutdoor,
    hasLightSource: vision.hasLightSource,
    availableModes: vision.availableModes,
    season: vision.season,
    dawn: vision.dawn,
    dusk: vision.dusk,
    moons: vision.moons,
  }};
  send(session.ws, payload);
  } catch (err) {
    console.error('[ENGINE] handleLook crashed:', err);
  }
}

// ── Vision Mode Selection ───────────────────────────────────────────

function handleSetVisionMode(session, msg) {
  const requestedMode = msg.mode;

  // 'auto' resets to automatic mode selection (racial/spell)
  if (requestedMode === 'auto' || requestedMode === null) {
    session.activeVisionMode = null;
    const zoneDef = getZoneDef(session.char.zoneId);
    const vision = VisionSystem.getVisionState(session, zoneDef);
    sendCombatLog(session, [{
      event: 'MESSAGE',
      text: `[color=cyan]Vision mode set to automatic. Currently using ${vision.modeName}.[/color]`
    }]);
    sendStatus(session);
    return;
  }

  // Validate the requested mode exists
  if (!VISION_MODES[requestedMode]) {
    sendCombatLog(session, [{
      event: 'MESSAGE',
      text: `[color=red]Unknown vision mode: ${requestedMode}.[/color]`
    }]);
    return;
  }

  // Validate the player has access to this mode
  const available = VisionSystem.getAvailableVisionModes(session);
  if (!available.includes(requestedMode)) {
    const modeObj = VISION_MODES[requestedMode];
    sendCombatLog(session, [{
      event: 'MESSAGE',
      text: `[color=red]You do not have access to ${modeObj.name}. Available modes: ${available.join(', ')}.[/color]`
    }]);
    return;
  }

  // Set the mode
  session.activeVisionMode = requestedMode;
  const zoneDef = getZoneDef(session.char.zoneId);
  const vision = VisionSystem.getVisionState(session, zoneDef);
  const modeObj = VISION_MODES[requestedMode];

  // Send flavor text + status update
  sendCombatLog(session, [{
    event: 'MESSAGE',
    text: `[color=cyan]${modeObj.description}[/color]`
  }]);

  // Warn about light sensitivity if switching to a sensitive mode in bright conditions
  if (vision.sensitivityPenalty < 0) {
    sendCombatLog(session, [{
      event: 'MESSAGE',
      text: `[color=yellow]Warning: ${modeObj.name} is impaired in bright conditions (${vision.sensitivityPenalty} penalty).[/color]`
    }]);
  }

  sendStatus(session);
}

function handleSenseHeading(session) {
    const char = session.char;
    const skillName = 'sense_heading';
    
    // Check if character actually knows the skill
    const skillLevel = char.skills && char.skills[skillName] ? char.skills[skillName] : 0;

    // Roll against their skill
    const roll = Math.floor(Math.random() * 200) + 1;
    
    let success = false;
    if (skillLevel > 0) {
        success = roll <= (skillLevel + 20);
    }

    const directions = ["North", "South", "East", "West", "Northwest", "Southeast"];
    const fakeDir = directions[Math.floor(Math.random() * directions.length)];

    let text = "";
    if (success) {
        text = `You are certain that you are facing ${fakeDir}.`;
        combat.trySkillUp(session, skillName);
    } else {
        text = `You have no idea what direction you are facing.`;
    }

    flushSkillUps(session);
    sendCombatLog(session, [{ event: 'MESSAGE', text: text }]);
}

// ── Consider System ─────────────────────────────────────────────────
function handleConsider(session) {
  if (!session.combatTarget) {
    return sendCombatLog(session, [{ event: 'MESSAGE', text: 'You must have a target to consider.' }]);
  }

  const mob = session.combatTarget;
  const playerLvl = session.char.level;
  const mobLvl = mob.level || 1;
  const diff = mobLvl - playerLvl;

  let color, message;

  if (diff >= 3) {
    color = 'red';
    message = `${mob.name} — what would you like your tombstone to say?`;
  } else if (diff >= 1) {
    color = 'yellow';
    message = playerLvl >= 18
      ? `${mob.name} looks like it would wipe the floor with you!`
      : `${mob.name} looks like quite a gamble.`;
  } else if (diff === 0) {
    color = 'white';
    message = playerLvl >= 18
      ? `${mob.name} appears to be quite formidable.`
      : `${mob.name} looks like an even fight.`;
  } else {
    const blueThreshold = playerLvl < 14 ? -3 : -Math.floor(playerLvl * 0.25);
    if (diff >= blueThreshold) {
      color = 'blue';
      message = playerLvl >= 18
        ? `${mob.name} looks kind of dangerous.`
        : `${mob.name} looks like you would have the upper hand.`;
    } else {
      color = 'green';
      message = `${mob.name} looks like a reasonably safe opponent.`;
    }
  }

  sendCombatLog(session, [{
    event: 'CONSIDER',
    target: mob.name,
    level: mobLvl,
    color: color,
    text: message
  }]);
}

// ── Emote System ────────────────────────────────────────────────────
function handleEmote(session, msg) {
  const emote = msg.emote || '';
  const anim = msg.anim || null;
  if (!emote) return;

  const zoneId = session.char.zoneId;
  for (const [, s] of sessions) {
    if (s.char && s.char.zoneId === zoneId) {
      send(s.ws, {
        type: 'EMOTE',
        charName: session.char.name,
        emote: emote,
        anim: anim
      });
    }
  }
}

// ── Admin Succor (F8) — teleport to zone safe point ──────────────────

async function handleSuccor(session) {
  const char = session.char;
  
  try {
    const eqemuDB = require('./eqemu_db');
    await eqemuDB.init();
    const mysql = require('mysql2/promise');
    const p = mysql.createPool({
      host: process.env.EQEMU_HOST || '127.0.0.1',
      port: process.env.EQEMU_PORT || 3307,
      user: process.env.EQEMU_USER || 'eqemu',
      password: process.env.EQEMU_PASSWORD || '',
      database: process.env.EQEMU_DATABASE || 'peq',
    });
    
    const zoneDef = getZoneDef(char.zoneId);
    const dbShort = zoneDef && zoneDef.shortName ? zoneDef.shortName : char.zoneId;
    
    const [rows] = await p.query('SELECT safe_x, safe_y, safe_z FROM zone WHERE short_name = ?', [dbShort]);
    await p.end();
    
    if (rows.length === 0) {
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'No safe point found for this zone.' }]);
      return;
    }
    
    const safe = rows[0];
    
    // safe_x/safe_y/safe_z use the same coordinate system as spawn2:
    // x = horizontal, y = horizontal, z = height
    // TELEPORT handler on the client applies the EQ→Godot mapping
    console.log(`[ENGINE] Succor: ${char.name} teleporting to safe point (${safe.safe_x}, ${safe.safe_y}, ${safe.safe_z}) in ${dbShort}`);
    
    char.x = safe.safe_x;
    char.y = safe.safe_y;
    char.z = safe.safe_z;
    
    send(session.ws, {
      type: 'TELEPORT',
      x: char.x,
      y: char.y,
      z: char.z,
    });
    
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You have been transported to safety.' }]);
  } catch (e) {
    console.error('[ENGINE] Succor error:', e.message);
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'Succor failed.' }]);
  }
}

module.exports = {
  initZones,
  startGameLoop,
  handleMessage,
  createSession,
  removeSession,
  sessions,
};






