const mysql = require('mysql2/promise');
async function run() {
    const conn = await mysql.createConnection({ host: '127.0.0.1', user: 'root', password: 'eq', database: 'peq', port: 3306 });
    const [rows] = await conn.query("SELECT * FROM doors WHERE zone = 'gfaydark' AND name LIKE '%ELEVATOR%' OR name LIKE '%LIFT%'");
    console.log(JSON.stringify(rows, null, 2));
    await conn.end();
    process.exit(0);
}
run();
