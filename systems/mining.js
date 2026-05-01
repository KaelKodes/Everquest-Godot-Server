const State = require('../state');
const { zoneInstances, sessions } = State;
const MiningData = require('../data/miningNodes');
const DB = require('../db');
const combat = require('../combat');
const { send } = require('../utils');
const { NPC_TYPES } = require('../data/npcTypes');

let ItemDB, ITEMS, sendCombatLog, sendInventory;
function setDependencies(deps) {
  ItemDB = deps.ItemDB;
  ITEMS = deps.ITEMS;
  sendCombatLog = deps.sendCombatLog;
  sendInventory = deps.sendInventory;
}

function spawnMiningNodes(zoneId) {
  const zone = zoneInstances[zoneId];
  if (!zone) return;
  const shortName = zone.def && zone.def.shortName ? zone.def.shortName : zoneId;
  const spawnConfig = MiningData.ZONE_MINING_SPAWNS[zoneId] || MiningData.ZONE_MINING_SPAWNS[shortName];
  if (!spawnConfig) return;
  spawnNodeGroup(zoneId, spawnConfig.nodeType, spawnConfig.activeCount, spawnConfig.spawnLocations);
  if (spawnConfig.additionalNodeTypes) {
    for (const extra of spawnConfig.additionalNodeTypes) {
      spawnNodeGroup(zoneId, extra.nodeType, extra.activeCount, extra.spawnLocations);
    }
  }
}

function spawnMiningNPCs(zoneId, spawnMobFn) {
  const zone = zoneInstances[zoneId];
  if (!zone) return;
  const shortName = zone.def && zone.def.shortName ? zone.def.shortName : zoneId;
  const spawnPoint = MiningData.MINING_NPC_SPAWNS[zoneId] || MiningData.MINING_NPC_SPAWNS[shortName];
  if (!spawnPoint) return;
  if (zone.liveMobs.find(m => m.key === 'dougal_coalbeard')) return;
  const npcDef = MiningData.MINING_NPC_DEF;
  spawnMobFn(zoneId, npcDef, spawnPoint.x, spawnPoint.y, spawnPoint.z);
}

function spawnNodeGroup(zoneId, nodeType, activeCount, spawnLocations) {
  const zone = zoneInstances[zoneId];
  const nodeDef = MiningData.MINING_NODES[nodeType];
  if (!nodeDef || !spawnLocations || spawnLocations.length === 0) return;
  const shuffled = [...spawnLocations].sort(() => Math.random() - 0.5);
  const count = Math.min(activeCount, shuffled.length);
  for (let i = 0; i < count; i++) {
    const loc = shuffled[i];
    zone.liveNodes.push({
      id: `node_${nodeType}_${zoneId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      nodeType, name: nodeDef.name, tier: nodeDef.tier, hp: nodeDef.hp, maxHp: nodeDef.hp,
      x: loc.x, y: loc.y, z: loc.z || 0, alive: true,
    });
  }
  zone.nodeSpawnState.push({
    nodeType, activeCount, spawnLocations, respawnTime: nodeDef.respawnTime || 300, pendingRespawns: [],
  });
}

function processMiningRespawns(zoneId, dt) {
  const zone = zoneInstances[zoneId];
  if (!zone || !zone.nodeSpawnState) return;
  for (const state of zone.nodeSpawnState) {
    const aliveCount = zone.liveNodes.filter(n => n.nodeType === state.nodeType && n.alive).length;
    const deficit = state.activeCount - aliveCount - state.pendingRespawns.length;
    for (let i = 0; i < deficit; i++) state.pendingRespawns.push({ timer: state.respawnTime });
    for (let i = state.pendingRespawns.length - 1; i >= 0; i--) {
      state.pendingRespawns[i].timer -= dt;
      if (state.pendingRespawns[i].timer <= 0) {
        const usedPositions = new Set(zone.liveNodes.filter(n => n.nodeType === state.nodeType && n.alive).map(n => `${n.x},${n.y},${n.z}`));
        const available = state.spawnLocations.filter(loc => !usedPositions.has(`${loc.x},${loc.y},${loc.z || 0}`));
        if (available.length > 0) {
          const loc = available[Math.floor(Math.random() * available.length)];
          const nodeDef = MiningData.MINING_NODES[state.nodeType];
          zone.liveNodes.push({
            id: `node_${state.nodeType}_${zoneId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            nodeType: state.nodeType, name: nodeDef.name, tier: nodeDef.tier, hp: nodeDef.hp, maxHp: nodeDef.hp,
            x: loc.x, y: loc.y, z: loc.z || 0, alive: true,
          });
        }
        state.pendingRespawns.splice(i, 1);
      }
    }
  }
  zone.liveNodes = zone.liveNodes.filter(n => n.alive);
}

function handleMine(session, msg) {
  const events = [];
  const char = session.char;
  const zone = zoneInstances[char.zoneId];
  if (!zone) return sendCombatLog(session, [{ event: 'MESSAGE', text: 'You cannot mine here.' }]);

  let pickDef = null;
  for (const row of session.inventory) {
    if (row.equipped === 1 && row.slot === 13) {
      const itemDef = ITEMS[row.item_key] || ItemDB.getById(row.item_key);
      if (itemDef) {
        pickDef = MiningData.PICK_BY_ITEM_ID[row.item_key];
        if (!pickDef) {
          const itemName = (itemDef.name || '').toLowerCase();
          if (itemName.includes('pick') && (itemName.includes('mining') || itemName.includes('forged') || itemName.includes('silvered') || itemName.includes('velium'))) {
            pickDef = MiningData.PICK_BY_ITEM_KEY[ItemDB.generateKey(itemDef.name)];
          }
        }
      }
      break;
    }
  }

  if (!pickDef) return sendCombatLog(session, [{ event: 'MESSAGE', text: 'You must equip a mining pick to mine.' }]);
  if (!session.miningCooldown) session.miningCooldown = 0;
  if (session.miningCooldown > 0) return sendCombatLog(session, [{ event: 'MESSAGE', text: 'You are already swinging your pick...' }]);
  session.miningCooldown = pickDef.delay / 10;

  const targetId = msg.targetId;
  if (!targetId) return sendCombatLog(session, [{ event: 'MESSAGE', text: 'You must target a mining node.' }]);
  const node = zone.liveNodes.find(n => n.id === targetId && n.alive);
  if (!node) return sendCombatLog(session, [{ event: 'MESSAGE', text: 'That mining node is no longer available.' }]);

  const dx = (char.x || 0) - node.x;
  const dy = (char.y || 0) - node.y;
  if (dx * dx + dy * dy > 625) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You are too far away to mine that.' }]);
    session.miningCooldown = 0;
    return;
  }

  const tierMult = MiningData.getTierMultiplier(pickDef.tier, node.tier);
  if (tierMult <= 0) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `Your ${pickDef.name || 'pick'} cannot penetrate the ${node.name}. You need a stronger pick.` }]);
    session.miningCooldown = 0;
    return;
  }

  const nodeDef = MiningData.MINING_NODES[node.nodeType];
  const miningSkill = combat.getCharSkill(char, 'mining');
  const hitChance = MiningData.getMiningHitChance(miningSkill, nodeDef.minSkill);
  combat.trySkillUp(session, 'mining');

  if (Math.random() * 100 > hitChance) {
    events.push({ event: 'MINING_MISS', text: `Your pick glances off the ${node.name}.` });
    sendCombatLog(session, events);
    return;
  }

  const damage = Math.max(1, Math.floor(pickDef.damage * tierMult));
  node.hp -= damage;
  events.push({
    event: 'MINING_HIT', text: `You strike the ${node.name} for ${damage} damage. (${Math.max(0, node.hp)}/${node.maxHp} HP)`,
    nodeId: node.id, damage, nodeHp: Math.max(0, node.hp), nodeMaxHp: node.maxHp,
  });

  if (node.hp <= 0) {
    node.alive = false;
    const lootKey = MiningData.rollLoot(node.nodeType);
    let lootName = lootKey ? lootKey.replace(/_/g, ' ') : 'nothing';
    if (lootKey) {
      const lootItem = ITEMS[lootKey] || ItemDB.getByKey(lootKey);
      if (lootItem) {
        lootName = lootItem.name;
        DB.addInventoryItem(char.id, lootItem._id || lootKey, 0, 0).then(() => {
          DB.getInventory(char.id).then(inv => { session.inventory = inv; sendInventory(session); });
        });
      }
    }
    events.push({ event: 'NODE_SHATTER', text: `The ${node.name} shatters! You receive: ${lootName}.`, nodeId: node.id, lootName });
    for (const [, s] of sessions) {
      if (s.char && s.char.zoneId === char.zoneId && s !== session) send(s.ws, { type: 'NODE_DESTROYED', nodeId: node.id });
    }
  }
  sendCombatLog(session, events);
}

module.exports = {
  setDependencies,
  spawnMiningNodes,
  spawnMiningNPCs,
  processMiningRespawns,
  handleMine,
};
