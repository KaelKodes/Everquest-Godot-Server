const { LuaFactory } = require('wasmoon');

async function run() {
    const factory = new LuaFactory();
    
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
        const lua = await factory.createEngine();
        // Do nothing
    }
    const end = Date.now();
    console.log(`Created 100 engines in ${end - start}ms`);
}

run().catch(console.error);
