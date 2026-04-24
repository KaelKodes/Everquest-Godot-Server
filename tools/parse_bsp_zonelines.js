/**
 * Parse LanternExtractor BSP tree output and compute AABB bounds for zone line regions.
 * The BSP tree partitions space via half-planes. Each leaf's bounding volume is the
 * intersection of all the half-planes on the path from root to that leaf.
 */
const fs = require('fs');

const lines = fs.readFileSync('D:\\Kael Kodes\\EQMUD\\server\\tools\\LanternExtractor\\Exports\\crushbone\\Zone\\bsp_tree.txt', 'utf-8')
  .split('\n').filter(l => l.trim() && !l.startsWith('#'));

// Parse the BSP tree
const nodes = [];
for (const line of lines) {
  const parts = line.trim().split(',');
  
  if (parts.length >= 6) {
    // Normal node: NormalX, NormalY, NormalZ, SplitDistance, LeftNodeId, RightNodeId
    nodes.push({
      type: 'split',
      normalX: parseFloat(parts[0]),
      normalY: parseFloat(parts[1]),
      normalZ: parseFloat(parts[2]),
      splitDist: parseFloat(parts[3]),
      left: parseInt(parts[4]),
      right: parseInt(parts[5])
    });
  } else {
    // Leaf node: BSPRegionId, RegionType[, ...extra]
    const regionId = parseInt(parts[0]);
    const regionType = parts[1] || 'Normal';
    const extra = parts.slice(2);
    nodes.push({ type: 'leaf', regionId, regionType: regionType.trim(), extra });
  }
}

console.log(`Parsed ${nodes.length} BSP nodes`);

// Find all Zoneline leaves
const zlLeaves = [];
for (let i = 0; i < nodes.length; i++) {
  const n = nodes[i];
  if (n.type === 'leaf' && n.regionType === 'Zoneline') {
    zlLeaves.push({ index: i, ...n });
    console.log(`Zoneline leaf: node ${i}, regionId=${n.regionId}, extra=${n.extra.join(',')}`);
  }
}

// Traverse BSP tree to find paths to zone line leaves and compute bounds
// We'll use the splitting planes to narrow down the AABB

function findLeafBounds(targetIndex) {
  // Trace from root (node 0) to the target leaf
  // At each split node, going LEFT means dot(point, normal) >= splitDist
  // Going RIGHT means dot(point, normal) < splitDist
  
  const constraints = [];
  
  function traverse(nodeIdx, depth) {
    if (depth > 100) return false; // safety
    const node = nodes[nodeIdx];
    
    if (!node) return false;
    
    if (node.type === 'leaf') {
      return nodeIdx === targetIndex;
    }
    
    // Try left child
    if (node.left >= 0 && node.left < nodes.length) {
      constraints.push({
        normalX: node.normalX, normalY: node.normalY, normalZ: node.normalZ,
        splitDist: node.splitDist, side: 'left' // >= splitDist
      });
      if (traverse(node.left, depth + 1)) return true;
      constraints.pop();
    }
    
    // Try right child (right == -1 means null)
    if (node.right >= 0 && node.right < nodes.length) {
      constraints.push({
        normalX: node.normalX, normalY: node.normalY, normalZ: node.normalZ,
        splitDist: node.splitDist, side: 'right' // < splitDist
      });
      if (traverse(node.right, depth + 1)) return true;
      constraints.pop();
    }
    
    return false;
  }
  
  if (traverse(0, 0)) {
    return [...constraints];
  }
  return null;
}

// For each zone line leaf, find constraints and compute approximate AABB
const results = [];

for (const zl of zlLeaves) {
  const constraints = findLeafBounds(zl.index);
  if (!constraints) {
    console.log(`Could not find path to leaf ${zl.index}`);
    continue;
  }
  
  console.log(`\nZoneline leaf ${zl.index} (region ${zl.regionId}): ${constraints.length} splitting planes`);
  
  // Extract axis-aligned constraints for an approximate AABB
  // Each constraint: normal·point >= splitDist (left) or < splitDist (right)
  let minX = -10000, maxX = 10000;
  let minY = -10000, maxY = 10000;
  let minZ = -10000, maxZ = 10000;
  
  for (const c of constraints) {
    const nx = Math.abs(c.normalX);
    const ny = Math.abs(c.normalY);
    const nz = Math.abs(c.normalZ);
    
    // Only use constraints where the normal is mostly axis-aligned
    if (nx > 0.9 && ny < 0.1 && nz < 0.1) {
      // X-axis constraint
      const val = c.splitDist / c.normalX; // actual X position
      if (c.side === 'left') {
        // point.X * normalX >= splitDist → point.X >= splitDist/normalX (if normalX > 0)
        if (c.normalX > 0) minX = Math.max(minX, val);
        else maxX = Math.min(maxX, val);
      } else {
        if (c.normalX > 0) maxX = Math.min(maxX, val);
        else minX = Math.max(minX, val);
      }
    }
    else if (ny > 0.9 && nx < 0.1 && nz < 0.1) {
      // Y-axis constraint  
      const val = c.splitDist / c.normalY;
      if (c.side === 'left') {
        if (c.normalY > 0) minY = Math.max(minY, val);
        else maxY = Math.min(maxY, val);
      } else {
        if (c.normalY > 0) maxY = Math.min(maxY, val);
        else minY = Math.max(minY, val);
      }
    }
    else if (nz > 0.9 && nx < 0.1 && ny < 0.1) {
      // Z-axis constraint
      const val = c.splitDist / c.normalZ;
      if (c.side === 'left') {
        if (c.normalZ > 0) minZ = Math.max(minZ, val);
        else maxZ = Math.min(maxZ, val);
      } else {
        if (c.normalZ > 0) maxZ = Math.min(maxZ, val);
        else minZ = Math.max(minZ, val);
      }
    }
  }
  
  console.log(`  EQ AABB: X=[${minX.toFixed(1)}, ${maxX.toFixed(1)}] Y=[${minY.toFixed(1)}, ${maxY.toFixed(1)}] Z=[${minZ.toFixed(1)}, ${maxZ.toFixed(1)}]`);
  console.log(`  Width: ${(maxX-minX).toFixed(1)}, Depth: ${(maxY-minY).toFixed(1)}, Height: ${(maxZ-minZ).toFixed(1)}`);
  
  // Convert to Godot coords: GodotX = -EQ.Y, GodotY = EQ.Z, GodotZ = -EQ.X
  // Wait, from our previous convention: Godot.X = -EQ.X, Godot.Z = -EQ.Y, Godot.Y = EQ.Z
  // Actually EQ uses (Y=north, X=east, Z=up) and GLB/Godot uses (X=east, Y=up, Z=south)
  // But our zone_points DB uses EQ coords where the conversion was: server X→Godot X, server Y→Godot Z(negated), Z→Y
  // Let me output raw EQ coords and we'll map them in gameEngine.js
  
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;
  
  results.push({
    regionId: zl.regionId,
    type: 'Zoneline',
    referenceIndex: zl.extra.length >= 2 ? parseInt(zl.extra[1]) : 0,
    eq_center: [centerX, centerY, centerZ],
    eq_min: [minX, minY, minZ],
    eq_max: [maxX, maxY, maxZ],
    eq_size: [maxX - minX, maxY - minY, maxZ - minZ]
  });
}

// Merge overlapping zone line regions into one bounding box
if (results.length > 0) {
  const merged = {
    referenceIndex: results[0].referenceIndex,
    eq_min: [
      Math.min(...results.map(r => r.eq_min[0])),
      Math.min(...results.map(r => r.eq_min[1])),
      Math.min(...results.map(r => r.eq_min[2]))
    ],
    eq_max: [
      Math.max(...results.map(r => r.eq_max[0])),
      Math.max(...results.map(r => r.eq_max[1])),
      Math.max(...results.map(r => r.eq_max[2]))
    ]
  };
  merged.eq_center = merged.eq_min.map((v, i) => (v + merged.eq_max[i]) / 2);
  merged.eq_size = merged.eq_min.map((v, i) => merged.eq_max[i] - v);
  
  console.log('\n========================================');
  console.log('MERGED ZONE LINE TRIGGER VOLUME:');
  console.log('========================================');
  console.log(`  EQ center: (${merged.eq_center.map(v => v.toFixed(1)).join(', ')})`);
  console.log(`  EQ min: (${merged.eq_min.map(v => v.toFixed(1)).join(', ')})`);
  console.log(`  EQ max: (${merged.eq_max.map(v => v.toFixed(1)).join(', ')})`);
  console.log(`  EQ size: ${merged.eq_size.map(v => v.toFixed(1)).join(' x ')}`);
  console.log(`\nDB zone_point center: (163, -632, 3.13)`);
  console.log(`Difference from DB: X=${(merged.eq_center[0]-163).toFixed(1)}, Y=${(merged.eq_center[1]-(-632)).toFixed(1)}, Z=${(merged.eq_center[2]-3.13).toFixed(1)}`);
}

// Write output
const outPath = 'D:\\Kael Kodes\\EQMUD\\server\\tools\\crushbone_zonelines.json';
fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`\nWrote ${outPath}`);
