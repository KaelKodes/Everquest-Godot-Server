require('dotenv').config();
const mysql = require('mysql2/promise');

const CLASSES = {
    'warrior': 1, 'cleric': 2, 'paladin': 3, 'ranger': 4, 'shadow_knight': 5,
    'druid': 6, 'monk': 7, 'bard': 8, 'rogue': 9, 'shaman': 10,
    'necromancer': 11, 'wizard': 12, 'magician': 13, 'enchanter': 14,
    'beastlord': 15, 'berserker': 16
};

const RACES = {
    'human': 1, 'barbarian': 2, 'erudite': 3, 'wood_elf': 4, 'high_elf': 5,
    'dark_elf': 6, 'half_elf': 7, 'dwarf': 8, 'troll': 9, 'ogre': 10,
    'halfling': 11, 'gnome': 12, 'iksar': 128, 'vah_shir': 130, 'froglok': 330
};

// Hardcoded fallback mappings (overridden once DB loads)
const ZONES_NUM_FALLBACK = {
    'qeynos_city': 2,
    'qeynos_hills': 4,
    'west_karana': 12,
    'north_karana': 13
};

const INV_CLASSES = Object.fromEntries(Object.entries(CLASSES).map(([k, v]) => [v, k]));
const INV_RACES = Object.fromEntries(Object.entries(RACES).map(([k, v]) => [v, k]));
let INV_ZONES = Object.fromEntries(Object.entries(ZONES_NUM_FALLBACK).map(([k, v]) => [v, k]));

// Full zone metadata cache: short_name → { zoneidnumber, long_name, zone_type }
let ZONE_CACHE = {};
// Reverse lookup: zoneidnumber → short_name (built from DB)
let ZONE_ID_TO_SHORT = {};

let pool;

async function init() {
    pool = mysql.createPool({
        host: process.env.EQEMU_HOST || '127.0.0.1',
        port: process.env.EQEMU_PORT || 3307,
        user: process.env.EQEMU_USER || 'eqemu',
        password: process.env.EQEMU_PASSWORD || 'bHqIbrW81WLuaZ4qaQGrRViIHHvz9nR',
        database: process.env.EQEMU_DATABASE || 'peq',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });

    console.log('[DB] Connected to EQEmu MySQL Database.');

    // Build full zone metadata cache from DB
    try {
        const [zones] = await pool.query('SELECT zoneidnumber, short_name, long_name, ztype, castoutdoor FROM zone');
        INV_ZONES = {};
        ZONE_CACHE = {};
        ZONE_ID_TO_SHORT = {};
        for (const z of zones) {
            INV_ZONES[z.zoneidnumber] = z.short_name;
            ZONE_ID_TO_SHORT[z.zoneidnumber] = z.short_name;
            ZONE_CACHE[z.short_name] = {
                zoneidnumber: z.zoneidnumber,
                long_name: z.long_name || z.short_name,
                ztype: z.ztype || 0,
                castoutdoor: z.castoutdoor != null ? z.castoutdoor : 1
            };
        }
        console.log(`[DB] Loaded zone metadata cache (${zones.length} zones).`);
    } catch (e) {
        console.error('[DB] Failed to load zone cache, using hardcoded fallback:', e.message);
    }
}

// ── Account Queries ─────────────────────────────────────────────────

async function loginAccount(username, password) {
    if (!pool) await init();
    try {
        const [rows] = await pool.query('SELECT id, name, password, status FROM account WHERE name = ?', [username]);
        if (rows.length === 0) return null;
        if (rows[0].password !== password) return { error: 'Invalid password.' };
        return { id: rows[0].id, name: rows[0].name, status: rows[0].status };
    } catch (e) {
        console.error('[DB] loginAccount Error:', e.message);
        return null;
    }
}

async function createAccount(username, password) {
    if (!pool) await init();
    try {
        // Check if name is taken
        const [existing] = await pool.query('SELECT id FROM account WHERE name = ?', [username]);
        if (existing.length > 0) return { error: 'Account name already exists.' };

        const [result] = await pool.query(
            'INSERT INTO account (name, password, status, time_creation) VALUES (?, ?, 0, UNIX_TIMESTAMP())',
            [username, password]
        );
        return { id: result.insertId, name: username, status: 0 };
    } catch (e) {
        console.error('[DB] createAccount Error:', e.message);
        return { error: 'Failed to create account.' };
    }
}

async function getCharactersByAccount(accountId) {
    if (!pool) return [];
    try {
        const [rows] = await pool.query(
            'SELECT id, name, class, race, level, zone_id FROM character_data WHERE account_id = ? ORDER BY name',
            [accountId]
        );
        return rows.map(c => ({
            id: c.id,
            name: c.name,
            className: INV_CLASSES[c.class] || 'warrior',
            race: INV_RACES[c.race] || 'human',
            level: c.level,
            zone: INV_ZONES[c.zone_id] || 'unknown'
        }));
    } catch (e) {
        console.error('[DB] getCharactersByAccount Error:', e.message);
        return [];
    }
}

// ── Start Zone & Deity Lookups ──────────────────────────────────────

async function getStartZone(raceId, classId, deityId) {
    if (!pool) await init();
    try {
        // Try exact race + class + deity match
        let [rows] = await pool.query(
            `SELECT sz.x, sz.y, sz.z, sz.heading, sz.zone_id, sz.bind_id, sz.bind_x, sz.bind_y, sz.bind_z, z.short_name as zone_short
             FROM start_zones sz 
             JOIN zone z ON sz.zone_id = z.zoneidnumber 
             WHERE sz.player_race = ? AND sz.player_class = ? AND sz.player_deity = ? 
             LIMIT 1`,
            [raceId, classId, deityId]
        );

        // Fallback: race + class, any deity
        if (rows.length === 0) {
            [rows] = await pool.query(
                `SELECT sz.x, sz.y, sz.z, sz.heading, sz.zone_id, sz.bind_id, sz.bind_x, sz.bind_y, sz.bind_z, z.short_name as zone_short
                 FROM start_zones sz 
                 JOIN zone z ON sz.zone_id = z.zoneidnumber 
                 WHERE sz.player_race = ? AND sz.player_class = ? 
                 LIMIT 1`,
                [raceId, classId]
            );
        }

        if (rows.length === 0) {
            console.log(`[DB] No start zone for race=${raceId} class=${classId} deity=${deityId}, defaulting to Qeynos Hills.`);
            return { zone_id: 4, zone_short: 'qeytoqrg', x: 0, y: 0, z: 0, heading: 0, bind_id: 4, bind_x: 0, bind_y: 0, bind_z: 0 };
        }

        const row = rows[0];
        return {
            zone_id: row.zone_id,
            zone_short: row.zone_short,
            x: row.x, y: row.y, z: row.z,
            heading: row.heading,
            bind_id: row.bind_id || row.zone_id,
            bind_x: row.bind_x || row.x,
            bind_y: row.bind_y || row.y,
            bind_z: row.bind_z || row.z
        };
    } catch (e) {
        console.error('[DB] getStartZone Error:', e.message);
        return { zone_id: 4, zone_short: 'qeytoqrg', x: 0, y: 0, z: 0, heading: 0, bind_id: 4, bind_x: 0, bind_y: 0, bind_z: 0 };
    }
}

async function getValidDeities(raceId, classId) {
    if (!pool) await init();
    try {
        const [rows] = await pool.query(
            'SELECT DISTINCT player_deity FROM start_zones WHERE player_race = ? AND player_class = ? ORDER BY player_deity',
            [raceId, classId]
        );
        return rows.map(r => r.player_deity);
    } catch (e) {
        console.error('[DB] getValidDeities Error:', e.message);
        return [];
    }
}

async function getZonePoints(zoneShortName) {
    if (!pool) await init();
    try {
        const [rows] = await pool.query(
            `SELECT zp.number, zp.x, zp.y, zp.z, zp.target_x, zp.target_y, zp.target_z, 
                    zp.target_zone_id, zp.buffer, zp.height, zp.width,
                    z.short_name as target_short
             FROM zone_points zp 
             JOIN zone z ON zp.target_zone_id = z.zoneidnumber 
             WHERE zp.zone = ? AND zp.is_virtual = 0`,
            [zoneShortName]
        );
        return rows;
    } catch (e) {
        console.error('[DB] getZonePoints Error:', e.message);
        return [];
    }
}

async function getCharacter(name) {
    if (!pool) await init();
    try {
        const [rows] = await pool.query(`SELECT * FROM character_data WHERE name = ?`, [name]);
        if (rows.length === 0) return null;
        
        const char = rows[0];
        return {
            id: char.id,
            name: char.name,
            class: INV_CLASSES[char.class] || 'warrior',
            race: INV_RACES[char.race] || 'human',
            level: char.level,
            experience: char.exp,
            hp: char.cur_hp,
            maxHp: char.cur_hp > 0 ? char.cur_hp : char.level * 25,
            mana: char.mana,
            str: char.str,
            sta: char.sta,
            agi: char.agi,
            dex: char.dex,
            wis: char.wis,
            intel: char.int,
            cha: char.cha,
            zoneId: INV_ZONES[char.zone_id] || 'qeynos_hills',
            roomId: null,
            state: 'standing',
            x: char.x,
            y: char.y,
            z: char.z,
            copper: 1000
        };
    } catch (e) {
        console.error('[DB] getCharacter Error:', e);
        return null;
    }
}

async function createCharacter(accountId, name, className, raceName, deityId, str, sta, agi, dex, wis, intel, cha, hp, mana) {
    if (!pool) await init();
    
    const classId = CLASSES[className.toLowerCase()] || 1;
    const raceId = RACES[raceName.toLowerCase()] || 1;
    
    // Capitalize first letter of name
    const formattedName = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();

    // Check character limit (8 per account)
    const [existing] = await pool.query('SELECT COUNT(*) as cnt FROM character_data WHERE account_id = ?', [accountId]);
    if (existing[0].cnt >= 8) return { error: 'Maximum 8 characters per account.' };

    // Check name uniqueness
    const [nameTaken] = await pool.query('SELECT id FROM character_data WHERE name = ?', [formattedName]);
    if (nameTaken.length > 0) return { error: 'Character name is already taken.' };

    // Look up authentic start zone from the database
    const start = await getStartZone(raceId, classId, deityId || 396);
    console.log(`[DB] Start zone for race=${raceId} class=${classId} deity=${deityId}: zone_id=${start.zone_id} (${start.zone_short}) at ${start.x},${start.y},${start.z}`);

    const query = `
        INSERT INTO character_data 
        (account_id, name, class, race, deity, level, exp, cur_hp, mana, str, sta, agi, dex, wis, \`int\`, cha, zone_id, x, y, z) 
        VALUES 
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const params = [
        accountId, formattedName, classId, raceId, deityId || 396, 1, 0, hp, mana, str, sta, agi, dex, wis, intel, cha, start.zone_id, start.x, start.y, start.z
    ];

    try {
        const [result] = await pool.query(query, params);
        
        // Return the mapped schema object exactly as getCharacter would
        return {
            id: result.insertId,
            name: formattedName,
            class: className.toLowerCase(),
            race: raceName.toLowerCase(),
            level: 1,
            experience: 0,
            hp: hp,
            maxHp: hp,
            mana: mana,
            str: str,
            sta: sta,
            agi: agi,
            dex: dex,
            wis: wis,
            intel: intel,
            cha: cha,
            zoneId: start.zone_short || INV_ZONES[start.zone_id] || 'qeynos_hills',
            roomId: null,
            state: 'standing',
            x: start.x,
            y: start.y,
            z: start.z,
            copper: 1000
        };
    } catch (e) {
        console.error('[DB] createCharacter Error:', e.message);
        return null;
    }
}

async function deleteCharacter(charId) {
    if (!pool) return;
    try {
        await pool.query('DELETE FROM inventory WHERE character_id = ?', [charId]);
        await pool.query('DELETE FROM character_skills WHERE id = ?', [charId]);
        await pool.query('DELETE FROM character_data WHERE id = ?', [charId]);
        console.log(`[DB] Deleted character id=${charId} and related data.`);
    } catch (e) {
        console.error('[DB] deleteCharacter Error:', e.message);
        throw e;
    }
}

async function updateCharacterState(char) {
    if (!pool) return;
    // Look up zone number from the DB cache
    let zoneId = getZoneIdByShortName(char.zoneId);
    if (!zoneId) zoneId = 4; // Ultimate fallback

    try {
        await pool.query(
            'UPDATE character_data SET x = ?, y = ?, z = ?, zone_id = ?, cur_hp = ?, mana = ?, exp = ? WHERE id = ?',
            [char.x, char.y, char.z || 0, zoneId, char.hp, char.mana, char.experience, char.id]
        );
    } catch (e) {
        console.error('[DB] updateCharacterState Error:', e.message);
    }
}

async function getZoneSpawns(shortName) {
    if (!pool) await init();

    const query = `
        SELECT s.id as spawn2_id, s.x, s.y, s.z, s.respawntime, 
               se.chance, 
               n.id as npc_id, n.name, n.level, n.hp, n.mindmg, n.maxdmg, n.race, n.gender, n.class 
        FROM spawn2 s 
        JOIN spawnentry se ON s.spawngroupID = se.spawngroupID 
        JOIN npc_types n ON se.npcID = n.id 
        WHERE s.zone = ?
    `;

    const [rows] = await pool.query(query, [shortName]);
    return rows;
}

async function getAllItems() {
    if (!pool) await init();

    const query = `
        SELECT id as item_key, Name as name, 
               aagi, acha, adex, aint, asta, astr, awis, 
               ac, hp, mana, damage, delay, price, 
               itemtype, slots, classes, races, weight, icon
        FROM items
    `;

    const [rows] = await pool.query(query);
    return rows;
}

// ── Inventory Queries ───────────────────────────────────────────────────

async function getInventory(charId) {
    if (!pool) return [];
    try {
        const [rows] = await pool.query('SELECT slot_id, item_id, charges FROM inventory WHERE character_id = ?', [charId]);
        const ItemDB = require('./data/itemDatabase');
        
        let inventory = [];
        for (const row of rows) {
            const itemDef = ItemDB.getById(row.item_id);
            if (itemDef) {
                inventory.push({
                    id: row.item_id, // we don't have unique inventory row IDs in EQEmu, just char + slot
                    char_id: charId,
                    item_key: itemDef._id, // the ItemDB stores _id as the original eqemu number
                    equipped: row.slot_id < 22 ? 1 : 0,
                    slot: row.slot_id,
                    quantity: row.charges > 0 ? row.charges : 1
                });
            }
        }
        return inventory;
    } catch(e) {
        console.error('[DB] getInventory error:', e.message);
        return [];
    }
}

async function addItem(charId, itemKey, equipped, slot, qty = 1) {
    if (!pool) return;
    try {
        await pool.query(
            'INSERT INTO inventory (character_id, slot_id, item_id, charges) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE item_id = ?, charges = charges + ?',
            [charId, slot, itemKey, qty, itemKey, qty]
        );
    } catch(e) { console.error('[DB] addItem error:', e.message); }
}

async function updateItemQuantity(id, charId, qty) {
    // ID in our old db was a row ID. In EQEmu, the primary key is charId + slotId.
    // We will assume `id` argument is now `item_id`.
    if (!pool) return;
    try {
        await pool.query('UPDATE inventory SET charges = charges + ? WHERE character_id = ? AND item_id = ?', [qty, charId, id]);
    } catch(e) { console.error('[DB] update qty error:', e.message); }
}

async function equipItem(itemId, charId, slot) {
    if (!pool) return;
    try {
        // Move from bag/cursor to equipped slot
        // This requires a swap or update. For simplicity, we just change the slot_id of the matching item_id.
        await pool.query('UPDATE inventory SET slot_id = ? WHERE character_id = ? AND item_id = ? LIMIT 1', [slot, charId, itemId]);
    } catch(e) { console.error('[DB] equipItem error:', e.message); }
}

async function unequipItem(itemId, charId) {
    if (!pool) return;
    try {
        // Find an empty main inventory slot (22-29)
        const [rows] = await pool.query('SELECT slot_id FROM inventory WHERE character_id = ? AND slot_id >= 22 AND slot_id <= 29', [charId]);
        const occupied = rows.map(r => r.slot_id);
        let freeSlot = 22;
        while(occupied.includes(freeSlot) && freeSlot <= 29) { freeSlot++; }
        
        await pool.query('UPDATE inventory SET slot_id = ? WHERE character_id = ? AND item_id = ? LIMIT 1', [freeSlot, charId, itemId]);
    } catch(e) { console.error('[DB] unequipItem error:', e.message); }
}

// ── Skills & Spells ───────────────────────────────────────────────────

async function getSkills(charId) {
    if (!pool) return [];
    try {
        const [rows] = await pool.query('SELECT skill_id, value FROM character_skills WHERE id = ?', [charId]);
        return rows;
    } catch(e) { return []; }
}

async function getSpells(charId) {
    if (!pool) return [];
    return []; // Spells mapping deferred
}

async function saveCharacterSkills(charId, skillsObj) {
    if (!pool || !skillsObj) return;
    // update character_skills... skipped for brevity as we just need basic function for now
}

// ── Zone Metadata Helpers ───────────────────────────────────────────

/** Get zone metadata from the DB cache. Returns { long_name, zone_type, zoneidnumber } or null. */
function getZoneMetadata(shortName) {
    return ZONE_CACHE[shortName] || null;
}

/** Get the numeric zone ID for a short_name (used for character persistence). */
function getZoneIdByShortName(shortName) {
    const meta = ZONE_CACHE[shortName];
    if (meta) return meta.zoneidnumber;
    // Fallback: check hardcoded map (pre-DB-init)
    return ZONES_NUM_FALLBACK[shortName] || null;
}

// ── Character Creation Data ──────────────────────────────────────────

/**
 * Get all valid class/deity combos and their stat allocations for a given race.
 * Returns: { classes: [{ classId, deities: [deityId, ...], allocations: { allocationId, base_*, alloc_* } }] }
 */
async function getCharCreateData(raceId) {
    if (!pool) await init();
    try {
        // Get all combos for this race with their stat allocation data
        const [rows] = await pool.query(`
            SELECT DISTINCT ccc.race, ccc.class, ccc.deity, ccc.allocation_id,
                   pa.base_str, pa.base_sta, pa.base_dex, pa.base_agi,
                   pa.base_int, pa.base_wis, pa.base_cha,
                   pa.alloc_str, pa.alloc_sta, pa.alloc_dex, pa.alloc_agi,
                   pa.alloc_int, pa.alloc_wis, pa.alloc_cha
            FROM char_create_combinations ccc
            JOIN char_create_point_allocations pa ON ccc.allocation_id = pa.id
            WHERE ccc.race = ?
            ORDER BY ccc.class, ccc.deity
        `, [raceId]);

        // Group by class
        const classMap = {};
        for (const row of rows) {
            if (!classMap[row.class]) {
                classMap[row.class] = {
                    classId: row.class,
                    className: INV_CLASSES[row.class] || `class_${row.class}`,
                    deities: new Set(),
                    allocation: {
                        id: row.allocation_id,
                        base_str: row.base_str, base_sta: row.base_sta,
                        base_dex: row.base_dex, base_agi: row.base_agi,
                        base_int: row.base_int, base_wis: row.base_wis,
                        base_cha: row.base_cha,
                        alloc_str: row.alloc_str, alloc_sta: row.alloc_sta,
                        alloc_dex: row.alloc_dex, alloc_agi: row.alloc_agi,
                        alloc_int: row.alloc_int, alloc_wis: row.alloc_wis,
                        alloc_cha: row.alloc_cha,
                    }
                };
            }
            classMap[row.class].deities.add(row.deity);
        }

        // Convert Sets to arrays
        const classes = Object.values(classMap).map(c => ({
            ...c,
            deities: Array.from(c.deities).sort((a, b) => a - b)
        }));

        return { raceId, classes };
    } catch (e) {
        console.error('[DB] getCharCreateData Error:', e.message);
        return { raceId, classes: [] };
    }
}

module.exports = {
    init,
    loginAccount,
    createAccount,
    getCharactersByAccount,
    getStartZone,
    getValidDeities,
    getCharCreateData,
    getZoneSpawns,
    getZonePoints,
    getAllItems,
    getCharacter,
    createCharacter,
    deleteCharacter,
    updateCharacterState,
    getInventory,
    addItem,
    updateItemQuantity,
    equipItem,
    unequipItem,
    getSkills,
    getSpells,
    saveCharacterSkills,
    getZoneMetadata,
    getZoneIdByShortName
};
