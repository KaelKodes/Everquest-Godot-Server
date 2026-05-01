require('dotenv').config({ path: './.env' });
const mysql = require('mysql2/promise');
const fs = require('fs');

async function patchSpells() {
    console.log("Loading spells_parsed.json...");
    const jsonPath = './data/spells_parsed.json';
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const spells = data.spells;

    console.log("Connecting to TAKP database...");
    const pool = mysql.createPool({
        host: process.env.EQEMU_HOST || '127.0.0.1',
        port: process.env.EQEMU_PORT || 3307,
        user: process.env.EQEMU_USER || 'eqemu',
        password: process.env.EQEMU_PASSWORD,
        database: 'takp'
    });

    try {
        const [rows] = await pool.query('SELECT id, icon, new_icon FROM spells_new');
        let updatedCount = 0;

        for (const row of rows) {
            const spellId = row.id.toString();
            if (spells[spellId]) {
                const oldIcon = spells[spellId].visual.icon;
                const oldMemIcon = spells[spellId].visual.memIcon;
                
                spells[spellId].visual.icon = row.icon;
                spells[spellId].visual.memIcon = row.new_icon;
                
                if (oldIcon !== row.icon || oldMemIcon !== row.new_icon) {
                    updatedCount++;
                }
            }
        }

        console.log(`Updated ${updatedCount} spell icons from TAKP database.`);
        
        fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
        console.log("Saved patched spells to spells_parsed.json");

    } catch (err) {
        console.error("Database error:", err);
    } finally {
        await pool.end();
    }
}

patchSpells();
