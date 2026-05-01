const mysql = require('mysql2/promise');
require('dotenv').config();

async function sampleData() {
    const pool = mysql.createPool({
        host: process.env.EQEMU_HOST || '127.0.0.1',
        port: process.env.EQEMU_PORT || 3307,
        user: process.env.EQEMU_USER || 'eqemu',
        password: process.env.EQEMU_PASSWORD || 'bHqIbrW81WLuaZ4qaQGrRViIHHvz9nR',
        database: process.env.EQEMU_DATABASE || 'peq',
    });

    try {
        console.log("--- faction_list Sample ---");
        const [fList] = await pool.query('SELECT * FROM faction_list LIMIT 5;');
        console.table(fList);

        console.log("--- npc_faction Sample ---");
        const [nFac] = await pool.query('SELECT * FROM npc_faction LIMIT 5;');
        console.table(nFac);
        
        console.log("--- npc_faction_entries Sample ---");
        const [nFacEnt] = await pool.query('SELECT * FROM npc_faction_entries LIMIT 5;');
        console.table(nFacEnt);

        console.log("--- faction_list_mod Sample ---");
        const [fListMod] = await pool.query('SELECT * FROM faction_list_mod LIMIT 5;');
        console.table(fListMod);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

sampleData();
