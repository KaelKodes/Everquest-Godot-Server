const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { LuaFactory } = require('wasmoon');

const factory = new LuaFactory();

class QuestManager {
    constructor() {
        this.questsDir = path.join(__dirname, 'quests');
    }

    getScriptPath(zone, npcName, npcId) {
        const extLua = '.lua';
        const extPl = '.pl';
        
        // Clean name (e.g. Guard_Valon)
        const cleanName = npcName.replace(/ /g, '_').replace(/#/g, '');
        
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

        // Lua Proxy objects
        const e = {
            self: {
                Say: (msg) => actions.push({ action: 'say', source: npc.id, msg }),
                Shout: (msg) => actions.push({ action: 'shout', source: npc.id, msg }),
                Emote: (msg) => actions.push({ action: 'emote', source: npc.id, msg }),
                DoAnim: (anim) => actions.push({ action: 'anim', source: npc.id, anim }),
                CastSpell: (spellId, targetId, slot, unk) => actions.push({ action: 'cast', source: npc.id, spellId, targetId }),
                GetName: () => npc.name,
                GetID: () => npc.id,
                GetCleanName: () => npc.name.replace(/_/g, ' '),
                GetX: () => npc.x,
                GetY: () => npc.y,
                GetZ: () => npc.z,
                GetHeading: () => npc.h,
                CheckHandin: (other, handin, required, item_data) => {
                    let success = true;
                    for (const k of Object.keys(required)) {
                        if ((handin[k] || 0) < required[k]) {
                            success = false;
                            break;
                        }
                    }
                    if (success) {
                        const returned = [];
                        for (const k of Object.keys(handin)) {
                            let left = handin[k] - (required[k] || 0);
                            for (let i=0; i<left; i++) {
                                returned.push(parseInt(k));
                            }
                        }
                        if (returned.length > 0) {
                            actions.push({ action: 'say', source: npc.id, msg: `I have no need for this, ${player.name}, you can have it back.` });
                            actions.push({ action: 'return_items', returned });
                        }
                        return true;
                    }
                    return false;
                },
                ReturnHandinItems: (client) => {
                    const returned = [];
                    if (eData.trade) {
                        for (const v of Object.values(eData.trade)) {
                            returned.push(v);
                        }
                    }
                    if (returned.length > 0) {
                        actions.push({ action: 'say', source: npc.id, msg: `I have no need for this, ${player.name}, you can have it back.` });
                        actions.push({ action: 'return_items', returned });
                    }
                }
            },
            other: {
                GetName: () => player.name,
                GetID: () => player.id,
                GetCleanName: () => player.name.replace(/_/g, ' '),
                GetClass: () => player.class || 1,
                Class: () => {
                    const CLASS_NAMES = { 1: "Warrior", 2: "Cleric", 3: "Paladin", 4: "Ranger", 5: "Shadowknight", 6: "Druid", 7: "Monk", 8: "Bard", 9: "Rogue", 10: "Shaman", 11: "Necromancer", 12: "Wizard", 13: "Magician", 14: "Enchanter", 15: "Beastlord", 16: "Berserker" };
                    return CLASS_NAMES[player.class || 1] || "Unknown";
                },
                GetLevel: () => player.level || 1,
                Message: (color, text) => actions.push({ action: 'message', target: player.id, color, text }),
                QuestReward: (self, cop, sil, gld, plat, item_id, exp) => 
                    actions.push({ action: 'reward', target: player.id, item_id, exp, cop, sil, gld, plat }),
                AddEXP: (amt) => actions.push({ action: 'exp', target: player.id, amount: amt })
            },
            message: eData.message || '',
            joined: eData.joined || false,
            trade: eData.trade || {}
        };

        lua.global.set('e', e);

        const eq = {
            get_qglobals: (plr) => { return { paladin_epic: "9" }; }, // Stub
            spawn2: (npc_id, grid, unused, x, y, z, h) => 
                actions.push({ action: 'spawn2', npc_id, grid, x, y, z, h }),
            depop: () => actions.push({ action: 'depop', source: npc.id, timer: 0 }),
            depop_with_timer: () => actions.push({ action: 'depop', source: npc.id, timer: 1 }),
            set_timer: (name, ms) => actions.push({ action: 'timer', source: npc.id, name, ms }),
            zone_emote: (color, text) => actions.push({ action: 'zone_emote', color, text })
        };

        // Format trade for Lua
        if (eData.trade) {
            const eTrade = {
                self: e.self,
                other: e.other,
                platinum: 0, gold: 0, silver: 0, copper: 0
            };
            for (const [k, v] of Object.entries(eData.trade)) {
                eTrade[k] = { GetID: () => v, valid: true };
            }
            e.trade = eTrade;
        }

        lua.global.set('e', e);
        lua.global.set('eq', eq);

        try {
            // Polyfill custom EQEmu Lua methods
            await lua.doString(`
                package.path = package.path .. ";${this.questsDir.replace(/\\/g, '/')}/lua_modules/?.lua"
                local string_meta = getmetatable("")
                string_meta.__index.findi = function(self, pattern)
                    if not self or not pattern then return nil end
                    return string.find(string.lower(self), string.lower(pattern))
                end
            `);

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
            
            const argsObj = {
                script_path: scriptPath,
                event_type: eventType.toUpperCase(), // e.g. EVENT_SAY
                text: eData.message || '',
                name: player.name,
                class: player.class || 1,
                race: player.race || 1,
                ulevel: player.level || 1,
                itemcount: itemcount
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
                            if (act.action === 'message' || act.action === 'summonitem' || act.action === 'exp') {
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
