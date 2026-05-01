const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    try {
        const [rows] = await pool.query(`
            SELECT s2.x, s2.y, s2.z 
            FROM spawn2 s2 
            JOIN spawnentry se ON s2.spawngroupID = se.spawngroupID 
            JOIN npc_types n ON se.npcID = n.id 
            WHERE n.name = 'Guard_Orcflayer'
        `);
        console.table(rows);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

run();
