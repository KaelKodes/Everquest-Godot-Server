const mysql = require('mysql2/promise');

async function checkSchema() {
    try {
        const pool = mysql.createPool({
            host: '127.0.0.1',
            port: 3307,
            user: 'eqemu',
            password: 'bHqIbrW81WLuaZ4qaQGrRViIHHvz9nR',
            database: 'peq',
            connectTimeout: 5000
        });

        console.log("Connected! Fetching schemas...");
        
        const tables = ['character_skills', 'character_spells', 'character_data', 'inventory', 'zone'];
        for (const table of tables) {
            try {
                const [rows] = await pool.query(`DESCRIBE ${table}`);
                console.log(`\n--- Schema for ${table} ---`);
                console.table(rows);
            } catch (e) {
                console.log(`Table ${table} not found or error: ${e.message}`);
            }
        }
        
        pool.end();
    } catch (e) {
        console.error("Database not ready yet:", e.message);
    }
}

checkSchema();
