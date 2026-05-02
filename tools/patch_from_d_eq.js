const fs = require('fs');
const jsonPath = '../data/spells_parsed.json';
const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const spells = data.spells;

const spellMap = {};
for (let i = 0; i < spells.length; i++) {
    spellMap[spells[i].id] = i;
}

const lines = fs.readFileSync('D:/EQ/spells_us.txt', 'utf8').split(/\r?\n/);
let count = 0;

for (const line of lines) {
    if (!line.trim()) continue;
    const f = line.split('^');
    if (f.length < 76) continue;

    const id = parseInt(f[0], 10);
    const icon = parseInt(f[74], 10);
    const memIcon = parseInt(f[75], 10);

    const sIndex = spellMap[id];
    if (sIndex !== undefined) {
        spells[sIndex].visual.icon = icon;
        spells[sIndex].visual.memIcon = memIcon;
        count++;
    }
}

fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
console.log('Updated ' + count + ' from D:/EQ/spells_us.txt');
