// Generate a compact JSON race map: raceId -> { m: "male_code", f: "female_code", s: scale }
// Only includes races that have an available GLB model
const fs = require('fs');

const raceDataPath = 'D:\\EQ\\racedata.txt';
const glbDir = 'D:\\Kael Kodes\\EQMUD\\eqmud\\Data\\Characters';
const outputPath = 'D:\\Kael Kodes\\EQMUD\\eqmud\\Data\\race_models.json';

const lines = fs.readFileSync(raceDataPath, 'utf8').split('\n').filter(l => l.trim());
const glbs = new Set(fs.readdirSync(glbDir).filter(f => f.endsWith('.glb')).map(f => f.replace('.glb', '').toLowerCase()));

const races = {};

for (const line of lines) {
  const f = line.split('^');
  const raceId = parseInt(f[0]);
  const gender = parseInt(f[1]);
  if (isNaN(raceId)) continue;

  // Extract model code
  let modelCode = null;
  for (let i = 40; i < f.length; i++) {
    const v = f[i].trim();
    if (v.length >= 3 && v.length <= 4 && /^[A-Z][A-Z0-9]+$/i.test(v) && v !== 'NONE') {
      modelCode = v.toLowerCase();
      break;
    }
  }
  if (!modelCode) continue;

  // Extract height (fields 47-48)
  const h = parseFloat(f[47]) || parseFloat(f[48]) || 6;
  const scale = parseFloat((h / 6).toFixed(2));

  if (!races[raceId]) races[raceId] = {};
  const entry = races[raceId];

  if (gender === 0) { entry.m = modelCode; entry.s = scale; }
  else if (gender === 1) { entry.f = modelCode; if (!entry.s) entry.s = scale; }
  else { entry.n = modelCode; if (!entry.s) entry.s = scale; }
}

// Filter to only races with available GLBs, and normalize
const result = {};
let count = 0;
for (const [raceId, entry] of Object.entries(races)) {
  const male = entry.m || entry.n || entry.f;
  const female = entry.f || entry.n || entry.m;
  if (!male) continue;
  if (!glbs.has(male) && !glbs.has(female)) continue;

  result[raceId] = { m: male, f: female, s: entry.s || 1.0 };
  count++;
}

fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(`Wrote ${count} race entries to ${outputPath}`);
