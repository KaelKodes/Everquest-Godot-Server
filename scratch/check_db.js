const mysql = require('mysql2/promise');
require('dotenv').config();

async function check() {
    const pool = mysql.createPool({
        host: process.env.EQEMU_HOST || '127.0.0.1',
        port: process.env.EQEMU_PORT || 3307,
        user: process.env.EQEMU_USER || 'eqemu',
        password: process.env.EQEMU_PASSWORD,
        database: process.env.EQEMU_DATABASE || 'peq'
    });

    const tables = ['character_spellbook', 'character_spell_loadouts', 'character_buffs', 'faction_values'];
    
    for (const table of tables) {
        try {
            const [rows] = await pool.query(`DESCRIBE ${table}`);
            console.log(`Table: ${table}`);
            rows.forEach(r => console.log(`  - ${r.Field}`));
        } catch (e) {
            console.log(`Table ${table} error: ${e.message}`);
        }
    }
    process.exit(0);
}

check();
