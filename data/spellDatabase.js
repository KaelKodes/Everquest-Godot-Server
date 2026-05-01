// ── Spell Database ──────────────────────────────────────────────────
// Runtime spell data loaded from the parsed EQ spell data.
// Provides lookup functions for the game engine and combat system.
//
// This replaces the old hand-coded spells.js with 1,828 real EQ spells.
// The old interface fields (manaCost, castTime, effect, damage, amount, etc.)
// are preserved via adapter getters so existing game engine code works
// without modification.
// ────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

let spellsById = {};       // id (number) -> spell object
let spellsByName = {};      // lowercase name -> spell object
let spellsByKey = {};       // snake_case key -> spell object (backwards compat)
let loaded = false;

// ── Loading ──────────────────────────────────────────────────────────

/**
 * Load spell data from the parsed JSON file.
 * Call this once at server startup.
 */
function loadSpells(filePath) {
    if (!filePath) {
        filePath = path.join(__dirname, 'spells_parsed.json');
    }

    if (!fs.existsSync(filePath)) {
        console.warn(`[SPELLS] Warning: Spell data file not found at ${filePath}`);
        console.warn('[SPELLS] Run: node server/tools/parse_spells.js --player-only --max-level=60 --output=server/data/spells_classic.json');
        return;
    }

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const spells = raw.spells || [];

    spellsById = {};
    spellsByName = {};
    spellsByKey = {};

    for (const spell of spells) {
        // Add backwards-compatible adapter fields
        const adapted = createAdaptedSpell(spell);

        spellsById[spell.id] = adapted;
        spellsByName[spell.name.toLowerCase()] = adapted;

        // Generate a snake_case key for backwards compatibility with DB
        const key = generateSpellKey(spell.name);
        const isPlayerSpell = Object.values(spell.classes).some(lvl => lvl !== 255);
        
        if (!spellsByKey[key]) {
            spellsByKey[key] = adapted;
        } else {
            const existingIsPlayer = Object.values(spellsByKey[key].classes).some(lvl => lvl !== 255);
            if (isPlayerSpell && !existingIsPlayer) {
                spellsByKey[key] = adapted; // Overwrite NPC spell with Player spell
            } else if (isPlayerSpell && existingIsPlayer) {
                // Both are player spells. Prefer the lower ID (original classic spell).
                if (spell.id < spellsByKey[key].id) {
                    spellsByKey[key] = adapted;
                }
            }
        }
        adapted._key = key;
    }

    loaded = true;
    console.log(`[SPELLS] Loaded ${spells.length} spells from ${path.basename(filePath)}`);
}

/**
 * Generate a snake_case key from a spell name.
 * e.g., "Minor Healing" -> "minor_healing"
 *       "Spirit of Wolf" -> "spirit_of_wolf"
 */
function generateSpellKey(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')   // Remove special chars
        .replace(/\s+/g, '_')           // Spaces to underscores
        .replace(/_+/g, '_')            // Collapse multiple underscores
        .replace(/^_|_$/g, '');         // Trim leading/trailing
}

/**
 * Create a spell object with adapter fields that match the old spells.js format.
 * This lets existing gameEngine code work without changes.
 */
function createAdaptedSpell(spell) {
    // Determine the primary damage or heal amount from effects
    const hpEffect = spell.effects.find(e => e.spa === 0);
    const primaryAmount = hpEffect ? Math.abs(hpEffect.base) : 0;
    const primaryMax = hpEffect ? Math.abs(hpEffect.max) : primaryAmount;

    // Determine "old style" target from EQ target type
    let oldTarget = 'self';
    if (spell.targetType.id === 5 || spell.targetType.id === 1) {
        // Single target - could be enemy or ally based on goodEffect
        oldTarget = spell.goodEffect ? 'self' : 'enemy';
    } else if (spell.targetType.id === 6) {
        oldTarget = 'self';
    } else if (spell.targetType.id === 4) {
        oldTarget = spell.goodEffect ? 'self' : 'enemy'; // PBAE
    } else if (spell.targetType.id === 8) {
        oldTarget = 'enemy'; // Targeted AE
    }

    // Determine the "old style" single class assignment
    // (For backwards compat; the real data supports multiple classes)
    let primaryClass = 'all';
    let primaryLevel = 1;
    const classEntries = Object.entries(spell.classes)
        .filter(([, lvl]) => lvl !== 255)
        .sort((a, b) => a[1] - b[1]); // Sort by level ascending

    if (classEntries.length > 0) {
        primaryClass = classEntries[0][0];
        primaryLevel = classEntries[0][1];
    }

    // Build the buff name from spell name (for buff effect type)
    const buffName = spell.name;

    // Determine buff duration in seconds (EQ uses 6-second ticks)
    const durationSeconds = spell.duration.ticks * 6;

    // Calculate actual damage/heal range
    const damageMin = primaryAmount;
    const damageMax = primaryMax > 0 ? primaryMax : primaryAmount;

    // Determine old-style resist type string
    const resistTypeStr = spell.resistType.name || 'none';

    return {
        // ── Full EQ data (the complete parsed record) ──
        ...spell,

        // ── Backwards-compatible adapter fields ──
        // These match the old spells.js format so gameEngine.js works unchanged

        // Old key-based lookup support
        _spellId: spell.id,

        // Old flat fields
        manaCost: spell.cost.mana,
        castTime: spell.timing.castTime / 1000, // Convert ms to seconds
        target: oldTarget,
        effect: spell.derived.type,  // 'heal', 'dd', 'dot', 'buff', 'root', etc.

        // Old class/level (single-class assignment for compat)
        class: primaryClass,
        level: primaryLevel,

        // Old damage/heal amount
        damage: damageMax || damageMin,
        amount: damageMax || damageMin, // Heals use 'amount'

        // Old buff fields
        buffName: buffName,
        duration: durationSeconds,
        ac: spell.effects.find(e => e.spa === 1)?.base || 0,

        // Old resist fields
        resistType: resistTypeStr,
        resistAdjust: spell.properties.resistPerLevel || 0,

        // Description from messages
        description: spell.messages.castOnYou || spell.messages.castOnOther || spell.name,
    };
}

// ── Lookup Functions ────────────────────────────────────────────────

/**
 * Look up a spell by its numeric ID.
 */
function getById(id) {
    return spellsById[id] || null;
}

/**
 * Look up a spell by name (case-insensitive).
 */
function getByName(name) {
    return spellsByName[name.toLowerCase()] || null;
}

/**
 * Look up a spell by its snake_case key (backwards compatible with old spells.js).
 * Also accepts numeric IDs as strings.
 */
function getByKey(key) {
    // Try as numeric ID first
    const numId = parseInt(key, 10);
    if (!isNaN(numId) && spellsById[numId]) {
        return spellsById[numId];
    }
    // Then try as string key
    return spellsByKey[key] || null;
}

/**
 * Get all spells available to a given class at a given level.
 */
function getSpellsForClass(className, maxLevel = 255) {
    // Normalize: our class names use underscores (shadow_knight) but spell data doesn't (shadowknight)
    const normalizedClass = className.toLowerCase().replace(/_/g, '');
    const results = [];
    for (const spell of Object.values(spellsById)) {
        const classLevel = spell.classes[normalizedClass];
        if (classLevel !== undefined && classLevel !== 255 && classLevel <= maxLevel) {
            results.push(spell);
        }
    }
    return results.sort((a, b) => {
        const aLvl = a.classes[normalizedClass];
        const bLvl = b.classes[normalizedClass];
        return aLvl - bLvl;
    });
}

/**
 * Get spells newly available at a specific level for a class.
 */
function getNewSpellsAtLevel(className, level) {
    const normalizedClass = className.toLowerCase().replace(/_/g, '');
    return getSpellsForClass(className, level)
        .filter(s => s.classes[normalizedClass] === level);
}

/**
 * Get all spells. Returns the full spellsById map.
 */
function getAll() {
    return spellsById;
}

/**
 * Check if spell data is loaded.
 */
function isLoaded() {
    return loaded;
}

/**
 * Get spell count.
 */
function count() {
    return Object.keys(spellsById).length;
}

// ── Proxy-style access for backwards compatibility ──────────────────
// The old code does SPELLS[spellKey] and Object.entries(SPELLS).
// We create a Proxy that supports both patterns.

function createLegacyProxy() {
    return new Proxy(spellsByKey, {
        get(target, prop) {
            if (prop === Symbol.iterator) return undefined;
            if (typeof prop === 'string') {
                // Check numeric ID
                const numId = parseInt(prop, 10);
                if (!isNaN(numId) && spellsById[numId]) {
                    return spellsById[numId];
                }
                // Check string key
                if (target[prop]) return target[prop];
            }
            return undefined;
        },
        has(target, prop) {
            if (typeof prop === 'string') {
                const numId = parseInt(prop, 10);
                if (!isNaN(numId)) return !!spellsById[numId];
                return prop in target;
            }
            return false;
        },
        ownKeys(target) {
            return Object.keys(target);
        },
        getOwnPropertyDescriptor(target, prop) {
            if (prop in target) {
                return { configurable: true, enumerable: true, value: target[prop] };
            }
            return undefined;
        }
    });
}

// ── Module Exports ──────────────────────────────────────────────────

module.exports = {
    loadSpells,
    getById,
    getByName,
    getByKey,
    getSpellsForClass,
    getNewSpellsAtLevel,
    getAll,
    isLoaded,
    count,
    createLegacyProxy,
    generateSpellKey,
};
