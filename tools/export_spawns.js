const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function runQuery(sql) {
    const command = `wsl docker exec 426398ed577e mysql -ueqemu -pbHqIbrW81WLuaZ4qaQGrRViIHHvz9nR peq -e "${sql}"`;
    try {
        const output = execSync(command).toString();
        const lines = output.trim().split('\n');
        if (lines.length <= 1) return [];
        
        const headers = lines[0].split('\t');
        const results = [];
        for (let i = 1; i < lines.length; i++) {
            const row = lines[i].split('\t');
            const obj = {};
            headers.forEach((h, idx) => {
                obj[h] = row[idx];
            });
            results.push(obj);
        }
        return results;
    } catch (e) {
        console.error("Query failed:", e.message);
        return [];
    }
}

function exportSpawns(dbShortName, mudShortName) {
    console.log(`[*] Exporting spawns for ${mudShortName}...`);
    
    const spawns = runQuery(`SELECT s.id, s.x, s.y, s.z, s.spawngroupID, nt.name as npc_name FROM spawn2 s JOIN spawnentry se ON s.spawngroupID = se.spawngroupID JOIN npc_types nt ON se.npcID = nt.id WHERE s.zone = '${dbShortName}' GROUP BY s.id;`);

    const formattedSpawns = spawns.map(s => ({
        id: s.id,
        npcKey: s.npc_name.toLowerCase(),
        x: parseFloat(s.x),
        y: parseFloat(s.y),
        z: parseFloat(s.z)
    }));

    const outPath = path.join(__dirname, '..', 'data', 'spawns', `${mudShortName}.js`);
    const outDir = path.dirname(outPath);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const content = `module.exports = ${JSON.stringify(formattedSpawns, null, 2)};`;
    fs.writeFileSync(outPath, content);
    console.log(`[+] Exported ${formattedSpawns.length} spawns to ${outPath}`);
}

const args = process.argv.slice(2);
if (args.length >= 2) {
    exportSpawns(args[0], args[1]);
} else {
    console.log("Usage: node export_spawns.js <db_short_name> <mud_short_name>");
}
