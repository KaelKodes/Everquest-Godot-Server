const State = require('../state');
const { zoneInstances } = State;
const { NPC_TYPES } = require('../data/npcTypes');
const { mapEqemuClassToNpcType } = require('../utils/npcUtils');

function pickFromPool(pool) {
  if (!pool || pool.length === 0) return null;
  if (pool.length === 1) return pool[0];
  const totalChance = pool.reduce((sum, p) => sum + p.chance, 0);
  if (totalChance <= 0) return pool[Math.floor(Math.random() * pool.length)];
  const roll = Math.random() * totalChance;
  let cumulative = 0;
  for (const entry of pool) {
    cumulative += entry.chance;
    if (roll < cumulative) return entry;
  }
  return pool[pool.length - 1];
}

function spawnMob(zoneId, mobDef, forcedX = null, forcedY = null, forcedZ = null, forcedHeading = null) {
  const zone = zoneInstances[zoneId];
  if (!zone) return;

  let roomId = null;
  if (zone.def && zone.def.rooms) {
      const roomKeys = Object.keys(zone.def.rooms);
      if (roomKeys.length > 0) roomId = roomKeys[Math.floor(Math.random() * roomKeys.length)];
  } else if (zone.def && zone.def.defaultRoom) {
      roomId = zone.def.defaultRoom;
  }

  let spawnX = (forcedX !== null) ? forcedX : 0;
  let spawnY = (forcedY !== null) ? forcedY : 0;

  if (forcedX === null && roomId === 'random') {
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

  const npcType = mobDef.type || NPC_TYPES.MOB;
  const newMob = {
    id: `${mobDef.key}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    roomId, key: mobDef.key, name: mobDef.name, level: mobDef.level,
    race: mobDef.race || 1, gender: mobDef.gender || 0, npcType,
    eqClass: mobDef.eqClass || 0,
    x: spawnX, y: spawnY, z: (forcedZ !== null) ? forcedZ : 0,
    heading: (forcedHeading !== null) ? forcedHeading : 0,
    spawnX, spawnY,
    hp: mobDef.maxHp, maxHp: mobDef.maxHp,
    minDmg: mobDef.minDmg, maxDmg: mobDef.maxDmg,
    attackDelay: mobDef.attackDelay, attackTimer: 0,
    xpBase: mobDef.xpBase, loot: mobDef.loot || [],
    target: null,
  };

  if (mobDef.pathgrid > 0 && zone.grids && zone.grids[mobDef.pathgrid]) {
    newMob.gridId = mobDef.pathgrid;
    newMob.gridEntries = zone.grids[mobDef.pathgrid];
    newMob.gridIndex = 0;
    newMob.gridPauseTimer = 0;
    newMob.isRoaming = true;
  } else if (mobDef.wanderDist > 0) {
    newMob.wanderDist = mobDef.wanderDist;
    newMob.isRoaming = true;
    newMob.gridPauseTimer = 0;
  }
  
  zone.liveMobs.push(newMob);
  return newMob;
}
spawnMob.mapType = mapEqemuClassToNpcType;

function processRespawns(zoneId, TICK_RATE) {
  const zone = zoneInstances[zoneId];
  if (!zone || !zone.spawnPointState) return;

  for (const spawn of zone.spawnPointState) {
    const alive = zone.liveMobs.some(m => m.id === spawn.currentMobId);
    if (!alive) {
      if (spawn.respawnTimer === 0) spawn.respawnTimer = Math.max(spawn.respawnTime || 420, 60);
      spawn.respawnTimer -= TICK_RATE / 1000;
      if (spawn.respawnTimer <= 0) {
        let mobDef = spawn.mobDef;
        if (spawn.pool && spawn.pool.length > 0) {
          const picked = pickFromPool(spawn.pool);
          if (picked) {
            mobDef = {
              key: picked.npc_id.toString(), name: picked.name, level: picked.level,
              type: mapEqemuClassToNpcType(picked.npcClass || 1), pathgrid: spawn.pathgrid || 0,
              maxHp: picked.hp > 0 ? picked.hp : picked.level * 20,
              minDmg: picked.mindmg || Math.max(1, Math.floor(picked.level / 2)),
              maxDmg: picked.maxdmg || Math.max(4, picked.level * 2),
              attackDelay: 3, xpBase: picked.level * picked.level * 15,
              respawnTime: spawn.respawnTime
            };
            spawn.mobDef = mobDef;
            spawn.mobKey = mobDef.key;
          }
        }
        if (mobDef) {
          const newMob = spawnMob(zoneId, mobDef, spawn.x, spawn.y, spawn.z);
          if (newMob) {
            spawn.currentMobId = newMob.id;
            spawn.respawnTimer = 0;
          }
        }
      }
    }
  }
}

module.exports = {
  pickFromPool,
  spawnMob,
  processRespawns,
};
