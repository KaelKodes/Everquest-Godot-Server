const { SPELLS } = require('../data/spells');
const ItemDB = require('../data/itemDatabase');
const FactionSystem = require('./faction');

/**
 * Calculates the final SPA value based on the classic EQ formulas.
 */
function calcSpellValue(base, max, formula, casterLevel) {
    let val = base;
    
    switch (formula) {
        case 100: val = base; break;
        case 101: val = base + Math.floor(casterLevel / 2); break;
        case 102: val = base + casterLevel; break;
        case 103: val = base + (casterLevel * 2); break;
        case 104: val = base + (casterLevel * 3); break;
        case 105: val = base + (casterLevel * 4); break;
        case 107: val = base + Math.floor(casterLevel / 2); break;
        case 108: val = base + Math.floor(casterLevel / 3); break;
        case 109: val = base + Math.floor(casterLevel / 4); break;
        case 110: val = base + Math.floor(casterLevel / 5); break;
        case 111: val = base + (casterLevel > 16 ? 16 : casterLevel) * 6 + (casterLevel > 16 ? (casterLevel - 16) * 5 : 0); break;
        case 112: val = base + (casterLevel > 24 ? 24 : casterLevel) * 8 + (casterLevel > 24 ? (casterLevel - 24) * 6 : 0); break;
        case 113: val = base + (casterLevel > 34 ? 34 : casterLevel) * 10 + (casterLevel > 34 ? (casterLevel - 34) * 8 : 0); break;
        case 114: val = base + (casterLevel > 44 ? 44 : casterLevel) * 15 + (casterLevel > 44 ? (casterLevel - 44) * 11 : 0); break;
        case 115: val = base + (casterLevel > 15 ? 15 : casterLevel) * 7 + (casterLevel > 15 ? (casterLevel - 15) * 10 : 0); break;
        case 116: val = base + (casterLevel > 24 ? 24 : casterLevel) * 10 + (casterLevel > 24 ? (casterLevel - 24) * 13 : 0); break;
        case 117: val = base + (casterLevel > 34 ? 34 : casterLevel) * 13 + (casterLevel > 34 ? (casterLevel - 34) * 17 : 0); break;
        case 118: val = base + (casterLevel > 44 ? 44 : casterLevel) * 20 + (casterLevel > 44 ? (casterLevel - 44) * 23 : 0); break;
        case 119: val = base + Math.floor(casterLevel / 8); break;
        case 121: val = base + Math.floor(casterLevel / 3); break;
        case 122: val = 0; break; // Splurt scaling, too complex for initial pass
        default: val = base; break;
    }

    // Apply cap if defined
    if (max !== 0) {
        if (base > 0 && val > max) val = max;
        else if (base < 0 && val < max) val = max; // Negative max
    }

    return val;
}

/**
 * Applies immediate SPA effects (duration === 0)
 */
function applyInstantEffect(session, target, spellDef, spa, value, events) {
    switch (spa) {
        case 0: { // Current HP (Direct Damage or Heal)
            if (value > 0) {
                target.hp = Math.min(target.hp + value, target.maxHp || target.hp);
                events.push({ event: 'SPELL_HEAL', source: session.char.name, target: target.name || target.char?.name || 'Unknown', spell: spellDef.name, amount: value });
            } else if (value < 0) {
                target.hp -= Math.abs(value);
                events.push({ event: 'SPELL_DAMAGE', source: session.char.name, target: target.name || target.char?.name || 'Unknown', spell: spellDef.name, damage: Math.abs(value) });
                breakMez(target, events);
            }
            break;
        }
        case 15: { // Mana (Drain or Grant)
            if (value > 0) {
                target.mana = Math.min((target.mana || 0) + value, target.maxMana || target.mana || 0);
            } else if (value < 0) {
                target.mana = Math.max(0, (target.mana || 0) - Math.abs(value));
            }
            break;
        }
    }
}

/**
 * Breaks mesmerize effects if the entity takes damage.
 */
function breakMez(entity, events = null) {
    if (!entity || !Array.isArray(entity.buffs)) return false;
    let broke = false;
    entity.buffs = entity.buffs.filter(b => {
        if (b.isMez) {
            broke = true;
            const name = entity.name || entity.char?.name || 'Unknown';
            if (events) events.push({ event: 'MESSAGE', text: `${name} has been awakened.` });
            return false;
        }
        return true;
    });
    return broke;
}

/**
 * Calculate spell duration based on formula
 */
function calcSpellDuration(baseDuration, formula, casterLevel) {
    if (baseDuration === 0) return 0;
    
    let ticks = baseDuration;
    // Duration formula scaling
    switch (formula) {
        case 1: ticks = Math.ceil(casterLevel / 2); break;
        case 2: ticks = Math.ceil(casterLevel / 2) + 5; break;
        case 3: ticks = casterLevel * 30; break;
        case 4: ticks = 50; break;
        case 5: ticks = 2; break;
        case 6: ticks = Math.ceil(casterLevel / 2) + 2; break;
        case 7: ticks = casterLevel; break;
        case 8: ticks = casterLevel + 10; break;
        case 9: ticks = casterLevel * 2 + 10; break;
        case 10: ticks = casterLevel * 3 + 10; break;
        case 11: ticks = (casterLevel + 3) * 30; break;
    }
    
    if (ticks === 0) ticks = baseDuration;
    
    // Convert ticks to seconds (1 EQ tick = 6 seconds)
    return ticks * 6;
}

/**
 * Handle a spell completing its cast
 */
async function handleCastComplete(session, spellDef, spellKey, combatTarget) {
    const events = [];
    const isHostile = spellDef.target === 'enemy';
    
    // Check for Summon Item (SPA 32)
    const summonEffect = (spellDef.effects || []).find(e => e.spa === 32);
    if (summonEffect) {
        const eqItemId = summonEffect.base;
        const SUMMON_ITEM_MAP = module.exports.SUMMON_ITEM_MAP || {};
        const ITEMS = module.exports.ITEMS || {};
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
        
        if (itemKey && ITEMS[itemKey] && module.exports.DB) {
            await module.exports.DB.addItem(session.char.id, itemKey, 0, 0);
            session.inventory = await module.exports.DB.getInventory(session.char.id);
            if (module.exports.sendInventoryFn) module.exports.sendInventoryFn(session);
            events.push({ event: 'MESSAGE', text: `You summon ${ITEMS[itemKey].name}.` });
        } else {
            events.push({ event: 'MESSAGE', text: `${spellDef.name} conjures something, but it fizzles away.` });
        }
        if (module.exports.sendCombatLogFn) module.exports.sendCombatLogFn(session, events);
        return;
    }

    let target = isHostile ? combatTarget : session.char;
    // If the spell is a buff and target is an enemy, it shouldn't land unless it's a debuff.
    // For now, assume single target spells follow the isHostile flag.
    
    if (!target) {
        events.push({ event: 'MESSAGE', text: `You must have a target to cast that spell.` });
        if (module.exports.sendCombatLogFn) module.exports.sendCombatLogFn(session, events);
        return;
    }

    const casterLevel = session.char.level;
    const duration = calcSpellDuration(spellDef.buffDuration || 0, spellDef.buffDurationFormula || 0, casterLevel);

    if (duration === 0) {
        // Instant Cast Spells (Nukes, Heals)
        for (const effect of spellDef.effects || []) {
            const val = calcSpellValue(effect.baseValue || effect.base, effect.max || effect.limitValue || 0, effect.formula, casterLevel);
            applyInstantEffect(session, target, spellDef, effect.spa, val, events);
        }
    } else {
        // Buffs, Debuffs, DoTs, HoTs
        const buffObj = {
            name: spellDef.name,
            duration: duration,
            maxDuration: duration,
            beneficial: !isHostile,
            caster: session.char.id,
            effects: []
        };

        for (const effect of spellDef.effects || []) {
            const val = calcSpellValue(effect.baseValue || effect.base, effect.max || effect.limitValue || 0, effect.formula, casterLevel);
            buffObj.effects.push({
                spa: effect.spa,
                value: val
            });
            if (effect.spa === 31) {
                buffObj.isMez = true;
                if (target.target) target.target = null; // Drop combat target when mezzed
            }
        }

        // Apply buff to target
        if (!target.buffs) target.buffs = [];
        
        // Remove existing buff of same name (stacking rules later)
        target.buffs = target.buffs.filter(b => b.name !== spellDef.name);
        target.buffs.push(buffObj);

        const landMsg = spellDef.messages?.castOnYou || (isHostile ? `${target.name || target.char?.name} is afflicted by ${spellDef.name}.` : `You feel ${spellDef.name} take hold.`);
        events.push({ event: 'MESSAGE', text: landMsg });
    }

    if (module.exports.sendCombatLogFn) module.exports.sendCombatLogFn(session, events);
    
    // Death check for target if hostile
    if (isHostile && target.hp <= 0 && module.exports.handleMobDeathFn) {
        await module.exports.handleMobDeathFn(session, target, []);
    }
}

/**
 * Process DoTs and HoTs every server tick (called from gameEngine)
 */
function processBuffTicks(entity, dt, isPlayer = false, sendCombatLogFn = null, session = null) {
    if (!entity || !entity.buffs || entity.buffs.length === 0) return false;

    let expired = false;
    let ticked = false;

    for (const buff of entity.buffs) {
        buff.duration -= dt;
        
        // Initialize nextTick if not present (legacy support)
        if (buff.nextTick === undefined) buff.nextTick = 6;
        buff.nextTick -= dt;
        
        if (buff.nextTick <= 0) {
            buff.nextTick = 6; // Reset tick timer
            // Process DoTs / HoTs
            for (const eff of buff.effects) {
                if (eff.spa === 0) {
                    const dmg = eff.value;
                    if (dmg > 0) {
                        entity.hp = Math.min(entity.hp + dmg, entity.maxHp || entity.hp);
                        if (isPlayer && sendCombatLogFn) {
                            sendCombatLogFn(session, [{ event: 'MESSAGE', text: `You heal for ${dmg} hit points from ${buff.name}.` }]);
                        }
                    } else if (dmg < 0) {
                        entity.hp -= Math.abs(dmg);
                        if (isPlayer && sendCombatLogFn) {
                            sendCombatLogFn(session, [{ event: 'MESSAGE', text: `You take ${Math.abs(dmg)} damage from ${buff.name}.` }]);
                        } else if (!isPlayer && sendCombatLogFn) {
                            sendCombatLogFn(session, [{ event: 'MESSAGE', text: `${entity.name} takes ${Math.abs(dmg)} damage from ${buff.name}.` }]);
                        }
                        // Damage breaks Mez
                        if (breakMez(entity)) {
                            expired = true; // Force buff UI refresh
                        }
                    }
                    ticked = true;
                }
            }
        }
        
        if (buff.duration <= 0) {
            expired = true;
            if (isPlayer && sendCombatLogFn) {
                sendCombatLogFn(session, [{ event: 'MESSAGE', text: `Your ${buff.name} spell has worn off.` }]);
            } else if (!isPlayer && sendCombatLogFn) {
                sendCombatLogFn(session, [{ event: 'MESSAGE', text: `${entity.name}'s ${buff.name} spell has worn off.` }]);
            }
        }
    }
    
    if (expired) {
        entity.buffs = entity.buffs.filter(b => b.duration > 0);
        return true; // Buffs changed (recalc stats)
    }
    return ticked; // HP changed (send status)
}

module.exports = {
    calcSpellValue,
    calcSpellDuration,
    handleCastComplete,
    processBuffTicks,
    breakMez,
    setSendCombatLogFn: (fn) => { module.exports.sendCombatLogFn = fn; },
    setHandleMobDeathFn: (fn) => { module.exports.handleMobDeathFn = fn; },
    setDBFn: (db) => { module.exports.DB = db; },
    setSendInventoryFn: (fn) => { module.exports.sendInventoryFn = fn; },
    setItemsFn: (items) => { module.exports.ITEMS = items; },
    setSummonItemMapFn: (map) => { module.exports.SUMMON_ITEM_MAP = map; }
};
