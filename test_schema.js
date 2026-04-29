const mysql = require('mysql2/promise');

async function check() {
    const pool = mysql.createPool({
        host: '127.0.0.1',
        port: 3307,
        user: 'eqemu',
        password: 'bHqIbrW81WLuaZ4qaQGrRViIHHvz9nR',
        database: 'peq',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });

    try {
        const [rows] = await pool.query('SELECT * FROM spawn2 LIMIT 1');
        console.log("SPAWN2 COLUMNS:", Object.keys(rows[0]));
        const [grids] = await pool.query('SELECT * FROM grid_entries LIMIT 1');
        console.log("GRID_ENTRIES COLUMNS:", Object.keys(grids[0]));
        pool.end();
    } catch(e) {
        console.log(e);
    }
}
check();
