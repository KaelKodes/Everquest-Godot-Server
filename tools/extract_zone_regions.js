/**
 * Extract zone line trigger volumes from EQ S3D files.
 * Uses the correct WLD fragment layout from LanternExtractor source:
 *  - Fragment 0x29 (BspRegionType): defines region type via name string, links to 0x22 indices
 *  - Fragment 0x22 (BspRegion): contains region vertices that form the trigger volume
 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function decompressPFS(buf) {
  const dirOff = buf.readUInt32LE(0);
  let off = dirOff;
  const fc = buf.readUInt32LE(off); off += 4;
  const entries = [];
  for (let i = 0; i < fc; i++) { off += 4; const d = buf.readUInt32LE(off); off += 4; const s = buf.readUInt32LE(off); off += 4; entries.push({ d, s }); }
  
  const files = [];
  for (const e of entries) {
    let p = e.d; const chunks = []; let total = 0;
    while (total < e.s && p < buf.length - 8) {
      const dl = buf.readUInt32LE(p); p += 4; p += 4; // skip inflated length
      if (dl <= 0 || dl > 5000000) break;
      try { const inf = zlib.inflateSync(buf.slice(p, p + dl)); chunks.push(inf); total += inf.length; } catch (e) { break; }
      p += dl;
    }
    if (chunks.length > 0) files.push(Buffer.concat(chunks));
  }
  return files;
}

function findZoneWLD(files) {
  for (const data of files) {
    if (data.length > 28 && data.readUInt32LE(0) === 0x54503D02 && data.readUInt32LE(12) > 0) return data;
  }
  return null;
}

// Decode WLD encoded strings (same XOR key as string hash)
function decodeWldString(bytes) {
  const key = [0x95, 0x3A, 0xC5, 0x2A, 0x95, 0x7A, 0x95, 0x6A];
  const out = Buffer.alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ key[i % 8];
  // Trim null terminator
  let end = out.indexOf(0);
  if (end === -1) end = out.length;
  return out.toString('ascii', 0, end);
}

function parseWLD(data) {
  let offset = 0;
  offset += 4; // magic
  offset += 4; // version
  const fragCount = data.readUInt32LE(offset); offset += 4;
  offset += 4; // regionCount
  offset += 4; // unk1
  const hashSize = data.readUInt32LE(offset); offset += 4;
  offset += 4; // unk2

  // Decode string hash
  const hashBuf = Buffer.alloc(hashSize);
  data.copy(hashBuf, 0, offset, offset + hashSize);
  const key = [0x95, 0x3A, 0xC5, 0x2A, 0x95, 0x7A, 0x95, 0x6A];
  for (let i = 0; i < hashSize; i++) hashBuf[i] ^= key[i % 8];
  offset += hashSize;

  function str(ref) {
    if (ref >= 0) return `FRAG${ref}`;
    const s = -ref; let e = s;
    while (e < hashBuf.length && hashBuf[e] !== 0) e++;
    return hashBuf.toString('ascii', s, e);
  }

  // Parse all fragments
  const frags = [];
  for (let i = 0; i < fragCount; i++) {
    if (offset + 12 > data.length) break;
    const sz = data.readUInt32LE(offset); offset += 4;
    const type = data.readUInt32LE(offset); offset += 4;
    const nameRef = data.readInt32LE(offset); offset += 4;
    const fd = data.slice(offset, offset + sz - 4);
    offset += sz - 4;
    frags.push({ idx: i + 1, type, name: str(nameRef), data: fd });
  }

  console.log(`WLD: ${frags.length} fragments`);

  // ── Parse 0x22 (BspRegion): extract vertices ──
  const bspRegions = [];
  for (const frag of frags) {
    if (frag.type !== 0x22) continue;
    const fd = frag.data;
    let fo = 0;

    const flags = fd.readUInt32LE(fo); fo += 4;

    // Parse flag bits (from LanternExtractor)
    const hasSphere = (flags & 1) !== 0;
    const hasReverbVolume = (flags & 2) !== 0;
    const hasReverbOffset = (flags & 4) !== 0;
    const hasLegacyMeshRef = (flags & 64) !== 0;
    const hasByteEntries = (flags & 128) !== 0;
    const hasMeshRef = (flags & 256) !== 0;

    // 9 int32 fields
    const ambientLight = fd.readInt32LE(fo); fo += 4;
    const numRegionVertex = fd.readInt32LE(fo); fo += 4;
    const numProximalRegions = fd.readInt32LE(fo); fo += 4;
    const numRenderVertices = fd.readInt32LE(fo); fo += 4;
    const numWalls = fd.readInt32LE(fo); fo += 4;
    const numObstacles = fd.readInt32LE(fo); fo += 4;
    const numCuttingObstacles = fd.readInt32LE(fo); fo += 4;
    const numVisNode = fd.readInt32LE(fo); fo += 4;
    const numVisList = fd.readInt32LE(fo); fo += 4;

    // Read region vertices (3 floats each)
    const vertices = [];
    for (let v = 0; v < numRegionVertex; v++) {
      if (fo + 12 > fd.length) break;
      vertices.push([fd.readFloatLE(fo), fd.readFloatLE(fo + 4), fd.readFloatLE(fo + 8)]);
      fo += 12;
    }

    const bspData = { name: frag.name, vertices, flags, numWalls, numObstacles };
    frag.bspData = bspData;
    bspRegions.push(bspData);
  }

  console.log(`Parsed ${bspRegions.length} BSP regions`);

  // ── Parse 0x29 (BspRegionType): links region type to BSP regions ──
  const zoneLineRegions = [];
  
  for (const frag of frags) {
    if (frag.type !== 0x29) continue;
    const fd = frag.data;
    let fo = 0;

    const flags = fd.readInt32LE(fo); fo += 4;
    const regionCount = fd.readInt32LE(fo); fo += 4;

    const regionIndices = [];
    for (let r = 0; r < regionCount; r++) {
      if (fo + 4 > fd.length) break;
      regionIndices.push(fd.readInt32LE(fo)); fo += 4;
    }

    // Read region string
    if (fo + 4 > fd.length) continue;
    const strSize = fd.readInt32LE(fo); fo += 4;
    let regionTypeString = '';
    if (strSize > 0 && fo + strSize <= fd.length) {
      regionTypeString = decodeWldString(fd.slice(fo, fo + strSize)).toLowerCase();
    } else {
      regionTypeString = frag.name.toLowerCase();
    }

    // Check if this is a zone line
    const isZoneLine = regionTypeString.startsWith('drntp') || 
                       regionTypeString.startsWith('wtntp') ||
                       regionTypeString.startsWith('lantp');

    if (isZoneLine) {
      console.log(`\nZoneLine 0x29: "${regionTypeString}" → links to ${regionCount} BSP regions: [${regionIndices.join(',')}]`);

      // Parse zone line info from the string
      let zlInfo = {};
      if (regionTypeString === 'drntp_zone') {
        zlInfo = { type: 'reference', index: 0 };
      } else if (regionTypeString.length >= 10) {
        const zoneId = parseInt(regionTypeString.substring(5, 10));
        if (zoneId === 255 && regionTypeString.length >= 16) {
          const zlIndex = parseInt(regionTypeString.substring(10, 16));
          zlInfo = { type: 'reference', index: zlIndex };
        } else {
          zlInfo = { type: 'absolute', zoneId };
          if (regionTypeString.length >= 28) {
            const parseVal = (s) => s.startsWith('-') ? -parseFloat(s.substring(1)) : parseFloat(s);
            zlInfo.x = parseVal(regionTypeString.substring(10, 16));
            zlInfo.y = parseVal(regionTypeString.substring(16, 22));
            zlInfo.z = parseVal(regionTypeString.substring(22, 28));
          }
          if (regionTypeString.length >= 31) {
            zlInfo.heading = parseInt(regionTypeString.substring(28, 31));
          }
        }
      }

      // Collect all vertices from linked fragments
      const allVerts = [];
      for (const ri of regionIndices) {
        // ri is often a fragment index (1-indexed)
        const targetFrag = frags.find(f => f.idx === ri);
        if (targetFrag) {
          console.log(`    Target fragment ${ri}: type=0x${targetFrag.type.toString(16)} name="${targetFrag.name}"`);
          if (targetFrag.type === 0x22 && targetFrag.bspData) {
            allVerts.push(...targetFrag.bspData.vertices);
          }
        } else {
          console.log(`    Target fragment ${ri} NOT FOUND`);
        }
      }

      if (allVerts.length > 0) {
        const minX = Math.min(...allVerts.map(v => v[0]));
        const maxX = Math.max(...allVerts.map(v => v[0]));
        const minY = Math.min(...allVerts.map(v => v[1]));
        const maxY = Math.max(...allVerts.map(v => v[1]));
        const minZ = Math.min(...allVerts.map(v => v[2]));
        const maxZ = Math.max(...allVerts.map(v => v[2]));

        console.log(`  ${allVerts.length} vertices`);
        console.log(`  EQ bounds: X=[${minX.toFixed(1)}, ${maxX.toFixed(1)}] Y=[${minY.toFixed(1)}, ${maxY.toFixed(1)}] Z=[${minZ.toFixed(1)}, ${maxZ.toFixed(1)}]`);
        console.log(`  EQ center: (${((minX+maxX)/2).toFixed(1)}, ${((minY+maxY)/2).toFixed(1)}, ${((minZ+maxZ)/2).toFixed(1)})`);
        console.log(`  Size: ${(maxX-minX).toFixed(1)} x ${(maxY-minY).toFixed(1)} x ${(maxZ-minZ).toFixed(1)}`);

        zoneLineRegions.push({
          name: regionTypeString,
          zlInfo,
          vertices: allVerts,
          eq_min: [minX, minY, minZ],
          eq_max: [maxX, maxY, maxZ],
          eq_center: [(minX+maxX)/2, (minY+maxY)/2, (minZ+maxZ)/2],
          // Convert to Godot: GodotX = -EQ.X, GodotZ = -EQ.Y, GodotY = EQ.Z
          godot_center: [-(minX+maxX)/2, (minZ+maxZ)/2, -(minY+maxY)/2],
          godot_min: [-maxX, minZ, -maxY],
          godot_max: [-minX, maxZ, -minY],
        });
      }
    }
  }

  return zoneLineRegions;
}

// ── Main ──────────────────────────────────────────────────────────
const s3dPath = process.argv[2] || 'D:\\EQ\\crushbone.s3d';
console.log(`Parsing ${s3dPath}...\n`);

const buf = fs.readFileSync(s3dPath);
const files = decompressPFS(buf);
const wld = findZoneWLD(files);
if (!wld) { console.error('No zone WLD found!'); process.exit(1); }
console.log(`Zone WLD: ${wld.length} bytes`);

const zoneLines = parseWLD(wld);
console.log(`\n========================================`);
console.log(`Total zone line triggers: ${zoneLines.length}`);
console.log(`========================================`);

for (const zl of zoneLines) {
  console.log(`\n${zl.name}:`);
  console.log(`  Zone info:`, JSON.stringify(zl.zlInfo));
  console.log(`  EQ center: (${zl.eq_center.map(v=>v.toFixed(1)).join(', ')})`);
  console.log(`  EQ min: (${zl.eq_min.map(v=>v.toFixed(1)).join(', ')})`);
  console.log(`  EQ max: (${zl.eq_max.map(v=>v.toFixed(1)).join(', ')})`);
  console.log(`  Godot center: (${zl.godot_center.map(v=>v.toFixed(1)).join(', ')})`);
  console.log(`  Godot min: (${zl.godot_min.map(v=>v.toFixed(1)).join(', ')})`);
  console.log(`  Godot max: (${zl.godot_max.map(v=>v.toFixed(1)).join(', ')})`);
}

// Write JSON output
const outPath = s3dPath.replace('.s3d', '_zonelines.json');
fs.writeFileSync(outPath, JSON.stringify(zoneLines, null, 2));
console.log(`\nWrote ${outPath}`);
