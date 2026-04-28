/**
 * Convert LanternExtractor weapon/equipment meshes to GLB files.
 * 
 * Reads the intermediate mesh format (vertices, UVs, normals, face indices)
 * and material lists, then builds GLB files using @gltf-transform/core.
 * 
 * Usage: node convert_weapon_meshes.js           (all weapons)
 *        node convert_weapon_meshes.js it10       (single weapon)
 */

const { NodeIO, Document } = require('@gltf-transform/core');
const fs = require('fs');
const path = require('path');

const EXPORT_DIR = path.join(__dirname, 'LanternExtractor', 'Exports', 'gequip');
const MESH_DIR = path.join(EXPORT_DIR, 'Meshes');
const MATLIST_DIR = path.join(EXPORT_DIR, 'MaterialLists');
const TEX_DIR = path.join(EXPORT_DIR, 'Textures');
const OUT_DIR = path.join(__dirname, '..', '..', 'eqmud', 'Data', 'Equipment');

/**
 * Parse a LanternExtractor material list file.
 * Returns: Map<materialIndex, { name, textureName }>
 */
function parseMaterialList(filePath) {
  const materials = new Map();
  if (!fs.existsSync(filePath)) return materials;
  
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('#') || line.trim() === '') continue;
    // Format: Index,MaterialName:TextureName,AnimationTextures
    const parts = line.split(',');
    if (parts.length < 2) continue;
    
    const idx = parseInt(parts[0]);
    const matPart = parts[1]; // e.g. "d_aroshaft:aroshaft"
    const colonIdx = matPart.indexOf(':');
    const matName = colonIdx >= 0 ? matPart.substring(0, colonIdx) : matPart;
    const texName = colonIdx >= 0 ? matPart.substring(colonIdx + 1) : matPart;
    
    materials.set(idx, { name: matName, textureName: texName });
  }
  return materials;
}

/**
 * Parse a LanternExtractor mesh intermediate format file.
 * Returns: { materialLabel, vertices[], uvs[], normals[], faces[] }
 * where faces[]: { materialIndex, indices[3] }
 */
function parseMesh(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  
  let materialLabel = '';
  const vertices = [];
  const uvs = [];
  const normals = [];
  const faces = [];
  
  for (const line of lines) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const parts = line.split(',');
    const type = parts[0];
    
    switch (type) {
      case 'ml':
        materialLabel = parts[1];
        break;
      case 'v':
        vertices.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
        break;
      case 'uv':
        uvs.push([parseFloat(parts[1]), parseFloat(parts[2])]);
        break;
      case 'n':
        normals.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
        break;
      case 'i':
        // i,materialIndex,v0,v1,v2
        faces.push({
          material: parseInt(parts[1]),
          indices: [parseInt(parts[2]), parseInt(parts[3]), parseInt(parts[4])]
        });
        break;
    }
  }
  
  return { materialLabel, vertices, uvs, normals, faces };
}

/**
 * Convert a parsed mesh + material list into a GLB document.
 */
async function buildGLB(meshData, materialList, itemName) {
  const doc = new Document();
  const buffer = doc.createBuffer(); // Required for GLB binary data
  doc.createScene(itemName);
  const scene = doc.getRoot().listScenes()[0];
  const rootNode = doc.createNode(itemName);
  scene.addChild(rootNode);
  
  // Group faces by material index
  const facesByMat = new Map();
  for (const face of meshData.faces) {
    if (!facesByMat.has(face.material)) facesByMat.set(face.material, []);
    facesByMat.get(face.material).push(face.indices);
  }
  
  // Create a mesh with one primitive per material group
  const mesh = doc.createMesh(itemName);
  
  for (const [matIdx, faceList] of facesByMat) {
    // Collect unique vertex indices used by these faces
    const usedIndices = new Set();
    for (const tri of faceList) {
      tri.forEach(i => usedIndices.add(i));
    }
    
    // Build remapped vertex data
    const indexMap = new Map();
    const posArr = [];
    const uvArr = [];
    const normArr = [];
    let newIdx = 0;
    
    for (const oldIdx of [...usedIndices].sort((a, b) => a - b)) {
      indexMap.set(oldIdx, newIdx++);
      
      if (oldIdx < meshData.vertices.length) {
        const v = meshData.vertices[oldIdx];
        posArr.push(v[0], v[1], v[2]);
      } else {
        posArr.push(0, 0, 0);
      }
      
      if (oldIdx < meshData.uvs.length) {
        const uv = meshData.uvs[oldIdx];
        uvArr.push(uv[0], 1.0 - uv[1]); // Flip V for glTF
      } else {
        uvArr.push(0, 0);
      }
      
      if (oldIdx < meshData.normals.length) {
        const n = meshData.normals[oldIdx];
        normArr.push(n[0], n[1], n[2]);
      } else {
        normArr.push(0, 1, 0);
      }
    }
    
    // Build index buffer
    const indexArr = [];
    for (const tri of faceList) {
      indexArr.push(indexMap.get(tri[0]), indexMap.get(tri[1]), indexMap.get(tri[2]));
    }
    
    // Create accessors
    const posAccessor = doc.createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array(posArr))
      .setBuffer(buffer);
    
    const uvAccessor = doc.createAccessor()
      .setType('VEC2')
      .setArray(new Float32Array(uvArr))
      .setBuffer(buffer);
    
    const normAccessor = doc.createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array(normArr))
      .setBuffer(buffer);
    
    const idxAccessor = doc.createAccessor()
      .setType('SCALAR')
      .setArray(new Uint16Array(indexArr))
      .setBuffer(buffer);
    
    // Create material with texture
    const matInfo = materialList.get(matIdx);
    const material = doc.createMaterial(matInfo ? matInfo.name : `mat_${matIdx}`);
    material.setDoubleSided(true);
    
    if (matInfo) {
      const texFile = path.join(TEX_DIR, matInfo.textureName + '.png');
      if (fs.existsSync(texFile)) {
        const imgData = fs.readFileSync(texFile);
        const texture = doc.createTexture(matInfo.textureName)
          .setImage(new Uint8Array(imgData))
          .setMimeType('image/png');
        material.setBaseColorTexture(texture);
      }
    }
    
    // Create primitive
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', posAccessor)
      .setAttribute('TEXCOORD_0', uvAccessor)
      .setAttribute('NORMAL', normAccessor)
      .setIndices(idxAccessor)
      .setMaterial(material);
    
    mesh.addPrimitive(prim);
  }
  
  rootNode.setMesh(mesh);
  return doc;
}

// ── Main ──
(async () => {
  const targetItem = process.argv[2]; // e.g. "it10"
  
  // Ensure output directory
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  
  const io = new NodeIO();
  
  // Get list of mesh files to process
  let meshFiles;
  if (targetItem) {
    const f = path.join(MESH_DIR, targetItem + '.txt');
    if (!fs.existsSync(f)) { console.log(`Mesh not found: ${f}`); return; }
    meshFiles = [targetItem + '.txt'];
  } else {
    meshFiles = fs.readdirSync(MESH_DIR)
      .filter(f => f.endsWith('.txt') && !f.includes('collision'));
  }
  
  let converted = 0, errors = 0;
  
  for (const meshFile of meshFiles) {
    const itemName = meshFile.replace('.txt', '');
    const meshPath = path.join(MESH_DIR, meshFile);
    const matListPath = path.join(MATLIST_DIR, meshFile);
    const outPath = path.join(OUT_DIR, itemName + '.glb');
    
    try {
      const meshData = parseMesh(meshPath);
      const matList = parseMaterialList(matListPath);
      
      if (meshData.vertices.length === 0 || meshData.faces.length === 0) {
        continue; // Skip empty meshes
      }
      
      const doc = await buildGLB(meshData, matList, itemName);
      await io.write(outPath, doc);
      converted++;
      
      if (targetItem || converted % 50 === 0) {
        console.log(`  ${itemName}: ${meshData.vertices.length} verts, ${meshData.faces.length} faces, ${matList.size} materials`);
      }
    } catch (err) {
      errors++;
      if (targetItem) console.error(`  ERROR ${itemName}: ${err.message}`);
    }
  }
  
  console.log(`\nConverted: ${converted} weapon GLBs (${errors} errors)`);
  
  // Size check
  const totalSize = fs.readdirSync(OUT_DIR)
    .filter(f => f.endsWith('.glb'))
    .reduce((sum, f) => sum + fs.statSync(path.join(OUT_DIR, f)).size, 0);
  console.log(`Total size: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
})();
