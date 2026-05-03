const { send } = require('../utils');
const DB = require('../db');
const ItemDB = require('../data/itemDatabase');
const FactionSystem = require('./faction');
const State = require('../state');
const MERCHANT_INVENTORIES = require('../data/npcs/merchants');
const QuestManager = require('../questManager');
const ZONES = require('../data/zones');
const { zoneInstances, sessions } = State;

const { NPC_TYPES, HAIL_RANGE } = require('../data/npcTypes');
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

function getFirstEmptySlot(inventory) {
  const usedSlots = inventory.map(i => i.slot);
  let slot = 22;
  while (usedSlots.includes(slot) && slot <= 29) {
    slot++;
  }
  return slot > 29 ? -1 : slot;
}
function sendInventory(session) {
  return module.exports.sendInventoryFn ? module.exports.sendInventoryFn(session) : null;
}
function sendStatus(session) {
  return module.exports.sendStatusFn ? module.exports.sendStatusFn(session) : null;
}
function processQuestActions(session, target, actions) {
  if (module.exports.processQuestActionsFn) return module.exports.processQuestActionsFn(session, target, actions);
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

  const buyMod = await getChaBuyMod(session, merchant.id);
  const price = Math.max(1, Math.floor(basePrice * buyMod));

  if (char.copper < price) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You don't have enough money! That costs ${formatCurrency(price)}.` }]);
    return;
  }

  // Transaction — use the numeric itemKey for DB items
  const addKey = parseInt(itemKey) || itemKey;
  const emptySlot = getFirstEmptySlot(session.inventory);
  if (emptySlot === -1) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'Your inventory is full!' }]);
    return;
  }

  // Transaction
  char.copper -= price;
  await DB.addItem(char.id, addKey, 0, emptySlot);
  await DB.updateCharacterState(char);

  session.inventory = await DB.getInventory(char.id);
  session.effectiveStats = calcEffectiveStats(char, session.inventory, session.buffs);

  if (module.exports.sendInventoryFn) module.exports.sendInventoryFn(session);
  sendCombatLog(session, [{ event: 'MESSAGE', text: `You bought ${itemName} for ${formatCurrency(price)}.` }]);
  if (module.exports.sendStatusFn) module.exports.sendStatusFn(session);
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

  // Find the item in player inventory — use string comparison to avoid type mismatches
  const invRow = session.inventory.find(i => String(i.id) === String(itemId));
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
  const sellMod = await getChaSellMod(session, merchant.id);
  const sellPrice = Math.max(1, Math.floor(baseSell * sellMod * bonusMult));

  // Transaction
  await DB.deleteItem(char.id, invRow.item_key, invRow.slot);
  char.copper += sellPrice;
  await DB.updateCharacterState(char);
  
  // Add to buyback
  await DB.addBuybackItem(char.id, parseInt(merchant.key), invRow.item_key, invRow.quantity || 1, sellPrice);

  // Refresh inventory
  session.inventory = await DB.getInventory(char.id);
  if (module.exports.calcEffectiveStatsFn) {
    session.effectiveStats = module.exports.calcEffectiveStatsFn(char, session.inventory, session.buffs);
  }

  if (module.exports.sendInventoryFn) module.exports.sendInventoryFn(session);
  sendCombatLog(session, [{ event: 'LOOT', text: `You sold ${itemName} to ${merchant.name} for ${formatCurrency(sellPrice)}.` }]);
  if (module.exports.sendStatusFn) module.exports.sendStatusFn(session);
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
  const instance = zoneInstances[char.zoneId];
  if (instance && instance.liveMobs) {
    target = instance.liveMobs.find(m => String(m.id) === String(targetId));
  }

  if (!target) {
    sendCombatLog(session, [{ event: 'ERROR', text: "That NPC is no longer there." }]);
    sendInventory(session);
    return;
  }

  // Faction check for trade
  const standing = FactionSystem.getStanding(char, target);
  if (standing.value < -699) { // Dubious or worse
    const fallbackActions = [
      { action: 'say', source: target.id, msg: `I will not trade with someone like you, ${char.name}.` }
    ];
    processQuestActions(session, target, fallbackActions);
    sendInventory(session);
    return;
  }

  // Pet specific logic
  if (target.isPet && target.ownerId === char.id) {
    let itemsToConsume = [];
    let itemsRejected = [];
    let isFull = false;

    // Slot mapping for easy access
    const eqToSlot = {
      0: 'charm', 1: 'ear1', 2: 'head', 3: 'face', 4: 'ear2', 5: 'neck', 6: 'shoulders',
      7: 'arms', 8: 'back', 9: 'wrists1', 10: 'wrists2', 11: 'ranged', 12: 'hands',
      13: 'primary', 14: 'secondary', 15: 'fingers1', 16: 'fingers2', 17: 'chest',
      18: 'legs', 19: 'feet', 20: 'waist', 21: 'ammo'
    };

    // Calculate item "score" to determine BiS (simple sum of stats + ac + damage)
    const getItemScore = (itemDef) => {
      if (!itemDef) return 0;
      return (itemDef.hp || 0) + (itemDef.ac || 0) * 2 + (itemDef.damage || 0) * 5 + 
             (itemDef.astr || 0) + (itemDef.asta || 0) + (itemDef.adex || 0) + (itemDef.aagi || 0);
    };

    for (const it of items) {
      const itemDef = ItemDB.getById(it.item_id) || ITEMS[it.item_id] || {};
      
      // Can the pet use it? (Assuming pets are class 1 Warrior by default)
      const classId = 1;
      const canEquipClass = itemDef.classes === 65535 || (itemDef.classes & (1 << (classId - 1)));
      
      if (!canEquipClass) {
        itemsRejected.push(it);
        continue;
      }

      // Determine slot
      let targetSlotName = eqToSlot[itemDef.slot];
      if (!targetSlotName) targetSlotName = 'primary'; // fallback

      // Handle duplicate slot types (ear, wrist, fingers)
      let slotNamesToCheck = [targetSlotName];
      if (itemDef.slot === 1 || itemDef.slot === 4) slotNamesToCheck = ['ear1', 'ear2'];
      if (itemDef.slot === 9 || itemDef.slot === 10) slotNamesToCheck = ['wrists1', 'wrists2'];
      if (itemDef.slot === 15 || itemDef.slot === 16) slotNamesToCheck = ['fingers1', 'fingers2'];
      if (itemDef.itemtype === 1) slotNamesToCheck = ['primary', 'secondary']; // Weapons
      if (itemDef.itemtype === 4) slotNamesToCheck = ['secondary']; // Shield

      let equippedSlot = null;
      let isUpgrade = false;

      // Find if we have an empty slot or an upgrade
      for (const sName of slotNamesToCheck) {
        const currentItem = target.equipment[sName];
        if (!currentItem) {
          equippedSlot = sName;
          isUpgrade = true;
          break;
        } else {
          const currentDef = ItemDB.getById(currentItem.item_id) || ITEMS[currentItem.item_id] || {};
          if (getItemScore(itemDef) > getItemScore(currentDef)) {
            equippedSlot = sName;
            isUpgrade = true;
            break;
          }
        }
      }

      if (isUpgrade) {
        // Equip it! Move existing item to inventory if any
        if (target.equipment[equippedSlot]) {
          const oldItem = target.equipment[equippedSlot];
          if (target.inventory.length < 8) {
            target.inventory.push(oldItem);
          } else {
            // No room for the old item! We must reject the new one
            isFull = true;
            itemsRejected.push(it);
            continue;
          }
        }
        target.equipment[equippedSlot] = it;
        itemsToConsume.push(it);
      } else {
        // Not BiS, put in inventory if space
        if (target.inventory.length < 8) {
          target.inventory.push(it);
          itemsToConsume.push(it);
        } else {
          isFull = true;
          itemsRejected.push(it);
        }
      }
    }

    if (itemsRejected.length > 0) {
      const fallbackActions = [
        { action: 'say', source: target.id, msg: isFull ? `Master, my inventory is full. Please take some items first.` : `I have no use for this, master.` }
      ];
      processQuestActions(session, target, fallbackActions);
    } else {
      processQuestActions(session, target, [{ action: 'say', source: target.id, msg: `Thank you, master.` }]);
    }

    // Delete consumed items from player
    for (const it of itemsToConsume) {
      if (it.inst_id) {
        await DB.pool.query('DELETE FROM inventory WHERE id = ? AND char_id = ?', [it.inst_id, char.id]);
      }
    }

    session.inventory = await DB.getInventory(char.id);
    session.effectiveStats = calcEffectiveStats(char, session.inventory, session.buffs);
    sendInventory(session);
    
    // Send pet inventory update
    send(session.ws, { 
      type: 'PET_INVENTORY_UPDATE', 
      equipment: target.equipment, 
      inventory: target.inventory 
    });
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
  } else {
    // Unhandled trade: return all items to player
    itemsToConsume = [];
    const fallbackActions = [
      { action: 'say', source: target.id, msg: `I have no need for this, ${char.name}, you can have it back.` }
    ];
    processQuestActions(session, target, fallbackActions);
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
async function getChaBuyMod(session, npcId) {
  const cha = session.effectiveStats?.cha || session.char?.cha || 75;
  let mod = 1.0 - (cha - 75) * 0.004;
  if (npcId) {
      const npc = (State.zoneInstances[session.char.zoneId]?.liveMobs || []).find(m => m.id === npcId);
      if (npc) {
         const standing = FactionSystem.getStanding(session.char, npc);
         mod -= (standing.value / 10000);
      }
  }
  return Math.max(0.6, Math.min(1.3, mod));
}

async function getChaSellMod(session, npcId) {
  const cha = session.effectiveStats?.cha || session.char?.cha || 75;
  let mod = 1.0 + (cha - 75) * 0.004;
  if (npcId) {
      const npc = (State.zoneInstances[session.char.zoneId]?.liveMobs || []).find(m => m.id === npcId);
      if (npc) {
         const standing = FactionSystem.getStanding(session.char, npc);
         mod += (standing.value / 10000);
      }
  }
  return Math.max(0.7, Math.min(1.5, mod));
}

async function handlePetInventoryAction(session, msg) {
  const char = session.char;
  const pet = session.pet;

  if (!pet || !pet.alive || pet.ownerId !== char.id) return;

  const { action, location, destination } = msg;

  const getItemAt = (loc) => {
    if (!loc) return null;
    if (loc.type === 'equip') return pet.equipment[loc.slot];
    if (loc.type === 'inventory') return pet.inventory[loc.slot];
    return null;
  };

  const setItemAt = (loc, item) => {
    if (loc.type === 'equip') {
      if (item) pet.equipment[loc.slot] = item;
      else delete pet.equipment[loc.slot];
    } else if (loc.type === 'inventory') {
      pet.inventory[loc.slot] = item;
    }
  };

  if (action === 'take') {
    const item = getItemAt(location);
    if (!item) return;

    // Check player inventory space
    const emptySlot = getFirstEmptySlot(session.inventory);
    if (emptySlot === -1) {
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'Your inventory is full!' }]);
      return;
    }

    // Add to DB
    await DB.addItem(char.id, item.item_id, 0, emptySlot);
    
    // Remove from pet
    if (location.type === 'inventory') {
      pet.inventory.splice(location.slot, 1);
    } else {
      setItemAt(location, null);
    }

    session.inventory = await DB.getInventory(char.id);
    session.effectiveStats = calcEffectiveStats(char, session.inventory, session.buffs);
    sendInventory(session);
    
    send(session.ws, { 
      type: 'PET_INVENTORY_UPDATE', 
      equipment: pet.equipment, 
      inventory: pet.inventory 
    });
  } else if (action === 'move') {
    const srcItem = getItemAt(location);
    if (!srcItem) return;

    // If moving from inventory to inventory, we just swap or shift
    if (location.type === 'inventory' && destination.type === 'inventory') {
      const destItem = getItemAt(destination);
      pet.inventory[location.slot] = destItem;
      pet.inventory[destination.slot] = srcItem;
      // Filter out nulls to keep it packed
      pet.inventory = pet.inventory.filter(i => i);
    } else {
      const destItem = getItemAt(destination);
      
      // If equipping, check constraints? 
      // The user is manually equipping it, we can enforce class/race but MVP just swaps
      
      if (location.type === 'inventory') {
        // we are moving FROM inventory TO equip
        setItemAt(destination, srcItem);
        if (destItem) {
          pet.inventory[location.slot] = destItem; // swap
        } else {
          pet.inventory.splice(location.slot, 1); // remove
        }
      } else if (destination.type === 'inventory') {
        // moving FROM equip TO inventory
        setItemAt(location, destItem); // might be null
        // If destination slot is out of bounds, just push
        if (destination.slot >= pet.inventory.length) {
           pet.inventory.push(srcItem);
        } else {
           pet.inventory[destination.slot] = srcItem;
        }
      } else {
        // equip to equip swap
        setItemAt(destination, srcItem);
        setItemAt(location, destItem);
      }
      
      pet.inventory = pet.inventory.filter(i => i);
    }

    send(session.ws, { 
      type: 'PET_INVENTORY_UPDATE', 
      equipment: pet.equipment, 
      inventory: pet.inventory 
    });
  }
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

  const invRow = session.inventory.find(i => i.slot === fromSlot);
  if (!invRow) return;

  const itemDef = ItemDB.getById(invRow.item_key) || ITEMS[invRow.item_key] || {};

  // Check if target is a bag slot
  if ((toSlot >= 251 && toSlot <= 330) || (toSlot >= 2531 && toSlot <= 2770) || (toSlot >= 2511 && toSlot <= 2590)) {
    // Cannot put bags inside bags
    if (itemDef.itemtype === 1) {
      send(session.ws, { type: 'SYSTEM_MSG', message: 'You cannot put a container inside another container.' });
      return;
    }

    let parentBagSlot = 0;
    if (toSlot >= 251 && toSlot <= 330) {
        parentBagSlot = 22 + Math.floor((toSlot - 251) / 10);
    } else if (toSlot >= 2531 && toSlot <= 2770) {
        parentBagSlot = 2000 + Math.floor((toSlot - 2531) / 10);
    } else if (toSlot >= 2511 && toSlot <= 2590) {
        parentBagSlot = 2500 + Math.floor((toSlot - 2511) / 10);
    }

    const parentBagRow = session.inventory.find(i => i.slot === parentBagSlot);
    if (!parentBagRow) {
      send(session.ws, { type: 'SYSTEM_MSG', message: 'There is no bag there.' });
      return;
    }

    const bagDef = ItemDB.getById(parentBagRow.item_key) || ITEMS[parentBagRow.item_key] || {};
    
    // Check if item fits in the bag (bagsize 0-4 = tiny-giant, item size 0-4)
    if (itemDef.size > bagDef.bagsize) {
      send(session.ws, { type: 'SYSTEM_MSG', message: 'That item is too large to fit in this container.' });
      return;
    }
  }

  // If moving a bag to another slot, ensure the target slot is not inside a bag
  if (itemDef.itemtype === 1) {
      if ((toSlot >= 251 && toSlot <= 330) || (toSlot >= 2531 && toSlot <= 2770) || (toSlot >= 2511 && toSlot <= 2590)) {
          send(session.ws, { type: 'SYSTEM_MSG', message: 'You cannot put a container inside another container.' });
          return;
      }
      
      // If moving a bag, and there's an item in the target slot, that target item will swap with the bag.
      // So if target item is NOT a bag, it will try to go into fromSlot.
      // If fromSlot is an equip slot or inside a bag, it might be invalid.
      // For MVP, we let eqemu_db swap them, but EQ might not allow swapping bags if target is occupied.
      const toRow = session.inventory.find(i => i.slot === toSlot);
      if (toRow) {
          // If swapping, ensure the swapped item can go into fromSlot
          if (fromSlot >= 251 && fromSlot <= 330) {
               // The fromSlot is a bag slot, so we're swapping an item out of a bag WITH a bag into the bag. Invalid.
               send(session.ws, { type: 'SYSTEM_MSG', message: 'Invalid container swap.' });
               return;
          }
      }
  }

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

async function handleGetOffer(session, msg) {
  const { npcId, itemId, slotId } = msg;
  console.log(`[TRADE] handleGetOffer: npcId=${npcId}, itemId=${itemId}`);
  const char = session.char;
  const instance = zoneInstances[char.zoneId];
  if (!instance) {
      console.log(`[TRADE] handleGetOffer: no instance found for zoneId=${char.zoneId}`);
      return;
  }

  const merchant = instance.liveMobs.find(m => m.id === npcId);
  if (!merchant || merchant.npcType !== NPC_TYPES.MERCHANT) {
      console.log(`[TRADE] handleGetOffer: merchant not found or not merchant type. npcId=${npcId}, merchant=`, merchant);
      return;
  }

  const invRow = session.inventory.find(i => String(i.id) === String(itemId));
  if (!invRow) {
      console.log(`[TRADE] handleGetOffer: invRow not found for itemId=${itemId}. session.inventory IDs:`, session.inventory.map(i => i.id));
      return;
  }

  const itemDef = ItemDB.getById(invRow.item_key) || ITEMS[invRow.item_key];
  const baseSell = (itemDef ? itemDef.value || 1 : 1) * 0.25;

  let bonusMult = 1.0;
  const shopData = MERCHANT_INVENTORIES[merchant.key];
  if (shopData && shopData.sellBonus && shopData.sellBonusCategories) {
    const itemNameLower = (itemDef ? itemDef.name || '' : '').toLowerCase();
    if (shopData.sellBonusCategories.some(cat => itemNameLower.includes(cat))) {
      bonusMult = 1.0 + shopData.sellBonus;
    }
  }

  const sellMod = await getChaSellMod(session, merchant.id);
  const sellPrice = Math.max(1, Math.floor(baseSell * sellMod * bonusMult));

  send(session.ws, {
    type: 'MERCHANT_OFFER',
    itemId: itemId,
    price: sellPrice,
    priceText: formatCurrency(sellPrice),
    name: itemDef ? itemDef.name || 'Unknown Item' : 'Unknown Item',
    icon: itemDef ? itemDef.icon || 0 : 0
  });
}

async function handleSellJunk(session, msg) {
  const { npcId } = msg;
  const char = session.char;
  const instance = zoneInstances[char.zoneId];
  if (!instance) return;

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

  // Find all unequipped items and sell them if they have a low value (e.g., < 1pp) or no special attributes.
  // For simplicity, we define "junk" as items with no stats (AC, damage, HP/mana) and low price.
  let totalSold = 0;
  let totalCopper = 0;

  for (const invRow of session.inventory) {
      if (invRow.equipped === 1) continue;
      
      const itemDef = ItemDB.getById(invRow.item_key) || ITEMS[invRow.item_key];
      if (!itemDef) continue;
      
      // Heuristic for junk: No stats, no scroll effect, low value.
      // This might be risky in classic EQ, but we'll use a basic heuristic.
      // Alternatively, we could rely on a specific 'junk' flag if it existed.
      // Let's look for items with no stat bonuses and value < 1000cp (1pp).
      const hasStats = (itemDef.ac > 0) || (itemDef.damage > 0) || (itemDef.hp > 0) || (itemDef.mana > 0) || (itemDef.astr > 0) || (itemDef.scrolleffect > 0) || (itemDef.classes !== 65535 && itemDef.classes > 0);
      
      if (!hasStats && (itemDef.value || 0) < 1000) {
          const baseSell = (itemDef.value || 1) * 0.25;
          const sellMod = await getChaSellMod(session, merchant.id);
          const sellPrice = Math.max(1, Math.floor(baseSell * sellMod));
          
          await DB.deleteItem(char.id, invRow.item_key, invRow.slot);
          char.copper += sellPrice;
          await DB.addBuybackItem(char.id, merchant.id, invRow.item_key, invRow.quantity || 1, sellPrice);
          totalSold++;
          totalCopper += sellPrice;
      }
  }

  if (totalSold > 0) {
      DB.updateCharacterState(char);
      session.inventory = await DB.getInventory(char.id);
      session.effectiveStats = calcEffectiveStats(char, session.inventory, session.buffs);
      sendInventory(session);
      sendCombatLog(session, [{ event: 'LOOT', text: `You sold ${totalSold} junk items to ${merchant.name} for ${formatCurrency(totalCopper)}.` }]);
      sendStatus(session);
  } else {
      sendCombatLog(session, [{ event: 'MESSAGE', text: `You don't have any junk to sell.` }]);
  }
}

async function handleBuyRecover(session, msg) {
    const { npcId, buybackId } = msg;
    const char = session.char;
    const instance = zoneInstances[char.zoneId];
    if (!instance) return;

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

    const buybackItems = await DB.getBuybackItems(char.id, parseInt(merchant.key));
    
    // If no buybackId provided, the client is just requesting the list
    if (buybackId === undefined || buybackId === null) {
        const payloadItems = buybackItems.map(bItem => {
            const def = ItemDB.getById(bItem.item_id) || ITEMS[bItem.item_id];
            return {
                buybackId: bItem.id,
                itemKey: bItem.item_id,
                name: def ? def.name : String(bItem.item_id),
                price: bItem.price,
                priceText: formatCurrency(bItem.price),
                icon: def ? def.icon : 0,
                charges: bItem.charges
            };
        });
        
        send(session.ws, {
            type: 'MERCHANT_RECOVER_LIST',
            npcId: merchant.id,
            items: payloadItems
        });
        return;
    }

    const item = buybackItems.find(i => String(i.id) === String(buybackId));
    if (!item) {
        sendCombatLog(session, [{ event: 'MESSAGE', text: 'That item is no longer available for recovery.' }]);
        return;
    }

    if (char.copper < item.price) {
        sendCombatLog(session, [{ event: 'MESSAGE', text: `You don't have enough money! That costs ${formatCurrency(item.price)}.` }]);
        return;
    }

    const emptySlot = getFirstEmptySlot(session.inventory);
    if (emptySlot === -1) {
        sendCombatLog(session, [{ event: 'MESSAGE', text: 'Your inventory is full!' }]);
        return;
    }

    // Transaction
    char.copper -= item.price;
    await DB.addItem(char.id, item.item_id, 0, emptySlot, item.charges || 1);
    await DB.removeBuybackItem(item.id);
    await DB.updateCharacterState(char);

    session.inventory = await DB.getInventory(char.id);
    session.effectiveStats = calcEffectiveStats(char, session.inventory, session.buffs);

    const itemDef = ItemDB.getById(item.item_id) || ITEMS[item.item_id];
    const itemName = itemDef ? itemDef.name : String(item.item_id);

    if (module.exports.sendInventoryFn) module.exports.sendInventoryFn(session);
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You recovered ${itemName} for ${formatCurrency(item.price)}.` }]);
    if (module.exports.sendStatusFn) module.exports.sendStatusFn(session);

    // Tell the client to refresh the recover list
    const updatedBuybackItems = await DB.getBuybackItems(char.id, parseInt(merchant.key));
    send(session.ws, {
        type: 'MERCHANT_RECOVER_LIST',
        npcId: merchant.id,
        items: updatedBuybackItems.map(i => {
            const def = ItemDB.getById(i.item_id) || ITEMS[i.item_id] || {};
            return {
                buybackId: i.id,
                itemKey: i.item_id,
                name: def.name || String(i.item_id),
                price: i.price,
                priceText: formatCurrency(i.price),
                scrolllevel: def.scrolllevel || 0,
                itemtype: def.itemtype || 0,
                classes: def.classes || 65535,
                reclevel: def.reclevel || 0
            };
        })
    });
}



async function handleRightClick(session, msg) {
  const { targetId } = msg;
  const char = session.char;
  const zone = zoneInstances[char.zoneId];

  if (!zone || !zone.liveMobs) return;
  let target = zone.liveMobs.find(m => String(m.id) === String(targetId));
  let effectiveType = target ? target.npcType : null;

  if (!target && zone.corpses) {
      target = zone.corpses.find(c => String(c.id) === String(targetId));
      if (target) effectiveType = 'corpse';
  }

  if (!target) return;

  const distSq = getDistanceSq(char.x, char.y, target.x, target.y);
  if (distSq > HAIL_RANGE * HAIL_RANGE) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You are too far away to interact with ${target.name}.` }]);
    return;
  }

  // Safety Fallback: If npcType is generic MOB, try re-resolving via eqClass
  if (effectiveType === NPC_TYPES.MOB && target.eqClass > 0) {
      const { mapEqemuClassToNpcType } = require('../utils/npcUtils');
      effectiveType = mapEqemuClassToNpcType(target.eqClass);
      target.npcType = effectiveType; // Fix it for future clicks
  }

  if (effectiveType === 'corpse') {
      let lootedSomething = false;
      for (const lootEntry of target.loot) {
          const itemDef = ITEMS[lootEntry.itemKey];
          if (itemDef) {
              if (itemDef.type !== 'weapon' && itemDef.type !== 'armor' && itemDef.type !== 'shield' && itemDef.type !== 'clothing') {
                  const existing = session.inventory.find(i => i.item_key === lootEntry.itemKey);
                  if (existing) {
                      await DB.updateItemQuantity(existing.id, session.char.id, 1);
                  } else {
                      await DB.addItem(session.char.id, lootEntry.itemKey, 0, 0, 1);
                  }
              } else {
                  await DB.addItem(session.char.id, lootEntry.itemKey, 0, 0, 1);
              }
              sendCombatLog(session, [{ event: 'LOOT', item: itemDef.name, source: target.originalName }]);
              lootedSomething = true;
          }
      }
      
      if (lootedSomething) {
          session.inventory = await DB.getInventory(session.char.id);
          sendInventory(session);
      } else {
          sendCombatLog(session, [{ event: 'MESSAGE', text: `This corpse is empty.` }]);
      }
      
      // Fast decay after looted
      target.decayTime = 0; 
      return;
  }

  // Handle based on NPC type
  switch (effectiveType) {
    case NPC_TYPES.MERCHANT: {
      // Turn NPC to face player
      let dx = char.x - target.x;
      let dy = char.y - target.y;
      let newHeading = (Math.atan2(dx, dy) / (2 * Math.PI)) * 512;
      if (newHeading < 0) newHeading += 512;
      target.heading = newHeading;

      const eqemuDB = require('../eqemu_db');
      const dbItems = await eqemuDB.getMerchantItems(parseInt(target.key));
      
      const buyMod = await getChaBuyMod(session, target.id);
      const sellMod = await getChaSellMod(session, target.id);

      const items = dbItems.map(di => {
        const itemDef = ItemDB.getById(di.itemKey) || ITEMS[di.itemKey] || {};
        let price = Math.max(1, Math.floor((di.price || 10) * buyMod));
        return {
          itemKey: di.itemKey,
          name: di.name,
          price: price,
          priceText: formatCurrency(price),
          icon: itemDef.icon || 0,
          charges: di.charges || 1,
          scrolllevel: itemDef.scrolllevel || 0,
          itemtype: itemDef.itemtype || 0,
          classes: itemDef.classes || 65535,
          reclevel: itemDef.reclevel || 0
        };
      });

      // Compute player's class bitmask for client-side filtering
      const CLASSES_MAP = { warrior:1, cleric:2, paladin:3, ranger:4, shadow_knight:5, druid:6, monk:7, bard:8, rogue:9, shaman:10, necromancer:11, wizard:12, magician:13, enchanter:14, beastlord:15, berserker:16 };
      const classId = CLASSES_MAP[char.class] || 1;
      const playerClassBitmask = 1 << (classId - 1);

      send(session.ws, {
        type: 'OPEN_MERCHANT',
        npcId: target.id,
        npcName: target.name,
        buyMod: buyMod,
        sellMod: sellMod,
        items: items,
        playerClassBitmask: playerClassBitmask,
        playerLevel: char.level
      });
      break;
    }

    case NPC_TYPES.TRAINER:
    case NPC_TYPES.GUILD_MASTER: {
      // Turn NPC to face player
      let dx = char.x - target.x;
      let dy = char.y - target.y;
      let newHeading = (Math.atan2(dx, dy) / (2 * Math.PI)) * 512;
      if (newHeading < 0) newHeading += 512;
      target.heading = newHeading;

      if (module.exports.handleTrainSkillFn) {
        module.exports.handleTrainSkillFn(session, { npcId: target.id });
      }
      break;
    }

    case NPC_TYPES.BANK: {
      // Turn NPC to face player
      let dx = char.x - target.x;
      let dy = char.y - target.y;
      let newHeading = (Math.atan2(dx, dy) / (2 * Math.PI)) * 512;
      if (newHeading < 0) newHeading += 512;
      target.heading = newHeading;

      // Drop Invis
      if (session.char.invisible) {
          session.char.invisible = false;
          send(session.ws, { type: 'SYSTEM_MSG', message: 'You appear.' });
          // Note: In a full system, you would call buff removal logic here
      }

      send(session.ws, { type: 'OPEN_BANK', npcId: target.id });
      break;
    }
  }
}

module.exports = {
  handleBuy,
  handleRightClick,
  handleSell,
  handleNPCGiveItems,
  handlePetInventoryAction,
  handleDestroyItem,
  handleEquipItem,
  handleUnequipItem,
  handleMoveItem,
  handleAutoEquip,
  handleGetOffer,
  handleSellJunk,
  handleBuyRecover,
  getFirstEmptySlot,
  setCalcEffectiveStatsFn: (fn) => { module.exports.calcEffectiveStatsFn = fn; },
  setSendCombatLogFn: (fn) => { module.exports.sendCombatLogFn = fn; },
  setSendInventoryFn: (fn) => { module.exports.sendInventoryFn = fn; },
  setSendStatusFn: (fn) => { module.exports.sendStatusFn = fn; },
  setProcessQuestActionsFn: (fn) => { module.exports.processQuestActionsFn = fn; }
};
