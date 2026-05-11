/**
 * MacroQuest API Wrapper (The TLO Bridge)
 * Maps EQMUD state into TLO-style objects for bot profiles.
 * `/cast` and `/target` resolve through gameEngine (lazy require to avoid load cycles).
 */

const State = require('../state');

class TLO_Class {
  constructor(classId) {
    this.classId = classId;
  }

  ShortName() {
    const names = {
      1: 'WAR', 2: 'CLR', 3: 'PAL', 4: 'RNG', 5: 'SHD', 6: 'DRU', 7: 'MNK',
      8: 'BRD', 9: 'ROG', 10: 'SHM', 11: 'NEC', 12: 'WIZ', 13: 'MAG', 14: 'ENC',
    };
    return names[this.classId] || 'UNK';
  }
}

/**
 * @param {*} entity — `char` object, mob object, or null
 * @param {*} observerSession — session that receives `DoTarget` (usually the bot)
 * @param {*} buffSourceSession — optional player session whose `buffs` match `entity` (for group buff checks)
 */
class TLO_Spawn {
  constructor(entity, observerSession, buffSourceSession = null) {
    this.entity = entity;
    this.session = observerSession;
    this.buffSourceSession = buffSourceSession;
  }

  ID() {
    if (!this.entity) return 0;
    return this.entity.id;
  }

  DisplayName() {
    return this.entity ? this.entity.name : 'NULL';
  }

  CleanName() {
    return this.DisplayName();
  }

  PctHPs() {
    if (!this.entity) return 0;
    const maxHp = this.entity.maxHp
      || (this.entity.effectiveStats ? this.entity.effectiveStats.hp : 100);
    if (maxHp <= 0) return 0;
    return Math.floor(((this.entity.hp || 0) / maxHp) * 100);
  }

  Class() {
    return new TLO_Class(this.entity ? this.entity.class : 1);
  }

  /**
   * Sets `observerSession.combatTarget` to a mob ref, pet, or **player session** (for heals/buffs/rez).
   */
  DoTarget() {
    if (!this.session) return false;
    if (this.buffSourceSession && this.buffSourceSession.char) {
      this.session.combatTarget = this.buffSourceSession;
      return true;
    }
    if (this.entity) {
      this.session.combatTarget = this.entity;
      return true;
    }
    return false;
  }

  Buff(buffName) {
    return () => {
      let buffList = [];
      if (this.buffSourceSession && this.entity && this.buffSourceSession.char
          && this.buffSourceSession.char.id === this.entity.id) {
        buffList = this.buffSourceSession.buffs || [];
      } else if (this.session && this.entity && this.session.char
          && this.session.char.id === this.entity.id) {
        buffList = this.session.buffs || [];
      } else {
        buffList = this.entity?.buffs || [];
      }
      const want = String(buffName || '').toLowerCase();
      return buffList.some((b) => String(b.name || '').toLowerCase() === want
        || String(b.spellName || '').toLowerCase() === want);
    };
  }
}

class TLO_Me extends TLO_Spawn {
  constructor(session) {
    super(session.char, session, session);
  }

  GroupAssistTarget() {
    const group = this.session.group;
    if (!group || group.members.length === 0) {
      return new TLO_Spawn(null, this.session, null);
    }
    const maId = group.roles != null ? group.roles.mainAssist : null;
    const maMem = maId != null
      ? group.members.find((m) => m.char.id === maId)
      : null;
    const ma = maMem || group.members[0];
    if (!ma || !ma.combatTarget) {
      return new TLO_Spawn(null, this.session, null);
    }
    const ct = ma.combatTarget;
    if (ct.char) {
      return new TLO_Spawn(ct.char, this.session, ct);
    }
    return new TLO_Spawn(ct, this.session, null);
  }
}

class TLO_Target extends TLO_Spawn {
  constructor(session) {
    const ct = session.combatTarget;
    if (!ct) {
      super(null, session, null);
    } else if (ct.char) {
      super(ct.char, session, ct);
    } else {
      super(ct, session, null);
    }
  }
}

class MQWrapper {
  constructor(session) {
    this.session = session;
    this.TLO = {
      Me: new TLO_Me(session),
      Target: new TLO_Target(session),
      Spawn: TLO_Spawn,
    };
  }

  /**
   * Execute a MacroQuest-style slash command for this bot session.
   * @returns {Promise<boolean>}
   */
  async cmdf(cmd, ...args) {
    let formatted = cmd;
    args.forEach((arg) => {
      formatted = formatted.replace('%s', arg);
    });

    console.log(`[MQ] ${this.session.char?.name || '?'} executes: ${formatted}`);

    const parts = formatted.trim().split(/\s+/);
    const baseCmd = parts[0].toLowerCase();

    if (baseCmd === '/target') {
      const m = formatted.match(/"([^"]+)"/);
      const rawName = (m ? m[1] : parts.slice(1).join(' ')).trim();
      if (!rawName) return false;
      const want = rawName.toLowerCase();
      const zoneId = this.session.char.zoneId;
      for (const [, s] of State.sessions) {
        if (s.char && s.char.zoneId === zoneId && s.char.name.toLowerCase() === want) {
          this.session.combatTarget = s;
          return true;
        }
      }
      const zoneInst = State.zoneInstances && State.zoneInstances[zoneId];
      if (zoneInst && zoneInst.liveMobs) {
        const mob = zoneInst.liveMobs.find((x) => String(x.name || '').toLowerCase() === want
          || String(x.originalName || '').toLowerCase() === want);
        if (mob) {
          this.session.combatTarget = mob;
          return true;
        }
      }
      return false;
    }

    if (baseCmd === '/cast') {
      const spellMatch = formatted.match(/"([^"]+)"/);
      if (!spellMatch) return false;
      const spellName = spellMatch[1];
      const ge = require('../gameEngine');
      return ge.botTryCastSpellByName(this.session, spellName);
    }

    return false;
  }

  delay() {
    // Reserved for scripted MQ delays
  }
}

module.exports = { MQWrapper, TLO_Spawn };
