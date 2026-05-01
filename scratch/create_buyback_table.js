const mysql = require('mysql2/promise');
require('dotenv').config();

async function createTable() {
    const pool = mysql.createPool({
        host: process.env.EQEMU_HOST || '127.0.0.1',
        port: process.env.EQEMU_PORT || 3307,
        user: process.env.EQEMU_USER || 'eqemu',
        password: process.env.EQEMU_PASSWORD || 'bHqIbrW81WLuaZ4qaQGrRViIHHvz9nR',
        database: process.env.EQEMU_DATABASE || 'peq',
    });

    try {
        const query = `
            CREATE TABLE IF NOT EXISTS merchant_buyback (
                id INT AUTO_INCREMENT PRIMARY KEY,
                char_id INT NOT NULL,
                npc_id INT NOT NULL,
                item_id INT NOT NULL,
                charges INT DEFAULT 1,
                price INT NOT NULL,
                sold_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_char_npc (char_id, npc_id)
            );
        `;
        await pool.query(query);
        console.log('merchant_buyback table created or verified.');
    } catch (e) {
        console.error('Error creating table:', e);
    } finally {
        await pool.end();
    }
}

createTable();
