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
        const [doors] = await pool.query("SELECT * FROM doors WHERE zone = 'qeynos' OR zone = 'Qeynos' OR zone = 'qeynos2' LIMIT 5");
        console.log("Qeynos doors:", doors.length);
        if (doors.length > 0) {
            console.log("First door:", doors[0].name, doors[0].zone);
        }
        
        const [doors_case] = await pool.query("SELECT DISTINCT zone FROM doors LIMIT 10");
        console.log("Distinct zones in doors:", doors_case.map(d => d.zone).join(', '));
        pool.end();
    } catch(e) {
        console.log(e);
    }
}
check();
