const mysql = require('mysql2/promise'); 
async function check() { 
    const pool = mysql.createPool({host: '127.0.0.1', port: 3307, user: 'eqemu', password: 'bHqIbrW81WLuaZ4qaQGrRViIHHvz9nR', database: 'peq'}); 
    const [doors] = await pool.query("SELECT * FROM doors WHERE zone = 'gfaydark'"); 
    console.log(JSON.stringify(doors, null, 2)); 
    pool.end(); 
} check();
