/**
 * Batch extract zone line trigger volumes from ALL EQ S3D files.
 * 
 * Pipeline:
 *   1. Find all zone .s3d files in the EQ directory
 *   2. Run LanternExtractor on each to get bsp_tree.txt
 *   3. Parse BSP tree for Zoneline leaf nodes
 *   4. Traverse BSP tree to compute AABB bounds for each zone line
 *   5. Write combined zone_triggers.json
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const EQ_DIR = 'D:\\EQ';
const LANTERN_EXE = path.join(__dirname, 'LanternExtractor', 'LanternExtractor.exe');
const LANTERN_DIR = path.join(__dirname, 'LanternExtractor');
const EXPORTS_DIR = path.join(LANTERN_DIR, 'Exports');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'zone_triggers.json');

// Character/object S3D files that are NOT zones (skip these)
const SKIP_PATTERNS = [
  /^global/i, /^chequip/i, /^load2/i, /_chr\.s3d$/i, /_obj\.s3d$/i,
  /_2_obj/i, /_amr\.s3d$/i, /^snd/i, /^music/i, /_sounds?\./i,
  /_lit\.s3d$/i, /_env\.s3d$/i, /^sky/i, /_pfs\.s3d$/i
];

function isZoneS3D(filename) {
  const lower = filename.toLowerCase();
  if (!lower.endsWith('.s3d')) return false;
  for (const pat of SKIP_PATTERNS) {
    if (pat.test(lower)) return false;
  }
  // Zone files are typically just "zonename.s3d"
  // Skip files with underscores that indicate sub-assets (except some like "north_karana.s3d")
  return true;
}

function getZoneName(filename) {
  return filename.replace(/\.s3d$/i, '').toLowerCase();
}

// ── BSP Tree Parser ──────────────────────────────────────────────

function parseBspTree(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'));

  const nodes = [];
  for (const line of lines) {
    const parts = line.trim().split(',');
    // Normal node: 6 numeric fields (NormalX, NormalY, NormalZ, SplitDistance, LeftNodeId, RightNodeId)
    if (parts.length >= 6 && !isNaN(parseFloat(parts[0])) && !isNaN(parseFloat(parts[3])) && !isNaN(parseInt(parts[4]))) {
      const left = parseInt(parts[4]);
      const right = parseInt(parts[5]);
      // Verify this looks like a split node (left/right are node indices or -1)
      if (!isNaN(left) && !isNaN(right)) {
        nodes.push({
          type: 'split',
          nx: parseFloat(parts[0]),
          ny: parseFloat(parts[1]),
          nz: parseFloat(parts[2]),
          d: parseFloat(parts[3]),
          left, right
        });
        continue;
      }
    }
    // Leaf node: BSPRegionId, RegionType[, extra...]
    const regionId = parseInt(parts[0]);
    const regionType = (parts[1] || 'Normal').trim();
    nodes.push({ type: 'leaf', regionId, regionType, extra: parts.slice(2).map(s => s.trim()) });
  }

  return nodes;
}

function findZonelineLeaves(nodes) {
  const leaves = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.type === 'leaf' && n.regionType === 'Zoneline') {
      leaves.push({ index: i, ...n });
    }
  }
  return leaves;
}

function findLeafPath(nodes, targetIndex) {
  const path = [];
  function go(idx, depth) {
    if (depth > 500 || idx < 0 || idx >= nodes.length) return false;
    const n = nodes[idx];
    if (n.type === 'leaf') return idx === targetIndex;
    if (n.left >= 0) {
      path.push({ nx: n.nx, ny: n.ny, nz: n.nz, d: n.d, side: 'front' });
      if (go(n.left, depth + 1)) return true;
      path.pop();
    }
    if (n.right >= 0) {
      path.push({ nx: n.nx, ny: n.ny, nz: n.nz, d: n.d, side: 'back' });
      if (go(n.right, depth + 1)) return true;
      path.pop();
    }
    return false;
  }
  go(0, 0);
  return [...path];
}

function computeAABB(constraints) {
  let xMin = -50000, xMax = 50000;
  let yMin = -50000, yMax = 50000;
  let zMin = -50000, zMax = 50000;

  for (const c of constraints) {
    const anx = Math.abs(c.nx), any = Math.abs(c.ny), anz = Math.abs(c.nz);
    // EQ BSP: front side means nx*x + ny*y + nz*z + d >= 0
    // So for dominant axis: x >= -d/nx (if nx > 0, front side)
    if (anx > 0.95) {
      const val = -c.d / c.nx;
      if (c.side === 'front') { if (c.nx > 0) xMin = Math.max(xMin, val); else xMax = Math.min(xMax, val); }
      else { if (c.nx > 0) xMax = Math.min(xMax, val); else xMin = Math.max(xMin, val); }
    } else if (any > 0.95) {
      const val = -c.d / c.ny;
      if (c.side === 'front') { if (c.ny > 0) yMin = Math.max(yMin, val); else yMax = Math.min(yMax, val); }
      else { if (c.ny > 0) yMax = Math.min(yMax, val); else yMin = Math.max(yMin, val); }
    } else if (anz > 0.95) {
      const val = -c.d / c.nz;
      if (c.side === 'front') { if (c.nz > 0) zMin = Math.max(zMin, val); else zMax = Math.min(zMax, val); }
      else { if (c.nz > 0) zMax = Math.min(zMax, val); else zMin = Math.max(zMin, val); }
    }
  }

  return { xMin, xMax, yMin, yMax, zMin, zMax };
}

// ── Main ──────────────────────────────────────────────────────────

console.log('=== Batch Zone Line Extraction ===\n');

// Find all S3D files
const s3dFiles = fs.readdirSync(EQ_DIR).filter(f => isZoneS3D(f)).sort();
console.log(`Found ${s3dFiles.length} potential zone S3D files in ${EQ_DIR}\n`);

const allTriggers = {};
let totalZones = 0;
let zonesWithZL = 0;
let totalZonelines = 0;
let errors = 0;

for (const s3dFile of s3dFiles) {
  const zoneName = getZoneName(s3dFile);

  // Run LanternExtractor
  try {
    execSync(`"${LANTERN_EXE}" ${zoneName}`, {
      cwd: LANTERN_DIR,
      stdio: 'pipe',
      timeout: 30000
    });
  } catch (e) {
    // LanternExtractor may fail for non-zone files or unsupported formats
    continue;
  }

  totalZones++;

  // Check for BSP tree output
  const bspPath = path.join(EXPORTS_DIR, zoneName, 'Zone', 'bsp_tree.txt');
  if (!fs.existsSync(bspPath)) {
    continue; // No BSP tree = not a proper zone or no BSP data
  }

  // Parse BSP tree
  let nodes;
  try {
    nodes = parseBspTree(bspPath);
  } catch (e) {
    console.log(`  ✗ ${zoneName}: BSP parse error: ${e.message}`);
    errors++;
    continue;
  }

  if (nodes.length === 0) continue;

  // Find zone line leaves
  const zlLeaves = findZonelineLeaves(nodes);
  if (zlLeaves.length === 0) continue;

  // Group zone line leaves by referenceIndex
  const grouped = {};
  for (const leaf of zlLeaves) {
    // Extract reference index from extra data
    let refType = 'unknown';
    let refIndex = 0;
    if (leaf.extra.length >= 1) refType = leaf.extra[0];
    if (leaf.extra.length >= 2) refIndex = parseInt(leaf.extra[1]) || 0;
    
    const key = `${refType}_${refIndex}`;
    if (!grouped[key]) grouped[key] = { refType, refIndex, leaves: [] };
    grouped[key].leaves.push(leaf);
  }

  // Compute merged AABB for each zone line group
  const zoneTriggers = [];

  for (const [key, group] of Object.entries(grouped)) {
    const allBounds = [];
    
    for (const leaf of group.leaves) {
      const constraints = findLeafPath(nodes, leaf.index);
      if (constraints.length === 0) continue;
      
      const aabb = computeAABB(constraints);
      // Skip degenerate AABBs (bounds still at initial values)
      if (aabb.xMin >= aabb.xMax || aabb.yMin >= aabb.yMax || aabb.zMin >= aabb.zMax) continue;
      // Skip unreasonably large AABBs (> 5000 units on any axis = not properly constrained)
      if ((aabb.xMax - aabb.xMin) > 5000 || (aabb.yMax - aabb.yMin) > 5000 || (aabb.zMax - aabb.zMin) > 5000) continue;
      
      allBounds.push(aabb);
    }

    if (allBounds.length === 0) continue;

    // Merge all leaf AABBs into one trigger volume
    const merged = {
      xMin: Math.min(...allBounds.map(b => b.xMin)),
      xMax: Math.max(...allBounds.map(b => b.xMax)),
      yMin: Math.min(...allBounds.map(b => b.yMin)),
      yMax: Math.max(...allBounds.map(b => b.yMax)),
      zMin: Math.min(...allBounds.map(b => b.zMin)),
      zMax: Math.max(...allBounds.map(b => b.zMax)),
    };

    // BSP coords → EQ /loc coords mapping:
    // eq_center.x = BSP Z center, eq_center.y = BSP X center, eq_center.z = BSP Y center
    // (BSP internal → EQ loc: x↔z swapped, same Y)
    // Actually from our Crushbone test, the mapping was direct:
    // DB.x ≈ BSP.Z, DB.y ≈ BSP.X, DB.z ≈ BSP.Y
    // But the AABB is passed raw to the client which does its own transform.
    // So we store in the same coord system as the BSP (which is the same as EQ internal rendering coords)
    // and let the client convert.
    
    // For the server matching and client display, we use EQ /loc convention:
    // eq_center/min/max: x = BSP.Z, y = BSP.X, z = BSP.Y
    zoneTriggers.push({
      referenceIndex: group.refIndex,
      referenceType: group.refType,
      eq_center: {
        x: round((merged.zMin + merged.zMax) / 2),
        y: round((merged.xMin + merged.xMax) / 2),
        z: round((merged.yMin + merged.yMax) / 2)
      },
      eq_min: {
        x: round(merged.zMin),
        y: round(merged.xMin),
        z: round(merged.yMin)
      },
      eq_max: {
        x: round(merged.zMax),
        y: round(merged.xMax),
        z: round(merged.yMax)
      },
      eq_size: {
        width: round(merged.zMax - merged.zMin),
        depth: round(merged.xMax - merged.xMin),
        height: round(merged.yMax - merged.yMin)
      }
    });

    totalZonelines++;
  }

  if (zoneTriggers.length > 0) {
    allTriggers[zoneName] = zoneTriggers;
    zonesWithZL++;
    console.log(`  ✓ ${zoneName}: ${zoneTriggers.length} zone line(s) — ${zlLeaves.length} BSP leaves`);
  }
}

function round(v) { return Math.round(v * 10) / 10; }

// Write output
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allTriggers, null, 2));

console.log('\n========================================');
console.log(`  Processed: ${totalZones} zones`);
console.log(`  With zone lines: ${zonesWithZL} zones`);
console.log(`  Total zone lines: ${totalZonelines}`);
console.log(`  Errors: ${errors}`);
console.log(`  Output: ${OUTPUT_FILE}`);
console.log('========================================');
