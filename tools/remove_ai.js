const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'gameEngine.js');
let lines = fs.readFileSync(file, 'utf8').split('\n');

// 5565 is the empty line before processMobRoaming
// 5878 is `function processEnvironment`
// Wait, arrays are 0-indexed.
// Line 5566 is `function processMobRoaming(mob, dt, zoneId) {` -> index 5565
// Let's find the exact indices
const startIndex = lines.findIndex(l => l.startsWith('function processMobRoaming'));
const endIndex = lines.findIndex(l => l.startsWith('function processEnvironment'));

if (startIndex !== -1 && endIndex !== -1) {
  lines.splice(startIndex, endIndex - startIndex, '// ── AI System moved to systems/ai.js ────────────────────────────────');
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  console.log('AI System removed successfully.');
} else {
  console.log('Could not find AI system bounds.', startIndex, endIndex);
}
