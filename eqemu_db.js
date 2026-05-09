require('dotenv').config();
const mysql = require('mysql2/promise');

const constants = require('./data/constants');
const CLASSES = constants.CLASSES;
const RACES = constants.RACES;


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
let ZONE_ROUTING_CACHE = null; // zone_short -> { node, continent }

async function init() {
    if (!process.env.EQEMU_PASSWORD) {
        throw new Error('[DB] FATAL: EQEMU_PASSWORD not set in .env file. Cannot start server.');
    }
    
    initPromise = (async () => {
        pool = mysql.createPool({
        host: process.env.EQEMU_HOST || '127.0.0.1',
        port: process.env.EQEMU_PORT || 3307,
        user: process.env.EQEMU_USER || 'eqemu',
        password: process.env.EQEMU_PASSWORD,
        database: process.env.EQEMU_DATABASE || 'peq',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });

    console.log('[DB] Connected to EQEmu MySQL Database.');

    try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS character_spellbook (
            id INT AUTO_INCREMENT PRIMARY KEY,
            character_id INT NOT NULL,
            book_slot INT NOT NULL,
            spell_key VARCHAR(128) NOT NULL,
            spell_id INT NOT NULL,
            UNIQUE KEY (character_id, book_slot)
          )
        `);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS character_spell_loadouts (
            character_id INT NOT NULL,
            loadout_name VARCHAR(64) NOT NULL,
            gem_data JSON NOT NULL,
            PRIMARY KEY (character_id, loadout_name)
          )
        `);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS character_buffs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            character_id INT NOT NULL,
            buff_name VARCHAR(128) NOT NULL,
            duration FLOAT NOT NULL,
            max_duration FLOAT NOT NULL,
            beneficial TINYINT DEFAULT 1,
            effects JSON,
            ac INT DEFAULT 0,
            icon INT DEFAULT 0,
            mem_icon INT DEFAULT 0,
            saved_at BIGINT NOT NULL
          )
        `);

        // ── EQMUD Player Corpses (persistent across zone activity) ─────────────
        await pool.query(`
          CREATE TABLE IF NOT EXISTS eqmud_player_corpses (
            corpse_id VARCHAR(128) PRIMARY KEY,
            character_id INT NOT NULL,
            character_name VARCHAR(64) NOT NULL,
            zone_id VARCHAR(64) NOT NULL,
            x FLOAT NOT NULL,
            y FLOAT NOT NULL,
            z FLOAT NOT NULL,
            heading FLOAT NOT NULL,
            level INT NOT NULL,
            race INT NOT NULL,
            gender INT NOT NULL,
            face INT NOT NULL,
            appearance_json TEXT,
            equip_visuals_json TEXT,
            loot_json LONGTEXT,
            coins INT DEFAULT 0,
            animation VARCHAR(16),
            loot_lock_group VARCHAR(64),
            loot_lock_until BIGINT,
            created_at BIGINT NOT NULL,
            decay_time BIGINT NOT NULL,
            KEY idx_zone_decay (zone_id, decay_time),
            KEY idx_char (character_id)
          )
        `);
        try {
          await pool.query('ALTER TABLE eqmud_player_corpses ADD COLUMN loot_consent_json TEXT NULL');
        } catch (e) { /* column exists */ }

        await pool.query(`
          CREATE TABLE IF NOT EXISTS eqmud_zone_routing (
            zone_short VARCHAR(64) PRIMARY KEY,
            node VARCHAR(32) NOT NULL,
            continent VARCHAR(32) DEFAULT NULL,
            notes VARCHAR(255) DEFAULT NULL,
            updated_at BIGINT NOT NULL,
            KEY idx_node (node),
            KEY idx_continent (continent)
          )
        `);
    } catch (e) {
        console.error('[DB] Failed to create custom EQMUD tables:', e.message);
    }

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

    // Load zone routing cache (best-effort)
    try {
        await refreshZoneRoutingCache();
    } catch (e) {}
    })();
    return initPromise;
}

async function refreshZoneRoutingCache() {
    if (!pool) return {};
    try {
        const [rows] = await pool.query('SELECT zone_short, node, continent FROM eqmud_zone_routing');
        ZONE_ROUTING_CACHE = {};
        for (const r of rows) {
            if (!r.zone_short) continue;
            ZONE_ROUTING_CACHE[String(r.zone_short).toLowerCase()] = {
                node: r.node,
                continent: r.continent
            };
        }
        console.log(`[DB] Loaded zone routing cache (${rows.length} routes).`);
        return ZONE_ROUTING_CACHE;
    } catch (e) {
        console.error('[DB] Failed to load zone routing cache:', e.message);
        ZONE_ROUTING_CACHE = {};
        return ZONE_ROUTING_CACHE;
    }
}

async function getZoneRoute(zoneShort) {
    if (!zoneShort) return null;
    const z = String(zoneShort).toLowerCase();
    if (ZONE_ROUTING_CACHE == null) await refreshZoneRoutingCache();
    return ZONE_ROUTING_CACHE[z] || null;
}

async function upsertZoneRoute(zoneShort, node, continent = null, notes = null) {
    if (!pool || !zoneShort || !node) return;
    const z = String(zoneShort).toLowerCase();
    try {
        await pool.query(
            `INSERT INTO eqmud_zone_routing (zone_short, node, continent, notes, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE node = VALUES(node), continent = VALUES(continent), notes = VALUES(notes), updated_at = VALUES(updated_at)`,
            [z, node, continent, notes, Date.now()]
        );
        if (ZONE_ROUTING_CACHE == null) ZONE_ROUTING_CACHE = {};
        ZONE_ROUTING_CACHE[z] = { node, continent };
    } catch (e) {
        console.error('[DB] upsertZoneRoute error:', e.message);
    }
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
            hunger: char.hunger_level != null ? char.hunger_level : 100,
            thirst: char.thirst_level != null ? char.thirst_level : 100,
            zoneId: INV_ZONES[char.zone_id] || ZONE_ID_TO_SHORT[char.zone_id] || `zone_${char.zone_id}`,
            roomId: null,
            state: 'standing',
            practices: char.training_points != null ? char.training_points : (char.level * 5),
            x: char.x,
            y: char.y,
            z: char.z,
            copper: 0
        };

        // Load bind point
        try {
            const [bindRows] = await pool.query('SELECT zone_id, x, y, z, heading FROM character_bind WHERE id = ? AND slot = 0', [result.id]);
            if (bindRows.length > 0) {
                const b = bindRows[0];
                result.bindZoneId = INV_ZONES[b.zone_id] || ZONE_ID_TO_SHORT[b.zone_id] || `zone_${b.zone_id}`;
                result.bindX = b.x;
                result.bindY = b.y;
                result.bindZ = b.z;
                result.bindHeading = b.heading;
            }
        } catch (bindErr) {
            console.warn(`[DB] Could not load bind point for ${result.name}:`, bindErr.message);
        }

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
        const charId = result.insertId;

        // --- GRANT STARTING ITEMS ---
        try {
            // PEQ uses pipe-separated lists (e.g. zone_id_list "3|189"); FIND_IN_SET only works on comma-separated values.
            const [starterItems] = await pool.query(
                `SELECT item_id, item_charges, inventory_slot FROM starting_items 
                 WHERE status = 0 
                 AND (class_list = '0' OR FIND_IN_SET(?, REPLACE(class_list, '|', ',')))
                 AND (race_list = '0' OR FIND_IN_SET(?, REPLACE(race_list, '|', ',')))
                 AND (deity_list = '0' OR FIND_IN_SET(?, REPLACE(deity_list, '|', ',')))
                 AND (zone_id_list = '0' OR FIND_IN_SET(?, REPLACE(zone_id_list, '|', ',')))`,
                [classId.toString(), raceId.toString(), (deityId || 396).toString(), start.zone_id.toString()]
            );

            const ItemDB = require('./data/itemDatabase');
            const itemsToGive = [];
            for (const item of starterItems) {
                const def = ItemDB.getById(item.item_id);
                let ch = Number(item.item_charges);
                if (!Number.isFinite(ch) || ch <= 0) {
                    ch = 1;
                    if (def && Number(def.stackable) === 1 && Number(def.stacksize) > 1) {
                        ch = Number(def.stacksize);
                    }
                }
                itemsToGive.push({
                    id: item.item_id,
                    charges: Math.max(1, ch | 0),
                    slot: item.inventory_slot,
                });
            }
            // Do not inject extra backpack/torch here — PEQ `starting_items` already defines them for combos that need them,
            // and duplicates overwrite bag slots via ON DUPLICATE KEY.

            // Place fixed-slot items first so auto-slot (-1) fills gaps without colliding.
            itemsToGive.sort((a, b) => (b.slot >= 0 ? 1 : 0) - (a.slot >= 0 ? 1 : 0));

            const occupiedSlots = new Set(itemsToGive.filter(i => i.slot >= 0).map(i => i.slot));

            for (const item of itemsToGive) {
                let targetSlot = item.slot;
                if (targetSlot < 0) {
                    targetSlot = 22; // Start at first bag slot
                    while (occupiedSlots.has(targetSlot) && targetSlot <= 29) {
                        targetSlot++;
                    }
                    if (targetSlot > 29) targetSlot = 30; // Cursor fallback
                    occupiedSlots.add(targetSlot);
                }
                await pool.query(
                    'INSERT INTO inventory (character_id, slot_id, item_id, charges) VALUES (?, ?, ?, ?)',
                    [charId, targetSlot, item.id, item.charges]
                );
            }
            console.log(`[DB] Granted ${itemsToGive.length} starting items to new character ${formattedName}`);
        } catch(e) {
            console.error('[DB] Starting items error:', e.message);
        }
        
        // Return the mapped schema object exactly as getCharacter would
        return {
            id: charId,
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
            hunger: 100,
            thirst: 100,
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
                'UPDATE character_data SET x = ?, y = ?, z = ?, cur_hp = ?, mana = ?, exp = ?, level = ?, training_points = ?, hunger_level = ?, thirst_level = ? WHERE id = ?',
                [char.x, char.y, char.z || 0, char.hp || 0, char.mana || 0, char.experience || 0, char.level || 1, char.practices || 0, char.hunger || 0, char.thirst || 0, char.id]
            );
            await saveCharacterCurrency(char.id, char.copper || 0);
        } catch (e) {
            console.error('[DB] updateCharacterState (no-zone) Error:', e.message);
        }
        return;
    }

    try {
        await pool.query(
            'UPDATE character_data SET x = ?, y = ?, z = ?, zone_id = ?, cur_hp = ?, mana = ?, exp = ?, level = ?, training_points = ?, hunger_level = ?, thirst_level = ? WHERE id = ?',
            [char.x, char.y, char.z || 0, zoneId, char.hp || 0, char.mana || 0, char.experience || 0, char.level || 1, char.practices || 0, char.hunger || 0, char.thirst || 0, char.id]
        );
        // Save currency to the separate table
        await saveCharacterCurrency(char.id, char.copper || 0);
    } catch (e) {
        console.error('[DB] updateCharacterState Error:', e.message);
    }
}

async function updateCharacterBind(char) {
    if (!pool) return;
    let zoneId = getZoneIdByShortName(char.bindZoneId);
    if (!zoneId) {
        const ZONES = require('./data/zones');
        const def = ZONES[char.bindZoneId];
        if (def && def.shortName) {
            zoneId = getZoneIdByShortName(def.shortName);
        }
    }
    if (!zoneId) {
        console.warn(`[DB] updateCharacterBind: Can't resolve zone '${char.bindZoneId}'. Bind aborted.`);
        return;
    }

    try {
        await pool.query(
            'INSERT INTO character_bind (id, slot, zone_id, instance_id, x, y, z, heading) VALUES (?, 0, ?, 0, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE zone_id = ?, x = ?, y = ?, z = ?, heading = ?',
            [char.id, zoneId, char.bindX, char.bindY, char.bindZ, char.bindHeading, zoneId, char.bindX, char.bindY, char.bindZ, char.bindHeading]
        );
        console.log(`[DB] Updated bind point for char ${char.id} in zone ${zoneId}`);
    } catch (e) {
        console.error('[DB] updateCharacterBind Error:', e.message);
    }
}

async function getZoneSpawns(shortName) {
    await init();

    const query = `
        SELECT s.id as spawn2_id, s.x, s.y, s.z, s.heading, s.respawntime, s.pathgrid,
               se.chance, 
               n.id as npc_id, n.name, n.level, n.hp, n.mindmg, n.maxdmg, n.race, n.gender, n.class, n.npc_faction_id, n.prim_melee_type,
               n.size, n.texture, n.helmtexture, n.d_melee_texture1, n.d_melee_texture2, n.armtexture, n.bracertexture, n.handtexture, n.legtexture, n.feettexture,
               n.runspeed, n.walkspeed, n.attack_delay, n.see_invis, n.see_invis_undead, n.loottable_id,
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
        SELECT i.id as item_key, i.Name as name, 
               i.aagi, i.acha, i.adex, i.aint, i.asta, i.astr, i.awis, 
               i.ac, i.hp, i.mana, i.damage, i.delay, i.price, 
               i.stackable, i.stacksize,
               i.itemtype, i.slots, i.classes, i.races, i.weight, i.icon, i.material, i.idfile,
               i.reclevel, i.reqlevel, i.scrolllevel, i.scrolleffect, i.focuseffect, i.light,
               i.lore, i.magic, i.nodrop, i.norent, i.size, i.endur, i.fr, i.cr, i.mr, i.pr, i.dr,
               i.elemdmgtype, i.elemdmgamt, i.banedmgrace, i.banedmgamt, i.placeable,
               i.augslot1type, i.augslot2type, i.augslot3type, i.augslot4type, i.augslot5type, i.augslot6type,
               i.bagslots, i.bagsize, i.bagwr, i.bagtype,
               b.txtfile as bookText
        FROM items i
        LEFT JOIN books b ON i.filename = b.name
    `;

    const [rows] = await pool.query(query);
    return rows;
}

// ── Student / Bot Functions ───────────────────────────────────────────────

async function getCharacterStudents(charId) {
    if (!pool) return [];
    try {
        const [rows] = await pool.query('SELECT * FROM character_students WHERE owner_id = ?', [charId]);
        return rows;
    } catch(e) {
        console.error('[DB] getCharacterStudents error:', e.message);
        return [];
    }
}

async function createCharacterStudent(ownerId, name, classId, raceId, level, zoneId, x, y, z, heading, gender = 0, face = 0, deityId = 396, stats = {}) {
    if (!pool) return null;
    try {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS character_students (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    owner_id INT,
                    name VARCHAR(64),
                    class_id INT,
                    race_id INT,
                    level INT,
                    zone_id INT,
                    x FLOAT,
                    y FLOAT,
                    z FLOAT,
                    heading FLOAT,
                    hp INT DEFAULT 100,
                    mana INT DEFAULT 100,
                    gender INT DEFAULT 0,
                    face INT DEFAULT 0,
                    deity_id INT DEFAULT 396,
                    str INT DEFAULT 0,
                    sta INT DEFAULT 0,
                    agi INT DEFAULT 0,
                    dex INT DEFAULT 0,
                    wis INT DEFAULT 0,
                    intel INT DEFAULT 0,
                    cha INT DEFAULT 0
                )
            `);
        } catch(e) { console.error('[DB] create table character_students error:', e.message); }
        
        try {
            await pool.query('ALTER TABLE character_students ADD COLUMN gender INT DEFAULT 0, ADD COLUMN face INT DEFAULT 0, ADD COLUMN deity_id INT DEFAULT 396, ADD COLUMN str INT DEFAULT 0, ADD COLUMN sta INT DEFAULT 0, ADD COLUMN agi INT DEFAULT 0, ADD COLUMN dex INT DEFAULT 0, ADD COLUMN wis INT DEFAULT 0, ADD COLUMN intel INT DEFAULT 0, ADD COLUMN cha INT DEFAULT 0');
        } catch(e) {} // Ignore if already altered

        const [result] = await pool.query(
            'INSERT INTO character_students (owner_id, name, class_id, race_id, level, zone_id, x, y, z, heading, gender, face, deity_id, str, sta, agi, dex, wis, intel, cha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [ownerId, name, classId, raceId, level, zoneId, x, y, z, heading, gender, face, deityId, stats.str || 0, stats.sta || 0, stats.agi || 0, stats.dex || 0, stats.wis || 0, stats.int || 0, stats.cha || 0]
        );
        return result.insertId;
    } catch(e) {
        console.error('[DB] createCharacterStudent error:', e.message);
        return null;
    }
}

async function deleteCharacterStudent(studentDbId) {
    if (!pool) return false;
    try {
        await pool.query('DELETE FROM character_students WHERE id = ?', [studentDbId]);
        return true;
    } catch(e) {
        console.error('[DB] deleteCharacterStudent error:', e.message);
        return false;
    }
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
                    character_id: charId,
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

async function updateItemQuantity(id, charId, qty, slotId = null) {
    // ID in our old db was a row ID. In EQEmu, the primary key is charId + slotId.
    // We will assume `id` argument is now `item_id`.
    if (!pool) return;
    try {
        if (slotId !== null) {
            await pool.query('UPDATE inventory SET charges = charges + ? WHERE character_id = ? AND item_id = ? AND slot_id = ? LIMIT 1', [qty, charId, id, slotId]);
        } else {
            await pool.query('UPDATE inventory SET charges = charges + ? WHERE character_id = ? AND item_id = ?', [qty, charId, id]);
        }
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

async function splitStackToSlot(charId, fromSlot, toSlot, count) {
    if (!pool || count < 1 || fromSlot === toSlot) return false;
    try {
        const [fromRows] = await pool.query(
            'SELECT item_id, charges FROM inventory WHERE character_id = ? AND slot_id = ? LIMIT 1',
            [charId, fromSlot]
        );
        if (!fromRows.length) return false;
        const fr = fromRows[0];
        const q = Number(fr.charges) > 0 ? Number(fr.charges) : 1;
        const n = Math.floor(Number(count));
        if (!Number.isFinite(n) || n < 1 || n >= q) return false;

        const [toRows] = await pool.query(
            'SELECT item_id, charges FROM inventory WHERE character_id = ? AND slot_id = ? LIMIT 1',
            [charId, toSlot]
        );

        if (!toRows.length) {
            await pool.query(
                'UPDATE inventory SET charges = ? WHERE character_id = ? AND slot_id = ? LIMIT 1',
                [q - n, charId, fromSlot]
            );
            await pool.query(
                'INSERT INTO inventory (character_id, slot_id, item_id, charges) VALUES (?, ?, ?, ?)',
                [charId, toSlot, fr.item_id, n]
            );
            return true;
        }

        const tr = toRows[0];
        if (Number(tr.item_id) !== Number(fr.item_id)) return false;
        const tq = Number(tr.charges) > 0 ? Number(tr.charges) : 1;
        await pool.query(
            'UPDATE inventory SET charges = ? WHERE character_id = ? AND slot_id = ? LIMIT 1',
            [q - n, charId, fromSlot]
        );
        await pool.query(
            'UPDATE inventory SET charges = ? WHERE character_id = ? AND slot_id = ? LIMIT 1',
            [tq + n, charId, toSlot]
        );
        return true;
    } catch (e) {
        console.error('[DB] splitStackToSlot error:', e.message);
        return false;
    }
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

// ── Persistent Player Corpses ───────────────────────────────────────────────
function safeJsonParse(str, fallback) {
    if (!str) return fallback;
    try { return JSON.parse(str); } catch (e) { return fallback; }
}

async function savePlayerCorpse(corpse) {
    if (!pool || !corpse) return;
    try {
        const consentJson = JSON.stringify(Array.isArray(corpse.lootConsentNames) ? corpse.lootConsentNames : []);
        await pool.query(
            `INSERT INTO eqmud_player_corpses
             (corpse_id, character_id, character_name, zone_id, x, y, z, heading, level, race, gender, face,
              appearance_json, equip_visuals_json, loot_json, coins, animation, loot_lock_group, loot_lock_until,
              loot_consent_json, created_at, decay_time)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
              zone_id = VALUES(zone_id),
              x = VALUES(x), y = VALUES(y), z = VALUES(z), heading = VALUES(heading),
              level = VALUES(level), race = VALUES(race), gender = VALUES(gender), face = VALUES(face),
              appearance_json = VALUES(appearance_json),
              equip_visuals_json = VALUES(equip_visuals_json),
              loot_json = VALUES(loot_json),
              coins = VALUES(coins),
              animation = VALUES(animation),
              loot_lock_group = VALUES(loot_lock_group),
              loot_lock_until = VALUES(loot_lock_until),
              loot_consent_json = VALUES(loot_consent_json),
              decay_time = VALUES(decay_time)`,
            [
                corpse.id,
                corpse.mobId,
                corpse.originalName,
                corpse.zoneId || corpse.zone_id || corpse.zone,
                corpse.x || 0,
                corpse.y || 0,
                corpse.z || 0,
                corpse.heading || 0,
                corpse.level || 1,
                corpse.race || 1,
                corpse.gender || 0,
                corpse.face || 0,
                JSON.stringify(corpse.appearance || {}),
                JSON.stringify(corpse.equipVisuals || {}),
                JSON.stringify(corpse.loot || []),
                corpse.coins || 0,
                corpse.animation || null,
                corpse.lootLockGroup || null,
                corpse.lootLockUntil || null,
                consentJson,
                corpse.spawnTime || Date.now(),
                corpse.decayTime || (Date.now() + 7 * 24 * 60 * 60 * 1000)
            ]
        );
    } catch (e) {
        console.error('[DB] savePlayerCorpse error:', e.message);
    }
}

async function getPlayerCorpsesForZone(zoneId) {
    if (!pool || !zoneId) return [];
    try {
        const now = Date.now();
        const [rows] = await pool.query(
            `SELECT * FROM eqmud_player_corpses WHERE zone_id = ? AND decay_time > ?`,
            [zoneId, now]
        );
        return rows.map(r => ({
            id: r.corpse_id,
            name: `${r.character_name}'s corpse`,
            type: 'corpse',
            originalName: r.character_name,
            mobId: r.character_id,
            level: r.level,
            x: r.x, y: r.y, z: r.z,
            heading: r.heading,
            race: r.race,
            gender: r.gender,
            face: r.face,
            appearance: safeJsonParse(r.appearance_json, {}),
            equipVisuals: safeJsonParse(r.equip_visuals_json, {}),
            size: 6,
            isNpc: false,
            loot: safeJsonParse(r.loot_json, []),
            coins: r.coins || 0,
            spawnTime: Number(r.created_at) || Date.now(),
            decayTime: Number(r.decay_time) || (Date.now() + 7 * 24 * 60 * 60 * 1000),
            lootLockGroup: r.loot_lock_group,
            lootLockUntil: Number(r.loot_lock_until) || 0,
            animation: r.animation || null,
            lootConsentNames: safeJsonParse(r.loot_consent_json, [])
        }));
    } catch (e) {
        console.error('[DB] getPlayerCorpsesForZone error:', e.message);
        return [];
    }
}

async function updatePlayerCorpse(corpse) {
    if (!pool || !corpse) return;
    try {
        const consentJson = corpse.lootConsentNames !== undefined
            ? JSON.stringify(Array.isArray(corpse.lootConsentNames) ? corpse.lootConsentNames : [])
            : null;
        if (consentJson != null) {
            await pool.query(
                `UPDATE eqmud_player_corpses
                 SET zone_id = ?, x = ?, y = ?, z = ?, heading = ?,
                     loot_json = ?, coins = ?, loot_lock_group = ?, loot_lock_until = ?,
                     loot_consent_json = ?, decay_time = ?
                 WHERE corpse_id = ?
                 LIMIT 1`,
                [
                    corpse.zoneId || corpse.zone_id || corpse.zone,
                    corpse.x || 0,
                    corpse.y || 0,
                    corpse.z || 0,
                    corpse.heading || 0,
                    JSON.stringify(corpse.loot || []),
                    corpse.coins || 0,
                    corpse.lootLockGroup || null,
                    corpse.lootLockUntil || null,
                    consentJson,
                    corpse.decayTime || (Date.now() + 7 * 24 * 60 * 60 * 1000),
                    corpse.id
                ]
            );
        } else {
            await pool.query(
                `UPDATE eqmud_player_corpses
                 SET zone_id = ?, x = ?, y = ?, z = ?, heading = ?,
                     loot_json = ?, coins = ?, loot_lock_group = ?, loot_lock_until = ?, decay_time = ?
                 WHERE corpse_id = ?
                 LIMIT 1`,
                [
                    corpse.zoneId || corpse.zone_id || corpse.zone,
                    corpse.x || 0,
                    corpse.y || 0,
                    corpse.z || 0,
                    corpse.heading || 0,
                    JSON.stringify(corpse.loot || []),
                    corpse.coins || 0,
                    corpse.lootLockGroup || null,
                    corpse.lootLockUntil || null,
                    corpse.decayTime || (Date.now() + 7 * 24 * 60 * 60 * 1000),
                    corpse.id
                ]
            );
        }
    } catch (e) {
        console.error('[DB] updatePlayerCorpse error:', e.message);
    }
}

async function appendLootConsentForCharacterCorpses(characterId, granteeLower) {
    if (!pool || !characterId || !granteeLower) return;
    const now = Date.now();
    try {
        const [rows] = await pool.query(
            'SELECT corpse_id, loot_consent_json FROM eqmud_player_corpses WHERE character_id = ? AND decay_time > ?',
            [characterId, now]
        );
        for (const row of rows) {
            let arr = safeJsonParse(row.loot_consent_json, []);
            if (!Array.isArray(arr)) arr = [];
            if (!arr.includes(granteeLower)) {
                arr.push(granteeLower);
                await pool.query(
                    'UPDATE eqmud_player_corpses SET loot_consent_json = ? WHERE corpse_id = ? LIMIT 1',
                    [JSON.stringify(arr), row.corpse_id]
                );
            }
        }
    } catch (e) {
        console.error('[DB] appendLootConsentForCharacterCorpses error:', e.message);
    }
}

async function removeLootConsentForCharacterCorpses(characterId, granteeLower) {
    if (!pool || !characterId || !granteeLower) return;
    const now = Date.now();
    try {
        const [rows] = await pool.query(
            'SELECT corpse_id, loot_consent_json FROM eqmud_player_corpses WHERE character_id = ? AND decay_time > ?',
            [characterId, now]
        );
        for (const row of rows) {
            let arr = safeJsonParse(row.loot_consent_json, []);
            if (!Array.isArray(arr)) arr = [];
            const next = arr.filter(n => String(n).toLowerCase() !== granteeLower);
            if (next.length !== arr.length) {
                await pool.query(
                    'UPDATE eqmud_player_corpses SET loot_consent_json = ? WHERE corpse_id = ? LIMIT 1',
                    [JSON.stringify(next), row.corpse_id]
                );
            }
        }
    } catch (e) {
        console.error('[DB] removeLootConsentForCharacterCorpses error:', e.message);
    }
}

async function clearLootConsentForCharacterCorpses(characterId) {
    if (!pool || !characterId) return;
    const now = Date.now();
    try {
        await pool.query(
            'UPDATE eqmud_player_corpses SET loot_consent_json = ? WHERE character_id = ? AND decay_time > ?',
            ['[]', characterId, now]
        );
    } catch (e) {
        console.error('[DB] clearLootConsentForCharacterCorpses error:', e.message);
    }
}

async function deletePlayerCorpse(corpseId) {
    if (!pool || !corpseId) return;
    try {
        await pool.query(`DELETE FROM eqmud_player_corpses WHERE corpse_id = ? LIMIT 1`, [corpseId]);
    } catch (e) {
        console.error('[DB] deletePlayerCorpse error:', e.message);
    }
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

async function saveCharacterLocation(charId, zoneShortName, x, y, z) {
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
        await pool.query('UPDATE character_data SET zone_id = ?, x = ?, y = ?, z = ? WHERE id = ?', [zoneId, x, y, z, charId]);
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
    if (typeof npcId === 'number' && isNaN(npcId)) return [];
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
            'INSERT INTO merchant_buyback (character_id, npc_id, item_id, charges, price) VALUES (?, ?, ?, ?, ?)',
            [charId, npcId, itemId, charges, price]
        );
    } catch(e) { console.error('[DB] addBuybackItem error:', e.message); }
}

async function getBuybackItems(charId, npcId) {
    if (!pool) return [];
    if (typeof npcId === 'number' && isNaN(npcId)) return [];
    try {
        const [rows] = await pool.query(
            'SELECT id, item_id, charges, price FROM merchant_buyback WHERE character_id = ? AND npc_id = ? ORDER BY sold_at DESC',
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

const CHAR_CREATE_DEITY_NAMES = {
    201: 'Bertoxxulous', 202: 'Brell Serilis', 203: 'Cazic-Thule', 204: 'Erollisi Marr',
    205: 'Bristlebane', 206: 'Innoruuk', 207: 'Karana', 208: 'Mithaniel Marr',
    209: 'Prexus', 210: 'Quellious', 211: 'Rallos Zek', 212: 'Rodcet Nife',
    213: 'Solusek Ro', 214: 'The Tribunal', 215: 'Tunare', 216: 'Veeshan',
    396: 'Agnostic'
};

/**
 * Get all valid class/deity combos and their stat allocations for a given race.
 * Returns: { raceId, classes: [{ classId, className, deities, deityNames, allocation }] }
 */
async function getCharCreateData(raceId) {
    await init();
    const rid = parseInt(String(raceId ?? 1), 10) || 1;
    try {
        // Get all combos for this race with their stat allocation data
        const [rows] = await pool.query(`
            SELECT DISTINCT ccc.race, ccc.class, ccc.deity, ccc.allocation_id,
                   pa.base_str, pa.base_sta, pa.base_dex, pa.base_agi,
                   pa.base_int, pa.base_wis, pa.base_cha,
                   pa.alloc_str, pa.alloc_sta, pa.alloc_dex, pa.alloc_agi,
                   pa.alloc_int, pa.alloc_wis, pa.alloc_cha
            FROM char_create_combinations ccc
            LEFT JOIN char_create_point_allocations pa ON ccc.allocation_id = pa.id
            WHERE ccc.race = ?
            ORDER BY ccc.class, ccc.deity
        `, [rid]);

        // Group by class
        const classMap = {};
        for (const row of rows) {
            if (!classMap[row.class]) {
                const classKey = INV_CLASSES[row.class] || `class_${row.class}`;
                classMap[row.class] = {
                    classId: row.class,
                    className: classKey.charAt(0).toUpperCase() + classKey.slice(1).replace('_', ' '),
                    deities: new Set(),
                    allocation: {
                        id: row.allocation_id,
                        base_str: row.base_str || 75, base_sta: row.base_sta || 75,
                        base_dex: row.base_dex || 75, base_agi: row.base_agi || 75,
                        base_int: row.base_int || 75, base_wis: row.base_wis || 75,
                        base_cha: row.base_cha || 75,
                        alloc_str: row.alloc_str || 0, alloc_sta: row.alloc_sta || 0,
                        alloc_dex: row.alloc_dex || 0, alloc_agi: row.alloc_agi || 0,
                        alloc_int: row.alloc_int || 0, alloc_wis: row.alloc_wis || 0,
                        alloc_cha: row.alloc_cha || 0,
                    }
                };
            }
            if (row.deity) classMap[row.class].deities.add(row.deity);
        }

        // Convert Sets to arrays; deityNames matches what the Godot menu expects (see MainMenu.OnClassSelected)
        const classes = Object.values(classMap).map(c => {
            const deities = Array.from(c.deities).sort((a, b) => a - b);
            return {
                ...c,
                deities,
                deityNames: deities.map(id => ({
                    id,
                    name: CHAR_CREATE_DEITY_NAMES[id] || `Unknown (${id})`
                }))
            };
        });

        return { raceId: rid, classes };
    } catch (e) {
        console.error('[DB] getCharCreateData Error:', e.message);
        return { raceId: rid, classes: [] };
    }
}

// --- EQMUD Custom Spell/Buff Persistence ---

async function getCharacterSpellbook(charId) {
    if (!pool) return [];
    try {
        const [rows] = await pool.query('SELECT book_slot, spell_key, spell_id FROM character_spellbook WHERE char_id = ? ORDER BY book_slot', [charId]);
        return rows.map(r => ({ bookSlot: r.book_slot, spell_key: r.spell_key, id: r.spell_id }));
    } catch (e) {
        console.error('[DB] getCharacterSpellbook Error:', e.message);
        return [];
    }
}

async function saveCharacterSpellbook(charId, spellbook) {
    if (!pool || !spellbook || spellbook.length === 0) return;
    try {
        await pool.query('DELETE FROM character_spellbook WHERE char_id = ?', [charId]);
        const SpellDB = require('./data/spellDatabase');
        const values = spellbook.map(s => {
            const spellDef = SpellDB.getByKey(s.spell_key);
            const spellId = spellDef ? (spellDef._spellId || spellDef.id) : 0;
            const slot = (s.bookSlot !== undefined) ? s.bookSlot : s.slot;
            return [charId, slot, s.spell_key, spellId];
        });
        if (values.length > 0) {
            await pool.query('INSERT INTO character_spellbook (char_id, book_slot, spell_key, spell_id) VALUES ?', [values]);
        }
    } catch (e) {
        console.error('[DB] saveCharacterSpellbook Error:', e.message);
    }
}

async function getCharacterSpellLoadouts(charId) {
    if (!pool) return {};
    try {
        const [rows] = await pool.query('SELECT loadout_name, gem_data FROM character_spell_loadouts WHERE char_id = ?', [charId]);
        const loadouts = {};
        for (const r of rows) {
            loadouts[r.loadout_name] = r.gem_data;
        }
        return loadouts;
    } catch (e) {
        console.error('[DB] getCharacterSpellLoadouts Error:', e.message);
        return {};
    }
}

async function saveCharacterSpellLoadouts(charId, loadouts) {
    if (!pool || !loadouts) return;
    try {
        await pool.query('DELETE FROM character_spell_loadouts WHERE char_id = ?', [charId]);
        const keys = Object.keys(loadouts);
        if (keys.length === 0) return;
        const values = keys.map(k => [charId, k, JSON.stringify(loadouts[k])]);
        await pool.query('INSERT INTO character_spell_loadouts (char_id, loadout_name, gem_data) VALUES ?', [values]);
    } catch (e) {
        console.error('[DB] saveCharacterSpellLoadouts Error:', e.message);
    }
}

async function getCharacterBuffs(charId) {
    if (!pool) return [];
    try {
        const [rows] = await pool.query('SELECT * FROM character_buffs WHERE character_id = ?', [charId]);
        const restored = [];
        const SpellDB = require('./data/spellDatabase');
        
        for (const b of rows) {
            const spellDef = SpellDB.getById(b.spell_id);
            if (!spellDef) continue;
            
            restored.push({
                name: spellDef._key,
                duration: b.ticsremaining * 6, // Convert ticks back to seconds
                casterLevel: b.caster_level,
                casterName: b.caster_name,
                spellId: b.spell_id,
                beneficial: true // Assume beneficial for now or look up in spellDef
            });
        }
        return restored;
    } catch (e) {
        console.error('[DB] getCharacterBuffs Error:', e.message);
        return [];
    }
}

async function saveCharacterBuffs(charId, buffs) {
    if (!pool) return;
    try {
        await pool.query('DELETE FROM character_buffs WHERE character_id = ?', [charId]);
        if (!buffs || buffs.length === 0) return;
        
        const values = buffs.map((b, index) => [
            charId, 
            index, // slot_id
            b.spellId || 0,
            b.casterLevel || 1,
            b.casterName || 'Unknown',
            Math.floor(b.duration / 6), // ticsremaining
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 // fills for runes and other eqemu columns
        ]);
        
        await pool.query(`INSERT INTO character_buffs (
            character_id, slot_id, spell_id, caster_level, caster_name, ticsremaining,
            counters, numhits, melee_rune, magic_rune, persistent, dot_rune, 
            caston_x, caston_y, caston_z, ExtraDIChance, instrument_mod
        ) VALUES ?`, [values]);
    } catch (e) {
        console.error('[DB] saveCharacterBuffs Error:', e.message);
    }
}

async function rollLootFromTable(loottableId) {
    if (!pool || !loottableId) return { items: [], coins: 0 };
    try {
        // 1. Get coins from loottable
        const [ltRows] = await pool.query(`SELECT mincash, maxcash FROM loottable WHERE id = ?`, [loottableId]);
        let rolledCoins = 0;
        if (ltRows.length > 0) {
            const { mincash, maxcash } = ltRows[0];
            if (maxcash > mincash) {
                rolledCoins = Math.floor(Math.random() * (maxcash - mincash + 1)) + mincash;
            } else {
                rolledCoins = mincash;
            }
        }

        // 2. Get all lootdrops for this loottable
        const [entries] = await pool.query(`
            SELECT lte.lootdrop_id, lte.probability, lte.multiplier
            FROM loottable_entries lte
            WHERE lte.loottable_id = ?
        `, [loottableId]);

        const rolledItems = [];
        for (const entry of entries) {
            // Roll for the lootdrop itself
            if (Math.random() * 100 <= entry.probability) {
                // multiplier > 1 means multiple rolls on the same drop
                const count = entry.multiplier || 1;
                for (let i = 0; i < count; i++) {
                    // 3. Get items in this lootdrop
                    const [items] = await pool.query(`
                        SELECT item_id, item_charges, chance
                        FROM lootdrop_entries
                        WHERE lootdrop_id = ?
                    `, [entry.lootdrop_id]);

                    for (const item of items) {
                        if (Math.random() * 100 <= item.chance) {
                            rolledItems.push({
                                itemKey: item.item_id.toString(),
                                qty: item.item_charges || 1
                            });
                        }
                    }
                }
            }
        }
        return { items: rolledItems, coins: rolledCoins };
    } catch (e) {
        console.error('[DB] rollLootFromTable Error:', e.message);
        return { items: [], coins: 0 };
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
    splitStackToSlot,
    // Persistent corpses
    savePlayerCorpse,
    getPlayerCorpsesForZone,
    updatePlayerCorpse,
    deletePlayerCorpse,
    appendLootConsentForCharacterCorpses,
    removeLootConsentForCharacterCorpses,
    clearLootConsentForCharacterCorpses,
    refreshZoneRoutingCache,
    getZoneRoute,
    upsertZoneRoute,
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
    removeBuybackItem,
    updateCharacterBind,
    getCharacterStudents,
    createCharacterStudent,
    deleteCharacterStudent,
    getCharacterSpellbook,
    saveCharacterSpellbook,
    getCharacterSpellLoadouts,
    saveCharacterSpellLoadouts,
    getCharacterBuffs,
    saveCharacterBuffs,
    rollLootFromTable
  };


