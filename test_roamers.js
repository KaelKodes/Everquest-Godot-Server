const DB = require('./eqemu_db');
const Engine = require('./gameEngine');

async function test() {
    await DB.init();
    await Engine.initZones();
    console.log("Zones initialized");
    let roamers = 0;
    const zone = Engine.zoneInstances['qeynos'];
    if (zone && zone.liveMobs) {
        for (const mob of zone.liveMobs) {
            if (mob.isRoaming) roamers++;
        }
    }
    console.log(`Qeynos has ${roamers} roaming mobs out of ${zone ? zone.liveMobs.length : 0}`);
    process.exit(0);
}

test();
