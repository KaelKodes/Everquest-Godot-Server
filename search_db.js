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
        const [rows] = await pool.query("SHOW COLUMNS FROM spells_new");
        const cols = rows.map(r => r.Field);
        console.log(cols.filter(c => c.includes('anim') || c.includes('effect') || c.includes('part') || c.includes('visual') || c.includes('icon')));
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
getCols();
