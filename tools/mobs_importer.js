const { execSync } = require('child_process');

const ZONE_MAP = {
    'qeytoqrg': 'qeynos_hills',
    'qey2hh1':  'west_karana',
    'qeynos':   'qeynos_city',
};

// Item Name -> itemKey map based on server/data/items.js
const ITEM_KEY_MAP = {
    'fire beetle eye': 'fire_beetle_eye',
    'fire beetle leg': 'fire_beetle_leg',
    'rat whiskers': 'rat_whiskers',
    'wolf pelt': 'wolf_pelt',
    'gnoll fang': 'gnoll_fang',
    'lion skin': 'lion_skin',
    'scarecrow straw': 'scarecrow_straw',
    'giant toenail': 'giant_toenail',
    'griffon feather': 'griffon_feather',
    'rusty short sword': 'rusty_short_sword',
    'bronze long sword': 'bronze_long_sword',
    'worn great staff': 'worn_great_staff',
    'cloth cap': 'cloth_cap',
    'tattered tunic': 'tattered_tunic',
    'leather gloves': 'leather_gloves',
    'bronze helm': 'bronze_helm',
    'bronze breastplate': 'bronze_breastplate',
    'bread': 'bread',
    'water flask': 'water',
};

function runQuery(sql) {
    const command = `wsl docker exec 426398ed577e mysql -ueqemu -pbHqIbrW81WLuaZ4qaQGrRViIHHvz9nR peq -e "${sql}"`;
    try {
        const output = execSync(command).toString();
        const lines = output.trim().split('\n');
        if (lines.length <= 1) return [];
        
        const headers = lines[0].split('\t');
        const results = [];
        for (let i = 1; i < lines.length; i++) {
            const row = lines[i].split('\t');
            const obj = {};
            headers.forEach((h, idx) => {
                obj[h] = row[idx];
            });
            results.push(obj);
        }
        return results;
    } catch (e) {
        console.error("Query failed:", e.message);
        return [];
    }
}

function importZone(dbShortName, mudShortName) {
    console.log(`// --- Importing ${mudShortName} (${dbShortName}) ---`);
    
    // Added nt.race for better filtering
    const mobs = runQuery(`SELECT nt.id, nt.name, nt.level, nt.hp, nt.mindmg, nt.maxdmg, nt.attack_delay, nt.loottable_id, nt.race FROM spawn2 s JOIN spawnentry se ON s.spawngroupID = se.spawngroupID JOIN npc_types nt ON se.npcID = nt.id WHERE s.zone = '${dbShortName}' GROUP BY nt.id ORDER BY nt.level ASC;`);

    const formattedMobs = mobs.filter(m => {
        const name = m.name.toLowerCase();
        // Filter out invisible, utility, or non-combat placeholder mobs
        if (m.name.startsWith('#') || name.includes('invis') || name.includes('spawner') || name.includes('timer')) return false;
        
        // Race 240 and 127 are typically "Invisible Man" utility mobs
        if (m.race === '240' || m.race === '127') return false;
        
        // Heuristic: Emote mobs often use full sentence names
        const wordCount = m.name.split('_').length;
        if (wordCount > 4 && (name.startsWith('a_') || name.startsWith('the_'))) return false;
        if (['from_afar', 'amid_the', 'just_outside', 'a_shrieking', 'for_a_brief'].includes(name)) return false;

        if (parseInt(m.hp) <= 0) return false;
        if (name.includes('boat')) return false;
        return true;
    }).map(m => {
        const loottable_id = m.loottable_id;
        const loot = [];
        
        if (loottable_id && loottable_id != '0') {
            const items = runQuery(`SELECT i.name as item_name, lde.chance as drop_chance FROM loottable_entries lte JOIN lootdrop_entries lde ON lte.lootdrop_id = lde.lootdrop_id JOIN items i ON lde.item_id = i.id WHERE lte.loottable_id = ${loottable_id};`);
            
            items.forEach(it => {
                const name = it.item_name.replace(/_/g, ' ').toLowerCase();
                const key = ITEM_KEY_MAP[name] || name.replace(/ /g, '_');
                loot.push({ itemKey: key, chance: Math.round(parseFloat(it.drop_chance) / 100 * 1000) / 1000 });
            });
        }

        // Rebalance speed: delay 30 -> 3.0s
        const attackDelay = parseFloat(m.attack_delay) / 10;

        return {
            key: m.name.toLowerCase(),
            name: m.name.replace(/_/g, ' '),
            level: parseInt(m.level),
            maxHp: parseInt(m.hp),
            minDmg: Math.max(1, parseInt(m.mindmg)),
            maxDmg: Math.max(1, parseInt(m.maxdmg)),
            attackDelay: attackDelay,
            xpBase: Math.floor(parseInt(m.level) * 15), 
            loot: loot,
            spawnMax: 4, 
            respawnTime: 60,
        };
    });

    console.log(JSON.stringify(formattedMobs, null, 2));
}

// Example usage
// importZone('qeytoqrg', 'qeynos_hills');
// importZone('qey2hh1', 'west_karana');

const args = process.argv.slice(2);
if (args.length >= 2) {
    importZone(args[0], args[1]);
} else {
    console.log("Usage: node mobs_importer.js <db_short_name> <mud_short_name>");
    console.log("Example: node mobs_importer.js qeytoqrg qeynos_hills");
}
