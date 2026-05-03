const fs = require('fs');
const path = require('path');

function walk(dir) {
    fs.readdirSync(dir).forEach(file => {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            walk(fullPath);
        } else if (file.startsWith('Soulbinder_') && file.endsWith('.lua')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes('e.message:findi("bind my soul")') && !content.includes('or e.message:findi("bind your soul")')) {
                content = content.replace('e.message:findi("bind my soul")', 'e.message:findi("bind my soul") or e.message:findi("bind your soul")');
                fs.writeFileSync(fullPath, content);
                console.log('Updated ' + file);
            }
        }
    });
}

walk(path.join(__dirname, 'quests'));
console.log('Done');
