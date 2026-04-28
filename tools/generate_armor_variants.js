/**
 * Generate armor material variant GLBs for all playable races.
 * 
 * EQ armor appearance works by swapping body part textures based on material index:
 *   Material 0 = Cloth (base/skin)
 *   Material 1 = Leather
 *   Material 2 = Chain
 *   Material 3 = Plate
 *   Material 4 = Monk/Special (some races only)
 * 
 * Texture naming: {race}{part}{material2digits}{piece2digits}.png
 *   e.g. humch0201.png = Human chest, material 2 (chain), piece 1
 * 
 * GLB texture naming (LanternExtractor): {race}{part}0{piece} -> maps to material 00
 * 
 * Output: {race}_armor{material}.glb in Data/Characters/
 * 
 * Usage: node generate_armor_variants.js [raceCode] [material]
 *        node generate_armor_variants.js           (all races, all materials)
 */

const { NodeIO } = require('@gltf-transform/core');
const fs = require('fs');
const path = require('path');

const CHARACTERS_DIR = path.join(__dirname, '..', '..', 'eqmud', 'Data', 'Characters');
const GLOBAL_TEX_DIR = path.join(__dirname, 'LanternExtractor', 'Exports', 'global', 'Characters', 'Textures');

// Body parts that change with armor material
const BODY_PARTS = ['ch', 'lg', 'ft', 'ua', 'fa', 'hn'];

// All playable race model codes
const RACE_CODES = [
  'hum', 'huf',  // Human
  'bam', 'baf',  // Barbarian
  'erm', 'erf',  // Erudite
  'elm', 'elf',  // Wood Elf
  'him', 'hif',  // High Elf
  'dam', 'daf',  // Dark Elf
  'ham', 'haf',  // Half Elf
  'dwm', 'dwf',  // Dwarf
  'trm', 'trf',  // Troll
  'ogm', 'ogf',  // Ogre
  'hom', 'hof',  // Halfling
  'gnm', 'gnf',  // Gnome
  'ikm', 'ikf',  // Iksar
];

async function generateArmorVariants(raceCode, targetMaterial) {
  const io = new NodeIO();
  const baseGlbPath = path.join(CHARACTERS_DIR, `${raceCode}.glb`);
  
  if (!fs.existsSync(baseGlbPath)) {
    console.log(`  ${raceCode}: base GLB not found, skipping`);
    return 0;
  }

  // Scan available materials for this race in the global texture dir
  const allTexFiles = fs.readdirSync(GLOBAL_TEX_DIR).filter(f => f.startsWith(raceCode) && f.endsWith('.png'));
  const availableMaterials = new Set();
  for (const f of allTexFiles) {
    const m = f.match(new RegExp(`^${raceCode}(?:ch|lg|ft|ua|fa|hn)(\\d{2})\\d{2}\\.png$`));
    if (m) availableMaterials.add(parseInt(m[1]));
  }
  availableMaterials.delete(0); // Material 0 = base model (already the default)
  
  const materials = targetMaterial !== undefined 
    ? [targetMaterial].filter(m => availableMaterials.has(m))
    : [...availableMaterials].sort((a, b) => a - b);
  
  if (materials.length === 0) {
    console.log(`  ${raceCode}: no armor materials to generate`);
    return 0;
  }

  // Read the base GLB to understand texture naming
  const baseDoc = await io.read(baseGlbPath);
  const baseTextures = baseDoc.getRoot().listTextures();
  
  // Map GLB textures to body parts
  // GLB names: humch0001 or humch0001 (Base Color) image
  const texMapping = [];
  for (const tex of baseTextures) {
    const rawName = tex.getName().split(' ')[0]; // Strip EQSage suffix
    
    for (const part of BODY_PARTS) {
      const prefix = raceCode + part;
      if (!rawName.startsWith(prefix)) continue;
      const digits = rawName.substring(prefix.length);
      if (!/^\d+$/.test(digits)) continue;
      
      // Extract piece number (last 2 digits are the piece)
      const piece = digits.slice(-2).padStart(2, '0');
      
      texMapping.push({
        texture: tex,
        texName: rawName,
        part: part,
        piece: piece,
      });
      break;
    }
  }
  
  let generated = 0;
  
  for (const mat of materials) {
    const matStr = String(mat).padStart(2, '0');
    const outPath = path.join(CHARACTERS_DIR, `${raceCode}_armor${mat}.glb`);
    
    // Re-read base GLB for each material (fresh copy)
    const doc = await io.read(baseGlbPath);
    const textures = doc.getRoot().listTextures();
    
    let swapped = 0;
    const swapLog = [];
    
    for (const tex of textures) {
      const rawName = tex.getName().split(' ')[0];
      
      // Find this texture in our mapping
      for (const part of BODY_PARTS) {
        const prefix = raceCode + part;
        if (!rawName.startsWith(prefix)) continue;
        const digits = rawName.substring(prefix.length);
        if (!/^\d+$/.test(digits)) continue;
        
        const piece = digits.slice(-2).padStart(2, '0');
        
        // Look for armor texture: {race}{part}{material}{piece}.png
        const armorFile = `${raceCode}${part}${matStr}${piece}.png`;
        const armorPath = path.join(GLOBAL_TEX_DIR, armorFile);
        
        if (fs.existsSync(armorPath)) {
          const imgData = fs.readFileSync(armorPath);
          tex.setImage(new Uint8Array(imgData));
          tex.setMimeType('image/png');
          swapped++;
          swapLog.push(`${rawName} -> ${armorFile}`);
        }
        break;
      }
    }
    
    if (swapped > 0) {
      await io.write(outPath, doc);
      const anims = doc.getRoot().listAnimations().length;
      console.log(`  ${raceCode}_armor${mat}.glb: ${swapped} textures swapped, ${anims} anims`);
      generated++;
    } else {
      console.log(`  ${raceCode}_armor${mat}: 0 swaps, skipped`);
    }
  }
  
  return generated;
}

// ── Main ──
(async () => {
  const targetRace = process.argv[2];
  const targetMat = process.argv[3] ? parseInt(process.argv[3]) : undefined;
  
  let total = 0;
  
  if (targetRace) {
    console.log(`Generating armor variants for ${targetRace}...`);
    total = await generateArmorVariants(targetRace, targetMat);
  } else {
    console.log('Generating armor variants for all races...\n');
    for (const code of RACE_CODES) {
      total += await generateArmorVariants(code, targetMat);
    }
  }
  
  console.log(`\nTotal armor variant GLBs generated: ${total}`);
})();
