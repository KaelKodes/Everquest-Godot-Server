const { MQWrapper } = require('../botEngine');
const SpellDB = require('../../data/spellDatabase');
const { send } = require('../../utils');

/**
 * BaseBot - The foundational orchestrator for all MacroQuest-style Bots.
 * This acts as the generic state machine that class profiles (like Cleric) will extend.
 * It provides the standard E3/KissAssist loop: Heals -> Combat -> Buffs -> Movement.
 */
class BaseBot {
    constructor(session) {
        this.session = session;
        this.mq = new MQWrapper(session);
        
        // Configuration options that profiles can tweak
        this.config = {
            assistPct: 98,       // When to engage
            followDistance: 15,
            medPct: 40           // When to sit and med out of combat
        };
        
        // Active state
        this.stance = 'balanced'; // aggressive, balanced, conservative, passive
        this.actionQueue = [];
        this.state = 'idle';
    }

    /**
     * The main AI loop. Called every server tick.
     */
    tick() {
        // 1. If we are currently casting, do nothing else.
        if (this.session.casting) return;

        // 2. Process Chat Commands / Overrides first
        if (this.actionQueue.length > 0) {
            const action = this.actionQueue.shift();
            this.executeAction(action);
            return;
        }

        // 3. The Core MacroQuest-style State Machine Priority List
        if (this.CheckHeals()) return;
        if (this.CheckCombat()) return;
        if (this.CheckBuffs()) return;
        this.CheckMovement();
        this.CheckMedding();
        this.CheckSurvival();
    }

    /**
     * Executes forced actions (like chat commands)
     */
    executeAction(action) {
        if (action.type === 'CAST') {
            this.mq.cmdf('/cast "%s"', action.spellName);
            // In a full implementation, we'd find the spell ID in their spellbook
            // and trigger `SpellSystem.handleCast`.
        } else if (action.type === 'TARGET') {
            this.mq.cmdf('/target "%s"', action.targetName);
        }
    }

    // ==========================================
    // CHAT PARSER & INTERACTION
    // ==========================================

    /**
     * Called when a player whispers or speaks in group chat to the bot.
     */
    handleChat(text, sender) {
        const char = this.session.char;
        text = text.toLowerCase();

        // 1. Missing Spells
        if (text.includes('missing spells') || text.includes('missing any spells')) {
            const myClass = char.class;
            let minLvl = 1;
            let maxLvl = char.level;

            // Parse levels: "for level 9" or "levels 6 to 10" or "levels 6 and 10"
            const matchRange = text.match(/levels?\s+(\d+)\s+(?:to|and)\s+(\d+)/);
            const matchSingle = text.match(/level\s+(\d+)/);

            if (matchRange) {
                minLvl = parseInt(matchRange[1]);
                maxLvl = parseInt(matchRange[2]);
            } else if (matchSingle) {
                minLvl = parseInt(matchSingle[1]);
                maxLvl = parseInt(matchSingle[1]);
            }

            const allSpells = SpellDB.getSpellsForClass(myClass, maxLvl).filter(s => {
                const lvl = s.classes[myClass.toLowerCase().replace(/_/g, '')];
                return lvl >= minLvl && lvl <= maxLvl;
            });

            const scribed = new Set((this.session.spellbook || []).map(s => s.spell_key));
            const missing = allSpells.filter(s => !scribed.has(s._key));

            if (missing.length === 0) {
                this.replyGroup(`I have all my spells up to level ${maxLvl}, ${sender}!`);
            } else {
                const spellNames = missing.map(s => s.name).slice(0, 10).join(', ');
                const more = missing.length > 10 ? ` and ${missing.length - 10} more.` : '.';
                this.replyGroup(`I am missing ${missing.length} spells. For example: ${spellNames}${more}`);
            }
            return;
        }

        // 2. Supply Check
        if (text.includes('supply check')) {
            const inventory = this.session.inventory || {};
            // Very naive check for items with food/water/bandage tags
            // For now, we'll just mock it or check their actual inventory array if it's populated.
            let foodCount = 0;
            let waterCount = 0;
            let bandagesCount = 0;

            if (Array.isArray(inventory.slots)) {
                for (const slot of inventory.slots) {
                    if (!slot.item) continue;
                    const name = slot.item.name.toLowerCase();
                    if (name.includes('ration') || name.includes('loaf') || name.includes('pie')) foodCount += slot.count || 1;
                    if (name.includes('water') || name.includes('milk') || name.includes('ale')) waterCount += slot.count || 1;
                    if (name.includes('bandage')) bandagesCount += slot.count || 1;
                }
            }

            this.replyGroup(`Supply Report: I have ${foodCount} food, ${waterCount} water, and ${bandagesCount} bandages, ${sender}.`);
            return;
        }

        // 3. Command: Heal me!
        if (text.includes('heal me')) {
            this.replyGroup(`On it!`);
            this.actionQueue.push({ type: 'TARGET', targetName: sender });
            // Let the class profile decide *what* to cast based on missing HP
            // But we can force a generic cast here if we want.
            return;
        }
        
        // 4. Command: Buff us!
        if (text.includes('buff')) {
            this.replyGroup(`Checking buffs for everyone now!`);
            // The AI loop will naturally pick this up if we flag it.
            return;
        }

        // 5. Command: Camp
        if (text.includes('camp here')) {
            this.config.campX = char.x;
            this.config.campY = char.y;
            this.config.campZ = char.z;
            this.config.isCamping = true;
            this.replyGroup(`I am setting up camp here. I will return to this spot after combat!`);
            return;
        }

        // 6. Command: Follow
        if (text.includes('follow me')) {
            this.config.isCamping = false;
            this.replyGroup(`Breaking camp. I'm right behind you!`);
            return;
        }

        // 7. Dynamic Configuration (e.g., "set HealAt 80" or "set MAINTANK HealAt 90")
        if (text.startsWith('set ')) {
            const parts = text.split(' ').slice(1); // Remove "set"
            if (parts.length === 2) {
                // "set HealAt 80"
                const key = parts[0];
                const value = parseInt(parts[1]);
                this.config[key] = value;
                this.replyGroup(`I have updated my default ${key} to ${value}.`);
            } else if (parts.length === 3) {
                // "set MAINTANK HealAt 90" or "set Kael HealAt 90"
                const targetName = parts[0].toLowerCase();
                const key = parts[1];
                const value = parseInt(parts[2]);
                if (!this.config.targetOverrides) this.config.targetOverrides = {};
                if (!this.config.targetOverrides[targetName]) this.config.targetOverrides[targetName] = {};
                this.config.targetOverrides[targetName][key] = value;
                this.replyGroup(`Got it. For ${targetName}, I will use ${value} for ${key}.`);
            }
            return;
        }
    }

    /**
     * Gets a configuration value, checking target-specific overrides first.
     */
    GetConfig(key, targetSession = null) {
        if (targetSession && this.config.targetOverrides) {
            const charName = targetSession.char.name.toLowerCase();
            // Check direct name
            if (this.config.targetOverrides[charName] && this.config.targetOverrides[charName][key] !== undefined) {
                return this.config.targetOverrides[charName][key];
            }
            // Check roles
            const group = this.session.group;
            if (group && group.roles) {
                if (group.roles.mainTank === targetSession.char.id && this.config.targetOverrides['maintank'] && this.config.targetOverrides['maintank'][key] !== undefined) {
                    return this.config.targetOverrides['maintank'][key];
                }
                if (group.roles.puller === targetSession.char.id && this.config.targetOverrides['puller'] && this.config.targetOverrides['puller'][key] !== undefined) {
                    return this.config.targetOverrides['puller'][key];
                }
            }
        }
        return this.config[key];
    }

    /**
     * Checks if we have the reagent for a spell before casting.
     * Reports in group chat if we are missing it!
     */
    CheckReagents(spellName) {
        const spellDef = SpellDB.getByName(spellName);
        if (!spellDef || !spellDef.reagents) return true; // No reagents needed

        const inventory = this.session.inventory || {};
        const slots = inventory.slots || [];

        for (const reagentId of Object.keys(spellDef.reagents)) {
            const reqCount = spellDef.reagents[reagentId];
            if (reqCount > 0) {
                // Check if we have this item ID in inventory
                // For this example, we pretend we know the name of the missing item
                const hasReagent = slots.some(s => s.item && s.item.id == reagentId && s.count >= reqCount);
                if (!hasReagent) {
                    this.replyGroup(`I am trying to cast ${spellName} but I have no [Item ${reagentId}]!`);
                    return false;
                }
            }
        }
        return true;
    }

    replyGroup(text) {
        // Broadcast to group or say locally
        const channel = this.session.group ? 'group' : 'say';
        // In a real implementation we'd route this back through chat.js or directly broadcast
        // For now, we simulate the output to the owner
        const ownerSession = Array.from(require('../../state').sessions.values()).find(s => s.char && s.char.name === this.session.ownerCharName);
        if (ownerSession) {
            send(ownerSession.ws, { type: 'CHAT', channel: channel, sender: this.session.char.name, text: text });
        }
    }

    // ==========================================
    // OVERRIDABLE ROUTINES (For Class Profiles)
    // ==========================================

    /**
     * CheckHeals: Primarily overridden by Priests.
     * Returns true if a heal was initiated, halting further logic this tick.
     */
    CheckHeals() {
        return false; // Base bots do not heal
    }

    /**
     * CheckCombat: Engage targets, position for melee, cast nukes/dots.
     */
    CheckCombat() {
        const maTarget = this.mq.TLO.Me.GroupAssistTarget();
        const myTarget = this.mq.TLO.Target;

        if (maTarget.ID() > 0 && maTarget.PctHPs() <= this.config.assistPct) {
            if (myTarget.ID() !== maTarget.ID()) {
                maTarget.DoTarget(); // Auto-assist!
            }
            // By default, turn on auto-attack if it's a melee class
            // (Casters will override this to cast nukes instead)
            if (!this.session.char.autoAttack) {
                // Toggle attack logic here
            }
            return true;
        }
        return false;
    }

    /**
     * CheckBuffs: Recast faded buffs on self and group.
     */
    CheckBuffs() {
        // Base bots have no buffs to cast.
        return false;
    }

    /**
     * CheckMovement: Follow the group leader if out of combat.
     */
    CheckMovement() {
        // If we are in combat, positioning is handled by CheckCombat.
        if (this.session.inCombat) return;

        const group = this.session.group;
        if (group && group.members.length > 0) {
            const me = this.session.char;
            
            // If we are camping, move towards the camp spot instead of the leader
            let targetX, targetY, targetZ;
            let followRadius = 0;

            if (this.config.isCamping) {
                targetX = this.config.campX;
                targetY = this.config.campY;
                targetZ = this.config.campZ || 0;
                followRadius = 5; // Get close to camp center
            } else {
                const leader = group.members[0].char;
                // DO NOT follow the leader if they are the designated puller
                if (group.roles && group.roles.puller === leader.id) {
                    // Fall back to following the main assist or main tank instead
                    const alternateTargetId = group.roles.mainTank || group.roles.mainAssist;
                    const alternateMember = alternateTargetId ? group.members.find(m => m.char.id === alternateTargetId) : null;
                    if (alternateMember && alternateMember.char.id !== leader.id) {
                        targetX = alternateMember.char.x;
                        targetY = alternateMember.char.y;
                        targetZ = alternateMember.char.z || 0;
                    } else {
                        return; // No one safe to follow, just stay put
                    }
                } else {
                    targetX = leader.x;
                    targetY = leader.y;
                    targetZ = leader.z || 0;
                }
                followRadius = this.config.followDistance;
            }
            
            // Simple distance check
            const dx = targetX - me.x;
            const dy = targetY - me.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > followRadius) {
                // Determine direction
                const angle = Math.atan2(dy, dx);
                
                // Base running speed is roughly 30 units per second. 
                // Assuming tick rate is 2x a second, we'll cap movement at 15 units per tick.
                const speed = 15.0; 
                
                // Move towards the target, but stop exactly at the follow distance
                const moveDist = Math.min(speed, dist - followRadius);

                me.x += Math.cos(angle) * moveDist;
                me.y += Math.sin(angle) * moveDist;
                me.heading = angle;
                
                // Snap Z to target's Z for now
                me.z = targetZ;

                // Sync the movement to all players in the zone
                const State = require('../../state');
                for (const [ws, otherSession] of State.sessions) {
                    if (otherSession.char && otherSession.char.zoneId === me.zoneId) {
                        try {
                            ws.send(JSON.stringify({
                                type: 'MOB_MOVE',
                                id: `player_${me.id}`, // Students are registered as player entities
                                x: me.x,
                                y: me.y,
                                z: me.z,
                                heading: me.heading
                            }));
                        } catch (e) {
                            // ignore dropped websockets
                        }
                    }
                }
            }
        }
    }

    /**
     * CheckMedding: Sit down to regen mana/endurance if low and safe.
     */
    CheckMedding() {
        if (this.session.inCombat) return;
        
        const myPctMana = (this.session.char.mana / this.session.effectiveStats.mana) * 100;
        if (myPctMana < this.config.medPct && this.session.char.state !== 'sitting') {
            this.session.char.state = 'sitting';
            // Emulate /sit
        } else if (myPctMana >= 95 && this.session.char.state === 'sitting') {
            this.session.char.state = 'standing';
            // Emulate /stand
        }
    }

    /**
     * CheckSurvival: Complain if we are out of food or water!
     * Throttled so we don't spam.
     */
    CheckSurvival() {
        const now = Date.now();
        // Only run the check every 60 seconds
        if (this._lastSurvivalCheck && now - this._lastSurvivalCheck < 60000) return;
        this._lastSurvivalCheck = now;

        const inventory = this.session.inventory || {};
        const slots = inventory.slots || [];
        let hasFood = false;
        let hasWater = false;

        for (const slot of slots) {
            if (!slot.item) continue;
            const name = slot.item.name.toLowerCase();
            if (name.includes('ration') || name.includes('loaf') || name.includes('pie') || name.includes('meat') || name.includes('muffin')) hasFood = true;
            if (name.includes('water') || name.includes('milk') || name.includes('ale') || name.includes('mead') || name.includes('drink')) hasWater = true;
        }

        // 25% chance to complain if missing water
        if (!hasWater && Math.random() < 0.25) {
            const complaints = [
                "I have run out of water...",
                "I could really use a drink soon.",
                "My throat is parched...",
                "Get me to some water, you... ugh!",
                "I am so thirsty, I can barely cast."
            ];
            this.replyGroup(complaints[Math.floor(Math.random() * complaints.length)]);
            return; // Only complain about one thing at a time
        }

        // 25% chance to complain if missing food
        if (!hasFood && Math.random() < 0.25) {
            const complaints = [
                "I am starving! Do you have any food?",
                "My stomach is growling louder than an orc...",
                "I need rations, or I'm not going to be much use to you.",
                "I'm completely out of food."
            ];
            this.replyGroup(complaints[Math.floor(Math.random() * complaints.length)]);
        }
    }
}

module.exports = BaseBot;
