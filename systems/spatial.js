const fs = require('fs');
const path = require('path');

const MAPS_DIR = path.join(__dirname, '..', 'data', 'maps');
const GRID_SIZE = 250; // Grid cell size in EQ units
const zoneMaps = {}; // zoneId -> { walls, grid, bounds }

/**
 * Loads and partitions a zone map for fast spatial queries.
 */
function loadZoneMap(zoneId) {
    if (zoneMaps[zoneId]) return zoneMaps[zoneId];

    const filePath = path.join(MAPS_DIR, `${zoneId}.json`);
    if (!fs.existsSync(filePath)) {
        // console.warn(`[SPATIAL] No map data for zone: ${zoneId}`);
        return null;
    }

    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const walls = data.walls || [];
        
        // Calculate bounds
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        walls.forEach(w => {
            minX = Math.min(minX, w.s[0], w.e[0]);
            maxX = Math.max(maxX, w.s[0], w.e[0]);
            minY = Math.min(minY, w.s[1], w.e[1]);
            maxY = Math.max(maxY, w.s[1], w.e[1]);
        });

        const grid = {}; // "x,y" -> [wallIndex, ...]
        
        // Partition walls into grid cells
        walls.forEach((w, idx) => {
            const xMin = Math.min(w.s[0], w.e[0]);
            const xMax = Math.max(w.s[0], w.e[0]);
            const yMin = Math.min(w.s[1], w.e[1]);
            const yMax = Math.max(w.s[1], w.e[1]);

            const gxStart = Math.floor(xMin / GRID_SIZE);
            const gxEnd = Math.floor(xMax / GRID_SIZE);
            const gyStart = Math.floor(yMin / GRID_SIZE);
            const gyEnd = Math.floor(yMax / GRID_SIZE);

            for (let gx = gxStart; gx <= gxEnd; gx++) {
                for (let gy = gyStart; gy <= gyEnd; gy++) {
                    const key = `${gx},${gy}`;
                    if (!grid[key]) grid[key] = [];
                    grid[key].push(idx);
                }
            }
        });

        zoneMaps[zoneId] = { walls, grid, bounds: { minX, maxX, minY, maxY } };
        console.log(`[SPATIAL] Loaded ${zoneId}: ${walls.length} walls, partitioned into ${Object.keys(grid).length} grid cells.`);
        return zoneMaps[zoneId];
    } catch (e) {
        console.error(`[SPATIAL] Error loading map ${zoneId}:`, e.message);
        return null;
    }
}

/**
 * Line-segment intersection test (2D)
 */
function intersects(p1, p2, p3, p4) {
    const det = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p4[0] - p3[0]) * (p2[1] - p1[1]);
    if (det === 0) return false;
    const lambda = ((p4[1] - p3[1]) * (p4[0] - p1[0]) + (p3[0] - p4[0]) * (p4[1] - p1[1])) / det; // Wait, formula check
    // Standard segment intersection
    const x1 = p1[0], y1 = p1[1], x2 = p2[0], y2 = p2[1];
    const x3 = p3[0], y3 = p3[1], x4 = p4[0], y4 = p4[1];
    
    const uA = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / ((y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1));
    const uB = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / ((y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1));

    return (uA >= 0 && uA <= 1 && uB >= 0 && uB <= 1);
}

/**
 * Checks if there is a clear Line of Sight between two points in a zone.
 * Returns true if LOS is clear, false if blocked by a wall.
 * Currently only performs 2D (XY) checks.
 */
function hasLineOfSight(zoneId, x1, y1, x2, y2, z1, z2) {
    const map = loadZoneMap(zoneId);
    if (!map) return true; // If no map, default to clear (or you can default to blocked)

    const p1 = [x1, y1];
    const p2 = [x2, y2];

    // Determine grid cells to check
    const gxStart = Math.floor(Math.min(x1, x2) / GRID_SIZE);
    const gxEnd = Math.floor(Math.max(x1, x2) / GRID_SIZE);
    const gyStart = Math.floor(Math.min(y1, y2) / GRID_SIZE);
    const gyEnd = Math.floor(Math.max(y1, y2) / GRID_SIZE);

    const checkedWallIndices = new Set();

    for (let gx = gxStart; gx <= gxEnd; gx++) {
        for (let gy = gyStart; gy <= gyEnd; gy++) {
            const cellWalls = map.grid[`${gx},${gy}`];
            if (!cellWalls) continue;

            for (const wallIdx of cellWalls) {
                if (checkedWallIndices.has(wallIdx)) continue;
                checkedWallIndices.add(wallIdx);

                const wall = map.walls[wallIdx];
                
                // If the wall has Z-height data, check if the LOS path passes through it vertically.
                // However, most EQ zone files (especially JSON exports) often only have 2D walls for LoS.
                // If wall.minZ and wall.maxZ exist, we could do a 3D check.
                if (intersects(p1, p2, wall.s, wall.e)) {
                    // 2D intersection found. 
                    // If we have Z data for the wall, check if the LOS line's Z at intersection is within wall's Z range.
                    if (wall.minZ !== undefined && wall.maxZ !== undefined && z1 !== undefined && z2 !== undefined) {
                        // Calculate where on the segment [p1, p2] the intersection with [wall.s, wall.e] occurs.
                        // uA from the intersects function (which we should probably refactor to return uA).
                        const x1_ = p1[0], y1_ = p1[1], x2_ = p2[0], y2_ = p2[1];
                        const x3_ = wall.s[0], y3_ = wall.s[1], x4_ = wall.e[0], y4_ = wall.e[1];
                        const den = ((y4_ - y3_) * (x2_ - x1_) - (x4_ - x3_) * (y2_ - y1_));
                        if (den !== 0) {
                            const uA = ((x4_ - x3_) * (y1_ - y3_) - (y4_ - y3_) * (x1_ - x3_)) / den;
                            const intersectZ = z1 + uA * (z2 - z1);
                            if (intersectZ >= wall.minZ && intersectZ <= wall.maxZ) {
                                return false; // Blocked vertically too!
                            }
                            // Otherwise, it passes above or below the wall.
                            continue;
                        }
                    }
                    return false; // Blocked! (Defaulting to 2D block if no Z data)
                }
            }
        }
    }

    return true; // Clear!
}

module.exports = {
    loadZoneMap,
    hasLineOfSight
};
