const fs = require('fs');
const path = require('path');
const { ITEMS } = require('../data/items');

const mobsDir = path.join(__dirname, '../data/mobs');
const files = fs.readdirSync(mobsDir).filter(f => f.endsWith('.js'));

const missingItems = {};

files.forEach(f => {
    const mobs = require(path.join(mobsDir, f));
    mobs.forEach(mob => {
        if (!mob.loot) return;
        mob.loot.forEach(loot => {
            const key = loot.itemKey;
            if (!ITEMS[key] && !missingItems[key]) {
                // Generate a pretty name from the key
                const name = key.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
                missingItems[key] = {
                    name: name,
                    type: 'loot',
                    slot: 0,
                    weight: 0.1,
                    value: Math.floor(mob.level * 0.5) || 1
                };
            }
        });
    });
});

const output = `// --- Automatically Generated Supplemental Items ---
module.exports = ${JSON.stringify(missingItems, null, 2)};
`;

fs.writeFileSync(path.join(__dirname, '../data/items_supplemental.js'), output);
console.log(`Generated items_supplemental.js with ${Object.keys(missingItems).length} items.`);
