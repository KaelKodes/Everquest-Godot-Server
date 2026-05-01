const fs = require('fs');

const parsedPath = 'd:\\Kael Kodes\\EQMUD\\server\\data\\spells_parsed.json';
const eqPath = 'D:\\EQ\\spells_us.txt';

const spellsData = JSON.parse(fs.readFileSync(parsedPath, 'utf8'));
const eqLines = fs.readFileSync(eqPath, 'utf8').split('\r\n');

// Create a lookup map for fast ID access
const spellMap = {};
for (let i = 0; i < spellsData.spells.length; i++) {
    spellMap[spellsData.spells[i].id] = spellsData.spells[i];
}

let updated = 0;

for (const line of eqLines) {
    if (!line || line.trim() === '') continue;
    const cols = line.split('^');
    if (cols.length < 76) continue;

    const id = parseInt(cols[0], 10);
    const memIcon = parseInt(cols[75], 10);

    if (!isNaN(id) && spellMap[id]) {
        if (!spellMap[id].visual) {
            spellMap[id].visual = {};
        }
        spellMap[id].visual.memIcon = memIcon;
        updated++;
    }
}

fs.writeFileSync(parsedPath, JSON.stringify(spellsData, null, 2));
console.log(`Successfully fixed and updated ${updated} spells with accurate memIcon mapping!`);
