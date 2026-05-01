const fs = require('fs');
const parsed = JSON.parse(fs.readFileSync('d:\\Kael Kodes\\EQMUD\\server\\data\\spells_parsed.json', 'utf8')).spells;
const classic = require('d:\\Kael Kodes\\EQMUD\\server\\data\\spells_classic.json').spells;

const names = ['Lull', 'Minor Shielding', 'Strengthen', 'Shallow Breath', 'Weaken', 'Illusion: Centaur', 'Illusion: Ogre Pirate', "Pendril's Animation"];

console.log('--- PARSED ---');
for(const n of names) {
    const s = Object.values(parsed).find(x => x.name===n);
    if(s) console.log(n, 'memIcon:', s.visual.memIcon, 'adjusted:', s.visual.memIcon - 2001);
}

console.log('--- CLASSIC ---');
for(const n of names) {
    const s = Object.values(classic).find(x => x.name===n);
    if(s) console.log(n, 'memIcon:', s.visual.memIcon);
}
