const mysql = require('mysql2/promise');
async function run() {
    const pool = mysql.createPool({ 
        host: '127.0.0.1', 
        port: 3307,
        user: 'eqemu', 
        password: 'bHqIbrW81WLuaZ4qaQGrRViIHHvz9nR', 
        database: 'peq' 
    });
    
    try {
        const [cols] = await pool.query('DESCRIBE spawn2');
        console.log("spawn2 columns:", cols.map(c => c.Field).join(", "));
        
        const [gCols] = await pool.query('DESCRIBE grid');
        console.log("grid columns:", gCols.map(c => c.Field).join(", "));
        
        const [geCols] = await pool.query('DESCRIBE grid_entries');
        console.log("grid_entries columns:", geCols.map(c => c.Field).join(", "));
    } catch(e) { console.log(e.message); }
    process.exit();
}
run();
