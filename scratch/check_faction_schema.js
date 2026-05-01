const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkSchema() {
    const pool = mysql.createPool({
        host: process.env.EQEMU_HOST || '127.0.0.1',
        port: process.env.EQEMU_PORT || 3307,
        user: process.env.EQEMU_USER || 'eqemu',
        password: process.env.EQEMU_PASSWORD || 'bHqIbrW81WLuaZ4qaQGrRViIHHvz9nR',
        database: process.env.EQEMU_DATABASE || 'peq',
    });

    try {
        const [rows] = await pool.query("SHOW TABLES LIKE 'faction%';");
        console.log('Tables:', rows);
        
        const [charFactions] = await pool.query("SHOW TABLES LIKE 'faction_values%';");
        console.log('Faction Values Tables:', charFactions);

        const [npcFaction] = await pool.query("DESCRIBE npc_types;");
        console.log('NPC Types columns:', npcFaction.filter(c => c.Field.includes('faction')));
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

checkSchema();
