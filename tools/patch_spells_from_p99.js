const fs = require('fs');

function patchSpells() {
    console.log("Loading spells_parsed.json...");
    const jsonPath = './data/spells_parsed.json';
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const spells = data.spells;

    console.log("Loading P99 spells_us.txt...");
    const p99Path = '../P99FilesV62/spells_us.txt';
    const lines = fs.readFileSync(p99Path, 'utf8').split('\n');

    let updatedCount = 0;

    for (const line of lines) {
        if (!line.trim()) continue;
        const fields = line.split('^');
        if (fields.length < 58) continue;

        const spellIdStr = fields[0];
        const icon = parseInt(fields[56], 10);
        const memIcon = parseInt(fields[57], 10);

        const spellId = parseInt(spellIdStr, 10);
        const spellKey = Object.keys(spells).find(k => spells[k].id === spellId);

        if (spellKey) {
            const oldIcon = spells[spellKey].visual.icon;
            const oldMemIcon = spells[spellKey].visual.memIcon;
            
            spells[spellKey].visual.icon = icon;
            spells[spellKey].visual.memIcon = memIcon;
            
            if (oldIcon !== icon || oldMemIcon !== memIcon) {
                updatedCount++;
            }
        }
    }

    console.log(`Updated ${updatedCount} spell icons from P99 spells_us.txt.`);
    
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
    console.log("Saved patched spells to spells_parsed.json");
}

patchSpells();
