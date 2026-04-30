const mariadb = require('mysql2/promise');
async function run() {
    const conn = await mariadb.createConnection({host: '127.0.0.1', user: 'eqemu', password: 'bHqIbrW81WLuaZ4qaQGrRViIHHvz9nR', database: 'peq', port: 3307});
    const rows = await conn.query("SELECT * FROM doors WHERE zone = 'gfaydark' AND pos_x BETWEEN 200 AND 250 AND pos_y BETWEEN 100 AND 150");
    console.log(rows);
    await conn.end();
}
run();
