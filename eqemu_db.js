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
    'north_karana': 13,
    'gfaydark': 54,
    'lfaydark': 57
};

const INV_CLASSES = Object.fromEntries(Object.entries(CLASSES).map(([k, v]) => [v, k]));
const INV_RACES = Object.fromEntries(Object.entries(RACES).map(([k, v]) => [v, k]));
let INV_ZONES = Object.fromEntries(Object.entries(ZONES_NUM_FALLBACK).map(([k, v]) => [v, k]));

// Full zone metadata cache: short_name → { zoneidnumber, long_name, zone_type }
let ZONE_CACHE = {};
// Reverse lookup: zoneidnumber → short_name (built from DB)
let ZONE_ID_TO_SHORT = {};

// Faction caches
let FACTION_LIST = {};
let FACTION_BASE_DATA = {};
let NPC_FACTION = {};
let FACTION_LIST_MOD = [];
let NPC_FACTION_ENTRIES = {};

let pool;
let initPromise = null;

async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
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

    // Build Faction metadata cache
    try {
        const [listRows] = await pool.query('SELECT id, name, base FROM faction_list');
        FACTION_LIST = {};
        for (const r of listRows) FACTION_LIST[r.id] = r;

        const [baseDataRows] = await pool.query('SELECT client_faction_id, min, max FROM faction_base_data');
        FACTION_BASE_DATA = {};
        for (const r of baseDataRows) FACTION_BASE_DATA[r.client_faction_id] = r;

        const [npcFactionRows] = await pool.query('SELECT id, name, primaryfaction, ignore_primary_assist FROM npc_faction');
        NPC_FACTION = {};
        for (const r of npcFactionRows) NPC_FACTION[r.id] = r;

        const [modRows] = await pool.query('SELECT faction_id, mod_name, `mod` FROM faction_list_mod');
        FACTION_LIST_MOD = modRows;

        const [entryRows] = await pool.query('SELECT npc_faction_id, faction_id, value, npc_value, temp FROM npc_faction_entries');
        NPC_FACTION_ENTRIES = {};
        for (const r of entryRows) {
            if (!NPC_FACTION_ENTRIES[r.npc_faction_id]) NPC_FACTION_ENTRIES[r.npc_faction_id] = [];
            NPC_FACTION_ENTRIES[r.npc_faction_id].push(r);
        }

        console.log(`[DB] Loaded faction metadata cache.`);
    } catch (e) {
        console.error('[DB] Failed to load faction cache:', e.message);
    }
    })();
    return initPromise;
}

// ── Account Queries ─────────────────────────────────────────────────

async function loginAccount(username, password) {
    await init();
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
    await init();
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
            'SELECT id, name, class, race, level, zone_id, gender, face FROM character_data WHERE account_id = ? ORDER BY name',
            [accountId]
        );
        return rows.map(c => ({
            id: c.id,
            name: c.name,
            className: INV_CLASSES[c.class] || 'warrior',
            race: INV_RACES[c.race] || 'human',
            raceId: c.race,
            gender: c.gender || 0,
            face: c.face || 0,
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
    await init();
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
    await init();
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
    await init();
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
    await init();
    try {
        const [rows] = await pool.query(`SELECT * FROM character_data WHERE name = ?`, [name]);
        if (rows.length === 0) return null;
        
        const char = rows[0];
        const result = {
            id: char.id,
            name: char.name,
            class: INV_CLASSES[char.class] || 'warrior',
            classId: char.class || 1,
            race: INV_RACES[char.race] || 'human',
            raceId: char.race || 1,
            deityId: char.deity || 396,
            gender: char.gender || 0,
            face: char.face || 0,
            hairStyle: char.hair_style || 0,
            hairColor: char.hair_color || 0,
            beard: char.beard || 0,
            beardColor: char.beard_color || 0,
            eyeColor1: char.eye_color_1 || 0,
            eyeColor2: char.eye_color_2 || 0,
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
            zoneId: INV_ZONES[char.zone_id] || ZONE_ID_TO_SHORT[char.zone_id] || `zone_${char.zone_id}`,
            roomId: null,
            state: 'standing',
            practices: char.training_points != null ? char.training_points : (char.level * 5),
            x: char.x,
            y: char.y,
            z: char.z,
            copper: 0
        };

        // Load currency from separate table
        result.copper = await getCharacterCurrency(result.id);
        return result;
    } catch (e) {
        console.error('[DB] getCharacter Error:', e);
        return null;
    }
}

async function createCharacter(accountId, name, className, raceName, deityId, str, sta, agi, dex, wis, intel, cha, hp, mana, appearance = {}) {
    await init();
    
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

    // Appearance defaults
    const gender    = appearance.gender    || 0;
    const face      = appearance.face      || 0;
    const hairStyle = appearance.hairStyle || 0;
    const hairColor = appearance.hairColor || 0;
    const beard     = appearance.beard     || 0;
    const beardColor= appearance.beardColor|| 0;
    const eyeColor1 = appearance.eyeColor  || 0;
    const eyeColor2 = appearance.eyeColor  || 0;

    const query = `
        INSERT INTO character_data 
        (account_id, name, class, race, deity, level, exp, cur_hp, mana, str, sta, agi, dex, wis, \`int\`, cha, zone_id, x, y, z,
         gender, face, hair_style, hair_color, beard, beard_color, eye_color_1, eye_color_2) 
        VALUES 
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const params = [
        accountId, formattedName, classId, raceId, deityId || 396, 1, 0, hp, mana, str, sta, agi, dex, wis, intel, cha, start.zone_id, start.x, start.y, start.z,
        gender, face, hairStyle, hairColor, beard, beardColor, eyeColor1, eyeColor2
    ];

    try {
        const [result] = await pool.query(query, params);
        
        // Return the mapped schema object exactly as getCharacter would
        return {
            id: result.insertId,
            name: formattedName,
            class: className.toLowerCase(),
            race: raceName.toLowerCase(),
            raceId: raceId,
            gender: gender,
            face: face,
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
            zoneId: start.zone_short || INV_ZONES[start.zone_id] || `zone_${start.zone_id}`,
            roomId: null,
            state: 'standing',
            x: start.x,
            y: start.y,
            z: start.z,
            copper: 1000  // Starter money
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
    // Look up zone number from the DB cache (char.zoneId is the engine's key, which for
    // dynamically loaded zones IS the EQEmu short_name)
    let zoneId = getZoneIdByShortName(char.zoneId);

    // If direct lookup failed, try reverse-mapping through ZONES definitions
    // (e.g., 'qeynos_hills' has shortName 'qeytoqrg')
    if (!zoneId) {
        const ZONES = require('./data/zones');
        const def = ZONES[char.zoneId];
        if (def && def.shortName) {
            zoneId = getZoneIdByShortName(def.shortName);
        }
    }

    if (!zoneId) {
        // Cannot resolve zone — preserve existing DB value, do NOT overwrite with a default
        console.warn(`[DB] updateCharacterState: Can't resolve zone '${char.zoneId}' to numeric ID. Skipping zone_id update to preserve character location.`);
        try {
            await pool.query(
                'UPDATE character_data SET x = ?, y = ?, z = ?, cur_hp = ?, mana = ?, exp = ?, level = ?, training_points = ? WHERE id = ?',
                [char.x, char.y, char.z || 0, char.hp, char.mana, char.experience, char.level, char.practices || 0, char.id]
            );
            await saveCharacterCurrency(char.id, char.copper || 0);
        } catch (e) {
            console.error('[DB] updateCharacterState (no-zone) Error:', e.message);
        }
        return;
    }

    try {
        await pool.query(
            'UPDATE character_data SET x = ?, y = ?, z = ?, zone_id = ?, cur_hp = ?, mana = ?, exp = ?, level = ?, training_points = ? WHERE id = ?',
            [char.x, char.y, char.z || 0, zoneId, char.hp, char.mana, char.experience, char.level, char.practices || 0, char.id]
        );
        // Save currency to the separate table
        await saveCharacterCurrency(char.id, char.copper || 0);
    } catch (e) {
        console.error('[DB] updateCharacterState Error:', e.message);
    }
}

async function getZoneSpawns(shortName) {
    await init();

    const query = `
        SELECT s.id as spawn2_id, s.x, s.y, s.z, s.heading, s.respawntime, s.pathgrid,
               se.chance, 
               n.id as npc_id, n.name, n.level, n.hp, n.mindmg, n.maxdmg, n.race, n.gender, n.class, n.npc_faction_id, n.prim_melee_type,
               n.size, n.texture, n.helmtexture, n.d_melee_texture1, n.d_melee_texture2, n.armtexture, n.bracertexture, n.handtexture, n.legtexture, n.feettexture,
               n.runspeed, n.walkspeed, n.attack_delay,
               sg.dist as wander_dist
        FROM spawn2 s 
        JOIN spawnentry se ON s.spawngroupID = se.spawngroupID 
        JOIN npc_types n ON se.npcID = n.id 
        JOIN spawngroup sg ON s.spawngroupID = sg.id
        WHERE s.zone = ?
    `;

    const [rows] = await pool.query(query, [shortName]);
    return rows;
}

async function getZoneDoors(shortName) {
    await init();

    const query = `
        SELECT id, doorid, name, pos_x, pos_y, pos_z, heading, opentype, 
               dest_zone, dest_instance, dest_x, dest_y, dest_z, dest_heading, invert_state, size,
               triggerdoor, door_param
        FROM doors 
        WHERE zone = ?
    `;

    const [rows] = await pool.query(query, [shortName]);
    return rows;
}

async function getZoneGrids(zoneIdNumber) {
    await init();

    const query = `
        SELECT gridid, number, x, y, z, heading, pause 
        FROM grid_entries 
        WHERE zoneid = ? 
        ORDER BY gridid, number
    `;

    const [rows] = await pool.query(query, [zoneIdNumber]);
    
    // Group waypoints by gridid
    const grids = {};
    for (const row of rows) {
        if (!grids[row.gridid]) grids[row.gridid] = [];
        grids[row.gridid].push(row);
    }
    return grids;
}

async function getAllItems() {
    await init();

    const query = `
        SELECT id as item_key, Name as name, 
               aagi, acha, adex, aint, asta, astr, awis, 
               ac, hp, mana, damage, delay, price, 
               itemtype, slots, classes, races, weight, icon, material, idfile,
               reclevel, reqlevel, scrolllevel, scrolleffect, focuseffect, light,
               lore, magic, nodrop, norent, size, endur, fr, cr, mr, pr, dr,
               elemdmgtype, elemdmgamt, banedmgrace, banedmgamt, placeable,
               augslot1type, augslot2type, augslot3type, augslot4type, augslot5type, augslot6type
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

async function unequipItem(itemId, charId, targetSlot) {
    if (!pool) return;
    try {
        let finalSlot = targetSlot;
        if (targetSlot !== undefined && targetSlot >= 22 && targetSlot <= 29) {
            const [check] = await pool.query('SELECT item_id FROM inventory WHERE character_id = ? AND slot_id = ?', [charId, targetSlot]);
            if (check.length > 0) {
                // Target is occupied, bump existing item to Cursor (Slot 30)
                await pool.query('UPDATE inventory SET slot_id = 30 WHERE character_id = ? AND slot_id = ? LIMIT 1', [charId, targetSlot]);
            }
        } else {
            const [rows] = await pool.query('SELECT slot_id FROM inventory WHERE character_id = ? AND slot_id >= 22 AND slot_id <= 29', [charId]);
            const occupied = rows.map(r => r.slot_id);
            let freeSlot = 22;
            while(occupied.includes(freeSlot) && freeSlot <= 29) { freeSlot++; }
            finalSlot = freeSlot;
        }
        
        await pool.query('UPDATE inventory SET slot_id = ? WHERE character_id = ? AND item_id = ? LIMIT 1', [finalSlot, charId, itemId]);
    } catch(e) { console.error('[DB] unequipItem error:', e.message); }
}

async function unequipSlot(charId, slotId) {
    if (!pool) return;
    try {
        const [rows] = await pool.query('SELECT slot_id FROM inventory WHERE character_id = ? AND slot_id = ?', [charId, slotId]);
        if (rows.length > 0) {
            // Un-equipping an occupied slot implicitly bumps it to Cursor (Slot 30)
            await pool.query('UPDATE inventory SET slot_id = 30 WHERE character_id = ? AND slot_id = ? LIMIT 1', [charId, slotId]);
        }
    } catch(e) { console.error('[DB] unequipSlot error:', e.message); }
}

async function deleteItem(charId, itemId, slotId) {
    if (!pool) return;
    try {
        if (slotId != null) {
            await pool.query('DELETE FROM inventory WHERE character_id = ? AND item_id = ? AND slot_id = ? LIMIT 1', [charId, itemId, slotId]);
        } else {
            await pool.query('DELETE FROM inventory WHERE character_id = ? AND item_id = ? LIMIT 1', [charId, itemId]);
        }
    } catch(e) { console.error('[DB] deleteItem error:', e.message); }
}

async function moveItem(charId, fromSlot, toSlot) {
    if (!pool || fromSlot === toSlot) return;
    try {
        // Check if toSlot is occupied
        const [toRows] = await pool.query('SELECT slot_id FROM inventory WHERE character_id = ? AND slot_id = ?', [charId, toSlot]);
        if (toRows.length > 0) {
            // Swap: move the item currently in toSlot to the Cursor (Slot 30)
            await pool.query('UPDATE inventory SET slot_id = 30 WHERE character_id = ? AND slot_id = ? LIMIT 1', [charId, toSlot]);
            await pool.query('UPDATE inventory SET slot_id = ? WHERE character_id = ? AND slot_id = ? LIMIT 1', [toSlot, charId, fromSlot]);
        } else {
            await pool.query('UPDATE inventory SET slot_id = ? WHERE character_id = ? AND slot_id = ? LIMIT 1', [toSlot, charId, fromSlot]);
        }
    } catch(e) { console.error('[DB] moveItem error:', e.message); }
}

// ── EQEmu Canonical Skill ID Mapping ────────────────────────────────
// Maps our string skill keys to the numeric IDs used by character_skills table
const SKILL_NAME_TO_ID = {
    '1h_blunt': 0, '1h_slashing': 1, '2h_blunt': 2, '2h_slashing': 3,
    'abjuration': 4, 'alteration': 5, 'apply_poison': 6, 'archery': 7,
    'backstab': 8, 'bind_wound': 9, 'bash': 10, 'block': 11,
    'brass_instruments': 12, 'channeling': 13, 'conjuration': 14, 'defense': 15,
    'disarm': 16, 'disarm_traps': 17, 'divination': 18, 'dodge': 19,
    'double_attack': 20, 'dragon_punch': 21, 'dual_wield': 22, 'eagle_strike': 23,
    'evocation': 24, 'feign_death': 25, 'flying_kick': 26, 'foraging': 27,
    'hand_to_hand': 28, 'hide': 29, 'kick': 30, 'meditate': 31,
    'mend': 32, 'offense': 33, 'parry': 34, 'pick_lock': 35,
    'piercing': 36, 'riposte': 37, 'round_kick': 38, 'safe_fall': 39,
    'sense_heading': 40, 'singing': 41, 'sneak': 42, 'specialize_abjure': 43,
    'specialize_alteration': 44, 'specialize_conjuration': 45, 'specialize_divination': 46,
    'specialize_evocation': 47, 'stringed_instruments': 48, 'swimming': 49,
    'throwing': 50, 'tiger_claw': 51, 'tracking': 52, 'wind_instruments': 53,
    'fishing': 54, 'poison_making': 55, 'tinkering': 56, 'research': 57,
    'alchemy': 58, 'baking': 59, 'tailoring': 60, 'sense_traps': 61,
    'blacksmithing': 62, 'fletching': 63, 'brewing_ts': 64, 'alcohol_tolerance': 65,
    'begging': 66, 'jewelcrafting': 67, 'pottery_ts': 68, 'percussion': 69,
    'intimidation': 70, 'berserking': 71, 'taunt': 72,
    'pick_pocket': 53, // shares slot with wind_instruments in classic
    // Custom EQMUD skills (IDs 100+ to avoid conflicts with EQ's 0-72)
    'mining': 100,
    'normal_vision': 101,
    'weak_normal_vision': 102,
    'infravision': 103,
    'ultravision': 104,
    'cat_eye': 105,
    'serpent_sight': 106,
};
const SKILL_ID_TO_NAME = Object.fromEntries(Object.entries(SKILL_NAME_TO_ID).map(([k, v]) => [v, k]));

async function getSkills(charId) {
    if (!pool) return [];
    try {
        const [rows] = await pool.query('SELECT skill_id, value FROM character_skills WHERE id = ?', [charId]);
        // Convert numeric IDs back to string keys for the engine
        return rows.map(r => ({
            skill_id: SKILL_ID_TO_NAME[r.skill_id] || `skill_${r.skill_id}`,
            value: r.value
        }));
    } catch(e) { return []; }
}

async function getSpells(charId) {
    if (!pool) return [];
    try {
        const [rows] = await pool.query(
            'SELECT slot_id, spell_id FROM character_memmed_spells WHERE id = ? ORDER BY slot_id',
            [charId]
        );
        // Convert numeric spell_id back to string key via SpellDB
        const SpellDB = require('./data/spellDatabase');
        return rows.map(r => {
            const spellDef = SpellDB.getById(r.spell_id);
            return {
                slot: r.slot_id,
                spell_key: spellDef ? spellDef._key : `spell_${r.spell_id}`,
                id: r.spell_id
            };
        });
    } catch (e) {
        console.error('[DB] getSpells Error:', e.message);
        return [];
    }
}

async function memorizeSpell(charId, spellKey, slot) {
    if (!pool) return;
    try {
        // Resolve string key to numeric spell ID
        const SpellDB = require('./data/spellDatabase');
        const spellDef = SpellDB.getByKey(spellKey);
        const spellId = spellDef ? (spellDef._spellId || spellDef.id) : 0;
        if (!spellId) {
            console.warn(`[DB] memorizeSpell: Can't resolve spell key '${spellKey}' to numeric ID`);
            return;
        }
        await pool.query(
            'INSERT INTO character_memmed_spells (id, slot_id, spell_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE spell_id = ?',
            [charId, slot, spellId, spellId]
        );
    } catch (e) {
        console.error('[DB] memorizeSpell Error:', e.message);
    }
}

async function forgetSpell(charId, slot) {
    if (!pool) return;
    try {
        await pool.query('DELETE FROM character_memmed_spells WHERE id = ? AND slot_id = ?', [charId, slot]);
    } catch (e) {
        console.error('[DB] forgetSpell Error:', e.message);
    }
}

async function saveCharacterSkills(charId, skillsObj) {
    if (!pool || !skillsObj) return;
    try {
        for (const [skillName, value] of Object.entries(skillsObj)) {
            const numericId = SKILL_NAME_TO_ID[skillName];
            if (numericId === undefined) continue; // Skip unknown skills
            await pool.query(
                'INSERT INTO character_skills (id, skill_id, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = ?',
                [charId, numericId, value, value]
            );
        }
    } catch (e) {
        console.error('[DB] saveCharacterSkills Error:', e.message);
    }
}

// ── Currency Persistence ────────────────────────────────────────────
// EQEmu stores money in the `character_currency` table, not character_data

async function getCharacterCurrency(charId) {
    if (!pool) return 0;
    try {
        const [rows] = await pool.query('SELECT platinum, gold, silver, copper FROM character_currency WHERE id = ?', [charId]);
        if (rows.length === 0) return 0;
        const r = rows[0];
        return (r.platinum || 0) * 1000 + (r.gold || 0) * 100 + (r.silver || 0) * 10 + (r.copper || 0);
    } catch(e) {
        console.error('[DB] getCharacterCurrency Error:', e.message);
        return 0;
    }
}

async function saveCharacterCurrency(charId, totalCopper) {
    if (!pool) return;
    const pp = Math.floor(totalCopper / 1000);
    const gp = Math.floor((totalCopper % 1000) / 100);
    const sp = Math.floor((totalCopper % 100) / 10);
    const cp = totalCopper % 10;
    try {
        await pool.query(
            'INSERT INTO character_currency (id, platinum, gold, silver, copper) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE platinum = ?, gold = ?, silver = ?, copper = ?',
            [charId, pp, gp, sp, cp, pp, gp, sp, cp]
        );
    } catch(e) {
        console.error('[DB] saveCharacterCurrency Error:', e.message);
    }
}

// ── Location Persistence ────────────────────────────────────────────

async function saveCharacterLocation(charId, zoneShortName, roomId) {
    if (!pool) return;
    let zoneId = getZoneIdByShortName(zoneShortName);

    // FALLBACK: If zoneShortName is already numeric, use it directly!
    if (!zoneId && !isNaN(parseInt(zoneShortName))) {
        zoneId = parseInt(zoneShortName);
    }

    // If direct lookup failed, try reverse-mapping through ZONES definitions
    if (!zoneId) {
        const ZONES = require('./data/zones');
        const def = ZONES[zoneShortName];
        if (def && def.shortName) {
            zoneId = getZoneIdByShortName(def.shortName);
        }
    }

    if (!zoneId) {
        console.warn(`[DB] saveCharacterLocation: Unknown zone '${zoneShortName}', skipping.`);
        return;
    }
    try {
        await pool.query('UPDATE character_data SET zone_id = ? WHERE id = ?', [zoneId, charId]);
    } catch (e) {
        console.error('[DB] saveCharacterLocation Error:', e.message);
    }
}

// ── Zone Metadata Helpers ───────────────────────────────────────────

/** Get zone metadata from the DB cache. Returns { long_name, zone_type, zoneidnumber } or null. */
// ── Merchant Inventory (from merchantlist table) ─────────────────────

// Cache merchantlist results so we don't re-query every hail
const _merchantCache = {};

async function getMerchantItems(npcId) {
    if (_merchantCache[npcId]) return _merchantCache[npcId];
    if (!pool) return [];
    try {
        // The merchant_id in npc_types matches merchantid in merchantlist
        const [npcRow] = await pool.query('SELECT merchant_id FROM npc_types WHERE id = ?', [npcId]);
        if (!npcRow.length || !npcRow[0].merchant_id) return [];
        const merchantId = npcRow[0].merchant_id;

        const [rows] = await pool.query(`
            SELECT ml.slot, ml.item as item_id, i.Name as name, i.price, i.icon,
                   i.ac, i.damage, i.delay, i.hp, i.mana, i.weight,
                   i.astr, i.asta, i.aagi, i.adex, i.awis, i.aint, i.acha,
                   i.classes, i.reclevel, i.scrolleffect, i.scrolllevel, i.itemtype
            FROM merchantlist ml
            JOIN items i ON ml.item = i.id
            WHERE ml.merchantid = ?
            ORDER BY ml.slot
        `, [merchantId]);

        const items = rows.map(r => ({
            itemKey: r.item_id,
            name: r.name,
            price: r.price || 1,
            ac: r.ac || 0,
            damage: r.damage || 0,
            delay: r.delay || 0,
            hp: r.hp || 0,
            mana: r.mana || 0,
            weight: (r.weight || 0) / 10,
            str: r.astr || 0,
            sta: r.asta || 0,
            classes: r.classes || 65535,
            reclevel: r.reclevel || 0,
            scrolllevel: r.scrolllevel || 0,
            scrolleffect: r.scrolleffect || 0,
            itemtype: r.itemtype || 0,
            icon: r.icon || 0,
        }));

        _merchantCache[npcId] = items;
        console.log(`[DB] Loaded ${items.length} merchant items for NPC ${npcId}`);
        return items;
    } catch(e) {
        console.error('[DB] getMerchantItems error:', e.message);
        return [];
    }
}

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

// ── Factions & Buyback ───────────────────────────────────────────────

async function getCharacterFactionValues(charId) {
    if (!pool) return {};
    try {
        const [rows] = await pool.query('SELECT faction_id, current_value FROM faction_values WHERE char_id = ?', [charId]);
        const values = {};
        for (const r of rows) values[r.faction_id] = r.current_value;
        return values;
    } catch(e) {
        console.error('[DB] getCharacterFactionValues error:', e.message);
        return {};
    }
}

async function updateCharacterFactionValue(charId, factionId, newValue, temp) {
    if (!pool) return;
    try {
        await pool.query(
            'INSERT INTO faction_values (char_id, faction_id, current_value, temp) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE current_value = ?, temp = ?',
            [charId, factionId, newValue, temp, newValue, temp]
        );
    } catch (e) {
        console.error('[DB] updateCharacterFactionValue error:', e.message);
    }
}

function getFactionCaches() {
    return {
        FACTION_LIST,
        FACTION_BASE_DATA,
        NPC_FACTION,
        FACTION_LIST_MOD,
        NPC_FACTION_ENTRIES
    };
}

async function addBuybackItem(charId, npcId, itemId, charges, price) {
    if (!pool) return;
    try {
        await pool.query(
            'INSERT INTO merchant_buyback (char_id, npc_id, item_id, charges, price) VALUES (?, ?, ?, ?, ?)',
            [charId, npcId, itemId, charges, price]
        );
    } catch(e) { console.error('[DB] addBuybackItem error:', e.message); }
}

async function getBuybackItems(charId, npcId) {
    if (!pool) return [];
    try {
        const [rows] = await pool.query(
            'SELECT id, item_id, charges, price FROM merchant_buyback WHERE char_id = ? AND npc_id = ? ORDER BY sold_at DESC',
            [charId, npcId]
        );
        return rows;
    } catch(e) {
        console.error('[DB] getBuybackItems error:', e.message);
        return [];
    }
}

async function removeBuybackItem(buybackId) {
    if (!pool) return;
    try {
        await pool.query('DELETE FROM merchant_buyback WHERE id = ? LIMIT 1', [buybackId]);
    } catch(e) { console.error('[DB] removeBuybackItem error:', e.message); }
}

// ── Character Creation Data ──────────────────────────────────────────

/**
 * Get all valid class/deity combos and their stat allocations for a given race.
 * Returns: { classes: [{ classId, deities: [deityId, ...], allocations: { allocationId, base_*, alloc_* } }] }
 */
async function getCharCreateData(raceId) {
    await init();
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
    unequipSlot,
    deleteItem,
    moveItem,
    getSkills,
    getSpells,
    memorizeSpell,
    forgetSpell,
    saveCharacterSkills,
    getCharacterCurrency,
    saveCharacterCurrency,
    getZoneMetadata,
    getZoneIdByShortName,
    getMerchantItems,
    saveCharacterLocation,
    getZoneGrids,
    getZoneDoors,
    getCharacterFactionValues,
    updateCharacterFactionValue,
    getFactionCaches,
    addBuybackItem,
    getBuybackItems,
    removeBuybackItem
};


