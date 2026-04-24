const ZONES = require('./data/zones');
const SpellDB = require('./data/spellDatabase');
let SPELLS; // Legacy proxy, initialized after SpellDB loads
const { Skills } = require('./data/skills');
const { STARTER_GEAR } = require('./data/items');
const ItemDB = require('./data/itemDatabase');
let ITEMS; // Legacy proxy, initialized after ItemDB loads
const DB = require('./db');
const combat = require('./combat');
const { NPC_TYPES, HAIL_RANGE } = require('./data/npcTypes');
const MERCHANT_INVENTORIES = require('./data/npcs/merchants');
const QuestDialogs = require('./data/npcs/quests');

// Precise zone line trigger data extracted from EQ S3D client files (BSP regions)
let ZONE_TRIGGERS = {};
try { ZONE_TRIGGERS = require('./data/zone_triggers.json'); } catch (e) { console.warn('[ENGINE] No zone_triggers.json found, using DB defaults for all triggers'); }

const TICK_RATE = 2000; // 2 second game ticks
const VIEW_DISTANCE = 99999; // Disable proximity culling for authentic zone experience
const SYNC_RATE = 10; // Sync world every 10 ticks (20s) to refresh state

// ── Live State ──────────────────────────────────────────────────────

const sessions = new Map(); // ws -> session
const authSessions = new Map(); // ws -> { accountId, accountName }
const zoneInstances = {};

// Environment State
let worldHour = 8; // 0-23
let weatherState = 'clear'; // clear, rain, fog
let envTickCounter = 0;

// See combat.js for math helpers

function getDistance(x1, y1, x2, y2) {
    const dx = (x1 || 0) - (x2 || 0);
    const dy = (y1 || 0) - (y2 || 0);
    return Math.sqrt(dx * dx + dy * dy);
}

function calcEffectiveStats(char, inventory) {
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

  // Compute max HP and mana from class/level/stats using classic EQ formulas
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
  
  for (const [zoneId, zoneDef] of Object.entries(ZONES)) {
    zoneInstances[zoneId] = {
      def: zoneDef,
      liveMobs: [],
      spawnPointState: [], // Tracks individual authentic spawn points
    };
    // Load spawns from EQEmu MySQL
    const eqemuDB = require('./eqemu_db');
    try {
        const rawSpawns = await eqemuDB.getZoneSpawns(zoneDef.shortName);
        
        // Group rows by spawn2_id to build spawn pools
        const spawnPoints = new Map();
        for (const row of rawSpawns) {
            if (!spawnPoints.has(row.spawn2_id)) {
                spawnPoints.set(row.spawn2_id, {
                    x: row.x,
                    y: row.y,
                    z: row.z,
                    respawntime: row.respawntime || 420,
                    pool: [] // NPC candidates for this point
                });
            }
            spawnPoints.get(row.spawn2_id).pool.push({
                npc_id: row.npc_id,
                name: row.name ? row.name.replace(/_/g, ' ').replace(/[0-9]/g, '').trim() : "Unknown",
                level: row.level,
                hp: row.hp,
                mindmg: row.mindmg,
                maxdmg: row.maxdmg,
                chance: row.chance || 0
            });
        }

        // For each spawn point, pick ONE NPC from the pool using weighted chance
        for (const [spawnId, point] of spawnPoints) {
            const picked = pickFromPool(point.pool);
            if (!picked) continue;

            const mobDef = {
                key: picked.npc_id.toString(),
                name: picked.name,
                level: picked.level,
                type: NPC_TYPES.MOB,
                maxHp: picked.hp > 0 ? picked.hp : picked.level * 20,
                minDmg: picked.mindmg || Math.max(1, Math.floor(picked.level / 2)),
                maxDmg: picked.maxdmg || Math.max(4, picked.level * 2),
                attackDelay: 30, 
                xpBase: picked.level * picked.level * 15,
                respawnTime: point.respawntime
            };

            const mobState = {
                spawnId: spawnId,
                mobKey: mobDef.key,
                x: point.x,
                y: point.y,
                z: point.z,
                currentMobId: null,
                respawnTimer: 0,
                mobDef: mobDef,
                pool: point.pool,         // Keep the full pool for respawn re-rolls
                respawnTime: point.respawntime
            };

            const newMob = spawnMob(zoneId, mobDef, point.x, point.y);
            if (newMob) mobState.currentMobId = newMob.id;
            
            zoneInstances[zoneId].spawnPointState.push(mobState);
        }
        console.log(`[ENGINE] Loaded ${spawnPoints.size} spawn points (from ${rawSpawns.length} pool entries) for ${zoneId}.`);
    } catch (e) {
        console.log(`[ENGINE] Failed to load MySQL spawns for ${zoneId}:`, e.message);
    }
  }
  console.log(`[ENGINE] Initialized ${Object.keys(zoneInstances).length} zones.`);
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

  zoneInstances[zoneKey] = {
    def: zoneDef,
    liveMobs: [],
    spawnPointState: [],
  };

  // Track bounding box from all coordinates
  let allCoords = [];

  // Load spawns from EQEmu MySQL
  try {
    const rawSpawns = await eqemuDB.getZoneSpawns(zoneDef.shortName || zoneKey);

    const spawnPoints = new Map();
    for (const row of rawSpawns) {
      if (!spawnPoints.has(row.spawn2_id)) {
        spawnPoints.set(row.spawn2_id, {
          x: row.x, y: row.y, z: row.z,
          respawntime: row.respawntime || 420,
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
        type: NPC_TYPES.MOB,
        maxHp: picked.hp > 0 ? picked.hp : picked.level * 20,
        minDmg: picked.mindmg || Math.max(1, Math.floor(picked.level / 2)),
        maxDmg: picked.maxdmg || Math.max(4, picked.level * 2),
        attackDelay: 30,
        xpBase: picked.level * picked.level * 15,
        respawnTime: point.respawntime
      };

      const mobState = {
        spawnId, mobKey: mobDef.key,
        x: point.x, y: point.y, z: point.z,
        currentMobId: null, respawnTimer: 0,
        mobDef, pool: point.pool, respawnTime: point.respawntime
      };

      const newMob = spawnMob(zoneKey, mobDef, point.x, point.y, point.z);
      if (newMob) mobState.currentMobId = newMob.id;
      zoneInstances[zoneKey].spawnPointState.push(mobState);
    }

    console.log(`[ENGINE] Dynamically loaded ${spawnPoints.size} spawn points (from ${rawSpawns.length} pool entries) for '${zoneKey}'.`);
  } catch (e) {
    console.log(`[ENGINE] No spawn data found for '${zoneKey}':`, e.message);
  }

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
    // Only include real zone exits (filter out virtual teleporters at 0,0)
    const realZonePoints = zonePoints.filter(zp => zp.x !== 0 || zp.y !== 0);
    
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

function spawnMob(zoneId, mobDef, forcedX = null, forcedY = null, forcedZ = null) {
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
    x: spawnX,
    y: spawnY,
    z: (forcedZ !== null) ? forcedZ : 0,
    hp: mobDef.maxHp,
    maxHp: mobDef.maxHp,
    minDmg: mobDef.minDmg,
    maxDmg: mobDef.maxDmg,
    attackDelay: mobDef.attackDelay,
    attackTimer: mobDef.attackDelay,
    xpBase: mobDef.xpBase,
    loot: mobDef.loot || [],
    target: null,
  };
  
  zone.liveMobs.push(newMob);
  return newMob;
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
              maxHp: picked.hp > 0 ? picked.hp : picked.level * 20,
              minDmg: picked.mindmg || Math.max(1, Math.floor(picked.level / 2)),
              maxDmg: picked.maxdmg || Math.max(4, picked.level * 2),
              attackDelay: 30,
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
  char.skills = skills;

  const session = {
    ws,
    char,
    inventory,
    spells,
    effectiveStats: calcEffectiveStats(char, inventory),
    inCombat: false,
    autoFight: false,
    combatTarget: null,
    attackTimer: 0,
    buffs: [],
    casting: null,
  };

  const zoneDef = getZoneDef(char.zoneId);
  if (!session.char.roomId && zoneDef && zoneDef.defaultRoom) {
      session.char.roomId = zoneDef.defaultRoom;
  }

  sessions.set(ws, session);

  // Ensure the player spawns at their stored coordinates
  if (char.x !== 0 || char.y !== 0) {
    session.pendingTeleport = { x: char.x, y: char.y };
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
    case 'MOVE': return handleMove(session, msg);
    case 'UPDATE_POS': return handleUpdatePos(session, msg);
    case 'UPDATE_SNEAK': return handleUpdateSneak(session, msg);
    case 'CAMP': return handleCamp(session);
    case 'ABILITY': return handleAbility(session, msg);
    case 'SET_TACTIC': return handleTactic(session, msg);
    case 'HAIL': return handleHail(session, msg);
    case 'SAY': return handleSay(session, msg);
    case 'BUY': return handleBuy(session, msg);
    case 'LOOK': {
      console.log(`[ENGINE] LOOK command received from ${session.char.name}`);
      return handleLook(session);
    }
    case 'SENSE_HEADING': {
      return handleSenseHeading(session);
    }
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

  // Store auth session
  authSessions.set(ws, { accountId: result.id, accountName: result.name });

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

  send(ws, { type: 'CHAR_CREATE_DATA', ...data });
  console.log(`[ENGINE] Sent char create data for race ${raceId}: ${data.classes.length} classes.`);
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
    // Refresh session inventory
    session.inventory = await DB.getInventory(char.id);
    console.log(`[ENGINE] Granted missing starter gear to ${char.name}.`);
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

  const createResult = await DB.createCharacter(
     auth.accountId, name, charClass, race, deity,
     finalStats.str, finalStats.sta, finalStats.agi, finalStats.dex, finalStats.wis, finalStats.intel, finalStats.cha,
     startHp, startMana
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

  // Give starter spells — pull level 1 spells for this class from EQ data
  const starterSpells = SpellDB.getNewSpellsAtLevel(charClass, 1);
  if (starterSpells.length > 0) {
    starterSpells.slice(0, 8).forEach((spell, i) => {
      DB.memorizeSpell(char.id, spell._key, i);
    });
    console.log(`[ENGINE] Gave ${Math.min(starterSpells.length, 8)} starter spells to ${charClass} "${name}".`);
  }

  console.log(`[ENGINE] Created ${charClass} "${name}" (${race}) on account '${auth.accountName}' with stats STR=${finalStats.str} STA=${finalStats.sta} AGI=${finalStats.agi} DEX=${finalStats.dex} WIS=${finalStats.wis} INT=${finalStats.intel} CHA=${finalStats.cha}.`);

  // Send updated character list back to character select
  const characters = await DB.getCharactersByAccount(auth.accountId);
  send(ws, { type: 'CHARACTER_CREATED', name: char.name, characters });
}

function handleSit(session) {
  if (session.inCombat) {
    return sendCombatLog(session, [{ event: 'MESSAGE', text: 'You cannot sit while in combat!' }]);
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

  session.autoFight = true;
  sendCombatLog(session, [{ event: 'MESSAGE', text: 'Auto attack is on.' }]);
  sendStatus(session);
}

function handleStopCombat(session) {
  session.autoFight = false;
  sendCombatLog(session, [{ event: 'MESSAGE', text: 'You cease your attack.' }]);
  sendStatus(session);
}

function handleSetTarget(session, msg) {
  const targetId = msg.targetId;
  if (!targetId) return;

  const mobId = targetId.startsWith('mob_') ? targetId.substring(4) : targetId;
  const zone = zoneInstances[session.char.zoneId];
  if (!zone || !zone.liveMobs) return;

  let mob = zone.liveMobs.find(m => m.id === mobId || m.id === targetId);
  if (mob) {
    session.combatTarget = mob;
    sendStatus(session);
  }
}

function handleClearTarget(session) {
  if (!session.inCombat) {
      session.combatTarget = null;
      sendStatus(session);
  }
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
  mob.target = session;
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

function handleCastSpell(session, msg) {
  const slotIndex = msg.slot;
  const spellRow = session.spells.find(s => s.slot === slotIndex);
  if (!spellRow) return;

  const spellDef = SPELLS[spellRow.spell_key];
  if (!spellDef) return;

  if (session.char.mana < spellDef.manaCost) {
    return sendCombatLog(session, [{ event: 'MESSAGE', text: 'Insufficient mana.' }]);
  }
  if (session.char.state === 'medding') {
    return sendCombatLog(session, [{ event: 'MESSAGE', text: 'You must stand before casting!' }]);
  }

  session.char.mana -= spellDef.manaCost;
  applySpellEffect(session, spellDef, spellRow.spell_key);
  sendStatus(session);
}

function applySpellEffect(session, spellDef, spellKey) {
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
        handleMobDeath(session, mob, events);
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
        ac: spellDef.ac || 0,
      });
      events.push({ event: 'MESSAGE', text: `You feel ${spellDef.buffName} take hold.` });
      sendBuffs(session);
      break;
    }
    case 'cure':
      events.push({ event: 'MESSAGE', text: 'You feel the poison leave your body.' });
      break;
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
    case 'info':
      events.push({ event: 'MESSAGE', text: spellDef.description });
      break;
    default:
      events.push({ event: 'MESSAGE', text: `${spellDef.name} has no effect.` });
  }

  if (events.length > 0) sendCombatLog(session, events);
}

function handleAbility(session, msg) {
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
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You taunt ${mob.name}!` }]);
    session.abilityCooldowns[msg.ability] = 6;
  }

  if (session.skillUpMessages && session.skillUpMessages.length > 0) {
    const logs = session.skillUpMessages.map(msg => ({ event: 'MESSAGE', text: `[color=yellow]You have become better at ${msg.skillName}! (${msg.newLevel})[/color]` }));
    sendCombatLog(session, logs);
    session.skillUpMessages = [];
  }
}

function handleTactic(session, msg) {
  session.tactic = msg.tactic;
  sendCombatLog(session, [{ event: 'MESSAGE', text: `Combat tactic set to: ${msg.tactic}` }]);
}

// ── NPC Interaction Handlers ────────────────────────────────────────

function handleHail(session, msg) {
  const char = session.char;
  const zone = zoneInstances[char.zoneId];

  // If no target, just hail into the void
  if (!session.combatTarget) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You say, 'Hail!'` }]);
    return;
  }

  const target = session.combatTarget;

  // Proximity check — must be within HAIL_RANGE
  const dist = getDistance(char.x, char.y, target.x, target.y);
  if (dist > HAIL_RANGE) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You are too far away to speak with ${target.name}.` }]);
    return;
  }

  // If it's a regular mob, just shout at it
  if (!target.npcType || target.npcType === NPC_TYPES.MOB) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You say, 'Hail, ${target.name}!'` }]);
    sendCombatLog(session, [{ event: 'MESSAGE', text: `${target.name} regards you indifferently.` }]);
    return;
  }

  const events = [];
  events.push({ event: 'MESSAGE', text: `You say, 'Hail, ${target.name}!'` });

  switch (target.npcType) {
    case NPC_TYPES.MERCHANT: {
      // Check for merchant inventory
      const shopData = MERCHANT_INVENTORIES[target.key];
      if (shopData) {
        events.push({ event: 'MESSAGE', text: `${target.name} says, '${shopData.greeting}'` });
        // Send the merchant window data to the client
        send(session.ws, {
          type: 'OPEN_MERCHANT',
          npcId: target.id,
          npcName: target.name,
          items: shopData.items.map(si => {
            const itemDef = ITEMS[si.itemKey];
            return {
              itemKey: si.itemKey,
              name: itemDef ? itemDef.name : si.itemKey,
              price: si.price || (itemDef ? itemDef.value || 10 : 10),
              type: itemDef ? itemDef.type : 'misc',
            };
          }),
        });
      } else {
        events.push({ event: 'MESSAGE', text: `${target.name} says, 'I have nothing for sale at the moment.'` });
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
      events.push({ event: 'MESSAGE', text: `${target.name} says, 'I can offer you [training] in various skills. What would you like to learn?'` });
      // Send trainer window — placeholder for now
      send(session.ws, {
        type: 'OPEN_TRAINER',
        npcId: target.id,
        npcName: target.name,
        // TODO: populate with class-appropriate skills
        availableSkills: [],
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

function handleSay(session, msg) {
  const char = session.char;
  const text = (msg.text || '').trim();
  if (!text) return;

  // Echo the player's speech
  sendCombatLog(session, [{ event: 'MESSAGE', text: `You say, '${text}'` }]);

  // If we have a targeted NPC, check for keyword responses
  if (session.combatTarget && session.combatTarget.npcType) {
    const target = session.combatTarget;

    // Proximity check
    const dist = getDistance(char.x, char.y, target.x, target.y);
    if (dist > HAIL_RANGE) return;

    // Only quest NPCs respond to keywords (for now)
    if (target.npcType === NPC_TYPES.QUEST) {
      const response = QuestDialogs.getKeywordResponse(target.key, text, char);
      if (response) {
        const keywords = QuestDialogs.extractKeywords(response);
        sendCombatLog(session, [{ event: 'NPC_SAY', npcName: target.name, text: response, keywords: keywords }]);
        return;
      }
    }

    // Merchant keyword check (e.g., player says something to a merchant)
    if (target.npcType === NPC_TYPES.MERCHANT) {
      const lowerText = text.toLowerCase();
      if (lowerText === 'buy' || lowerText === 'wares' || lowerText === 'shop') {
        // Re-open merchant window
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

  // Broadcast to other players in the zone
  for (const [ws, other] of sessions) {
    if (other !== session && other.char.zoneId === char.zoneId) {
      const pDist = getDistance(other.char.x, other.char.y, char.x, char.y);
      if (pDist <= 200) { // Hearing range
        sendCombatLog(other, [{ event: 'MESSAGE', text: `${char.name} says, '${text}'` }]);
      }
    }
  }
}

function handleBuy(session, msg) {
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
  const dist = getDistance(char.x, char.y, merchant.x, merchant.y);
  if (dist > HAIL_RANGE) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You are too far away to trade.' }]);
    return;
  }

  const shopData = MERCHANT_INVENTORIES[merchant.key];
  if (!shopData) return;

  const itemInfo = shopData.items.find(i => i.itemKey === itemKey);
  if (!itemInfo) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `${merchant.name} doesn't seem to have that item.` }]);
    return;
  }

  const itemDef = ITEMS[itemKey];
  const price = itemInfo.price || (itemDef ? itemDef.value || 10 : 10);

  if (char.copper < price) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You don't have enough money! That costs ${price} copper.` }]);
    return;
  }

  // Transaction
  char.copper -= price;
  DB.addItem(char.id, itemKey, 0, 0); // Add to inventory, unequipped
  DB.updateCharacterState(char); // Save copper

  const updatedInv = DB.getInventory(char.id);
  session.inventory = updatedInv.map(i => {
    const d = ITEMS[i.item_key];
    return { ...i, ...d, itemName: d ? d.name : i.item_key };
  });

  send(session.ws, { type: 'INVENTORY_UPDATE', inventory: session.inventory, message: `You bought ${itemDef ? itemDef.name : itemKey} for ${price} copper.` });
  sendCombatLog(session, [{ event: 'MESSAGE', text: `You bought ${itemDef ? itemDef.name : itemKey} for ${price} copper.` }]);
  sendStatus(session);
}

function handleEquipItem(session, msg) {
  const { itemId, slot } = msg;
  const invRow = session.inventory.find(i => i.id === itemId);
  if (!invRow) return;

  const itemDef = ITEMS[invRow.item_key];
  if (!itemDef) return;

  const targetSlot = slot || itemDef.slot;
  if (targetSlot <= 0) return;

  DB.unequipSlot(session.char.id, targetSlot);
  DB.equipItem(invRow.id, session.char.id, targetSlot);

  session.inventory = DB.getInventory(session.char.id);
  session.effectiveStats = calcEffectiveStats(session.char, session.inventory);

  sendInventory(session);
  sendStatus(session);
}

function handleUnequipItem(session, msg) {
  const { itemId } = msg;
  DB.unequipItem(itemId, session.char.id);
  session.inventory = DB.getInventory(session.char.id);
  session.effectiveStats = calcEffectiveStats(session.char, session.inventory);
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

  if (spawnX > 900000) spawnX = session.char.x || 0;
  if (spawnY > 900000) spawnY = session.char.y || 0;

  // ── Anti-bounce: push spawn AWAY from the reciprocal zoneline ──
  // Find the zoneline in the TARGET zone that leads BACK to the zone we just left.
  // If we spawned on top of it, we'd immediately trigger it and loop forever.
  const SAFE_OFFSET = 100; // Must exceed default trigger radius (75) to avoid spawning inside
  if (newZoneDef && newZoneDef.zoneLines) {
    const reciprocal = newZoneDef.zoneLines.find(zl => zl.target === currentZone);
    if (reciprocal) {
      const dx = spawnX - reciprocal.x;
      const dy = spawnY - reciprocal.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < SAFE_OFFSET + (reciprocal.length || 100)) {
        // We're dangerously close to (or inside) the return trigger.
        // Push the spawn point away from the reciprocal zoneline center.
        if (dist > 1) {
          // Use the vector from the reciprocal toward the spawn and extend it
          const nx = dx / dist;
          const ny = dy / dist;
          spawnX = reciprocal.x + nx * SAFE_OFFSET;
          spawnY = reciprocal.y + ny * SAFE_OFFSET;
        } else {
          // Spawn is exactly on the reciprocal — nudge based on orientation
          if (reciprocal.orientation === 'ew') {
            // Wall runs east-west: push north/south (along Y axis)
            const centerY = (newZoneDef.centerOffset && newZoneDef.centerOffset.y) || 0;
            spawnY = reciprocal.y + (reciprocal.y < centerY ? SAFE_OFFSET : -SAFE_OFFSET);
          } else {
            // Wall runs north-south: push east/west (along X axis)
            const centerX = (newZoneDef.centerOffset && newZoneDef.centerOffset.x) || 0;
            spawnX = reciprocal.x + (reciprocal.x < centerX ? SAFE_OFFSET : -SAFE_OFFSET);
          }
        }
        console.log(`[ENGINE] Anti-bounce: pushed spawn away from reciprocal zoneline '${currentZone}' at (${reciprocal.x},${reciprocal.y}) → spawn now (${Math.round(spawnX)},${Math.round(spawnY)})`);
      }
    }
  }

  // Small jitter so players don't stack
  spawnX += (Math.random() * 10 - 5);
  spawnY += (Math.random() * 10 - 5);

  session.char.x = spawnX;
  session.char.y = spawnY;
  session.pendingTeleport = { x: spawnX, y: spawnY };
  
  const zoneName = (newZoneDef && newZoneDef.name) || targetZone;
  sendCombatLog(session, [{ event: 'MESSAGE', text: `You have entered ${zoneName}.` }]);
  sendStatus(session);
}

function handleUpdatePos(session, msg) {
  if (session.char) {
    if (msg.x != null) session.char.x = msg.x;
    if (msg.y != null) session.char.y = msg.y;
  }
}

function handleUpdateSneak(session, msg) {
  if (session.char) {
    session.char.isSneaking = msg.sneaking;
    
    // Broadcast state change to other players in the zone
    const payload = JSON.stringify({
      type: 'ENTITY_SNEAK',
      id: `player_${session.char.id}`,
      sneaking: msg.sneaking
    });

    for (const [ws, other] of sessions) {
      if (other !== session && other.char.zoneId === session.char.zoneId) {
         try { ws.send(payload); } catch(e) {}
      }
    }
  }
}

function handleMove(session, msg) {
  const direction = msg.direction; // 'n', 's', 'e', 'w'
  const zoneDef = getZoneDef(session.char.zoneId);
  if (!zoneDef || !zoneDef.rooms) return;

  const currentRoom = zoneDef.rooms[session.char.roomId];
  if (!currentRoom) return;

  if (session.inCombat) {
    return sendCombatLog(session, [{ event: 'MESSAGE', text: 'You cannot move while in combat!' }]);
  }
  if (session.char.state === 'medding') {
    return sendCombatLog(session, [{ event: 'MESSAGE', text: 'You must stand up before moving.' }]);
  }

  const exits = currentRoom.exits || {};
  const targetRoomId = exits[direction];

  if (!targetRoomId) {
    return sendCombatLog(session, [{ event: 'MESSAGE', text: 'Alas, you cannot go that way.' }]);
  }

  const newRoom = zoneDef.rooms[targetRoomId];
  if (newRoom) {
     session.char.roomId = targetRoomId;
     // If moving into a zone line room, we could trigger a zone prompt. 
     // For now just move and send status.
     sendCombatLog(session, [{ event: 'MESSAGE', text: `You head ${getDirName(direction)}.` }]);
     sendStatus(session);
  }
}

function getDirName(d) {
  if (d === 'n') return 'north';
  if (d === 's') return 'south';
  if (d === 'e') return 'east';
  if (d === 'w') return 'west';
  return d;
}

// ── Combat Processing ───────────────────────────────────────────────

function processCombatTick(session, dt) {
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
    session.attackTimer = delay / 10;

    if (session.isOutOfRange) {
      events.push({ event: 'MESSAGE', text: 'You cannot reach your target!' });
    } else {
      const atk = combat.calcPlayerATK(session);
      const def = combat.calcMobDefense(mob);
      const charLvl = session.char.level;

      const executeAttack = (isOffhand) => {
        combat.trySkillUp(session, '1h_slashing'); // Hardcoded weapon skill for now
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
    handleMobDeath(session, mob, events);
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

function handleMobDeath(session, mob, events) {
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

  // Level up check
  const nextLevelXp = combat.xpForLevel(session.char.level + 1);
  if (session.char.experience >= nextLevelXp) {
    session.char.level++;
    session.effectiveStats = calcEffectiveStats(session.char, session.inventory);
    session.char.maxHp = session.effectiveStats.hp;
    session.char.maxMana = session.effectiveStats.mana;
    session.char.hp = session.char.maxHp;
    session.char.mana = session.char.maxMana;
    events.push({ event: 'LEVEL_UP', level: session.char.level });

    const newSpells = SpellDB.getNewSpellsAtLevel(session.char.class, session.char.level);
    for (const spell of newSpells) {
      events.push({ event: 'MESSAGE', text: `You have learned ${spell.name}!` });
    }
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
        
        session.inventory = DB.getInventory(session.char.id);
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
  if (session.inCombat) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You cannot camp while in combat!' }]);
    return;
  }
  
  DB.updateCharacterState(session.char);
  DB.saveCharacterSkills(session.char.id, session.char.skills);
  sendCombatLog(session, [{ event: 'MESSAGE', text: 'You have safely camped out.' }]);
  sessions.delete(session.ws);
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
    session.buffs[i].duration -= dt;
    if (session.buffs[i].duration <= 0) {
      session.buffs.splice(i, 1);
      changed = true;
    }
  }
  if (changed) sendBuffs(session);
}

// ── Network Helpers ─────────────────────────────────────────────────

function send(ws, data) {
  try {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(data));
    }
  } catch (e) {
    console.error('[ENGINE] Send error:', e.message);
  }
}

function sendFullState(session) {
  sendLoginOk(session);
  sendInventory(session);
  sendSpellbook(session);
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
      stats: {
        str: effective.str, sta: effective.sta, agi: effective.agi,
        dex: effective.dex, wis: effective.wis, intel: effective.intel,
        cha: effective.cha, ac: effective.ac,
      },
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

  // Determine which abilities the character has unlocked to send to the UI
  const availableAbilities = [];
  for (const skillKey of Object.keys(Skills)) {
      if (Skills[skillKey].type === 'ability') {
          const skVal = combat.getCharSkill(char, skillKey);
          if (skVal > 0) {
              availableAbilities.push(Skills[skillKey].name.toLowerCase()); 
          }
      }
  }

  // Build Extended Targets list (mobs hostile to this session)
  const extendedTargets = [];
  if (zone && zone.liveMobs) {
      for (const m of zone.liveMobs) {
          if (m.target === session) {
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
      mapData: mapData,
      abilityCooldowns: session.abilityCooldowns || {},
      availableAbilities: availableAbilities,
      skills: char.skills || {},
      extendedTargets: extendedTargets,
      target: session.combatTarget ? {
        id: session.combatTarget.id,
        name: session.combatTarget.name,
        hp: session.combatTarget.hp,
        level: session.combatTarget.level,
        maxHp: session.combatTarget.maxHp
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
      itemKey: legacyKey,
      itemName: itemName,
      equipped: row.equipped,
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
    };
  });

  send(session.ws, { type: 'INVENTORY_UPDATE', inventory });
}

function sendSpellbook(session) {
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
      description: def.description || '',
    };
  });

  send(session.ws, { type: 'SPELLBOOK_UPDATE', spells });
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
      processCombatTick(session, dt);
      processBuffs(session, dt);
      sendStatus(session);

      // --- Proximity Sync ---
      // Periodically refresh the world state to handle LoadRadius pop-ins/outs
      if (tickCount % SYNC_RATE === 0) {
          handleLook(session, true); // skipText = true
      }
    }

    for (const zoneId of Object.keys(zoneInstances)) {
      processMobAI(zoneInstances[zoneId], dt);
      processRespawns(zoneId);
    }

    // Persist every 10 ticks (~20 seconds)
    saveCounter++;
    if (saveCounter >= 10) {
      saveCounter = 0;
      for (const [, session] of sessions) {
        DB.updateCharacterState(session.char);
      }
    }
  }, TICK_RATE);
  
  // Periodically save all character states
  setInterval(() => {
    for (const [ws, session] of sessions.entries()) {
        if (ws.readyState === 1 && session.char) {
            DB.updateCharacterState(session.char);
        }
    }
  }, 30000); // 30 sec auto-save

  console.log(`[ENGINE] Game loop started (${TICK_RATE}ms tick rate).`);
}

function processMobAI(zone, dt) {
  if (!zone || !zone.liveMobs) return;
  for (const mob of zone.liveMobs) {
    if (mob.hp > 0 && mob.target) {
      mob.attackTimer -= dt;
      if (mob.attackTimer <= 0) {
        mob.attackTimer = mob.attackDelay;
        const session = mob.target;
        
        // If target is out of zone or dead, reset aggro
        if (!session.char || session.char.hp <= 0 || session.char.zoneId !== zone.name) {
            mob.target = null;
            continue;
        }

        const events = [];
        if (!session.isOutOfRange) {
          combat.trySkillUp(session, 'defense');

          const avoidance = combat.checkAvoidance(session);
          if (avoidance) {
            events.push({ event: 'MESSAGE', text: `You ${avoidance.toLowerCase()} ${mob.name}'s attack!` });
            if (avoidance === 'RIPOSTE') {
              const { damage, delay } = getWeaponStats(session.inventory);
              let ripoDmg = combat.calcPlayerDamage(session, damage, delay);
              mob.hp -= ripoDmg;
              events.push({ event: 'MELEE_HIT', source: 'You', target: mob.name, damage: ripoDmg, text: 'Riposte' });
            }
          } else {
            const mobHitChance = combat.calcMobHitChance(mob, session);
            if (combat.chance(mobHitChance)) {
              let dmgRoll = combat.calcMobDamage(mob, session.effectiveStats.ac);
              session.char.hp -= dmgRoll;
              events.push({ event: 'MELEE_HIT', source: mob.name, target: 'You', damage: dmgRoll });
            } else {
              events.push({ event: 'MELEE_MISS', source: mob.name, target: 'You' });
            }
          }
        }
        
        // Check player death from async mob logic
        if (session.char.hp <= 0) {
            session.char.hp = 0;
            events.push({ event: 'DEATH', who: 'YOU' });
            events.push({ event: 'MESSAGE', text: 'You have been slain! You return to your bind point.' });
            
            session.char.hp = Math.floor(session.effectiveStats.hp * 0.5);
            session.char.mana = Math.floor(session.effectiveStats.mana * 0.5);
            session.char.state = 'standing';
            session.inCombat = false;
            session.combatTarget = null;
            
            const xpPenalty = Math.floor(combat.xpForLevel(session.char.level) * 0.05);
            session.char.experience = Math.max(0, session.char.experience - xpPenalty);
            events.push({ event: 'MESSAGE', text: `You lost ${xpPenalty} experience.` });
            mob.target = null;
        }

        if (events.length > 0) sendCombatLog(session, events);
      }
    }
  }
}

function processEnvironment() {
  envTickCounter++;
  // Every 45 ticks (90 seconds) = 1 in-game hour
  if (envTickCounter >= 45) {
    envTickCounter = 0;
    worldHour = (worldHour + 1) % 24;
    
    // Random weather shift
    if (Math.random() < 0.1) {
       weatherState = ['clear', 'clear', 'rain', 'fog'][Math.floor(Math.random() * 4)];
       const isDay = worldHour >= 6 && worldHour <= 19;
       
       for (const [, session] of sessions) {
         if (getZoneDef(session.char.zoneId) && getZoneDef(session.char.zoneId).environment === 'outdoor') {
           sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=gray]The time is now ${worldHour}:00 (${isDay ? 'Day' : 'Night'}). Weather is ${weatherState}.[/color]` }]);
         }
       }
    }
  }
}

function handleLook(session, skipText = false) {
  try {
  const char = session.char;
  const zoneDef = getZoneDef(char.zoneId);
  if (!zoneDef) { console.log('[ENGINE] handleLook: no zoneDef for', char.zoneId); return; }

  const currentRoom = (zoneDef.rooms && zoneDef.rooms[char.roomId]) || { name: 'Unknown', description: 'You see nothing.' };
  
  // Vision Calculation
  let visionScore = 10; // normal daylight
  
  const isOutdoor = zoneDef.environment === 'outdoor';
  const isDay = worldHour >= 6 && worldHour <= 19;

  if (isOutdoor && !isDay) visionScore = 3; // Night time
  if (isOutdoor && weatherState === 'fog') visionScore -= 2;
  if (!isOutdoor) visionScore = 0; // Pitch black cave
  
  // Race Vision Enhancements
  if (char.race === 'dark_elf') visionScore += 10; // Ultravision
  else if (char.race === 'wood_elf' || char.race === 'half_elf' || char.race === 'dwarf') visionScore += 5; // Infravision

  // Light Source
  const hasTorch = session.inventory && session.inventory.some(i => {
    if (i.equipped !== 1) return false;
    const def = ItemDB.getById(i.item_key);
    const name = (def && def.name) ? def.name.toLowerCase() : '';
    return name.includes('torch') || name.includes('lantern');
  });
  if (hasTorch) visionScore += 5;
  
  const isBlind = visionScore <= 2;

  let text = `[color=yellow]${currentRoom.name}[/color]\n`;
  if (isBlind) {
      text += `It is completely pitch black. You cannot see anything around you.\n`;
  } else {
      text += `${currentRoom.description}\n`;
      if (isOutdoor) {
         text += `It is ${isDay ? 'light' : 'dark'} out. The weather is ${weatherState}.\n`;
      }
  }

  // Mobs
  const instance = zoneInstances[char.zoneId];
  const entities = [];

  // Random color helper
  const rHex = () => '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
  
  if (instance) {
      // Send ALL zone mobs to the 3D client — the 3D world is open space, not rooms
      for (const mob of instance.liveMobs) {
          // Distance Check: loadRadius (Robust)
          const dist = getDistance(mob.x, mob.y, char.x, char.y);
          if (dist > VIEW_DISTANCE) continue;

          if (!mob.appearance) {
              mob.appearance = {
                  hat: rHex(), skin: rHex(), torso: rHex(), legs: rHex(), feet: rHex()
              };
          }
          // Map npcType to client-side entity type for rendering
          let clientType = 'enemy';
          if (mob.npcType && mob.npcType !== NPC_TYPES.MOB) {
            clientType = 'npc'; // All non-mob NPCs render as friendly
          }
          entities.push({ id: mob.id, name: mob.name, type: clientType, npcType: mob.npcType || NPC_TYPES.MOB, race: mob.race || 1, gender: mob.gender || 0, appearance: mob.appearance, x: mob.x, y: mob.y, z: mob.z || 0 });
          
          // Text description only for mobs in the same room
          if (mob.roomId === char.roomId || !mob.roomId) {
              if (isBlind) {
                 text += `You hear a rustling shadow nearby.\n`;
              } else {
                 // Color-code by NPC type
                 let nameColor = 'red'; // Default: hostile mob
                 let suffix = 'is here.';
                 if (mob.npcType === NPC_TYPES.MERCHANT) { nameColor = 'cyan'; suffix = 'is here, ready to trade.'; }
                 else if (mob.npcType === NPC_TYPES.QUEST) { nameColor = 'green'; suffix = 'is here.'; }
                 else if (mob.npcType === NPC_TYPES.TRAINER) { nameColor = 'yellow'; suffix = 'is here, offering training.'; }
                 else if (mob.npcType === NPC_TYPES.BANK) { nameColor = 'cyan'; suffix = 'is here, guarding the vault.'; }
                 else if (mob.npcType === NPC_TYPES.BIND) { nameColor = 'yellow'; suffix = 'is here.'; }
                 else if (mob.npcType === NPC_TYPES.BLANK) { nameColor = 'white'; suffix = 'is here.'; }
                 text += `[color=${nameColor}]${mob.name}[/color] ${suffix}\n`;
              }
          }
      }
  }

  // Other players (skip self — we already have a local player capsule)
  for (const [ws, other] of sessions) {
      if (other.char.zoneId === char.zoneId && other.char.id !== char.id) {
          // Distance check for other players (Robust)
          const pDist = getDistance(other.char.x, other.char.y, char.x, char.y);
          if (pDist > VIEW_DISTANCE) continue;

          if (!other.char.appearance) {
              other.char.appearance = {
                  hat: rHex(), skin: rHex(), torso: rHex(), legs: rHex(), feet: rHex()
              };
          }
          entities.push({ id: `player_${other.char.id}`, name: other.char.name, type: 'player', appearance: other.char.appearance, sneaking: other.char.isSneaking });
          
          if (other.char.roomId === char.roomId) {
              if (!isBlind) {
                  text += `[color=lightblue]${other.char.name}[/color] is here.\n`;
              }
          }
      }
  }

  const payload = { type: 'ZONE_STATE', entities };
  console.log(`[ENGINE] ZONE_STATE first entity raw: ${JSON.stringify(entities[0])}`);
  send(session.ws, payload);
  console.log(`[ENGINE] Sent ZONE_STATE with ${entities.length} entities to ${char.name}`);
  if (!skipText) {
      sendCombatLog(session, [{ event: 'MESSAGE', text: text }]);
  }
  } catch (err) {
    console.error('[ENGINE] handleLook crashed:', err);
  }
}

function handleSenseHeading(session) {
    const char = session.char;
    const skillName = 'sense_heading';
    
    // Check if character actually knows the skill
    const skillLevel = session.skills && session.skills[skillName] ? session.skills[skillName] : 0;

    // Roll against their skill
    const roll = Math.floor(Math.random() * 200) + 1; // Basic difficulty curve
    
    let success = false;
    if (skillLevel > 0) {
        success = roll <= (skillLevel + 20); // 10% base chance + skill rating
    }

    // Since our mud is grid based, "Direction" was traditionally based on their last move. 
    // Wait, in a true 3D game, they have physical rotation. 
    // Since we don't sync rotation to the Node.js server yet, we will just simulate "You think you are facing North."
    const directions = ["North", "South", "East", "West", "Northwest", "Southeast"];
    const fakeDir = directions[Math.floor(Math.random() * directions.length)];

    let text = "";
    if (success) {
        text = `You are certain that you are facing ${fakeDir}.`;
        // Potential skillup!
        const Combat = require('./combat.js');
        if (Combat.trySkillUp) {
            Combat.trySkillUp(char.id, skillName);
        }
    } else {
        text = `You have no idea what direction you are facing.`;
    }

    sendCombatLog(session, [{ event: 'MESSAGE', text: text }]);
}

module.exports = {
  initZones,
  startGameLoop,
  handleMessage,
  createSession,
  removeSession,
  sessions,
};
