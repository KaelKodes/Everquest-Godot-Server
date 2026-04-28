/**
 * Generate face variant GLBs for EQ character models.
 * 
 * EQ texture naming convention for heads:
 *   {race}hesk{face}{piece}.png
 *   - face = 0-9 (face index)
 *   - piece = 1-8 (texture piece within that face)
 *   
 * Example: ikmhesk01 = Iksar male, face 0, piece 1
 *          ikmhesk31 = Iksar male, face 3, piece 1
 * 
 * The base GLB contains face 0 textures. For each additional face index
 * that has textures available, we create a variant GLB by swapping
 * the head textures (hesk0X -> heskNX).
 * 
 * Usage: node generate_face_variants.js [raceCode] [textureDir]
 * Example: node generate_face_variants.js ikm globalikm
 */

const { NodeIO } = require('@gltf-transform/core');
const fs = require('fs');
const path = require('path');

const CHARACTERS_DIR = path.join(__dirname, '..', '..', 'eqmud', 'Data', 'Characters');
const EXPORTS_BASE = path.join(__dirname, 'LanternExtractor', 'Exports');

async function generateFaceVariants(raceCode, exportDir) {
  const io = new NodeIO();
  const baseGlbPath = path.join(CHARACTERS_DIR, `${raceCode}.glb`);
  
  if (!fs.existsSync(baseGlbPath)) {
    console.error(`Base GLB not found: ${baseGlbPath}`);
    return;
  }

  // Find the texture directory
  const texDir = path.join(EXPORTS_BASE, exportDir, 'Characters', 'Textures');
  if (!fs.existsSync(texDir)) {
    console.error(`Texture directory not found: ${texDir}`);
    return;
  }

  // Scan for available face indices by looking at head textures
  const headTexPattern = new RegExp(`^${raceCode}hesk(\\d)(\\d)\\.png$`, 'i');
  const texFiles = fs.readdirSync(texDir);
  
  // Build a map: faceIndex -> { piece -> filePath }
  const faceMap = {};
  for (const file of texFiles) {
    const match = file.match(headTexPattern);
    if (match) {
      const faceIdx = parseInt(match[1]);
      const pieceIdx = parseInt(match[2]);
      if (!faceMap[faceIdx]) faceMap[faceIdx] = {};
      faceMap[faceIdx][pieceIdx] = path.join(texDir, file);
    }
  }

  const faceIndices = Object.keys(faceMap).map(Number).sort();
  console.log(`${raceCode}: Found ${faceIndices.length} face indices: ${faceIndices.join(', ')}`);
  console.log(`  Face 0 pieces: ${Object.keys(faceMap[0] || {}).join(', ')}`);

  if (faceIndices.length <= 1) {
    console.log(`  Only 1 face variant — no additional GLBs needed.`);
    return;
  }

  // Read the base GLB
  const baseDoc = await io.read(baseGlbPath);
  const baseTextures = baseDoc.getRoot().listTextures();
  
  // Find which textures in the base GLB are "head" textures (face 0)
  const headTexNames = baseTextures
    .filter(t => t.getName().match(new RegExp(`^${raceCode}hesk0\\d$`, 'i')))
    .map(t => t.getName());
  
  console.log(`  Base GLB head textures: ${headTexNames.join(', ')}`);
  
  if (headTexNames.length === 0) {
    console.log(`  No face-0 head textures found in base GLB — skipping.`);
    return;
  }

  // For each non-zero face index, create a variant GLB
  let generated = 0;
  for (const faceIdx of faceIndices) {
    if (faceIdx === 0) continue; // face 0 = base model
    
    const outPath = path.join(CHARACTERS_DIR, `${raceCode}_${String(faceIdx - 1).padStart(2, '0')}.glb`);
    
    // Clone the base document
    const doc = await io.read(baseGlbPath);
    const textures = doc.getRoot().listTextures();
    
    let swapped = 0;
    for (const tex of textures) {
      const texName = tex.getName();
      // Match head texture: {race}hesk0{piece}
      const match = texName.match(new RegExp(`^${raceCode}hesk0(\\d)$`, 'i'));
      if (match) {
        const piece = match[1];
        const newTexName = `${raceCode}hesk${faceIdx}${piece}`;
        const newTexPath = faceMap[faceIdx]?.[parseInt(piece)];
        
        if (newTexPath && fs.existsSync(newTexPath)) {
          const imgData = fs.readFileSync(newTexPath);
          tex.setImage(new Uint8Array(imgData));
          tex.setMimeType('image/png');
          swapped++;
        }
        // If the replacement texture doesn't exist for this piece, keep the original
      }
    }
    
    if (swapped > 0) {
      await io.write(outPath, doc);
      console.log(`  Face ${faceIdx} -> ${path.basename(outPath)} (${swapped} textures swapped)`);
      generated++;
    } else {
      console.log(`  Face ${faceIdx} -> skipped (no replacement textures found)`);
    }
  }
  
  console.log(`  Generated ${generated} face variant GLBs for ${raceCode}`);
  return generated;
}

// ── Main ──

(async () => {
  // Define all races that need face variants generated
  // Format: [raceCode, exportDirName]
  const RACE_CONFIGS = [
    // Expansion races (newly extracted)
    ['ikm', 'globalikm'],
    ['ikf', 'globalikf'],
    ['kem', 'globalkem'],
    ['kef', 'globalkef'],
    ['frm', 'globalpcfroglok'],
    ['frf', 'globalpcfroglok'],
    // Classic races that may be missing variants (re-extract if needed)
    // Uncomment to regenerate classic race face variants:
    // ['hum', 'globalhum'],
    // ['huf', 'globalhuf'],
    // etc.
  ];

  // Allow running for a specific race from CLI
  const targetRace = process.argv[2];
  const targetDir = process.argv[3];
  
  if (targetRace && targetDir) {
    await generateFaceVariants(targetRace, targetDir);
  } else if (targetRace) {
    const config = RACE_CONFIGS.find(c => c[0] === targetRace);
    if (config) {
      await generateFaceVariants(config[0], config[1]);
    } else {
      console.error(`Unknown race code: ${targetRace}`);
      console.log('Available:', RACE_CONFIGS.map(c => c[0]).join(', '));
    }
  } else {
    // Run all expansion races
    let total = 0;
    for (const [code, dir] of RACE_CONFIGS) {
      const count = await generateFaceVariants(code, dir);
      total += count || 0;
    }
    console.log(`\nTotal face variant GLBs generated: ${total}`);
  }
})();
