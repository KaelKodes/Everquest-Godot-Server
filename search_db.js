const mysql = require('mysql2/promise');

async function getCols() {
    const pool = mysql.createPool({
        host: '127.0.0.1',
        port: 3307,
        user: 'eqemu',
        password: 'bHqIbrW81WLuaZ4qaQGrRViIHHvz9nR',
        database: 'peq'
    });

    try {
        const [rows] = await pool.query("SHOW TABLES LIKE '%merc%'");
        console.log("Tables:", rows);
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
getCols();
