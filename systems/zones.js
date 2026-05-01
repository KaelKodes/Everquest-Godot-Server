const State = require('../state');
const { zoneInstances } = State;
const ZONES = require('../data/zones');
const SpellDB = require('../data/spellDatabase');
const ItemDB = require('../data/itemDatabase');
const WorldAtlas = require('../data/worldAtlas');
const Calendar = require('../data/calendar');
const eqemuDB = require('../eqemu_db');
const { ZONE_TRIGGERS } = require('../data/zone_triggers.json');

let SPELLS, ITEMS;

// Reverse map EQEmu short_names → our internal zone keys
const SHORTNAME_TO_KEY = {};
for (const [key, def] of Object.entries(ZONES)) {
  if (def.shortName) SHORTNAME_TO_KEY[def.shortName] = key;
}

function resolveZoneKey(zoneIdOrShort) {
  return SHORTNAME_TO_KEY[zoneIdOrShort] || zoneIdOrShort;
}

function getZoneDef(zoneKey) {
  return ZONES[zoneKey] || (zoneInstances[zoneKey] && zoneInstances[zoneKey].def) || null;
}

async function initZones() {
  SpellDB.loadSpells();
  SPELLS = SpellDB.createLegacyProxy();
  console.log(`[ENGINE] Spell database: ${SpellDB.count()} spells loaded.`);

  await ItemDB.loadItems();
  ITEMS = ItemDB.createLegacyProxy();
  
  for (const [zoneId, zoneDef] of Object.entries(ZONES)) {
    zoneInstances[zoneId] = {
      def: zoneDef, liveMobs: [], spawnPointState: [], liveNodes: [], nodeSpawnState: [],
      weather: Calendar.createZoneWeather(zoneDef.climate || 'temperate'), grids: {}, doors: [], doorStates: {}
    };
    console.log(`[ZONE] ${zoneId} (${zoneDef.name}) pre-initialized.`);
  }
  console.log(`[ENGINE] Initialized ${Object.keys(zoneInstances).length} zone(s).`);
  return { SPELLS, ITEMS };
}

async function ensureZoneLoaded(zoneKey, spawnMobFn, spawnMiningNodesFn, spawnMiningNPCsFn) {
  if (zoneInstances[zoneKey]) return;

  console.log(`[ENGINE] Dynamically loading zone '${zoneKey}'...`);
  const zoneMeta = eqemuDB.getZoneMetadata(zoneKey);
  const envType = (zoneMeta && zoneMeta.castoutdoor === 1) ? 'outdoor' : 'indoor';
  const displayName = (zoneMeta && zoneMeta.long_name) || zoneKey;

  const isPreset = !!ZONES[zoneKey];
  const zoneDef = ZONES[zoneKey] || {
    name: displayName, environment: envType, shortName: zoneKey,
    levelRange: [1, 60], mapSize: null, centerOffset: null, zoneLines: [], mobs: [],
  };

  const atlasEntry = WorldAtlas.getAtlasEntry(zoneKey);
  const zoneClimate = (zoneDef.climate) || (atlasEntry && atlasEntry.climate) || (envType === 'indoor' ? 'underground' : 'temperate');
  if (!zoneDef.climate && atlasEntry) {
    zoneDef.climate = atlasEntry.climate;
    zoneDef.terrain = atlasEntry.terrain;
  }

  zoneInstances[zoneKey] = {
    def: zoneDef, liveMobs: [], spawnPointState: [], liveNodes: [], nodeSpawnState: [],
    weather: Calendar.createZoneWeather(zoneClimate), grids: {}, doors: [], doorStates: {}
  };

  let allCoords = [];
  try {
    const zoneIdNumber = eqemuDB.getZoneIdByShortName(zoneDef.shortName || zoneKey);
    if (zoneIdNumber) zoneInstances[zoneKey].grids = await eqemuDB.getZoneGrids(zoneIdNumber);
  } catch (e) {}

  try {
    const rawSpawns = await eqemuDB.getZoneSpawns(zoneDef.shortName || zoneKey);
    const spawnPoints = new Map();
    for (const row of rawSpawns) {
      if (!spawnPoints.has(row.spawn2_id)) {
        spawnPoints.set(row.spawn2_id, {
          x: row.x, y: row.y, z: row.z, heading: row.heading || 0,
          respawntime: row.respawntime || 420, pathgrid: row.pathgrid || 0,
          wanderDist: row.wander_dist || 0, pool: []
        });
        allCoords.push({ x: row.x, y: row.y });
      }
      spawnPoints.get(row.spawn2_id).pool.push({
        npc_id: row.npc_id, name: row.name ? row.name.replace(/_/g, ' ').replace(/[0-9]/g, '').trim() : "Unknown",
        level: row.level, hp: row.hp, mindmg: row.mindmg, maxdmg: row.maxdmg,
        race: row.race || 1, gender: row.gender || 0, npcClass: row.class || 1, chance: row.chance || 0
      });
    }

    const { pickFromPool } = require('./spawning');
    const { mapEqemuClassToNpcType } = require('../utils/npcUtils'); // Assuming we move this

    for (const [spawnId, point] of spawnPoints) {
      const picked = pickFromPool(point.pool);
      if (!picked) continue;

      const mobDef = {
        key: picked.npc_id.toString(), name: picked.name, level: picked.level,
        race: picked.race || 1, gender: picked.gender || 0,
        type: spawnMobFn.mapType ? spawnMobFn.mapType(picked.npcClass) : 1,
        eqClass: picked.npcClass || 0, pathgrid: point.pathgrid, wanderDist: point.wanderDist,
        maxHp: picked.hp > 0 ? picked.hp : picked.level * 20,
        minDmg: picked.mindmg || Math.max(1, Math.floor(picked.level / 2)),
        maxDmg: picked.maxdmg || Math.max(4, picked.level * 2),
        attackDelay: 3, xpBase: picked.level * picked.level * 15, respawnTime: point.respawntime
      };

      const newMob = spawnMobFn(zoneKey, mobDef, point.x, point.y, point.z, point.heading);
      zoneInstances[zoneKey].spawnPointState.push({
        spawnId, mobKey: mobDef.key, x: point.x, y: point.y, z: point.z,
        currentMobId: newMob ? newMob.id : null, respawnTimer: 0,
        mobDef, pool: point.pool, respawnTime: point.respawntime, pathgrid: point.pathgrid
      });
    }
  } catch (e) { console.log(`[ENGINE] Spawn load error for '${zoneKey}':`, e.message); }

  try {
    zoneInstances[zoneKey].doors = await eqemuDB.getZoneDoors(zoneDef.shortName || zoneKey);
  } catch (e) {}

  spawnMiningNodesFn(zoneKey);
  spawnMiningNPCsFn(zoneKey, spawnMobFn);

  let zonePoints = [];
  try {
    zonePoints = await eqemuDB.getZonePoints(zoneDef.shortName || zoneKey);
    for (const zp of zonePoints) if (zp.x !== 0 || zp.y !== 0) allCoords.push({ x: zp.x, y: zp.y, isZonePoint: true });
  } catch (e) {}

  if (!isPreset && allCoords.length > 0) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of allCoords) {
      if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x;
      if (c.y < minY) minY = c.y; if (c.y > maxY) maxY = c.y;
    }
    const pad = 200;
    zoneDef.mapSize = { width: Math.max(500, (maxX - minX) + pad*2), length: Math.max(500, (maxY - minY) + pad*2) };
    zoneDef.centerOffset = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }

  if (zonePoints.length > 0) {
    const triggers = require('../data/zone_triggers.json')[zoneKey] || [];
    zoneDef.zoneLines = zonePoints.map(zp => {
      let bsp = triggers.find(t => t.referenceIndex === zp.number);
      
      if (zoneKey === 'felwitheb') {
        if (zp.number === 3) {
          bsp = { eq_center: { x: -601.5, y: 459.2, z: 41.5 }, eq_min: { x: -607.5, y: 456.2, z: 31 }, eq_max: { x: -595.5, y: 462.2, z: 52 }, eq_size: { width: 12, depth: 6, height: 21 } };
        } else if (zp.number === 5) {
          bsp = { eq_center: { x: -338.9, y: 503.0, z: 14.5 }, eq_min: { x: -341.9, y: 497.0, z: 4.0 }, eq_max: { x: -335.9, y: 509.0, z: 25.0 }, eq_size: { width: 6, depth: 12, height: 21 } };
        } else if (zp.number === 7) {
          bsp = { eq_center: { x: -919.8, y: 554.1, z: 14.5 }, eq_min: { x: -922.8, y: 548.1, z: 4.0 }, eq_max: { x: -916.8, y: 560.1, z: 25.0 }, eq_size: { width: 6, depth: 12, height: 21 } };
        }
      }

      if (bsp) {
        return {
          target: zp.target_short, targetLongName: zp.target_short, targetZoneId: zp.target_zone_id,
          x: bsp.eq_center.x, y: bsp.eq_center.y, z: bsp.eq_center.z,
          width: bsp.eq_size.depth, length: bsp.eq_size.width, triggerHeight: bsp.eq_size.height,
          bspMin: bsp.eq_min, bspMax: bsp.eq_max, targetX: zp.target_x, targetY: zp.target_y, targetZ: zp.target_z,
        };
      }
      return {
        target: zp.target_short, targetLongName: zp.target_short, targetZoneId: zp.target_zone_id,
        x: zp.x, y: zp.y, z: zp.z, width: zp.buffer || 75, length: zp.width || 75, triggerHeight: zp.height || 75,
        targetX: zp.target_x, targetY: zp.target_y, targetZ: zp.target_z,
      };
    });
  }
}

module.exports = {
  resolveZoneKey,
  getZoneDef,
  initZones,
  ensureZoneLoaded,
};
