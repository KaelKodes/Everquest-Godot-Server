// Parse D:\EQ\racedata.txt into a Race ID → Model Code mapping
// Then cross-reference with available GLBs in Data/Characters
const fs = require('fs');
const path = require('path');

const raceDataPath = 'D:\\EQ\\racedata.txt';
const glbDir = 'D:\\Kael Kodes\\EQMUD\\eqmud\\Data\\Characters';

// Parse racedata.txt
const lines = fs.readFileSync(raceDataPath, 'utf8').split('\n').filter(l => l.trim());

// Format: raceId^gender^...^modelCode^...
// The model code is a 3-letter uppercase string, appears to be field index ~51 (after the ^^)
const raceMap = new Map(); // raceId -> { male: code, female: code }

for (const line of lines) {
  const fields = line.split('^');
  const raceId = parseInt(fields[0]);
  const gender = parseInt(fields[1]); // 0=male, 1=female, 2=neutral
  
  // Find the 3-letter model code - it's the uppercase 3-letter string
  // Looking at the data, it appears after an empty field, around index 51
  let modelCode = null;
  for (let i = 40; i < fields.length; i++) {
    const f = fields[i].trim();
    if (f.length >= 3 && f.length <= 4 && /^[A-Z][A-Z0-9_]+$/i.test(f) && f !== 'NONE') {
      modelCode = f.toLowerCase();
      break;
    }
  }
  
  if (isNaN(raceId) || !modelCode) continue;
  
  if (!raceMap.has(raceId)) {
    raceMap.set(raceId, { male: null, female: null, neutral: null });
  }
  
  const entry = raceMap.get(raceId);
  if (gender === 0) entry.male = modelCode;
  else if (gender === 1) entry.female = modelCode;
  else if (gender === 2) entry.neutral = modelCode;
}

// Get available GLBs
const glbFiles = new Set(
  fs.readdirSync(glbDir)
    .filter(f => f.endsWith('.glb'))
    .map(f => f.replace('.glb', '').toLowerCase())
);

// Build final mapping and check availability
console.log('// === EQ Race ID → Model Code (from racedata.txt) ===');
console.log('// Format: { raceId, ("maleCode", "femaleCode") }');
console.log('');

let available = 0;
let missing = 0;
const csharpLines = [];
const missingModels = new Set();

const sorted = [...raceMap.entries()].sort((a, b) => a[0] - b[0]);
for (const [raceId, codes] of sorted) {
  const male = codes.male || codes.neutral || codes.female || '???';
  const female = codes.female || codes.neutral || codes.male || '???';
  
  const maleAvail = glbFiles.has(male);
  const femaleAvail = glbFiles.has(female);
  const hasModel = maleAvail || femaleAvail;
  
  if (hasModel) {
    available++;
    csharpLines.push(`        { ${raceId}, ("${male}", "${female}") },`);
  } else {
    missing++;
    if (male !== '???') missingModels.add(male);
    if (female !== '???') missingModels.add(female);
  }
}

console.log(`// Available: ${available} races have GLBs`);
console.log(`// Missing:   ${missing} races have no GLBs`);
console.log('');
console.log('// === C# Dictionary entries for available races ===');
for (const line of csharpLines) {
  console.log(line);
}

console.log('');
console.log(`// Missing model codes (no GLB): ${[...missingModels].sort().join(', ')}`);
