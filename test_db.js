const mysql = require('mysql2/promise');

async function test() {
    const db = await mysql.createConnection({
        host: '127.0.0.1',
        port: 3307,
        user: 'eqemu',
        password: 'bHqIbrW81WLuaZ4qaQGrRViIHHvz9nR',
        database: 'peq'
    });

    const [rows] = await db.query(`DESCRIBE inventory`);
    
    console.log(rows);
    db.end();
}

test();
