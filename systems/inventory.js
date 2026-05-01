const { send } = require('../utils');
const DB = require('../db');
const ItemDB = require('../data/itemDatabase');
const State = require('../state');
const { zoneInstances, sessions } = State;

const NPC_TYPES = {
  MERCHANT: 1,
  BANKER: 2,
  GUILDMASTER: 3,
  NORMAL: 4
};
const HAIL_RANGE = 200;
const ITEMS = ItemDB.ITEMS || {};

function getDistanceSq(x1, y1, x2, y2) {
  return (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
}

// We use the calcEffectiveStats function passed from the engine context
function calcEffectiveStats(char, inventory, buffs) {
  return module.exports.calcEffectiveStatsFn ? module.exports.calcEffectiveStatsFn(char, inventory, buffs) : {hp: char.maxHp, mana: char.maxMana};
}

// We also need sendCombatLog, sendInventory, sendStatus
function sendCombatLog(session, events) {
  return module.exports.sendCombatLogFn ? module.exports.sendCombatLogFn(session, events) : null;
}
function sendInventory(session) {
  return module.exports.sendInventoryFn ? module.exports.sendInventoryFn(session) : null;
}
function sendStatus(session) {
  return module.exports.sendStatusFn ? module.exports.sendStatusFn(session) : null;
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

  const itemDef = ItemDB.getById(invRow.item_key) || ITEMS[invRow.item_key] || {};
  if (!itemDef || Object.keys(itemDef).length === 0) return;

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
  const { itemId, slot } = msg;
  await DB.unequipItem(itemId, session.char.id, slot);
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


module.exports = {
  handleBuy,
  handleSell,
  handleNPCGiveItems,
  handleDestroyItem,
  handleEquipItem,
  handleUnequipItem,
  handleMoveItem,
  handleAutoEquip,
  setCalcEffectiveStatsFn: (fn) => { module.exports.calcEffectiveStatsFn = fn; },
  setSendCombatLogFn: (fn) => { module.exports.sendCombatLogFn = fn; },
  setSendInventoryFn: (fn) => { module.exports.sendInventoryFn = fn; },
  setSendStatusFn: (fn) => { module.exports.sendStatusFn = fn; }
};
