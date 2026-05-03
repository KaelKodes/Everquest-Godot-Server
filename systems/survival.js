const DB = require('../db');
const ItemDB = require('../data/itemDatabase');

const TICK_SECONDS = 180; // 3 minutes real-time for each hunger tick
const MAX_HUNGER = 100;
const DRAIN_AMOUNT = 5; 
const CONSUME_THRESHOLD = 50;

/**
 * Process hunger and thirst drains for a player session.
 * Automatically tries to consume food/drink from inventory if low.
 */
function processSurvival(session, dt, sendCombatLog, sendStatus) {
    if (!session.char || session.char.state === 'dead') return;
    
    // Initialize timers if not present
    if (session.survivalTimer === undefined) session.survivalTimer = 0;
    
    session.survivalTimer += dt;
    if (session.survivalTimer >= TICK_SECONDS) {
        session.survivalTimer = 0;
        
        let needsStatusUpdate = false;
        
        // Drain Thirst
        if (session.char.thirst > 0) {
            session.char.thirst = Math.max(0, session.char.thirst - DRAIN_AMOUNT);
            needsStatusUpdate = true;
        }
        
        // Drain Hunger
        if (session.char.hunger > 0) {
            session.char.hunger = Math.max(0, session.char.hunger - DRAIN_AMOUNT);
            needsStatusUpdate = true;
        }

        // Auto Consume Drink
        if (session.char.thirst < CONSUME_THRESHOLD) {
            if (tryConsume(session, 'drink')) {
                sendCombatLog(session, [{ event: 'MESSAGE', text: `You take a drink.` }]);
                session.char.thirst = MAX_HUNGER;
                needsStatusUpdate = true;
            } else if (session.char.thirst <= 0) {
                sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=yellow]You are thirsty.[/color]` }]);
            }
        }
        
        // Auto Consume Food
        if (session.char.hunger < CONSUME_THRESHOLD) {
            if (tryConsume(session, 'food')) {
                sendCombatLog(session, [{ event: 'MESSAGE', text: `You eat a meal.` }]);
                session.char.hunger = MAX_HUNGER;
                needsStatusUpdate = true;
            } else if (session.char.hunger <= 0) {
                sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=yellow]You are hungry.[/color]` }]);
            }
        }
        
        if (session.char.hunger <= 0 && session.char.thirst <= 0) {
            sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=red]You are out of food and drink.[/color]` }]);
        }

        if (needsStatusUpdate) {
            DB.updateCharacterState(session.char);
            sendStatus(session);
        }
    }
}

function tryConsume(session, type) {
    if (!session.inventory) return false;
    
    // Scan inventory for item of type (slots 22-29 are bags/top-level inventory in classic EQ)
    for (let slot = 22; slot <= 29; slot++) { 
        let invItem = session.inventory.find(i => i.slot === slot);
        if (invItem) {
            const def = ItemDB.getByKey(invItem.item_key);
            if (def && def.type === type) {
                // Found something! Consume it.
                if (invItem.quantity > 1) {
                    invItem.quantity -= 1;
                    DB.updateItemQuantity(invItem.item_key, session.char.id, -1, invItem.slot);
                } else {
                    // Consume last one
                    const idx = session.inventory.indexOf(invItem);
                    session.inventory.splice(idx, 1);
                    DB.deleteItem(session.char.id, invItem.item_key, invItem.slot);
                }
                
                // Inform client to update their inventory UI
                session.ws.send(JSON.stringify({ type: 'INVENTORY_UPDATE', inventory: session.inventory }));
                return true;
            }
        }
    }
    return false;
}

/**
 * Used by combat.js to calculate regeneration penalties.
 * Returns a multiplier (1.0 = normal, lower = penalty).
 */
function getRegenPenalty(char) {
    let multiplier = 1.0;
    if (char.hunger <= 0) multiplier -= 0.3; // 30% penalty for starving
    if (char.thirst <= 0) multiplier -= 0.3; // 30% penalty for thirsty
    return Math.max(0.1, multiplier);
}

module.exports = {
    processSurvival,
    getRegenPenalty
};
