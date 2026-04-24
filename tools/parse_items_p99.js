const fs = require('fs');
const path = require('path');
const https = require('https');

const API_ENDPOINT = 'https://wiki.project1999.com/api.php';
const ITEMS_FILE = path.join(__dirname, '../data/items_classic.json');

// Helper to make an API request with fetch (using native Node fetch)
async function fetchWiki(url) {
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'KaelKodes-NodeScraper/1.0',
            'Accept': 'application/json'
        }
    });
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
}

async function getAllItemTitles() {
    console.log("Fetching item titles from Category:Items...");
    let titles = [];
    let cmcontinue = "";

    while (true) {
        const url = `${API_ENDPOINT}?action=query&list=categorymembers&cmtitle=Category:Items&cmlimit=500&format=json${cmcontinue ? '&cmcontinue=' + cmcontinue : ''}`;
        const data = await fetchWiki(url);
        
        if (data && data.query && data.query.categorymembers) {
            data.query.categorymembers.forEach(member => {
                if (member.ns === 0) { // Only main namespace pages (skip Category/Template pages)
                    titles.push(member.title);
                }
            });
        }

        if (data && data['query-continue'] && data['query-continue'].categorymembers && data['query-continue'].categorymembers.cmcontinue) {
            cmcontinue = data['query-continue'].categorymembers.cmcontinue;
            console.log(`Fetched ${titles.length} titles...`);
        } else if (data && data.continue && data.continue.cmcontinue) {
            cmcontinue = data.continue.cmcontinue;
            console.log(`Fetched ${titles.length} titles...`);
        } else {
            break;
        }
    }
    console.log(`Total item pages found: ${titles.length}`);
    return titles;
}

function parseItembox(wikitext, title) {
    // The {{Itembox template contains the stats
    const itemboxMatch = wikitext.match(/\{\{Itembox([\s\S]*?)\}\}/i);
    if (!itemboxMatch) return null;

    const rawContent = itemboxMatch[1];
    let item = {
        id: 0,
        name: title,
        weight: 0,
        size: 'TINY',
        slots: [],
        classes: [],
        races: [],
        ac: 0,
        damage: 0,
        delay: 0,
        skill: '',
        stats: {} // Catch-all for STR, STA, HP, Mana, etc.
    };

    // Extract itemname if defined
    const nameMatch = rawContent.match(/\|\s*itemname\s*=\s*(.+)/i);
    if (nameMatch) item.name = nameMatch[1].trim();

    // Extract raw statsblock
    const statsMatch = rawContent.match(/\|\s*statsblock\s*=\s*([\s\S]*?)(\||$)/i);
    if (!statsMatch) return item;

    let statsRaw = statsMatch[1].replace(/<[^>]+>/g, ' '); // Strip HTML tags like <br>

    // Regex out interesting bits
    const slotMatch = statsRaw.match(/Slot:\s*([A-Z\s]+)/);
    if (slotMatch) item.slots = slotMatch[1].trim().split(/\s+/);

    const skillMatch = statsRaw.match(/Skill:\s*([\w\s]+?)(?:Atk Delay|$)/);
    if (skillMatch) item.skill = skillMatch[1].trim();

    const atkDelayMatch = statsRaw.match(/Atk Delay:\s*(\d+)/i);
    if (atkDelayMatch) item.delay = parseInt(atkDelayMatch[1]);

    const dmgMatch = statsRaw.match(/DMG:\s*(\d+)/i);
    if (dmgMatch) item.damage = parseInt(dmgMatch[1]);

    const acMatch = statsRaw.match(/AC:\s*(\d+)/i);
    if (acMatch) item.ac = parseInt(acMatch[1]);

    const wtMatch = statsRaw.match(/WT:\s*([\d\.]+)/i);
    if (wtMatch) item.weight = parseFloat(wtMatch[1]);

    const sizeMatch = statsRaw.match(/Size:\s*([A-Z]+)/i);
    if (sizeMatch) item.size = sizeMatch[1].trim();

    const classMatch = statsRaw.match(/Class:\s*([A-Z\s]+)(?:Race:|$)/i);
    if (classMatch) item.classes = classMatch[1].trim().split(/\s+/);

    const raceMatch = statsRaw.match(/Race:\s*([A-Z\s]+)/i);
    if (raceMatch) {
       item.races = raceMatch[1].trim().split(/\s+/);
       // Handle "ALL" race or class
       if (item.classes.includes('ALL')) item.classes = ["WAR", "CLR", "PAL", "RNG", "SHD", "DRU", "MNK", "BRD", "ROG", "SHM", "NEC", "WIZ", "MAG", "ENC", "BST"];
       if (item.races.includes('ALL')) item.races = ["HUM", "BAR", "ERU", "WEF", "HEF", "DEF", "HIE", "DWF", "TRL", "OGR", "HFL", "GNM", "IKS"];
    }

    // Extract individual stat mods using a basic pass
    const statTypes = ['STR', 'STA', 'AGI', 'DEX', 'WIS', 'INT', 'CHA', 'HP', 'MANA', 'SV FIRE', 'SV DISEASE', 'SV COLD', 'SV MAGIC', 'SV POISON'];
    statTypes.forEach(stat => {
        const stMatch = statsRaw.match(new RegExp(`${stat}:\\s*([+-]?\\d+)`, 'i'));
        if (stMatch) item.stats[stat] = parseInt(stMatch[1]);
    });

    return item;
}

// Function to chunk array
const chunkArray = (arr, size) => 
    Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
        arr.slice(i * size, i * size + size)
    );

async function main() {
    console.log("=== P99 Item Scraper Started ===");
    
    // Test if output directory exists
    if (!fs.existsSync(path.dirname(ITEMS_FILE))) {
        fs.mkdirSync(path.dirname(ITEMS_FILE), { recursive: true });
    }

    let allTitles = await getAllItemTitles();
    
    // To avoid crushing the wiki and my local RAM, we will process 50 titles at a time.
    let itemDatabase = {};
    let itemCounter = 1;
    let chunks = chunkArray(allTitles, 50);

    console.log(`Processing ${chunks.length} chunks of up to 50 items each...`);

    for (let i = 0; i < chunks.length; i++) {
        const titles = chunks[i].map(encodeURIComponent).join('|');
        const url = `${API_ENDPOINT}?action=query&prop=revisions&rvprop=content&titles=${titles}&format=json`;
        
        try {
            const data = await fetchWiki(url);
            if (data && data.query && data.query.pages) {
                Object.values(data.query.pages).forEach(page => {
                    if (page.revisions && page.revisions.length > 0) {
                        const content = page.revisions[0]['*'];
                        const itemObj = parseItembox(content, page.title);
                        if (itemObj) {
                            itemObj.id = itemCounter++; // Assign internal ID
                            itemDatabase[itemObj.id] = itemObj;
                        }
                    }
                });
            }
            process.stdout.write(`\rProgress: [${i+1}/${chunks.length}] | Total parsed items: ${Object.keys(itemDatabase).length}`);
            
            // Respect API limits
            await new Promise(r => setTimeout(r, 200)); 
        } catch (e) {
            console.error(`\nFailed to fetch chunk ${i}: ${e.message}`);
        }
    }

    console.log(`\n\nSaving ${Object.keys(itemDatabase).length} items to ${ITEMS_FILE}...`);
    fs.writeFileSync(ITEMS_FILE, JSON.stringify(itemDatabase, null, 2), 'utf8');
    
    // Write out the legacy array wrapper if needed for compatibility with old spells/items format
    console.log("Scraping completed successfully!");
}

main().catch(console.error);
