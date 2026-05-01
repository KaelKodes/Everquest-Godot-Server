const mysql = require('mysql2/promise');
require('dotenv').config();

async function describeTables() {
    const pool = mysql.createPool({
        host: process.env.EQEMU_HOST || '127.0.0.1',
        port: process.env.EQEMU_PORT || 3307,
        user: process.env.EQEMU_USER || 'eqemu',
        password: process.env.EQEMU_PASSWORD || 'bHqIbrW81WLuaZ4qaQGrRViIHHvz9nR',
        database: process.env.EQEMU_DATABASE || 'peq',
    });

    try {
        const queries = [
            'DESCRIBE faction_list;',
            'DESCRIBE faction_values;',
            'DESCRIBE faction_base_data;',
            'DESCRIBE npc_faction;',
            'DESCRIBE npc_faction_entries;'
        ];
        
        for (const q of queries) {
            try {
                const [res] = await pool.query(q);
                console.log(`\n--- ${q} ---`);
                console.table(res);
            } catch (e) {
                console.error(`Error executing ${q}: ${e.message}`);
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

describeTables();
