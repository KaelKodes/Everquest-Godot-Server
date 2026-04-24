const fs = require('fs');
const path = require('path');

function parseBrewallMap(inputPath, outputPath) {
    if (!fs.existsSync(inputPath)) {
        console.error(`Error: File not found at ${inputPath}`);
        return;
    }

    const content = fs.readFileSync(inputPath, 'utf-8');
    const lines = content.split(/\r?\n/);
    
    const mapData = {
        lines: [],
        points: []
    };

    let lineCount = 0;

    lines.forEach(lineStr => {
        const trimmed = lineStr.trim();
        if (!trimmed) return;

        if (trimmed.startsWith('L ')) {
            // Format: L x1, y1, z1, x2, y2, z2, r, g, b
            const parts = trimmed.substring(2).split(',').map(s => s.trim());
            if (parts.length >= 9) {
                mapData.lines.push({
                    start: [parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2])],
                    end: [parseFloat(parts[3]), parseFloat(parts[4]), parseFloat(parts[5])],
                    color: [parseInt(parts[6], 10), parseInt(parts[7], 10), parseInt(parts[8], 10)]
                });
                lineCount++;
            }
        } else if (trimmed.startsWith('P ')) {
            // Format: P x, y, z, r, g, b, size, label
            const match = trimmed.match(/^P\s+([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(.*)$/);
            if (match) {
                mapData.points.push({
                    pos: [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])],
                    color: [parseInt(match[4], 10), parseInt(match[5], 10), parseInt(match[6], 10)],
                    size: parseInt(match[7], 10),
                    label: match[8].replace(/^"|"$/g, '')
                });
            }
        }
    });

    console.log(`Parsed ${lineCount} lines and ${mapData.points.length} points.`);
    
    // Categorize lines based on color for easier use in Godot/Server
    const categorized = {
        walls: [],     // Black/Dark 0,0,0
        paths: [],     // Gray/Brown/White
        water: [],     // Blueish
        danger: [],    // Red
        doors: [],     // Door colors or interactive objects depending on map
        other: []
    };

    mapData.lines.forEach(line => {
        const [r, g, b] = line.color;
        
        // Basic heuristic for color categorization
        if (r === 0 && g === 0 && b === 0) {
            categorized.walls.push(line);
        } else if (b > r + 50 && b > g + 50) {
            // Blue dominant -> Water
            categorized.water.push(line);
        } else if (r > g + 100 && r > b + 100) {
            // Red dominant -> Danger / Zone lines / Doors
            categorized.danger.push(line);
        } else if (r > 100 && Math.abs(r - g) < 30 && Math.abs(r - b) < 30) {
            // Grays / Paths
            categorized.paths.push(line);
        } else {
            categorized.other.push(line);
        }
    });

    // Compute bounding box from all line segments
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    mapData.lines.forEach(line => {
        for (const p of [line.start, line.end]) {
            if (p[0] < minX) minX = p[0];
            if (p[0] > maxX) maxX = p[0];
            if (p[1] < minY) minY = p[1];
            if (p[1] > maxY) maxY = p[1];
        }
    });
    const bounds = {
        minX, maxX, minY, maxY,
        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2,
        spanX: maxX - minX,
        spanY: maxY - minY
    };
    console.log(`Bounds: X(${minX} to ${maxX}), Y(${minY} to ${maxY}), Center(${bounds.centerX}, ${bounds.centerY})`);

    const finalOutput = {
        bounds: bounds,
        categorizedLines: categorized,
        points: mapData.points
    };

    fs.writeFileSync(outputPath, JSON.stringify(finalOutput, null, 2));
    console.log(`Saved map data to ${outputPath}`);
}

const args = process.argv.slice(2);
if (args.length < 2) {
    console.log("Usage: node parse_brewall.js <input_txt_file> <output_json_file>");
    process.exit(1);
}

parseBrewallMap(args[0], args[1]);
