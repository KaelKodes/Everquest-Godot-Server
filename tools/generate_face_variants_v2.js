/**
 * Generate face variant GLBs by swapping the main head texture (humhe0001)
 * in the ORIGINAL animated GLB with face-specific textures from the export.
 * 
 * This preserves all animations (43 for human male) while changing the face.
 * 
 * Mapping: GLB texture "XXXhe0001" = main face skin
 *   -> swapped with export texture "XXXhesk{face}1.png" for each face > 0
 * 
 * Usage: node generate_face_variants_v2.js <raceCode> <exportDir>
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
    console.error(`  Base GLB not found: ${baseGlbPath}`);
    return 0;
  }

  const texDir = path.join(EXPORTS_BASE, exportDir, 'Characters', 'Textures');
  if (!fs.existsSync(texDir)) {
    console.error(`  Texture directory not found: ${texDir}`);
    return 0;
  }

  // Scan for available face textures: {race}hesk{face}{piece}.png
  const faceTexPattern = new RegExp(`^${raceCode}hesk(\\d)(\\d)\\.png$`, 'i');
  const texFiles = fs.readdirSync(texDir);
  
  const faceMap = {};
  for (const file of texFiles) {
    const match = file.match(faceTexPattern);
    if (match) {
      const faceIdx = parseInt(match[1]);
      const pieceIdx = parseInt(match[2]);
      if (!faceMap[faceIdx]) faceMap[faceIdx] = {};
      faceMap[faceIdx][pieceIdx] = path.join(texDir, file);
    }
  }

  const faceIndices = Object.keys(faceMap).map(Number).filter(n => n > 0).sort();
  console.log(`${raceCode}: ${faceIndices.length} face variants found (faces: ${faceIndices.join(', ')})`);
  
  if (faceIndices.length === 0) return 0;

  // Figure out which GLB textures are head textures
  // Original GLBs use: {race}he000{piece} naming
  // We need to find which ones correspond to swappable face pieces
  const baseDoc = await io.read(baseGlbPath);
  const headTextures = baseDoc.getRoot().listTextures()
    .filter(t => t.getName().match(new RegExp(`^${raceCode}he000\\d$`, 'i')));
  
  console.log(`  GLB head textures: ${headTextures.map(t => t.getName()).join(', ')}`);

  // Map GLB texture names to piece indices
  // {race}he000{piece} -> piece number
  const glbToPiece = {};
  for (const tex of headTextures) {
    const m = tex.getName().match(new RegExp(`^${raceCode}he000(\\d)$`, 'i'));
    if (m) glbToPiece[tex.getName()] = parseInt(m[1]);
  }

  let generated = 0;
  for (const faceIdx of faceIndices) {
    const outPath = path.join(CHARACTERS_DIR, `${raceCode}_face${faceIdx}.glb`);
    
    // Fresh read of the base
    const doc = await io.read(baseGlbPath);
    const textures = doc.getRoot().listTextures();
    
    let swapped = 0;
    const swapLog = [];
    
    for (const tex of textures) {
      const texName = tex.getName();
      const m = texName.match(new RegExp(`^${raceCode}he000(\\d)$`, 'i'));
      if (!m) continue;
      
      const piece = parseInt(m[1]);
      const replacementPath = faceMap[faceIdx]?.[piece];
      
      if (replacementPath && fs.existsSync(replacementPath)) {
        const imgData = fs.readFileSync(replacementPath);
        tex.setImage(new Uint8Array(imgData));
        tex.setMimeType('image/png');
        swapped++;
        swapLog.push(`he000${piece} -> hesk${faceIdx}${piece}`);
      }
    }
    
    if (swapped > 0) {
      await io.write(outPath, doc);
      const anims = doc.getRoot().listAnimations().length;
      console.log(`  Face ${faceIdx} -> ${path.basename(outPath)} (${swapped} swaps, ${anims} anims: ${swapLog.join(', ')})`);
      generated++;
    } else {
      console.log(`  Face ${faceIdx} -> skipped (no swaps matched)`);
    }
  }
  
  console.log(`  Generated ${generated} face variant GLBs for ${raceCode}\n`);
  return generated;
}

// ── Main ──
(async () => {
  const targetRace = process.argv[2];
  const targetDir = process.argv[3];
  
  if (targetRace && targetDir) {
    await generateFaceVariants(targetRace, targetDir);
  } else {
    console.log('Usage: node generate_face_variants_v2.js <raceCode> <exportDir>');
    console.log('Example: node generate_face_variants_v2.js hum globalhum');
  }
})();
