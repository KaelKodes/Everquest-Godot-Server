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
const { canLootLockedCorpse } = require('../utils/corpseLoot');
const ITEMS = ItemDB.createLegacyProxy();

/** Nested slot stride per parent slot; must match eqmud Scripts/UI/BagWindow.cs */
const NESTED_BAG_STRIDE = 10;

function resolveNestedBagBase(toSlot) {
  if (toSlot >= 251 && toSlot <= 330) {
    const parentBagSlot = 22 + Math.floor((toSlot - 251) / NESTED_BAG_STRIDE);
    const base = 251 + (parentBagSlot - 22) * NESTED_BAG_STRIDE;
    return { parentBagSlot, base };
  }
  if (toSlot >= 2531 && toSlot <= 2770) {
    const parentBagSlot = 2000 + Math.floor((toSlot - 2531) / NESTED_BAG_STRIDE);
    const base = 2531 + (parentBagSlot - 2000) * NESTED_BAG_STRIDE;
    return { parentBagSlot, base };
  }
  if (toSlot >= 2511 && toSlot <= 2590) {
    const parentBagSlot = 2500 + Math.floor((toSlot - 2511) / NESTED_BAG_STRIDE);
    const base = 2511 + (parentBagSlot - 2500) * NESTED_BAG_STRIDE;
    return { parentBagSlot, base };
  }
  return null;
}

function isNestedBagSlotId(slot) {
  return resolveNestedBagBase(slot) != null;
}

/**
 * Ensures nested slot id is within parent container's bagslots (item DB).
 * @returns {{ ok: true, isNested: false } | { ok: true, isNested: true, bagDef: object } | { ok: false, msg: string }}
 */
function validateNestedBagDestination(session, toSlot) {
  const resolved = resolveNestedBagBase(toSlot);
  if (!resolved) return { ok: true, isNested: false };
  const parentBagRow = session.inventory.find((i) => i.slot === resolved.parentBagSlot);
  if (!parentBagRow) return { ok: false, msg: 'There is no bag there.' };
  const bagDef = ItemDB.getById(parentBagRow.item_key) || ITEMS[parentBagRow.item_key] || {};
  const maxSlots = Math.max(0, Math.floor(Number(bagDef.bagslots)));
  const idx = toSlot - resolved.base;
  if (maxSlots <= 0 || idx < 0 || idx >= maxSlots) {
    return { ok: false, msg: 'That container does not have that slot.' };
  }
  return { ok: true, isNested: true, bagDef };
}

function getDistanceSq(x1, y1, x2, y2) {
  return (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
}

/**
 * Inventory rows use `id` === PEQ item_id (catalog key), not a unique instance id.
 * Prefer slotId from the client so stacks / duplicate item_ids resolve to the correct row.
 */
function resolveInvRowForTrade(session, itemId, slotId) {
  const inv = session.inventory || [];
  if (slotId != null && slotId !== '' && Number.isFinite(Number(slotId))) {
    const s = Number(slotId);
    const row = inv.find((i) => Number(i.slot) === s);
    if (row) return row;
  }
  if (itemId == null || itemId === '') return null;
  const sid = String(itemId);
  const matches = inv.filter((i) => String(i.item_key) === sid || String(i.id) === sid);
  if (matches.length === 1) return matches[0];
  return null;
}

const MERCHANT_QTY_CAP = 999;

/** Max units of itemKey that fit in main pockets (22–29), counting stack merge room. */
function computeMaxBuyOnPerson(session, itemKey, stackSize) {
  const key = Number(itemKey);
  const stack = Math.max(1, stackSize || 1);
  let room = 0;
  const inv = session.inventory || [];
  for (let slot = 22; slot <= 29; slot++) {
    const row = inv.find((i) => Number(i.slot) === slot);
    if (!row) {
      room += stack;
      continue;
    }
    if (Number(row.item_key) !== key) continue;
    const q = Math.max(1, Number(row.quantity) || 1);
    room += Math.max(0, stack - q);
  }
  return room;
}

/** Grant count units of addKey into main pockets; merges stacks then fills empty slots. Returns how many were placed. */
async function grantPurchasedItems(charId, addKey, count, stackSize, session) {
  let remaining = count;
  const stack = Math.max(1, stackSize || 1);
  while (remaining > 0) {
    session.inventory = await DB.getInventory(charId);
    let merged = false;
    for (let slot = 22; slot <= 29; slot++) {
      const row = session.inventory.find((i) => Number(i.slot) === slot);
      if (!row || Number(row.item_key) !== Number(addKey)) continue;
      const q = Math.max(1, Number(row.quantity) || 1);
      const space = stack - q;
      if (space <= 0) continue;
      const take = Math.min(remaining, space);
      await DB.updateItemQuantity(addKey, charId, take, slot);
      remaining -= take;
      merged = true;
      break;
    }
    if (merged) continue;
    const emptySlot = getFirstEmptySlot(session.inventory);
    if (emptySlot < 22 || emptySlot > 29) break;
    const chunk = Math.min(remaining, stack);
    await DB.addItem(charId, addKey, 0, emptySlot, chunk);
    remaining -= chunk;
  }
  session.inventory = await DB.getInventory(charId);
  return count - remaining;
}

let calcEffectiveStatsFn, sendCombatLogFn, sendInventoryFn, sendStatusFn, processQuestActionsFn, handleTrainSkillFn;

function calcEffectiveStats(char, inventory, buffs) {
  return calcEffectiveStatsFn ? calcEffectiveStatsFn(char, inventory, buffs) : {hp: char.maxHp, mana: char.maxMana};
}

function sendCombatLog(session, events) {
  if (sendCombatLogFn) sendCombatLogFn(session, events);
}

function sendInventory(session) {
  if (sendInventoryFn) sendInventoryFn(session);
}

function sendStatus(session) {
  if (sendStatusFn) sendStatusFn(session);
}

function init(deps) {
  calcEffectiveStatsFn = deps.calcEffectiveStats;
  sendCombatLogFn = deps.sendCombatLog;
  sendInventoryFn = deps.sendInventory;
  sendStatusFn = deps.sendStatus;
  processQuestActionsFn = deps.processQuestActions;
  handleTrainSkillFn = deps.handleTrainSkill;
}

function getFirstEmptySlot(inventory) {
  const usedSlots = inventory.map(i => i.slot);
  let slot = 22;
  while (usedSlots.includes(slot) && slot <= 29) {
    slot++;
  }
  return slot > 29 ? -1 : slot;
}

async function processQuestActions(session, target, actions) {
  if (processQuestActionsFn) return await processQuestActionsFn(session, target, actions);
}

/** Remove handed-in items using character_id + slot + PEQ item_id (DB.pool is not part of the public DB API). */
async function deleteHandedItemsFromCharacter(char, items) {
  for (const it of items) {
    const eqId = it.item_id;
    if (!eqId) continue;
    const slotId = it.slotId;
    if (typeof slotId === 'number' && slotId >= 0) {
      await DB.deleteItem(char.id, eqId, slotId);
    } else {
      await DB.deleteItem(char.id, eqId, null);
    }
  }
}

async function handleBuy(session, msg) {
  const { npcId, itemKey, quantity: qtyRaw } = msg;
  const qtyRequested = Math.max(1, Math.min(MERCHANT_QTY_CAP, Number(qtyRaw) || 1));
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
    const eqemuDB = require('../eqemu_db');
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
  const unitPrice = Math.max(1, Math.floor(basePrice * buyMod));

  const addKey = parseInt(itemKey, 10) || itemKey;
  const itemDef = ItemDB.getById(addKey) || ITEMS[addKey] || {};
  const stackSize = (Number(itemDef.stackable) > 0 && Number(itemDef.stacksize) > 0)
    ? Number(itemDef.stacksize)
    : 1;

  const maxFromInv = computeMaxBuyOnPerson(session, addKey, stackSize);
  const maxAfford = Math.floor(char.copper / unitPrice);
  const toBuy = Math.min(qtyRequested, maxFromInv, maxAfford);

  if (toBuy < 1) {
    if (maxFromInv < 1) {
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'Your inventory is too full for that purchase.' }]);
    } else {
      sendCombatLog(session, [{ event: 'MESSAGE', text: `You don't have enough money! (${formatCurrency(unitPrice)} each.)` }]);
    }
    return;
  }

  const totalPrice = unitPrice * toBuy;
  char.copper -= totalPrice;
  await DB.updateCharacterState(char);

  const granted = await grantPurchasedItems(char.id, addKey, toBuy, stackSize, session);
  if (granted < toBuy) {
    char.copper += unitPrice * (toBuy - granted);
  }
  await DB.updateCharacterState(char);

  session.inventory = await DB.getInventory(char.id);
  session.effectiveStats = calcEffectiveStats(char, session.inventory, session.buffs);

  sendInventory(session);
  const spent = unitPrice * granted;
  const qtyNote = granted !== 1 ? `${granted} ` : '';
  sendCombatLog(session, [{ event: 'MESSAGE', text: `You bought ${qtyNote}${itemName} for ${formatCurrency(spent)}.` }]);
  sendStatus(session);
}

async function handleSell(session, msg) {
  const { npcId, itemId, slotId, itemInstanceId, quantity: qtyRaw } = msg;
  const slotHint = slotId != null ? slotId : itemInstanceId;
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

  const invRow = resolveInvRowForTrade(session, itemId, slotHint);
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
  const unitSell = Math.max(1, Math.floor(baseSell * sellMod * bonusMult));
  const stackQty = Math.max(1, Number(invRow.quantity) || 1);
  const qtyRequested = (qtyRaw == null || qtyRaw === '')
    ? stackQty
    : Math.max(1, Math.min(MERCHANT_QTY_CAP, Number(qtyRaw) || stackQty));
  const sellQty = Math.min(qtyRequested, stackQty);
  const totalSell = unitSell * sellQty;

  if (sellQty >= stackQty) {
    await DB.deleteItem(char.id, invRow.item_key, invRow.slot);
  } else {
    const removed = await DB.reduceItemStackAtSlot(char.id, invRow.slot, invRow.item_key, sellQty);
    if (removed !== sellQty) {
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'That sale could not be completed.' }]);
      return;
    }
  }
  char.copper += totalSell;
  await DB.updateCharacterState(char);
  
  const safeMerchantKey = isNaN(parseInt(merchant.key)) ? merchant.key : parseInt(merchant.key);
  await DB.addBuybackItem(char.id, safeMerchantKey, invRow.item_key, sellQty, totalSell);

  // Refresh inventory
  session.inventory = await DB.getInventory(char.id);
  session.effectiveStats = calcEffectiveStats(char, session.inventory, session.buffs);

  sendInventory(session);
  const qtyNote = sellQty > 1 ? ` (${sellQty})` : '';
  sendCombatLog(session, [{ event: 'LOOT', text: `You sold ${itemName}${qtyNote} to ${merchant.name} for ${formatCurrency(totalSell)}.` }]);
  sendStatus(session);
}

async function handleNPCGiveItems(session, msg) {
  const char = session.char;
  const targetId = msg.npcId;
  const items = msg.items || [];

  console.log(`[NPC_TRADE] ${char.name} zone=${char.zoneId} npcId=${targetId} slots=${items.map((it) => `${it.item_id}@${it.slotId ?? '?'}`).join(',')}`);

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
    await processQuestActions(session, target, fallbackActions);
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
      await processQuestActions(session, target, fallbackActions);
    } else {
      await processQuestActions(session, target, [{ action: 'say', source: target.id, msg: `Thank you, master.` }]);
    }

    // Delete consumed items from player
    await deleteHandedItemsFromCharacter(char, itemsToConsume);

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
  let i = 1;
  for (const it of items) {
    trade[`item${i}`] = it.item_id;
    i++;
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
    await processQuestActions(session, target, actions);
  } else {
    // Unhandled trade: return all items to player
    itemsToConsume = [];
    const fallbackActions = [
      { action: 'say', source: target.id, msg: `I have no need for this, ${char.name}, you can have it back.` }
    ];
    await processQuestActions(session, target, fallbackActions);
  }

  // Delete only the consumed items from inventory
  await deleteHandedItemsFromCharacter(char, itemsToConsume);
  
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
  const constants = require('../data/constants');
  const CLASSES_MAP = constants.CLASSES;
  const RACES_MAP = constants.RACES;
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

async function handleSplitMoveItem(session, msg) {
  const { fromSlot, toSlot, count } = msg;
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n < 1) return;
  if (fromSlot === toSlot) return;
  if (toSlot < 22 && toSlot >= 0) {
    send(session.ws, { type: 'SYSTEM_MSG', message: 'You cannot split stacks directly onto equipment slots.' });
    return;
  }

  const invRow = session.inventory.find((i) => i.slot === fromSlot);
  if (!invRow) return;
  const qty = invRow.quantity > 0 ? invRow.quantity : 1;
  if (qty <= 1 || n >= qty) {
    send(session.ws, { type: 'SYSTEM_MSG', message: 'That stack is too small to split that way.' });
    return;
  }

  const nestTo = validateNestedBagDestination(session, toSlot);
  if (!nestTo.ok) {
    send(session.ws, { type: 'SYSTEM_MSG', message: nestTo.msg });
    return;
  }

  const ok = await DB.splitStackToSlot(session.char.id, fromSlot, toSlot, n);
  if (!ok) {
    send(session.ws, { type: 'SYSTEM_MSG', message: 'You cannot split the stack into that location.' });
    return;
  }

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

  if (itemDef.itemtype === 1 && isNestedBagSlotId(toSlot)) {
    send(session.ws, { type: 'SYSTEM_MSG', message: 'You cannot put a container inside another container.' });
    return;
  }

  const nestTo = validateNestedBagDestination(session, toSlot);
  if (!nestTo.ok) {
    send(session.ws, { type: 'SYSTEM_MSG', message: nestTo.msg });
    return;
  }
  if (nestTo.isNested && itemDef.size > nestTo.bagDef.bagsize) {
    send(session.ws, { type: 'SYSTEM_MSG', message: 'That item is too large to fit in this container.' });
    return;
  }

  if (itemDef.itemtype === 1) {
      const toRow = session.inventory.find(i => i.slot === toSlot);
      if (toRow) {
          if (isNestedBagSlotId(fromSlot)) {
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
  const constants = require('../data/constants');
  const CLASSES_MAP = constants.CLASSES;
  const RACES_MAP = constants.RACES;
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
  const { npcId, itemId, slotId, itemInstanceId } = msg;
  const slotHint = slotId != null ? slotId : itemInstanceId;
  console.log(`[TRADE] handleGetOffer: npcId=${npcId}, itemId=${itemId}, slotId=${slotHint}`);
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

  const invRow = resolveInvRowForTrade(session, itemId, slotHint);
  if (!invRow) {
      console.log(`[TRADE] handleGetOffer: invRow not found for itemId=${itemId} slotId=${slotHint}. inventory (slot->item_key):`, session.inventory.map(i => `${i.slot}:${i.item_key}`));
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
  const unitSell = Math.max(1, Math.floor(baseSell * sellMod * bonusMult));
  const qty = Math.max(1, Number(invRow.quantity) || 1);
  const totalSell = unitSell * qty;

  send(session.ws, {
    type: 'MERCHANT_OFFER',
    itemId: invRow.item_key,
    slotId: invRow.slot,
    quantity: qty,
    price: totalSell,
    unitPrice: unitSell,
    priceText: formatCurrency(totalSell),
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

    const safeMerchantKey = isNaN(parseInt(merchant.key)) ? merchant.key : parseInt(merchant.key);
    const buybackItems = await DB.getBuybackItems(char.id, safeMerchantKey);
    
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

    sendInventory(session);
    sendCombatLog(session, [{ event: 'MESSAGE', text: `You recovered ${itemName} for ${formatCurrency(item.price)}.` }]);
    sendStatus(session);

    // Tell the client to refresh the recover list
    const updatedBuybackItems = await DB.getBuybackItems(char.id, safeMerchantKey);
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
      if (!canLootLockedCorpse(target, session)) {
          sendCombatLog(session, [{ event: 'MESSAGE', text: `You do not have permission to loot this corpse.` }]);
          return;
      }

      // 1. Handle Coins immediately upon opening (Part 1 - Req 3)
      if (target.coins > 0) {
          const totalCoins = target.coins;
          target.coins = 0; // Prevent double-looting coins

          if (session.group) {
              const members = session.group.members;
              const share = Math.floor(totalCoins / members.length);
              const extra = totalCoins % members.length;
              
              for (let i = 0; i < members.length; i++) {
                  const m = members[i];
                  const amount = share + (i === 0 ? extra : 0);
                  m.char.platinum = (m.char.platinum || 0) + amount;
                  sendCombatLog(m, [{ event: 'MESSAGE', text: `You receive ${amount} platinum as your share of the loot.` }]);
                  const { sendStatus, send } = require('../gameEngine');
                  sendStatus(m);
                  send(m.ws, { type: 'LOOT_COIN', amount: amount, currency: 'platinum' });
              }
          } else {
              char.platinum = (char.platinum || 0) + totalCoins;
              sendCombatLog(session, [{ event: 'MESSAGE', text: `You loot ${totalCoins} platinum from the corpse.` }]);
              const { sendStatus, send } = require('../gameEngine');
              sendStatus(session);
              send(session.ws, { type: 'LOOT_COIN', amount: totalCoins, currency: 'platinum' });
          }
      }

      // 2. Prepare items for the loot window
      const lootItems = (target.loot || []).map((le, index) => {
          const def = ItemDB.getById(le.itemKey) || ITEMS[le.itemKey] || {};
          return {
              lootIndex: index,
              itemKey: le.itemKey || "",
              name: def.name || "Unknown Item",
              icon: def.icon || 0,
              qty: le.qty || 1
          };
      });

      // 3. Send message to open loot window ONLY if there are items
      if (lootItems.length > 0) {
          const { send } = require('../gameEngine');
          send(session.ws, {
              type: 'LOOT_CORPSE_OPEN',
              corpseId: target.id,
              corpseName: target.name,
              items: lootItems
          });
      } else {
          sendCombatLog(session, [{ event: 'MESSAGE', text: `This corpse has no items.` }]);
          // If coins were also zero, we could speed up decay here too, 
          // but handleRightClick is just an interaction. 
          // handleTakeLootItem handles empty transitions.
      }
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
      let dbItems = [];
      const shopData = MERCHANT_INVENTORIES[target.key];
      if (shopData) {
          dbItems = shopData.items.map(i => {
              const def = ItemDB.getById(i.itemKey) || ITEMS[i.itemKey] || {};
              return {
                  itemKey: i.itemKey,
                  name: def.name || i.itemKey,
                  price: i.price || def.value || 10,
                  charges: 1
              };
          });
      } else {
          const mKey = parseInt(target.key);
          if (!isNaN(mKey)) {
              dbItems = await eqemuDB.getMerchantItems(mKey);
          }
      }
      
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
          reclevel: itemDef.reclevel || 0,
          stacksize: Number(itemDef.stacksize) || 0,
          stackable: Number(itemDef.stackable) || 0
        };
      });

      // Compute player's class bitmask for client-side filtering
      const constants = require('../data/constants');
      const CLASSES_MAP = constants.CLASSES;
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

    case NPC_TYPES.STATION: {
      if (module.exports.handleTradeskillFn) {
        module.exports.handleTradeskillFn(session, {
          stationType: target.stationType || target.name,
          npcId: target.id
        });
      }
      break;
    }
  }
}

module.exports = {
  handleTradeskillFn: null,
  handleBuy,
  handleRightClick,
  handleSell,
  handleNPCGiveItems,
  handlePetInventoryAction,
  handleDestroyItem,
  handleEquipItem,
  handleUnequipItem,
  handleMoveItem,
  handleSplitMoveItem,
  handleAutoEquip,
  handleGetOffer,
  handleSellJunk,
  handleBuyRecover,
  init,
  getFirstEmptySlot,
};
