const BaseBot = require('../baseBot');
const Camp = require('../campControl');
const Puller = require('../puller');
const { eachMemmed, pickBestMemmed, pickCheapestMemmed, hasSpa } = require('../botSpellUtils');

/**
 * Mordecai — High Elf enchanter.
 *
 * His work is the adds the tank is not hitting: mesmerize them, refresh that
 * mesmerize before it breaks, then debuff and damage the tank's target.
 * With no damage spell memorized he walks in and swings his dagger at that
 * same target (the tank's, or the main assist's if the tank has not picked
 * one). When that target dies he names the next mezzed mob and lets the tank
 * take it. He does not pull unless the group assigns him the job, and even
 * then he tags from range.
 *
 * Pets: a summoned animation that only fights what attacks him, or a charmed
 * creature. Charm is attempted only after a mez, because it can fail.
 */
const PERSONA = {
  name: 'Mordecai',
  race: 'high elf',
  class: 'enchanter',
  home: 'Felwithe',
  voice: 'Mordecai is a young high elf enchanter out of Felwithe. He is precise, a little proud of his control, and glad of the company. He does not start fights. He mesmerizes the adds, keeps his distance, and lets the tank take a target when it is ready. He can warm toward them if they invite it. He does not start there.',
};

const REMEZ_SECONDS = 8;
const CHARM_RETRY_MS = 8000;

class EnchanterBot extends BaseBot {
  constructor(session) {
    super(session);

    this.config.followDistance = 22;
    this.config.medPct = 50;
    this.config.assistPct = 90;
    this.config.avoidMelee = true;

    this._stanceBaseline = {
      assistPct: this.config.assistPct,
      followDistance: this.config.followDistance,
      medPct: this.config.medPct,
    };

    this.persona = PERSONA;
    this.petMode = 'summoned';
    this.charmPrefer = '';
    this._askedPet = false;
    this._pullerWarned = false;
    this._handedId = null;
    this._charmHoldUntil = 0;
    this._saidNoMez = false;
  }

  applyRoleMindsetToConfig() {
    super.applyRoleMindsetToConfig();
    if (this._hasOffenseSpell()) {
      this.config.avoidMelee = true;
      this.config.followDistance = Math.max(this.config.followDistance, 22);
    } else {
      this.config.avoidMelee = false;
    }
  }

  async tick() {
    this._askPetPreference();
    return super.tick();
  }

  _sayGroup(text) {
    const whispered = this.session._whisperReplyTo;
    if (whispered && whispered.char) {
      require('../../chat').deliverWhisper(this.session, whispered, text);
      return;
    }
    if (this.session.group) {
      const GroupManager = require('../../groups');
      GroupManager.handleGroupChat(this.session, text);
      return;
    }
    this.replyGroup(text);
  }

  _askPetPreference() {
    if (this._askedPet || !this.session.group) return;
    this._askedPet = true;
    this.petMode = 'summoned';
    this._sayGroup('I am Mordecai. I can keep a summoned animation, which only fights what attacks me, or I can charm a creature. Charm is stronger and less safe. Which do you prefer? If you want a charm, name the one I should take.');
  }

  handleChat(text, sender) {
    const line = String(text || '').toLowerCase().trim();

    if (/\b(summoned pet|safe pet|defensive pet|animation)\b/.test(line)
      || /\b(use|keep|summon) (a |the )?(animation|pet|summon)\b/.test(line)) {
      this.petMode = 'summoned';
      this.charmPrefer = '';
      this._sayGroup('I will keep a summoned animation. It stays with me and only fights what attacks me.');
      return;
    }

    if (/\b(don't|do not|stop|no) charm/.test(line)) {
      this.petMode = 'summoned';
      this.charmPrefer = '';
      this._sayGroup('I will leave charm alone and keep a summoned animation.');
      return;
    }

    const named = line.match(/\bcharm(?:\s+the)?\s+(.+)$/);
    const namedTarget = named && named[1].replace(/[.!?]+$/g, '').trim();
    const generic = !namedTarget || /^(a pet|pets|something|a mob|one|a creature|mobs)$/.test(namedTarget);
    if (named && !generic) {
      this.petMode = 'charm';
      this.charmPrefer = namedTarget;
      this._sayGroup(`I will mesmerize ${this.charmPrefer} first, then try to charm it. If the charm breaks I will lock it down again, or we kill it.`);
      return;
    }

    if (/\bcharm\b/.test(line)) {
      this.petMode = 'charm';
      this._sayGroup('I will charm when I can. Name a creature if you want me to prefer one. Otherwise I take a mezzed add the tank is not killing, and I mesmerize it before I try.');
      return;
    }

    super.handleChat(text, sender);
  }

  _manaPct() {
    const max = this.session.effectiveStats?.mana || this.session.char.maxMana || 1;
    return ((this.session.char.mana || 0) / max) * 100;
  }

  _mezSpell() {
    return pickBestMemmed(this.session, (def) => hasSpa(def, 31));
  }

  _charmSpell() {
    return pickBestMemmed(this.session, (def) => hasSpa(def, 22));
  }

  _petSpell() {
    return pickBestMemmed(this.session, (def) => hasSpa(def, 33));
  }

  _tashSpell() {
    return pickBestMemmed(this.session, (def) => hasSpa(def, 50, -1));
  }

  _slowSpell() {
    return pickBestMemmed(this.session, (def) => hasSpa(def, 11, -1));
  }

  _dotSpell() {
    return pickBestMemmed(this.session, (def) => def.effect === 'dot');
  }

  _ddSpell() {
    return pickBestMemmed(this.session, (def) => def.effect === 'dd');
  }

  /** A nuke or a DoT. Lull and shielding do not count. */
  _hasOffenseSpell() {
    return !!(this._dotSpell() || this._ddSpell());
  }

  _groupIsSwinging(focus) {
    if (!focus) return false;
    const group = this.session.group;
    if (!group) return false;
    return group.members.some((member) => {
      if (!member || member === this.session) return false;
      if (!member.inCombat && !member.autoFight) return false;
      const ct = member.combatTarget || member.attackTarget;
      return ct === focus || (ct && focus.id != null && ct.id === focus.id);
    });
  }

  _engageDagger(focus) {
    const OocRegen = require('../../oocRegen');
    const me = this.session.char;
    if (!this.session.inCombat) OocRegen.markCombatStarted(this.session);
    this.session.attackTarget = focus;
    this.session.combatTarget = focus;
    this.session.autoFight = true;
    this.session.inCombat = true;
    this.session.sittingHold = false;
    this.session.holdPosition = false;
    if (this.session.attackTimer == null) this.session.attackTimer = 0;
    if (me.state === 'sitting' || me.state === 'medding') me.state = 'standing';
  }

  _sheathDagger() {
    if (!this.session.autoFight && !this.session.inCombat) return;
    const OocRegen = require('../../oocRegen');
    if (this.session.inCombat) OocRegen.markCombatEnded(this.session);
    this.session.autoFight = false;
    this.session.inCombat = false;
    this.session.attackTarget = null;
    if (this.session.combatTarget && !this.session.combatTarget.char) {
      this.session.combatTarget = null;
    }
  }

  _tagSpell() {
    return pickCheapestMemmed(this.session, (def) => def.effect === 'dd')
      || this._tashSpell()
      || pickCheapestMemmed(this.session, (def) => hasSpa(def, 30) || hasSpa(def, 86));
  }

  _hasCharmPet() {
    const pet = this.session.pet;
    return !!(pet && pet.isCharmed && pet.alive !== false && (pet.hp == null || pet.hp > 0));
  }

  _mobHasSpa(mob, spa, direction) {
    return (mob.buffs || []).some((b) => hasSpa(b, spa, direction));
  }

  _charmCandidate(list) {
    if (!list || list.length === 0) return null;
    if (this.charmPrefer) {
      const want = this.charmPrefer.toLowerCase();
      return list.find((mob) => String(mob.name || '').toLowerCase().includes(want)) || null;
    }
    return list.slice().sort((a, b) => (b.level || 0) - (a.level || 0))[0];
  }

  /**
   * When the tank's kill target is dead, point them at one mezzed add and
   * stop refreshing that mez so their swings can break it.
   */
  _handOffNextAdd() {
    if (Camp.focusOf(this.session)) {
      this._handedId = null;
      return;
    }
    const next = Camp.nextAdd(this.session);
    if (!next) return;
    const tank = this.getTankSession();
    if (!tank || tank === this.session) return;
    if (Camp.tankIsOn(this.session, next) && this._handedId === next.id) return;
    if (this._handedId === next.id && tank.combatTarget && tank.combatTarget.id === next.id) return;

    this._handedId = next.id;
    Camp.pointSession(tank, next);
    if (tank.isBot || tank.inCombat || tank.autoFight) {
      tank.attackTarget = next;
      tank.autoFight = true;
      tank.inCombat = true;
    }
    this._sayGroup(`${next.name} is next. I will not mesmerize that one again.`);
  }

  _assistCharmPet() {
    const pet = this.session.pet;
    if (!pet || !pet.isCharmed || pet.alive === false) return;
    const focus = this.getFocusTarget();
    if (!focus || focus === pet || Camp.isMezzed(focus)) return;
    if (!Array.isArray(pet.hateList)) pet.hateList = [];
    if (!pet.hateList.some((h) => h.mob === focus)) {
      pet.hateList.push({ mob: focus, hate: 1000 });
    }
  }

  async CheckCrowdControl() {
    this._handOffNextAdd();

    const mez = this._mezSpell();
    const adds = Camp.addsExceptFocus(this.session);
    const needsMez = (mob) => mob && !Camp.tankIsOn(this.session, mob);

    const fading = adds.find((mob) => needsMez(mob) && Camp.isMezzed(mob) && Camp.mezSecondsLeft(mob) < REMEZ_SECONDS);
    if (fading && mez) {
      if (!this.CheckReagents(mez.name)) return false;
      return this.castSpellOn(fading, mez);
    }

    let loose = adds.filter((mob) => needsMez(mob) && !Camp.isMezzed(mob));
    if (this.petMode === 'charm') {
      const prefer = this._charmCandidate(loose);
      if (prefer) loose = [prefer, ...loose.filter((mob) => mob !== prefer)];
    }
    if (loose.length > 0) {
      if (!mez) {
        if (!this._saidNoMez) {
          this._saidNoMez = true;
          this._sayGroup('I have no mesmerize memorized, so I cannot lock the adds.');
        }
        return false;
      }
      if (!this.CheckReagents(mez.name)) return false;
      return this.castSpellOn(loose[0], mez);
    }

    if (this.petMode === 'charm' && !this._hasCharmPet() && Date.now() >= this._charmHoldUntil) {
      const ready = adds.filter((mob) => needsMez(mob) && Camp.isMezzed(mob));
      const candidate = this._charmCandidate(ready);
      const charm = this._charmSpell();
      if (candidate && charm) {
        if (!this.CheckReagents(charm.name)) return false;
        this._charmHoldUntil = Date.now() + CHARM_RETRY_MS;
        this._sayGroup(`Charming ${candidate.name}. It may resist.`);
        return this.castSpellOn(candidate, charm);
      }
    }

    if (this.petMode !== 'charm' && !this.session.pet && this._manaPct() > 30) {
      const petSpell = this._petSpell();
      const addsHeld = adds.every((mob) => Camp.isMezzed(mob) || Camp.tankIsOn(this.session, mob));
      if (petSpell && addsHeld) {
        if (!this.CheckReagents(petSpell.name)) return false;
        return this.castSpellOn(this.session.char, petSpell);
      }
    }

    return false;
  }

  async CheckCombat() {
    this._assistCharmPet();

    const focus = this.getFocusTarget();
    if (!this._hasOffenseSpell()) {
      if (!focus || !this._groupIsSwinging(focus)) {
        this._sheathDagger();
        return false;
      }
      this._engageDagger(focus);
      const me = this.session.char;
      const dist = Math.hypot((focus.x || 0) - me.x, (focus.y || 0) - me.y);
      if (dist > 8) {
        const Path = require('../../companionPath');
        Path.stepToward(this.session, focus.x || 0, focus.y || 0, focus.z || me.z, Path.pace(true));
      }
      return true;
    }

    this._sheathDagger();
    if (!focus || Camp.isMezzed(focus)) return false;
    if (this._manaPct() < 20) return false;

    const tryCast = async (spell) => {
      if (!spell) return false;
      if (!this.CheckReagents(spell.name)) return false;
      return this.castSpellOn(focus, spell);
    };

    const tash = this._tashSpell();
    if (tash && !this._mobHasSpa(focus, 50, -1) && await tryCast(tash)) return true;

    const slow = this._slowSpell();
    if (slow && !this._mobHasSpa(focus, 11, -1) && await tryCast(slow)) return true;

    const dot = this._dotSpell();
    const alreadyDotted = (focus.buffs || []).some((b) => b.tickDamage > 0);
    if (dot && !alreadyDotted && await tryCast(dot)) return true;

    if (this._manaPct() < 40) return false;
    const adds = Camp.addsExceptFocus(this.session);
    const mezAboutToBreak = adds.some((mob) => Camp.isMezzed(mob) && Camp.mezSecondsLeft(mob) < 12);
    if (mezAboutToBreak) return false;

    const dd = this._ddSpell();
    if (dd && await tryCast(dd)) return true;
    return false;
  }

  /**
   * Between fights: beneficial buffs he actually has memorized, and the
   * summoned animation if that is the pet the group asked for.
   */
  _isRestBuff(def) {
    if (!def || def.effect !== 'buff' || !def.goodEffect) return false;
    if (hasSpa(def, 30) || hasSpa(def, 86) || hasSpa(def, 31) || hasSpa(def, 22) || hasSpa(def, 33)) return false;
    if (hasSpa(def, 12) || hasSpa(def, 25) || hasSpa(def, 26) || hasSpa(def, 58)) return false;
    return true;
  }

  async CheckBuffs() {
    if (this.session.inCombat || this.session.autoFight || this.session.casting) return false;
    if (Camp.campHasWork(this.session)) return false;
    if (this._manaPct() < 40) return false;

    if (this.petMode !== 'charm' && !this.session.pet) {
      const petSpell = this._petSpell();
      if (petSpell) {
        if (!this.CheckReagents(petSpell.name)) return false;
        return this.castSpellOn(this.session.char, petSpell);
      }
    }

    const group = this.session.group;
    const members = (group && group.members && group.members.length) ? group.members : [this.session];
    const buffs = eachMemmed(this.session)
      .filter((spell) => this._isRestBuff(spell.def))
      .sort((a, b) => (b.level || 0) - (a.level || 0));

    for (const spell of buffs) {
      const selfOnly = spell.def.targetType && spell.def.targetType.id === 6;
      const targets = selfOnly ? [this.session] : members;
      for (const member of targets) {
        if (!member || !member.char) continue;
        const tlo = new this.mq.TLO.Spawn(member.char, this.session, member);
        if (tlo.Buff(spell.name)()) continue;
        if (!this.CheckReagents(spell.name)) return false;
        return this.castSpellOn(member.char, spell);
      }
    }
    return false;
  }

  /**
   * Pulling is a poor job for him. He only does it when the group sets the
   * role, and he tags with a spell instead of walking into melee.
   */
  async CheckPullerDuty() {
    if (!this.getMyRoles().has('puller')) return false;
    if (this.session.casting) return false;

    if (this.session.puller && Puller.isBusy(this.session)) {
      Puller.resetPull(this.session);
      this.session.autoFight = false;
    }

    if (!this._pullerWarned) {
      this._pullerWarned = true;
      this._sayGroup('I can try to pull, but I am a poor choice for it. I will tag from range and come back. Someone else should pull when they can.');
    }

    if (Camp.campHasWork(this.session)) return false;

    const mob = Camp.nearestIdleMob(this.session, 40, 200);
    if (!mob) return false;
    const tag = this._tagSpell();
    if (!tag) return false;
    if (!this.CheckReagents(tag.name)) return false;
    this.session.autoFight = false;
    return this.castSpellOn(mob, tag);
  }

  CheckMovement() {
    if (!this._hasOffenseSpell()) {
      if (this.session.autoFight || this.session.inCombat) return;
      super.CheckMovement();
      return;
    }
    this.session.autoFight = false;
    if (this._keepOffTheMobs()) return;
    super.CheckMovement();
  }

  _keepOffTheMobs() {
    if (!this.session.inCombat && !Camp.campHasWork(this.session)) return false;
    const me = this.session.char;
    let nearest = null;
    let nearestD = 22;
    for (const mob of Camp.campMobs(this.session)) {
      const d = Math.hypot((mob.x || 0) - me.x, (mob.y || 0) - me.y);
      if (d < nearestD) {
        nearest = mob;
        nearestD = d;
      }
    }
    if (!nearest) return false;
    const dx = me.x - (nearest.x || 0);
    const dy = me.y - (nearest.y || 0);
    const len = Math.hypot(dx, dy) || 1;
    const Path = require('../../companionPath');
    Path.stepToward(this.session, me.x + (dx / len) * 14, me.y + (dy / len) * 14, me.z, Path.pace(true));
    return true;
  }
}

EnchanterBot.PERSONA = PERSONA;

module.exports = EnchanterBot;
