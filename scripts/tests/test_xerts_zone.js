const eqemuDB = require('./eqemu_db');

async function check() {
    await eqemuDB.init();
    const char = await eqemuDB.getCharacter('Xerts');
    console.log("Xerts zoneId:", char.zoneId);
}
check();
