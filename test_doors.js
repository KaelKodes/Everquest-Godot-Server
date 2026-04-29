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
        const [rows] = await pool.query("SELECT doorid, name FROM doors WHERE zone = 'felwithea'");
        for(let r of rows) {
            console.log(`Door ${r.doorid}: ${r.name}`);
        }
        pool.end();
    } catch(e) {
        console.log(e);
    }
}
check();
