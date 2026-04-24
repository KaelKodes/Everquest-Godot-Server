const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
async function run() {
    const SQL = await initSqlJs();
    const DB_PATH = path.join(__dirname, 'eqmud.db');
    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        const db = new SQL.Database(buffer);
        db.run('DELETE FROM spells;');
        const data = db.export();
        fs.writeFileSync(DB_PATH, Buffer.from(data));
        console.log("Spells cleared.");
    }
}
run();
