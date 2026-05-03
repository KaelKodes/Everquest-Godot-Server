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
        const [rows] = await pool.query('SHOW TABLES LIKE "book%"');
        console.log("TABLES:", rows);
        
        if (rows.length > 0) {
            const tableName = Object.values(rows[0])[0];
            const [cols] = await pool.query(`SHOW COLUMNS FROM ${tableName}`);
            console.log(`COLUMNS in ${tableName}:`, cols.map(c => c.Field).join(', '));
            
            const [books] = await pool.query(`SELECT * FROM ${tableName} LIMIT 1`);
            console.log("SAMPLE BOOK:");
            console.log(books);
        }
    } catch(e) {
        console.error(e);
    }
    process.exit(0);
}

test();
