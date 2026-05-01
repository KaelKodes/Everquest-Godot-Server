const fs = require('fs');

const lines = fs.readFileSync('D:\\EQ\\spells_us.txt', 'utf8').split('\r\n');
const lull = lines.find(l => l.startsWith('208^'));
if(lull) {
    const cols = lull.split('^');
    console.log('D:\\EQ\\spells_us.txt Lull 75:', cols[75]);
    console.log('D:\\EQ\\spells_us.txt Lull 143:', cols.length > 143 ? cols[143] : 'N/A');
}

const lines2 = fs.readFileSync('D:\\Kael Kodes\\EQMUD\\P99FilesV62\\spells_us.txt', 'utf8').split('\r\n');
const lull2 = lines2.find(l => l.startsWith('208^'));
if(lull2) {
    const cols2 = lull2.split('^');
    console.log('P99 Lull 75:', cols2[75]);
    console.log('P99 Lull 143:', cols2.length > 143 ? cols2[143] : 'N/A');
}
