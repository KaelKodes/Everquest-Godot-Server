const { LuaFactory } = require('wasmoon');

async function run() {
    const factory = new LuaFactory();
    const lua = await factory.createEngine();
    
    class NPC {
        constructor(n) { this.name = n; }
        Say(msg) { console.log(this.name + ' says: ' + msg); }
    }
    
    const npc = new NPC('Guard_Valon');
    
    // In EQ Lua, objects are passed in a table 'e'
    lua.global.set('e', { self: npc, message: 'hail' });
    
    await lua.doString(`
        e.self:Say("Hello! You said " .. e.message)
    `);
}

run().catch(console.error);
