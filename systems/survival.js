const DB = require('../db');
const ItemDB = require('../data/itemDatabase');

// Wall-clock between hunger/thirst drain ticks. Larger = mellower pacing (food/drink lasts longer).
// Was 180s (3 min); 540s ≈ one tick every 9 min, ~3× less frequent than before.
const TICK_SECONDS = 540;
const MAX_HUNGER = 100;
const DRAIN_AMOUNT = 5;
const CONSUME_THRESHOLD = 50;

/** EQEmu `items.itemtype` (see common/item_data.h ItemType enum). */
const ITEMTYPE_FOOD = 14;
const ITEMTYPE_DRINK = 15;
const ITEMTYPE_ALCOHOL = 38;

/**
 * Slots we consider "on your person" for automatic survival consumption.
 * Main inventory + nested bag slots for bags in those pockets (not bank).
 */
function isOnPersonAutoConsumeSlot(slot) {
  return (slot >= 22 && slot <= 29) || (slot >= 251 && slot <= 330);
}

function itemMatchesConsumeKind(def, kind) {
  if (!def) return false;
  const t = Number(def.itemtype);
  if (kind === 'food') return t === ITEMTYPE_FOOD;
  if (kind === 'drink') return t === ITEMTYPE_DRINK || t === ITEMTYPE_ALCOHOL;
  return false;
}

/**
 * Process hunger and thirst drains for a player session.
 * Automatically consumes food/drink from on-person inventory (including open bag slots).
 * @param {function} sendInventory - same shape as gameEngine.sendInventory (full client item payload)
 */
function processSurvival(session, dt, sendCombatLog, sendStatus, sendInventory) {
  if (!session.char || session.char.state === 'dead') return;

  if (session.survivalTimer === undefined) session.survivalTimer = 0;

  session.survivalTimer += dt;
  if (session.survivalTimer >= TICK_SECONDS) {
    session.survivalTimer = 0;
    void runSurvivalDrainTick(session, sendCombatLog, sendStatus, sendInventory);
  }
}

async function runSurvivalDrainTick(session, sendCombatLog, sendStatus, sendInventory) {
  let needsStatusUpdate = false;
  let needsInvUpdate = false;

  if (session.char.thirst > 0) {
    session.char.thirst = Math.max(0, session.char.thirst - DRAIN_AMOUNT);
    needsStatusUpdate = true;
  }

  if (session.char.hunger > 0) {
    session.char.hunger = Math.max(0, session.char.hunger - DRAIN_AMOUNT);
    needsStatusUpdate = true;
  }

  if (session.char.thirst < CONSUME_THRESHOLD) {
    if (await tryConsume(session, 'drink')) {
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'You take a drink.' }]);
      session.char.thirst = MAX_HUNGER;
      needsStatusUpdate = true;
      needsInvUpdate = true;
    } else if (session.char.thirst <= 0) {
      sendCombatLog(session, [{ event: 'MESSAGE', text: '[color=yellow]You are thirsty.[/color]' }]);
    }
  }

  if (session.char.hunger < CONSUME_THRESHOLD) {
    if (await tryConsume(session, 'food')) {
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'You eat a meal.' }]);
      session.char.hunger = MAX_HUNGER;
      needsStatusUpdate = true;
      needsInvUpdate = true;
    } else if (session.char.hunger <= 0) {
      sendCombatLog(session, [{ event: 'MESSAGE', text: '[color=yellow]You are hungry.[/color]' }]);
    }
  }

  if (session.char.hunger <= 0 && session.char.thirst <= 0) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: '[color=red]You are out of food and drink.[/color]' }]);
  }

  if (needsStatusUpdate) {
    DB.updateCharacterState(session.char);
    sendStatus(session);
  }
  if (needsInvUpdate && typeof sendInventory === 'function') {
    sendInventory(session);
  }
}

/**
 * Finds and consumes one matching item from on-person inventory.
 * Reloads session.inventory from DB on success.
 */
async function tryConsume(session, kind) {
  if (!session.inventory || !session.char) return false;

  const candidates = session.inventory
    .filter((i) => i && isOnPersonAutoConsumeSlot(i.slot))
    .sort((a, b) => a.slot - b.slot);

  for (const invItem of candidates) {
    const def = ItemDB.getById(invItem.item_key);
    if (!itemMatchesConsumeKind(def, kind)) continue;

    const qty = invItem.quantity > 0 ? invItem.quantity : 1;
    const itemId = invItem.item_key;

    if (qty > 1) {
      await DB.updateItemQuantity(itemId, session.char.id, -1, invItem.slot);
    } else {
      await DB.deleteItem(session.char.id, itemId, invItem.slot);
    }

    session.inventory = await DB.getInventory(session.char.id);
    return true;
  }
  return false;
}

/**
 * Used by combat.js to calculate regeneration penalties.
 * Returns a multiplier (1.0 = normal, lower = penalty).
 */
function getRegenPenalty(char) {
  let multiplier = 1.0;
  if (char.hunger <= 0) multiplier -= 0.3;
  if (char.thirst <= 0) multiplier -= 0.3;
  return Math.max(0.1, multiplier);
}

module.exports = {
  processSurvival,
  getRegenPenalty,
};
