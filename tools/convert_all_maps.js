const fs = require('fs');
const path = require('path');

// Configuration
const MAPS_DIR = 'd:\\everquest_rof2\\everquest_rof2\\maps';
const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'maps');

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function parseBrewallMap(inputPath, outputPath) {
    if (!fs.existsSync(inputPath)) return;

    const content = fs.readFileSync(inputPath, 'utf-8');
    const lines = content.split(/\r?\n/);
    
    const walls = [];

    lines.forEach(lineStr => {
        const trimmed = lineStr.trim();
        if (!trimmed || !trimmed.startsWith('L ')) return;

        // Format: L y1, x1, z1, y2, x2, z2, r, g, b
        const parts = trimmed.substring(2).split(',').map(s => s.trim());
        if (parts.length >= 9) {
            const r = parseInt(parts[6], 10);
            const g = parseInt(parts[7], 10);
            const b = parseInt(parts[8], 10);

            // Only include walls (typically black/dark)
            // Color 0,0,0 is a wall. 64,64,64 is also often a wall/outline.
            if ((r === 0 && g === 0 && b === 0) || (r === 64 && g === 64 && b === 64)) {
                walls.push({
                    s: [parseFloat(parts[1]), parseFloat(parts[0])], // [X, Y]
                    e: [parseFloat(parts[4]), parseFloat(parts[3])]  // [X, Y]
                });
            }
        }
    });

    if (walls.length === 0) return;

    // Optional: simplify or bound the map here if needed
    fs.writeFileSync(outputPath, JSON.stringify({ walls }, null, 0)); // Minified JSON
    console.log(`Converted ${path.basename(inputPath)}: ${walls.length} segments`);
}

const files = fs.readdirSync(MAPS_DIR).filter(f => f.endsWith('.txt'));
console.log(`Found ${files.length} map files.`);

files.forEach(file => {
    const zoneName = file.replace('.txt', '');
    const outPath = path.join(OUTPUT_DIR, `${zoneName}.json`);
    parseBrewallMap(path.join(MAPS_DIR, file), outPath);
});

console.log('Done!');
