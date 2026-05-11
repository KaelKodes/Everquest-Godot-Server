const BaseBot = require('../baseBot');
const { pickFirstMemmedByNames } = require('../botSpellUtils');

/**
 * Cleric bot — group heals, cures, rez, buffs; uses real `/cast` + memorized gems.
 * Respects MAINTANK / PULLER roles and stance modifiers from BaseBot.
 */
class ClericBot extends BaseBot {
  constructor(session) {
    super(session);

    this.config.medPct = 60;
    this.config.HealAt = 60;
    this.config.TankHealAt = 40;
    this.config.PanicHealAt = 20;
    this.config.HoTAt = 85;
    /** Skip healing puller above this HP% unless emergency */
    this.config.PullerHealIgnoreAbove = 35;

    this._stanceBaseline = {
      assistPct: this.config.assistPct,
      followDistance: this.config.followDistance,
      medPct: this.config.medPct,
      HealAt: this.config.HealAt,
      TankHealAt: this.config.TankHealAt,
      PanicHealAt: this.config.PanicHealAt,
      HoTAt: this.config.HoTAt,
      PullerHealIgnoreAbove: this.config.PullerHealIgnoreAbove,
    };

    // Exact SpellDB names — first memmed in each category wins (see hire / char create).
    this.spellPrefs = {
      completeHeal: ['Complete Heal', 'Superior Healing', 'Greater Healing', 'Healing', 'Greater Heal'],
      fastHeal: ['Remedy', 'Renewal', 'Celestial Health', 'Healing', 'Greater Healing', 'Light Healing', 'Minor Healing'],
      hot: ['Celestial Healing', 'Celestial Remedy', 'Celestial Health'],
      groupHpBuff: ['Aegolism', 'Temperance', 'Symbol of Transal', 'Heroism'],
      acBuff: ['Armor of Faith', 'Shield of Words', 'Guard', 'Holy Armor'],
      cureAll: ['Radiant Cure', 'Ethereal Cleansing'],
      curePoison: ['Counteract Poison', 'Cure Poison', 'Antidote'],
      cureDisease: ['Counteract Disease', 'Cure Disease', 'Remove Lesser Curse'],
      rez: ['Resurrection', 'Reviviscence', 'Resuscitate', 'Reanimation'],
    };
  }

  applyStanceToConfig() {
    const b = this._stanceBaseline;
    Object.assign(this.config, b);
    super.applyStanceToConfig();
    switch (this.stance) {
      case 'aggressive':
        this.config.HealAt = Math.max(35, b.HealAt - 12);
        this.config.TankHealAt = Math.max(25, b.TankHealAt - 8);
        this.config.PanicHealAt = Math.max(10, b.PanicHealAt - 5);
        this.config.HoTAt = Math.max(75, b.HoTAt - 8);
        break;
      case 'conservative':
        this.config.HealAt = Math.min(85, b.HealAt + 10);
        this.config.TankHealAt = Math.min(55, b.TankHealAt + 8);
        this.config.PanicHealAt = Math.min(30, b.PanicHealAt + 5);
        this.config.HoTAt = Math.min(92, b.HoTAt + 5);
        break;
      case 'passive':
        this.config.HealAt = Math.min(92, b.HealAt + 18);
        this.config.TankHealAt = Math.min(65, b.TankHealAt + 12);
        this.config.PullerHealIgnoreAbove = Math.min(55, b.PullerHealIgnoreAbove + 15);
        break;
      default:
        break;
    }
  }

  _pullerId(group) {
    return group && group.roles ? group.roles.puller : null;
  }

  _mainTankId(group) {
    return group && group.roles ? group.roles.mainTank : null;
  }

  /**
   * Collect group member sessions with HP% (skip null sessions).
   * Optionally deprioritize puller chip damage.
   */
  _groupHealCandidates(group) {
    const pullerId = this._pullerId(group);
    const pullerIgnore = this.GetConfig('PullerHealIgnoreAbove') ?? 35;
    const list = [];
    for (let i = 0; i < group.members.length; i++) {
      const memberSession = group.members[i];
      if (!memberSession || !memberSession.char) continue;
      const memberHp = memberSession.char.hp;
      const memberMaxHp = memberSession.effectiveStats?.hp
        || memberSession.char.maxHp
        || 1;
      const pct = (memberHp / memberMaxHp) * 100;
      let weight = pct;
      if (pullerId && memberSession.char.id === pullerId && pct > pullerIgnore) {
        weight = pct + 40;
      }
      list.push({
        i, memberSession, pct, weight, char: memberSession.char,
      });
    }
    list.sort((a, b) => a.weight - b.weight);
    return list;
  }

  async CheckRez() {
    if (this.session.inCombat) return false;
    const group = this.session.group;
    if (!group) return false;

    const picked = pickFirstMemmedByNames(this.session, this.spellPrefs.rez);
    if (!picked) return false;

    for (const s of group.members) {
      if (!s || !s.char) continue;
      const dead = s.char.hp <= 0 || s.char.state === 'dead';
      if (!dead) continue;
      if (s.char.zoneId !== this.session.char.zoneId) continue;
      if (!this.CheckReagents(picked.name)) return false;
      await this.mq.cmdf('/target "%s"', s.char.name);
      await this.mq.cmdf('/cast "%s"', picked.name);
      return true;
    }
    return false;
  }

  async CheckCures() {
    const group = this.session.group;
    if (!group) return false;

    for (const s of group.members) {
      if (!s || !s.char) continue;
      const bad = (s.buffs || []).filter((b) => b.beneficial === false);
      if (bad.length === 0) continue;

      const hasPois = bad.some((b) => Array.isArray(b.effects) && b.effects.some((e) => e.spa === 35));
      const hasDis = bad.some((b) => Array.isArray(b.effects) && b.effects.some((e) => e.spa === 36));
      const hasCurse = bad.some((b) => Array.isArray(b.effects) && b.effects.some((e) => e.spa === 116));

      let pick = null;
      if (hasPois || hasDis || hasCurse) {
        pick = pickFirstMemmedByNames(this.session, this.spellPrefs.cureAll);
      }
      if (!pick && hasPois) {
        pick = pickFirstMemmedByNames(this.session, this.spellPrefs.curePoison);
      }
      if (!pick && hasDis) {
        pick = pickFirstMemmedByNames(this.session, this.spellPrefs.cureDisease);
      }
      if (!pick) continue;

      if (!this.CheckReagents(pick.name)) return false;
      await this.mq.cmdf('/target "%s"', s.char.name);
      await this.mq.cmdf('/cast "%s"', pick.name);
      return true;
    }
    return false;
  }

  async CheckHeals() {
    const group = this.session.group;
    if (!group) return false;

    const candidates = this._groupHealCandidates(group);
    if (candidates.length === 0) return false;

    const { memberSession, pct, char } = candidates[0];
    if (!memberSession || pct >= 95) return false;

    const mtId = this._mainTankId(group);
    const lowestIsMainTank = mtId != null && char.id === mtId;

    const panicHealAt = this.GetConfig('PanicHealAt', memberSession);
    const tankHealAt = this.GetConfig('TankHealAt', memberSession);
    const healAt = this.GetConfig('HealAt', memberSession);
    const hotAt = this.GetConfig('HoTAt', memberSession);

    const complete = pickFirstMemmedByNames(this.session, this.spellPrefs.completeHeal);
    const fast = pickFirstMemmedByNames(this.session, this.spellPrefs.fastHeal);
    const hot = pickFirstMemmedByNames(this.session, this.spellPrefs.hot);

    const tryHeal = async (spellPick) => {
      if (!spellPick) return false;
      if (!this.CheckReagents(spellPick.name)) return false;
      await this.mq.cmdf('/target "%s"', char.name);
      await this.mq.cmdf('/cast "%s"', spellPick.name);
      return true;
    };

    if (lowestIsMainTank) {
      if (pct <= panicHealAt && fast && await tryHeal(fast)) return true;
      if (pct <= tankHealAt && complete && await tryHeal(complete)) return true;
    } else if (pct <= healAt && fast && await tryHeal(fast)) {
      return true;
    }

    if (pct <= hotAt && pct < 95 && hot && await tryHeal(hot)) {
      return true;
    }

    return false;
  }

  async CheckBuffs() {
    if (this.session.inCombat) return false;

    const myManaPct = (this.session.char.mana / (this.session.effectiveStats?.mana || 1)) * 100;
    if (myManaPct < 40) return false;

    const group = this.session.group;
    if (!group) return false;

    for (const mSession of group.members) {
      if (!mSession || !mSession.char) continue;

      const tloMember = new this.mq.TLO.Spawn(mSession.char, this.session, mSession);
      const hpBuffPick = pickFirstMemmedByNames(this.session, this.spellPrefs.groupHpBuff);
      if (hpBuffPick && !tloMember.Buff(hpBuffPick.name)()) {
        if (!this.CheckReagents(hpBuffPick.name)) return false;
        await this.mq.cmdf('/target "%s"', mSession.char.name);
        await this.mq.cmdf('/cast "%s"', hpBuffPick.name);
        return true;
      }

      const acPick = pickFirstMemmedByNames(this.session, this.spellPrefs.acBuff);
      if (acPick && !tloMember.Buff(acPick.name)()) {
        if (!this.CheckReagents(acPick.name)) return false;
        await this.mq.cmdf('/target "%s"', mSession.char.name);
        await this.mq.cmdf('/cast "%s"', acPick.name);
        return true;
      }
    }

    return false;
  }
}

module.exports = ClericBot;
