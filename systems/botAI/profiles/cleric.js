const BaseBot = require('../baseBot');

/**
 * Cleric Profile
 * Implements Priest-specific logic, focusing heavily on Group Health monitoring,
 * efficient healing (Complete Heal vs Fast Heal), and maintaining Aegolism/Armor buffs.
 */
class ClericBot extends BaseBot {
    constructor(session) {
        super(session);
        
        // Cleric-specific configuration
        this.config.medPct = 60; // Clerics med earlier to ensure emergency mana
        
        // Thresholds based on classic KissAssist cleric setups
        // Registered in this.config so GetConfig() can read/override them via chat!
        this.config.HealAt = 60;        // Standard heal threshold
        this.config.TankHealAt = 40;    // When to Complete Heal
        this.config.PanicHealAt = 20;   // When to spam fast heals
        this.config.HoTAt = 85;         // When to toss a Heal-over-Time

        // Cache spell names so we don't hardcode IDs (The BotEngine maps these later)
        this.spells = {
            completeHeal: "Complete Healing",
            fastHeal: "Remedy",
            hot: "Celestial Healing",
            groupHpBuff: "Aegolism",
            acBuff: "Armor of Faith"
        };
    }

    /**
     * Overrides CheckHeals from BaseBot.
     * Evaluates the group's health array and determines the optimal heal to cast.
     */
    CheckHeals() {
        const group = this.session.group;
        if (!group) return false;

        let lowestPct = 100;
        let lowestTarget = null;
        let lowestSession = null;
        let isTank = false;

        // Scan the group to find who needs healing the most
        for (let i = 0; i < group.members.length; i++) {
            const memberSession = group.members[i].session;
            if (!memberSession || !memberSession.char) continue;

            const memberHp = memberSession.char.hp;
            const memberMaxHp = memberSession.effectiveStats ? memberSession.effectiveStats.hp : 100;
            const pct = (memberHp / memberMaxHp) * 100;

            if (pct < lowestPct) {
                lowestPct = pct;
                lowestTarget = memberSession.char;
                lowestSession = memberSession;
                
                // Treat the group leader (index 0) or explicitly assigned MainTank role as the Tank
                isTank = (i === 0 || (group.roles && group.roles.mainTank === memberSession.char.id));
            }
        }

        if (!lowestTarget || lowestPct >= 95) return false;

        // Resolve thresholds dynamically using GetConfig (allows chat overrides)
        const panicHealAt = this.GetConfig('PanicHealAt', lowestSession);
        const tankHealAt = this.GetConfig('TankHealAt', lowestSession);
        const healAt = this.GetConfig('HealAt', lowestSession);
        const hotAt = this.GetConfig('HoTAt', lowestSession);

        // Decision Tree: What heal to cast?
        if (isTank) {
            if (lowestPct <= panicHealAt) {
                // PANIC FAST HEAL!
                this.mq.cmdf('/target "%s"', lowestTarget.name);
                this.mq.cmdf('/cast "%s"', this.spells.fastHeal);
                return true; // We took an action, halt the tick
            } 
            if (lowestPct <= tankHealAt) {
                // STANDARD COMPLETE HEAL
                this.mq.cmdf('/target "%s"', lowestTarget.name);
                this.mq.cmdf('/cast "%s"', this.spells.completeHeal);
                return true;
            }
        } else {
            // Squishy targeting (DPS / Casters)
            if (lowestPct <= healAt) {
                this.mq.cmdf('/target "%s"', lowestTarget.name);
                this.mq.cmdf('/cast "%s"', this.spells.fastHeal);
                return true;
            }
        }

        // If they are between 85 and 95, maybe just toss a HoT
        if (lowestPct <= hotAt) {
            this.mq.cmdf('/target "%s"', lowestTarget.name);
            this.mq.cmdf('/cast "%s"', this.spells.hot);
            return true;
        }

        return false;
    }

    /**
     * Overrides CheckBuffs.
     * Clerics need to make sure the group has HP buffs.
     */
    CheckBuffs() {
        if (this.session.inCombat) return false; // Don't buff during combat

        const myManaPct = (this.session.char.mana / this.session.effectiveStats.mana) * 100;
        if (myManaPct < 40) return false; // Save mana for heals

        const group = this.session.group;
        if (!group) return false;

        for (const member of group.members) {
            const mSession = member.session;
            if (!mSession) continue;

            // Use the MQ Wrapper to evaluate their buffs
            const tloMember = new this.mq.TLO.Spawn(mSession.char, mSession);
            
            // If they don't have our primary HP buff
            if (!tloMember.Buff(this.spells.groupHpBuff)()) {
                this.mq.cmdf('/target "%s"', mSession.char.name);
                this.mq.cmdf('/cast "%s"', this.spells.groupHpBuff);
                return true; // Cast initiated
            }
        }

        return super.CheckBuffs();
    }
}

module.exports = ClericBot;
