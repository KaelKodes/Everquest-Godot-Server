#!/usr/bin/env node
/**
 * Convert Brewall-style line dump (L x1,y1,z1,x2,y2,z2,r,g,b) to EQMUD Brewall map JSON
 * for LoadZoneBrewall → res://Data/Maps/<zone>_map.json
 *
 * Usage:
 *   node server/scripts/cshome_txt_to_map_json.js path/to/cshome.txt [out.json]
 *
 * Default output: eqmud/Data/Maps/cshome_map.json (repo root relative)
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const defaultOut = path.join(root, 'eqmud', 'Data', 'Maps', 'cshome_map.json');

function normRgb(r, g, b) {
  return `${Math.round(r)},${Math.round(g)},${Math.round(b)}`;
}

/** Map export RGB → categorizedLines bucket (must match WorldManager.Zone.cs categories). */
function categoryForRgb(r, g, b) {
  const key = normRgb(r, g, b);
  const table = {
    '0,0,0': 'walls',
    '70,130,180': 'water',
    '0,204,0': 'paths',
    '150,150,150': 'walls',
  };
  if (table[key]) return table[key];
  // Green-ish → paths; blue-ish → water; else structural walls
  if (g > r + 30 && g > b + 30) return 'paths';
  if (b > r + 20 && b > g) return 'water';
  if (r > 200 && g < 100 && b < 100) return 'danger';
  return 'other';
}

function parseLine(line) {
  const t = line.trim();
  if (!t || t.startsWith('#') || t.startsWith('//')) return null;
  const m = /^L\s+([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*$/i.exec(t);
  if (!m) return null;
  const x1 = parseFloat(m[1]);
  const y1 = parseFloat(m[2]);
  const z1 = parseFloat(m[3]);
  const x2 = parseFloat(m[4]);
  const y2 = parseFloat(m[5]);
  const z2 = parseFloat(m[6]);
  const r = parseFloat(m[7]);
  const g = parseFloat(m[8]);
  const b = parseFloat(m[9]);
  return { x1, y1, z1, x2, y2, z2, r, g, b };
}

function main() {
  const input = process.argv[2];
  const outPath = process.argv[3] ? path.resolve(process.argv[3]) : defaultOut;
  if (!input || !fs.existsSync(input)) {
    console.error('Usage: node server/scripts/cshome_txt_to_map_json.js <cshome.txt> [out.json]');
    process.exit(1);
  }

  const text = fs.readFileSync(input, 'utf8');
  const lines = text.split(/\r?\n/);

  const buckets = {
    walls: [],
    paths: [],
    water: [],
    danger: [],
    other: [],
  };

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const line of lines) {
    const p = parseLine(line);
    if (!p) continue;
    minX = Math.min(minX, p.x1, p.x2);
    maxX = Math.max(maxX, p.x1, p.x2);
    minY = Math.min(minY, p.y1, p.y2);
    maxY = Math.max(maxY, p.y1, p.y2);

    const cat = categoryForRgb(p.r, p.g, p.b);
    buckets[cat].push({
      start: [p.x1, p.y1, p.z1],
      end: [p.x2, p.y2, p.z2],
      color: [Math.round(p.r), Math.round(p.g), Math.round(p.b)],
    });
  }

  if (!Number.isFinite(minX)) {
    console.error('No L lines parsed. Expected: L x1,y1,z1,x2,y2,z2,r,g,b');
    process.exit(1);
  }

  const pad = 20;
  const out = {
    bounds: {
      minX: minX - pad,
      maxX: maxX + pad,
      minY: minY - pad,
      maxY: maxY + pad,
    },
    categorizedLines: {},
  };

  for (const [k, arr] of Object.entries(buckets)) {
    if (arr.length) out.categorizedLines[k] = arr;
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');

  const counts = Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length]));
  console.log(`Wrote ${outPath}`);
  console.log('Segment counts:', counts);
  console.log('Bounds:', out.bounds);
}

main();
