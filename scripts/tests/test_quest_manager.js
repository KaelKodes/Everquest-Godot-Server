const QuestManager = require('./questManager');

async function run() {
    const npc = { id: 123, name: 'Guard Orcflayer', x: 0, y: 0, z: 0, h: 0, zoneId: 54 };
    const player = { id: 1, name: 'Xerts', class: 1, race: 1, level: 10 };
    
    console.log("Testing EVENT_SAY 'hail' on Guard_Orcflayer (Perl):");
    const actions = await QuestManager.triggerEvent('gfaydark', npc, player, 'EVENT_SAY', { message: 'hail' });
    console.log(actions);

    console.log("\nTesting EVENT_SAY 'hail' on Guard_Highmoon (Lua):");
    npc.name = 'Guard Highmoon';
    const luaActions = await QuestManager.triggerEvent('gfaydark', npc, player, 'EVENT_SAY', { message: 'hail' });
    console.log(luaActions);
}

run().catch(console.error);
