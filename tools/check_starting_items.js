const mysql = require('mysql2/promise');

async function test() {
    const pool = mysql.createPool({
        host: '127.0.0.1',
        port: 3307,
        user: 'eqemu',
        password: 'bHqIbrW81WLuaZ4qaQGrRViIHHvz9nR',
        database: 'peq'
    });

    try {
        const [rows] = await pool.query('SHOW COLUMNS FROM starting_items');
        console.log("COLUMNS:");
        console.log(rows.map(r => r.Field).join(', '));
        
        const [items] = await pool.query('SELECT * FROM starting_items LIMIT 5');
        console.log("SAMPLE:");
        console.log(items);
    } catch(e) {
        console.error(e);
    }
    process.exit(0);
}

test();
