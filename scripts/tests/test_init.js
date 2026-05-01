require('dotenv').config();
const DB = require('./eqemu_db');
const Engine = require('./gameEngine');

async function check() {
    await DB.init();
    await Engine.initZones();
    process.exit(0);
}
check();
