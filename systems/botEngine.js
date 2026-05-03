const gameEngine = require('../gameEngine'); // We might need to require parts or pass them in to avoid circular dependencies.

/**
 * MacroQuest API Wrapper (The TLO Bridge)
 * This file maps EQMUD's internal server state into the Top-Level Objects (TLOs)
 * expected by MacroQuest scripts (e.g., mq.TLO.Me.PctHPs()).
 */

class TLO_Class {
    constructor(classId) {
        this.classId = classId;
    }
    
    ShortName() {
        // Map EQ classes to short names
        const names = {
            1: 'WAR', 2: 'CLR', 3: 'PAL', 4: 'RNG', 5: 'SHD', 6: 'DRU', 7: 'MNK', 
            8: 'BRD', 9: 'ROG', 10: 'SHM', 11: 'NEC', 12: 'WIZ', 13: 'MAG', 14: 'ENC'
        };
        return names[this.classId] || 'UNK';
    }
}

class TLO_Spawn {
    constructor(entity, session) {
        this.entity = entity; // The server mob/character object
        this.session = session; // The bot's session context
    }

    ID() { return this.entity ? this.entity.id : 0; }
    DisplayName() { return this.entity ? this.entity.name : 'NULL'; }
    CleanName() { return this.DisplayName(); } // We don't have titles/lastnames right now
    
    PctHPs() { 
        if (!this.entity) return 0;
        const maxHp = this.entity.maxHp || (this.entity.effectiveStats ? this.entity.effectiveStats.hp : 100);
        if (maxHp <= 0) return 0;
        return Math.floor((this.entity.hp / maxHp) * 100);
    }
    
    Class() { return new TLO_Class(this.entity ? this.entity.class : 1); }
    
    DoTarget() {
        if (!this.entity || !this.session) return false;
        // In EQMUD, targeting is done by ID strings or names
        // But the server's internal Target object expects the actual object reference
        this.session.combatTarget = this.entity;
        // Broadcast target update
        // We will need a safe way to call `sendStatus(this.session)` from here eventually
        return true;
    }
}

class TLO_Me extends TLO_Spawn {
    constructor(session) {
        super(session.char, session);
    }

    // `mq.TLO.Me.GroupAssistTarget` returns a Spawn
    GroupAssistTarget() {
        // For now, if we are in a group, return the MA's target.
        // Assuming the first person in group is MA for MVP.
        const group = this.session.group;
        if (group && group.members.length > 0) {
            const ma = group.members[0];
            if (ma.session && ma.session.combatTarget) {
                return new TLO_Spawn(ma.session.combatTarget, this.session);
            }
        }
        return new TLO_Spawn(null, this.session);
    }
    
    Buff(buffName) {
        return () => {
            if (!this.entity.buffs) return false;
            return this.entity.buffs.some(b => b.name === buffName);
        };
    }
}

class TLO_Target extends TLO_Spawn {
    constructor(session) {
        super(session.combatTarget, session);
    }
}

class MQWrapper {
    constructor(session) {
        this.session = session;
        this.TLO = {
            Me: new TLO_Me(session),
            Target: new TLO_Target(session)
        };
    }
    
    cmdf(cmd, ...args) {
        // Simple printf style formatting
        let formatted = cmd;
        args.forEach(arg => {
            formatted = formatted.replace('%s', arg);
        });
        
        console.log(`[MQ] ${this.session.char.name} executes: ${formatted}`);
        
        // Parse the slash command
        const parts = formatted.split(' ');
        const baseCmd = parts[0].toLowerCase();
        
        if (baseCmd === '/target') {
            const tgtName = parts.slice(1).join(' ');
            // Normally we'd search the zone for tgtName. 
            // For now, we stub this out or hook it into gameEngine.js handleTargetName
        } else if (baseCmd === '/cast') {
            // e.g. /cast "Spirit of Wolf"
            const spellName = formatted.match(/"([^"]+)"/);
            if (spellName) {
                // hook to SpellSystem.handleCast
            }
        }
    }
    
    delay(ms, conditionFunc) {
        // In lua scripts, mq.delay halts the script's thread.
        // Since JS is async, we can't do a true blocking sleep easily without async/await
        // The lua engine (fengari) can handle coroutine yields, but if we do this in native JS, we need Promises.
    }
}

module.exports = { MQWrapper, TLO_Spawn };
