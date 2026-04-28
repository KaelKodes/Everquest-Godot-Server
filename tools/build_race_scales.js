// Parse racedata.txt and output size values alongside race IDs
const fs = require('fs');
const lines = fs.readFileSync('D:\\EQ\\racedata.txt', 'utf8').split('\n').filter(l => l.trim());

const raceScales = new Map();
for (const line of lines) {
  const f = line.split('^');
  const raceId = parseInt(f[0]);
  const gender = parseInt(f[1]);
  if (isNaN(raceId)) continue;
  
  // Fields 47 and 48 appear to be male/female height
  const h1 = parseFloat(f[47]);
  const h2 = parseFloat(f[48]);
  const height = h1 || h2 || 6;
  
  if (!raceScales.has(raceId) || gender === 0) {
    raceScales.set(raceId, height);
  }
}

// Human is height 6, normalize to that
const sorted = [...raceScales.entries()].sort((a, b) => a[0] - b[0]);
for (const [raceId, height] of sorted) {
  const scale = (height / 6).toFixed(2);
  console.log(`            ${raceId} => ${scale}f,`);
}
