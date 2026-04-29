const eqemuDB = require('./eqemu_db');
const gameEngine = require('./gameEngine');

async function check() {
    await eqemuDB.init();
    await gameEngine.initZones();
    console.log(gameEngine.resolveZoneKey('felwithea'));
}
check();
