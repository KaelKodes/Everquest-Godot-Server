const fs = require('fs');
const path = require('path');

const files = [
    { json: 'qhills_final.json', js: 'mobs/qeynos_hills.js' },
    { json: 'wkarana_final.json', js: 'mobs/west_karana.js' },
    { json: 'nkarana_final.json', js: 'mobs/north_karana.js' }
];

const dataPath = path.join(__dirname, '../data');

files.forEach(f => {
    const jsonPath = path.join(dataPath, f.json);
    const jsPath = path.join(dataPath, f.js);
    
    if (fs.existsSync(jsonPath)) {
        let content = fs.readFileSync(jsonPath, 'utf8');
        // Strip BOM if present
        if (content.charCodeAt(0) === 0xFEFF) {
            content = content.slice(1);
        }
        // Strip the first line if it's a comment
        const lines = content.split('\n');
        if (lines[0].trim().startsWith('//')) {
            lines.shift();
        }
        const data = JSON.parse(lines.join('\n'));
        
        const moduleContent = `module.exports = ${JSON.stringify(data, null, 2)};`;
        fs.writeFileSync(jsPath, moduleContent);
        console.log(`Converted ${f.json} to ${f.js}`);
    } else {
        console.error(`File not found: ${jsonPath}`);
    }
});
