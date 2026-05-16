const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { LuaFactory } = require('wasmoon');
const FactionSystem = require('./systems/faction');

/** PEQ Perl compares `$class` to title-case names (e.g. `$class eq "Paladin"`). */
const PEQ_CLASS_NAMES = {
    1: 'Warrior', 2: 'Cleric', 3: 'Paladin', 4: 'Ranger', 5: 'Shadow Knight', 6: 'Druid', 7: 'Monk',
    8: 'Bard', 9: 'Rogue', 10: 'Shaman', 11: 'Necromancer', 12: 'Wizard', 13: 'Magician', 14: 'Enchanter',
    15: 'Beastlord', 16: 'Berserker',
};

const factory = new LuaFactory();

class QuestManager {
    constructor() {
        this.questsDir = path.join(__dirname, 'quests');
    }

    getScriptPath(zone, npcName, npcId) {
        const extLua = '.lua';
        const extPl = '.pl';
        
        // Clean name (e.g. Guard_Valon)
        const cleanName = npcName.replace(/ /g, '_').replace(/#/g, '').replace(/['`]/g, '-');
        
        let pathsToCheck = [
            path.join(this.questsDir, zone, `${cleanName}${extLua}`),
            path.join(this.questsDir, zone, `${cleanName}${extPl}`),
            path.join(this.questsDir, zone, `${npcId}${extLua}`),
            path.join(this.questsDir, zone, `${npcId}${extPl}`)
        ];

        for (let p of pathsToCheck) {
            if (fs.existsSync(p)) return p;
        }
        return null;
    }

    /**
     * wasmoon runs Lua in WASM with no host filesystem — require() cannot open lua_modules/*.lua
     * via package.path. Read modules in Node and register package.preload (require("items"), etc.).
     */
    async installLuaModulePreloads(lua) {
        const lm = path.join(this.questsDir, 'lua_modules');
        if (!fs.existsSync(lm)) return;
        let names;
        try {
            names = fs.readdirSync(lm);
        } catch {
            return;
        }
        for (const f of names) {
            if (!f.endsWith('.lua')) continue;
            const full = path.join(lm, f);
            let st;
            try {
                st = fs.statSync(full);
            } catch {
                continue;
            }
            if (!st.isFile()) continue;
            const modName = f.slice(0, -4);
            let source;
            try {
                source = fs.readFileSync(full, 'utf8');
            } catch {
                continue;
            }
            const literal = JSON.stringify(source);
            const chunkLabel = JSON.stringify(`@lua_modules/${f}`);
            const modKey = JSON.stringify(modName);
            try {
                await lua.doString(`package.preload[${modKey}] = function()
local s = ${literal}
return assert(load(s, ${chunkLabel}))()
end`);
            } catch (e) {
                console.warn(`[QuestManager] Lua preload failed for ${modName}:`, e && e.message ? e.message : e);
            }
        }
    }

    async triggerEvent(zone, npc, player, eventType, eData) {
        const scriptPath = this.getScriptPath(zone, npc.name, npc.key || npc.id || 0);
        if (!scriptPath) return []; // No script found

        let actions = [];

        if (scriptPath.endsWith('.lua')) {
            actions = await this.runLua(scriptPath, npc, player, eventType, eData);
        } else if (scriptPath.endsWith('.pl')) {
            actions = await this.runPerl(scriptPath, npc, player, eventType, eData);
        }

        return actions;
    }

    async runLua(scriptPath, npc, player, eventType, eData) {
        const lua = await factory.createEngine();
        const actions = [];

        /**
         * wasmoon quirk: JS callbacks must not return `null` — `typeof null === "object"` so the value is routed
         * through PromiseTypeExtension, which evaluates `null.then` and throws. Prefer `undefined` or scalars.
         * `node_modules/wasmoon/dist/index.js` is patched to push Lua nil for `null`; keep APIs nil-safe anyway.
         */
        const s = (v) => (v == null ? '' : String(v));
        const n = (v) => {
            if (v == null) return 0;
            const x = Number(v);
            return Number.isFinite(x) ? x : 0;
        };

        const isTradeEvent = eventType.toUpperCase() === 'EVENT_TRADE';
        /** EQ item IDs still owed back to the player after EVENT_TRADE (PEQ item_lib.return_items). */
        let tradeReturnBag = [];
        if (eData.trade && isTradeEvent) {
            for (let i = 1; i <= 4; i++) {
                const id = Number(eData.trade[`item${i}`]);
                if (Number.isFinite(id) && id > 0) tradeReturnBag.push(id);
            }
        }

        const normalizeCounts = (tbl) => {
            const out = {};
            if (!tbl || typeof tbl !== 'object') return out;
            for (const k of Object.keys(tbl)) {
                const v = Number(tbl[k]);
                if (!Number.isFinite(v) || v <= 0) continue;
                out[String(k)] = v;
            }
            return out;
        };

        const removeOneFromBag = (bag, itemId) => {
            const id = Number(itemId);
            const idx = bag.indexOf(id);
            if (idx !== -1) bag.splice(idx, 1);
        };

        const currencyKeys = new Set(['platinum', 'gold', 'silver', 'copper']);

        // Lua Proxy objects — wasmoon: JS functions invoked from Lua must not return `undefined`
        // (bridge treats that as async/Promise and can throw "Cannot read properties of null (reading 'then')").
        const e = {
            self: {
                Say: (msg) => { actions.push({ action: 'say', source: npc.id, msg }); return 0; },
                Shout: (msg) => { actions.push({ action: 'shout', source: npc.id, msg }); return 0; },
                Emote: (msg) => { actions.push({ action: 'emote', source: npc.id, msg }); return 0; },
                DoAnim: (anim) => { actions.push({ action: 'anim', source: npc.id, anim }); return 0; },
                CastSpell: (spellId, targetId, slot, unk) => { actions.push({ action: 'cast', source: npc.id, spellId, targetId }); return 0; },
                GetName: () => s(npc.name),
                GetID: () => n(npc.id),
                GetCleanName: () => s(npc.name).replace(/_/g, ' '),
                GetX: () => n(npc.x),
                GetY: () => n(npc.y),
                GetZ: () => n(npc.z),
                GetHeading: () => n(npc.h),
                CheckHandin: (other, handin, required, item_data) => {
                    const req = normalizeCounts(required);
                    const have = normalizeCounts(handin);

                    let success = true;
                    for (const k of Object.keys(req)) {
                        if ((have[k] || 0) < req[k]) {
                            success = false;
                            break;
                        }
                    }
                    if (!success) return false;

                    if (isTradeEvent) {
                        for (const k of Object.keys(req)) {
                            if (currencyKeys.has(k)) continue;
                            const idNum = Number(k);
                            if (!Number.isFinite(idNum)) continue;
                            const need = req[k];
                            for (let i = 0; i < need; i++) removeOneFromBag(tradeReturnBag, idNum);
                        }
                    }

                    const returned = [];
                    for (const k of Object.keys(have)) {
                        if (currencyKeys.has(k)) continue;
                        const left = have[k] - (req[k] || 0);
                        for (let i = 0; i < left; i++) returned.push(Number(k));
                    }
                    if (returned.length > 0) {
                        if (isTradeEvent) {
                            for (const id of returned) removeOneFromBag(tradeReturnBag, id);
                        }
                        actions.push({ action: 'say', source: npc.id, msg: `I have no need for this, ${s(player.name)}, you can have it back.` });
                        actions.push({ action: 'return_items', returned });
                    }
                    return true;
                },
                ReturnHandinItems: (client) => {
                    if (!isTradeEvent || tradeReturnBag.length === 0) return 0;
                    actions.push({ action: 'say', source: npc.id, msg: `I have no need for this, ${s(player.name)}, you can have it back.` });
                    actions.push({ action: 'return_items', returned: [...tradeReturnBag] });
                    tradeReturnBag.length = 0;
                    return 0;
                }
            },
            other: {
                GetName: () => s(player.name),
                GetID: () => n(player.id),
                GetCleanName: () => s(player.name).replace(/_/g, ' '),
                GetClass: () => n(player.class) || 1,
                Class: () => {
                    const CLASS_NAMES = { 1: "Warrior", 2: "Cleric", 3: "Paladin", 4: "Ranger", 5: "Shadowknight", 6: "Druid", 7: "Monk", 8: "Bard", 9: "Rogue", 10: "Shaman", 11: "Necromancer", 12: "Wizard", 13: "Magician", 14: "Enchanter", 15: "Beastlord", 16: "Berserker" };
                    return CLASS_NAMES[n(player.class) || 1] || "Unknown";
                },
                GetLevel: () => n(player.level) || 1,
                GetFaction: (target) => {
                    // target here is usually e.self, which is npc in this scope
                    const standing = FactionSystem.getStanding(player, npc);
                    return FactionSystem.getRank(standing.value);
                },
                HasItem: (itemId) => {
                    // Check if player has item in inventory (sessions are needed, but player object here is char)
                    const State = require('./state');
                    const session = Array.from(State.sessions.values()).find(s => s.char.id === player.id);
                    if (!session || !session.inventory) return false;
                    return session.inventory.some(i => i.item_key === itemId || i.id === itemId);
                },
                Message: (color, text) => { actions.push({ action: 'message', target: n(player.id), color, text }); return 0; },
                QuestReward: (self, cop, sil, gld, plat, item_id, exp) => {
                    actions.push({
                        action: 'reward',
                        target: player.id,
                        item_id: n(item_id),
                        exp: n(exp),
                        cop: n(cop),
                        sil: n(sil),
                        gld: n(gld),
                        plat: n(plat),
                    });
                    return 0;
                },
                SummonItem: (itemId) => { actions.push({ action: 'reward', target: n(player.id), item_id: n(itemId) }); return 0; },
                AddEXP: (amt) => { actions.push({ action: 'exp', target: n(player.id), amount: n(amt) }); return 0; },
                Ding: () => 0,
                Faction: (_fid, _amt, _rate) => 0,
                GiveCash: (_cop, _sil, _gld, _plat) => 0
            },
            message: eData.message || '',
            joined: eData.joined || false,
            trade: {}
        };

        const eq = {
            /** Quest dialogue links — EQEmu returns bracketed text; MUD shows plain [phrase]. */
            say_link: (phrase, _unused, displayAs) => {
                if (typeof displayAs === 'string' && displayAs.length > 0) {
                    return `[${displayAs}]`;
                }
                return `[${String(phrase ?? '')}]`;
            },
            get_qglobals: (plr) => { return { paladin_epic: "9" }; }, // Stub
            ChooseRandom: (...choices) => {
                const vals = choices.filter((v) => v != null && v !== undefined);
                if (!vals.length) return 0;
                const pick = vals[Math.floor(Math.random() * vals.length)];
                return pick == null ? 0 : pick;
            },
            spawn2: (npc_id, grid, unused, x, y, z, h) => { actions.push({ action: 'spawn2', npc_id, grid, x, y, z, h }); return 0; },
            depop: () => { actions.push({ action: 'depop', source: npc.id, timer: 0 }); return 0; },
            depop_with_timer: () => { actions.push({ action: 'depop', source: npc.id, timer: 1 }); return 0; },
            set_timer: (name, ms) => { actions.push({ action: 'timer', source: npc.id, name, ms }); return 0; },
            set_proximity: (minX, maxX, minY, maxY, minZ, maxZ) => 0,
            zone_emote: (color, text) => { actions.push({ action: 'zone_emote', color, text }); return 0; }
        };

        // Format trade for Lua — always item1..item4 like EQEmu (empty slots valid:false; avoids nil.valid crashes in items.lua).
        if (eData.trade) {
            const eTrade = {
                self: e.self,
                other: e.other,
                platinum: 0, gold: 0, silver: 0, copper: 0
            };
            for (let i = 1; i <= 4; i++) {
                const key = `item${i}`;
                const rawId = eData.trade[key];
                const id = Number(rawId);
                if (Number.isFinite(id) && id > 0) {
                    eTrade[key] = { GetID: () => id, valid: true };
                } else {
                    eTrade[key] = { GetID: () => 0, valid: false };
                }
            }
            e.trade = eTrade;
        }

        lua.global.set('e', e);
        lua.global.set('eq', eq);

        try {
            // Polyfill custom EQEmu Lua methods
            await lua.doString(`
                package.path = package.path .. ";${this.questsDir.replace(/\\/g, '/')}/lua_modules/?.lua"
                MT = MT or { White = 0, Gray = 1, Gray2 = 2, Green = 3, Blue = 4, LightBlue = 5, Black = 6, Light = 7, Light2 = 8, Light3 = 9, Yellow = 15, Red = 16, LightPurple = 20 }
                local string_meta = getmetatable("")
                string_meta.__index.findi = function(self, pattern)
                    if not self or not pattern then return nil end
                    return string.find(string.lower(self), string.lower(pattern))
                end
            `);

            // wasmoon Lua cannot open host files — require("items") would always fail.
            // Register package.preload for each lua_modules/*.lua (PEQ require("items"), etc.).
            await this.installLuaModulePreloads(lua);

            const scriptContent = fs.readFileSync(scriptPath, 'utf8');
            await lua.doString(scriptContent);

            const eventFuncName = eventType.toLowerCase(); // e.g. event_say
            if (lua.global.get(eventFuncName)) {
                await lua.doString(`${eventFuncName}(e)`);
            }
        } catch (err) {
            console.error(`[Lua Error] ${scriptPath}:`, err);
        } finally {
            lua.global.close();
        }

        return actions;
    }

    async runPerl(scriptPath, npc, player, eventType, eData) {
        return new Promise((resolve) => {
            const perlWrapper = path.join(this.questsDir, 'perl_wrapper.pl');
            
            const itemcount = {};
            if (eData.trade) {
                for (const itemId of Object.values(eData.trade)) {
                    if (itemId && itemId > 0) {
                        itemcount[itemId] = (itemcount[itemId] || 0) + 1;
                    }
                }
            }
            
            const cid = player.class || 1;
            const argsObj = {
                script_path: scriptPath,
                event_type: eventType.toUpperCase(), // e.g. EVENT_SAY
                text: eData.message || '',
                name: player.name,
                class: cid,
                class_name: PEQ_CLASS_NAMES[cid] || 'Warrior',
                race: player.race || 1,
                ulevel: player.level || 1,
                itemcount: itemcount,
                item1: eData.trade ? eData.trade.item1 : 0,
                item2: eData.trade ? eData.trade.item2 : 0,
                item3: eData.trade ? eData.trade.item3 : 0,
                item4: eData.trade ? eData.trade.item4 : 0,
                platinum: eData.trade ? (eData.trade.platinum || 0) : 0,
                gold: eData.trade ? (eData.trade.gold || 0) : 0,
                silver: eData.trade ? (eData.trade.silver || 0) : 0,
                copper: eData.trade ? (eData.trade.copper || 0) : 0,
                quests_dir: this.questsDir
            };

            const jsonArg = JSON.stringify(argsObj);
            
            execFile('perl', [perlWrapper, jsonArg], (error, stdout, stderr) => {
                const actions = [];
                if (stdout) {
                    const lines = stdout.split('\n');
                    for (let line of lines) {
                        line = line.trim();
                        if (!line) continue;
                        try {
                            const act = JSON.parse(line);
                            act.source = npc.id;
                            if (act.action === 'message' || act.action === 'summonitem' || act.action === 'exp'
                                || act.action === 'faction' || act.action === 'givecash' || act.action === 'ding') {
                                act.target = player.id;
                            }
                            actions.push(act);
                        } catch (e) {
                            // Non-JSON output from Perl (e.g. warnings)
                            console.warn(`[Perl Output] ${line}`);
                        }
                    }
                }
                if (stderr) {
                    console.error(`[Perl Error] ${scriptPath}:`, stderr);
                }
                resolve(actions);
            });
        });
    }
}

module.exports = new QuestManager();
