const DB = require('../db');

// EQ Faction Tiers (Classic)
const TIERS = [
    { threshold: 1101, name: 'Ally', text: 'looks upon you warmly -- what would you like your tombstone to say?' }, // wait, ally text is "regards you as an ally"
    { threshold: 701, name: 'Warmly', text: 'looks upon you warmly.' },
    { threshold: 401, name: 'Kindly', text: 'looks your way apprehensively -- what would you like your tombstone to say?' }, // wait, friendly is warmly, kindly
    { threshold: 101, name: 'Amiable', text: 'judges you amiably.' },
    { threshold: 0, name: 'Indifferent', text: 'glances at you indifferently.' },
    { threshold: -100, name: 'Apprehensive', text: 'looks your way apprehensively.' },
    { threshold: -700, name: 'Dubious', text: 'glowers at you dubiously.' },
    { threshold: -999, name: 'Threateningly', text: 'glares at you threateningly.' },
    { threshold: -Infinity, name: 'Scowls', text: 'scowls at you, ready to attack!' }
];

const TIER_ALLY = 1101;
const TIER_WARMLY = 701;
const TIER_KINDLY = 401;
const TIER_AMIABLE = 101;
const TIER_INDIFFERENT = 0;
const TIER_APPREHENSIVE = -100;
const TIER_DUBIOUS = -700;
const TIER_THREATENINGLY = -999;
const TIER_SCOWLS = -1000;

function getTierInfo(value) {
    if (value >= TIER_ALLY) return { name: 'Ally', text: 'regards you as an ally' };
    if (value >= TIER_WARMLY) return { name: 'Warmly', text: 'looks upon you warmly' };
    if (value >= TIER_KINDLY) return { name: 'Kindly', text: 'kindly considers you' };
    if (value >= TIER_AMIABLE) return { name: 'Amiable', text: 'judges you amiably' };
    if (value >= TIER_INDIFFERENT) return { name: 'Indifferent', text: 'glances at you indifferently' };
    if (value >= TIER_APPREHENSIVE) return { name: 'Apprehensive', text: 'looks your way apprehensively' };
    if (value >= TIER_DUBIOUS) return { name: 'Dubious', text: 'glowers at you dubiously' };
    if (value >= TIER_THREATENINGLY) return { name: 'Threateningly', text: 'glares at you threateningly' };
    return { name: 'Scowls', text: 'scowls at you, ready to attack' };
}

class FactionSystem {
    /**
     * Get the player's numerical standing and tier with a specific NPC.
     */
    static getStanding(char, npc) {
        // Char state must have: raceId, classId, deityId, factionValues (fetched on login), and status flags like isSneaking, isInvis
        
        // 1. Check if NPC has a primary faction. If 0 or missing, it's indifferent.
        const npcFactionId = npc.npc_faction_id;
        if (!npcFactionId || npcFactionId === 0) {
            return { value: 0, tier: getTierInfo(0) };
        }

        const caches = DB.getFactionCaches();
        const npcFractionDef = caches.NPC_FACTION[npcFactionId];
        if (!npcFractionDef) {
            return { value: 0, tier: getTierInfo(0) };
        }

        const factionId = npcFractionDef.primaryfaction;
        if (!factionId || factionId === 0) {
            return { value: 0, tier: getTierInfo(0) };
        }

        const factionDef = caches.FACTION_LIST[factionId];
        if (!factionDef) {
            return { value: 0, tier: getTierInfo(0) };
        }

        // 2. Check Temporary Modifiers (Invis, Sneak)
        if (char.isInvis) { // Needs see-invis logic eventually
            return { value: 0, tier: getTierInfo(0) };
        }
        if (char.isSneaking && char.isBehindTarget) {
            return { value: 0, tier: getTierInfo(0) };
        }

        // 3. Calculate Base Value
        let value = factionDef.base;

        // 4. Add Player's Earned Value
        if (char.factionValues && char.factionValues[factionId] !== undefined) {
            value += char.factionValues[factionId];
        }

        // 5. Apply Modifiers (Race, Class, Deity)
        // If player has an illusion, use illusion's race ID
        const activeRaceId = char.illusionRaceId || char.raceId;
        
        // Find modifiers for this faction ID
        const mods = caches.FACTION_LIST_MOD.filter(m => m.faction_id === factionId);
        
        const raceMod = mods.find(m => m.mod_name === `r${activeRaceId}`);
        if (raceMod) value += raceMod.mod;

        const classMod = mods.find(m => m.mod_name === `c${char.classId}`);
        if (classMod) value += classMod.mod;

        const deityMod = mods.find(m => m.mod_name === `d${char.deityId}`);
        if (deityMod) value += deityMod.mod;

        // 6. Clamp to Min/Max
        const baseData = caches.FACTION_BASE_DATA[factionId];
        if (baseData) {
            if (value > baseData.max) value = baseData.max;
            if (value < baseData.min) value = baseData.min;
        }

        return { value, tier: getTierInfo(value) };
    }

    /**
     * Apply faction hits when a player kills an NPC.
     */
    static async applyFactionHits(char, npc, sendMessageFn) {
        const npcFactionId = npc.npc_faction_id;
        if (!npcFactionId || npcFactionId === 0) return;

        const caches = DB.getFactionCaches();
        const entries = caches.NPC_FACTION_ENTRIES[npcFactionId];
        if (!entries || entries.length === 0) return;

        // Make sure char has a factionValues object loaded
        if (!char.factionValues) char.factionValues = {};

        for (const entry of entries) {
            const factionId = entry.faction_id;
            const hitValue = entry.value; // The amount the faction changes

            const factionDef = caches.FACTION_LIST[factionId];
            if (!factionDef) continue;
            
            let current = char.factionValues[factionId] || 0;
            let newValue = current + hitValue;

            let hitCap = false;
            let capDirection = 0; // 1 for max, -1 for min

            // Clamp and check caps
            const baseData = caches.FACTION_BASE_DATA[factionId];
            if (baseData) {
                if (newValue >= baseData.max) {
                    if (current < baseData.max) hitCap = true;
                    newValue = baseData.max;
                    capDirection = 1;
                }
                if (newValue <= baseData.min) {
                    if (current > baseData.min) hitCap = true;
                    newValue = baseData.min;
                    capDirection = -1;
                }
            }

            // Save to char in memory and DB
            char.factionValues[factionId] = newValue;
            await DB.updateCharacterFactionValue(char.id, factionId, newValue, 0);

            // Send messages
            if (sendMessageFn) {
                const directionText = hitValue > 0 ? "gotten better" : "gotten worse";
                sendMessageFn(`Your faction standing with ${factionDef.name} has ${directionText}.`, "system");

                if (hitCap && !char.hideMaxCapMessages) {
                    if (capDirection === 1) {
                        sendMessageFn(`Your faction with ${factionDef.name} could not possibly get any better.`, "system");
                    } else if (capDirection === -1) {
                        sendMessageFn(`Your faction with ${factionDef.name} could not possibly get any worse.`, "system");
                    }
                }
            }
        }
    }
}

module.exports = FactionSystem;
