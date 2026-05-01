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
        const [rows] = await pool.query("SELECT short_name, zoneidnumber FROM zone WHERE short_name = 'qeynos'");
        const zoneIdNumber = rows[0].zoneidnumber;
        const [grids] = await pool.query("SELECT * FROM grid_entries WHERE zoneid = ? LIMIT 10", [zoneIdNumber]);
        console.log(grids);
        pool.end();
    } catch(e) {
        console.log(e);
    }
}
check();
