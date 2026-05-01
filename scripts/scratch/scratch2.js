const fs = require('fs');
const spellDatabase = require('d:\\Kael Kodes\\EQMUD\\server\\data\\spellDatabase.js');
spellDatabase.load();
const SPELLS = spellDatabase.getAll();

const keys = ['lull', 'minor_shielding', 'strengthen', 'shallow_breath', 'weaken', 'illusion_centaur', 'illusion_ogre_pirate', 'pendrils_animation'];

console.log('Server Payload Simulator:');
for (const k of keys) {
    const def = SPELLS[k];
    if (def) {
        const memIcon = def.visual ? def.visual.memIcon : 0;
        console.log(`${k}: memIcon=${memIcon} -> Godot evaluates to: ${memIcon >= 2001 ? memIcon - 2001 : memIcon}`);
    } else {
        console.log(`${k}: NOT FOUND in spellDatabase`);
    }
}
