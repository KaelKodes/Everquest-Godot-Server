/**
 * Generate full-body skin variant GLBs for races with body-color face variants.
 * 
 * Supports TWO naming conventions:
 *   - LanternExtractor: GLB=kemchsk01, export=kemchsk{face}{piece}.png
 *   - EQSage:           GLB=kemch0001, export=kemchsk{face}{piece}.png
 * 
 * The export textures ALWAYS use the "sk" format from LanternExtractor.
 * The GLB textures may or may not have "sk" depending on the export tool.
 * 
 * Usage: node generate_skin_variants.js [raceCode] [exportDir]
 */

const { NodeIO } = require('@gltf-transform/core');
const fs = require('fs');
const path = require('path');

const CHARACTERS_DIR = path.join(__dirname, '..', '..', 'eqmud', 'Data', 'Characters');
const EXPORTS_BASE = path.join(__dirname, 'LanternExtractor', 'Exports');

// Body part codes used in EQ texture naming
const BODY_PARTS = ['ch', 'lg', 'ft', 'he', 'hn', 'fa', 'ua', 'ta'];

async function generateSkinVariants(raceCode, exportDir) {
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

  const baseDoc = await io.read(baseGlbPath);
  const baseTexNames = baseDoc.getRoot().listTextures().map(t => t.getName());
  console.log(`${raceCode}: ${baseTexNames.length} textures in base GLB`);

  // Build a mapping from GLB texture name -> { part, piece, exportPrefix }
  // Handles both naming conventions:
  //   LanternExtractor: kemchsk01  -> part=ch, piece=1, exportPrefix=kemchsk
  //   EQSage:           kemch0001  -> part=ch, piece=1, exportPrefix=kemchsk
  //   EQSage (alt):     kemch0001 (Base Color) image -> strip suffix first
  const texMapping = [];
  
  for (const rawTexName of baseTexNames) {
    // Strip EQSage suffixes like " (Base Color) image"
    const texName = rawTexName.split(' ')[0];
    
    // Try LanternExtractor format: {race}{part}sk{0?}{piece}
    let match = texName.match(new RegExp(`^(${raceCode})(\\w+?)sk0?(\\d+)$`, 'i'));
    if (match) {
      texMapping.push({
        glbName: rawTexName,
        part: match[2],
        piece: match[3],
        exportPrefix: `${raceCode}${match[2]}sk`
      });
      continue;
    }
    
    // Try EQSage format: {race}{part}{00}{piece} (e.g. kemch0001, ikmhe0011)
    // Body parts are 2 chars, then digits follow
    for (const part of BODY_PARTS) {
      const partPattern = new RegExp(`^${raceCode}${part}(\\d+)$`, 'i');
      match = texName.match(partPattern);
      if (match) {
        const digits = match[1]; // e.g. "0001" or "0011" or "0102"
        // The piece number is the last 1-2 digits, face is encoded differently
        // For base (face 0): digits are like 0001, 0002 -> piece 1, 2
        // We map to export: {race}{part}sk0{piece}.png
        const piece = parseInt(digits.slice(-1)) || parseInt(digits.slice(-2));
        texMapping.push({
          glbName: rawTexName,
          part: part,
          piece: String(piece),
          exportPrefix: `${raceCode}${part}sk`,
          originalDigits: digits
        });
        break;
      }
    }
  }
  
  console.log(`  Mapped ${texMapping.length} textures for swapping`);
  if (texMapping.length > 0) {
    texMapping.forEach(m => console.log(`    ${m.glbName} -> ${m.exportPrefix}0${m.piece}.png`));
  }

  // Scan export dir to find which face indices exist
  const allTexFiles = fs.readdirSync(texDir).filter(f => f.startsWith(raceCode) && f.endsWith('.png'));
  
  const faceIndices = new Set();
  for (const file of allTexFiles) {
    const m = file.match(new RegExp(`^${raceCode}\\w+sk(\\d)\\d+\\.png$`, 'i'));
    if (m) faceIndices.add(parseInt(m[1]));
  }
  faceIndices.delete(0); // face 0 = base
  
  const faces = [...faceIndices].sort();
  console.log(`  Found ${faces.length} skin variants: faces ${faces.join(', ')}`);
  
  if (faces.length === 0) return 0;

  // For each face, create a variant GLB by swapping all matching textures
  let generated = 0;
  for (const faceIdx of faces) {
    const outPath = path.join(CHARACTERS_DIR, `${raceCode}_face${faceIdx}.glb`);
    
    const doc = await io.read(baseGlbPath);
    const textures = doc.getRoot().listTextures();
    
    let swapped = 0;
    const swapLog = [];
    
    for (const tex of textures) {
      const texName = tex.getName();
      
      // Find this texture in our mapping
      const mapping = texMapping.find(m => m.glbName === texName);
      if (!mapping) continue;
      
      // Look for the variant texture: {exportPrefix}{faceIdx}{piece}.png
      const variantFile = `${mapping.exportPrefix}${faceIdx}${mapping.piece}.png`;
      const variantPath = path.join(texDir, variantFile);
      
      if (fs.existsSync(variantPath)) {
        const imgData = fs.readFileSync(variantPath);
        tex.setImage(new Uint8Array(imgData));
        tex.setMimeType('image/png');
        swapped++;
        swapLog.push(`${texName} -> ${variantFile}`);
      }
    }
    
    if (swapped > 0) {
      await io.write(outPath, doc);
      const anims = doc.getRoot().listAnimations().length;
      console.log(`  Face ${faceIdx} -> ${path.basename(outPath)} (${swapped} swapped, ${anims} anims)`);
      if (swapLog.length <= 12) swapLog.forEach(s => console.log(`    ${s}`));
      generated++;
    } else {
      console.log(`  Face ${faceIdx} -> skipped (0 swaps)`);
    }
  }
  
  console.log(`  Generated ${generated} skin variant GLBs for ${raceCode}\n`);
  return generated;
}

// ── Main ──
(async () => {
  const targetRace = process.argv[2];
  const targetDir = process.argv[3];
  
  if (targetRace && targetDir) {
    await generateSkinVariants(targetRace, targetDir);
  } else {
    // Run all Luclin-era races with full-body skin variants
    const configs = [
      ['ikm', 'globalikm'],
      ['ikf', 'globalikf'],
      ['kem', 'globalkem'],
      ['kef', 'globalkef'],
      ['frm', 'globalpcfroglok'],
      ['frf', 'globalpcfroglok'],
    ];
    let total = 0;
    for (const [code, dir] of configs) {
      total += await generateSkinVariants(code, dir) || 0;
    }
    console.log(`Total skin variant GLBs generated: ${total}`);
  }
})();
