const fs = require('fs');
const path = require('path');

const contentPath = path.join(
  process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + '/.local/share'),
  '..', // AppData\Roaming -> AppData
  'Local\\.gemini\\antigravity\\brain\\c07bf713-6ab7-4e69-99a8-2bb3d86e3abd\\.system_generated\\steps\\1207\\content.md'
);
// Above path is for Windows, let's just use absolute path provided by the artifact system.
const absPath = 'C:\\Users\\KyleB\\.gemini\\antigravity\\brain\\c07bf713-6ab7-4e69-99a8-2bb3d86e3abd\\.system_generated\\steps\\1207\\content.md';

const content = fs.readFileSync(absPath, 'utf8');
const lines = content.split('\n');

const spas = {};
let inSpellEffectNamespace = false;

for (const line of lines) {
    if (line.includes('namespace SpellEffect {')) {
        inSpellEffectNamespace = true;
        continue;
    }
    if (inSpellEffectNamespace && line.startsWith('}')) {
        break; // End of namespace
    }
    
    if (inSpellEffectNamespace) {
        // Match: constexpr int CurrentHP = 0; // implemented - Heals
        const match = line.match(/constexpr\s+int\s+([A-Za-z0-9_]+)\s*=\s*(-?\d+)\s*;/);
        if (match) {
            let name = match[1];
            let id = parseInt(match[2], 10);
            
            // camelCase the name to match our existing style
            let camelName = name.charAt(0).toLowerCase() + name.slice(1);
            spas[id] = camelName;
        }
    }
}

// Generate the JS code for spell_enums.js
let jsCode = 'const SPA_EFFECTS = {\n';
for (let i = 0; i < 500; i++) { // Max SPA is roughly ~500
    if (spas[i]) {
        jsCode += `    ${i}: '${spas[i]}',\n`;
    }
}
jsCode += '};\n';

fs.writeFileSync('D:\\Kael Kodes\\EQMUD\\server\\tools\\new_spas.js', jsCode);
console.log('Done writing new_spas.js!');
