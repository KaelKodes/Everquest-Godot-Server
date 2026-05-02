const fs = require('fs');
const readline = require('readline');
const { SPELL_COLUMNS } = require('./spell_columns');

async function main() {
    const sourcePath = 'D:\\everquest_rof2\\everquest_rof2\\spells_us.txt';
    const stream = fs.createReadStream(sourcePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    const spaCounts = {};
    let totalEffects = 0;

    for await (const line of rl) {
        if (!line.trim()) continue;
        const rawFields = line.split('^');
        
        // effectId1 is column index 86, up to effectId12
        // We will just use SPELL_COLUMNS to find the indexes dynamically
        for (let i = 1; i <= 12; i++) {
            const colDef = SPELL_COLUMNS.find(c => c.name === `effectId${i}`);
            if (!colDef) continue;
            
            const rawValue = rawFields[colDef.index];
            if (!rawValue) continue;
            
            const spa = parseInt(rawValue, 10);
            if (isNaN(spa) || spa === 254) continue; // 254 is unused slot
            
            spaCounts[spa] = (spaCounts[spa] || 0) + 1;
            totalEffects++;
        }
    }

    console.log(`Total active effects processed: ${totalEffects}`);
    console.log('SPA Frequencies:');
    
    const sorted = Object.entries(spaCounts).sort((a, b) => b[1] - a[1]);
    for (const [spa, count] of sorted) {
        console.log(`SPA ${spa}: ${count}`);
    }
}

main().catch(console.error);
