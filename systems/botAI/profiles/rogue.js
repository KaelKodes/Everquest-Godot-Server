const BaseBot = require('../baseBot');
const Camp = require('../campControl');
const State = require('../../../state');
const combat = require('../../../combat');

/**
 * Hormin — halfling rogue.
 *
 * He is melee damage. Out of a fight he sneaks. In a fight he gets behind
 * the tank's target and backstabs once he knows the skill. While he is
 * assisting he keeps checking that rear arc. If the mob turns and he is
 * no longer behind it, he steps back there. He does not swing at a
 * mesmerized add.
 *
 * Locks and traps are orders, not a patrol. "Hormin, pick this lock" or
 * "disarm this trap" sends him to the speaker. He tries the skill. If the
 * world has no lock or trap there, he says so.
 */
const PERSONA = {
  name: 'Hormin',
  race: 'halfling',
  class: 'rogue',
  home: 'Rivervale',
  hail(who) {
    return `Well met, ${who}. I am Hormin. Point me at a back and I will take it. Ask me when a lock or a trap needs hands.`;
  },
  voice: 'Hormin is a young halfling rogue out of Rivervale. He is quick, a little cocky, and glad of the company. He does not start fights. He sneaks, gets behind a foe, and backstabs when he can. He picks locks and disarms traps when someone asks him to. He can warm toward them if they invite it. He does not start there.',
};

const ORDER_RANGE = 12;

function entityPos(ent) {
  if (!ent) return null;
  if (ent.char) return ent.char;
  return ent;
}

/** How close he stands on the rear, and how far still counts as in reach. */
const BACKSTAB_STAND = 8;
const BACKSTAB_REACH = 10;

/** Unit vector of the mob's own facing. Backstab cares about this, not the tank. */
function mobFacing(mob) {
  const mobPos = entityPos(mob);
  const angle = ((mob.heading || (mobPos && mobPos.heading) || 0) / 512) * Math.PI * 2;
  return {
    fx: Math.sin(angle),
    fy: Math.cos(angle),
    mobPos,
  };
}

/**
 * True when the rogue is in the mob's rear arc (more than 90 degrees off
 * its facing). That is the same check combat uses before a bot backstab.
 */
function isBehind(session, mob) {
  if (!session || !session.char || !mob) return false;
  const { fx, fy, mobPos } = mobFacing(mob);
  if (!mobPos) return false;
  const ax = (session.char.x || 0) - (mobPos.x || 0);
  const ay = (session.char.y || 0) - (mobPos.y || 0);
  if (Math.hypot(ax, ay) < 1) return false;
  return ax * fx + ay * fy < 0;
}

function distanceTo(session, mob) {
  const mobPos = entityPos(mob);
  const me = session && session.char;
  if (!mobPos || !me) return Infinity;
  return Math.hypot((me.x || 0) - (mobPos.x || 0), (me.y || 0) - (mobPos.y || 0));
}

/** Behind the mob and close enough that a backstab can land. */
function inBackstabPosition(session, mob) {
  return isBehind(session, mob) && distanceTo(session, mob) <= BACKSTAB_REACH;
}

function behindPoint(session, mob) {
  const { fx, fy, mobPos } = mobFacing(mob);
  const me = session.char;
  const ox = mobPos ? (mobPos.x || 0) : 0;
  const oy = mobPos ? (mobPos.y || 0) : 0;
  let rx = -fx;
  let ry = -fy;
  const tank = Camp.tankSession(session);
  const face = tank && tank.char && tank !== session ? tank.char : null;
  if (face) {
    const sx = ox + rx * BACKSTAB_STAND;
    const sy = oy + ry * BACKSTAB_STAND;
    if (Math.hypot(sx - (face.x || 0), sy - (face.y || 0)) < 8) {
      const tx = (face.x || 0) - ox;
      const ty = (face.y || 0) - oy;
      const cross = rx * ty - ry * tx;
      const slide = (cross >= 0 ? -1 : 1) * 1.15;
      const cs = Math.cos(slide);
      const sn = Math.sin(slide);
      const nx = rx * cs - ry * sn;
      const ny = rx * sn + ry * cs;
      const len = Math.hypot(nx, ny) || 1;
      rx = nx / len;
      ry = ny / len;
    }
  }
  return {
    x: ox + rx * BACKSTAB_STAND,
    y: oy + ry * BACKSTAB_STAND,
    z: (mobPos && mobPos.z) || (me && me.z) || 0,
  };
}

class RogueBot extends BaseBot {
  constructor(session) {
    super(session);
    this.config.assistPct = 99;
    this.config.followDistance = 12;
    this.config.medPct = 0;
    this._stanceBaseline = {
      assistPct: this.config.assistPct,
      followDistance: this.config.followDistance,
      medPct: 0,
    };
    this.persona = PERSONA;
    this._job = null;
    this._stuck = 0;
  }

  _sayGroup(text) {
    const whispered = (this._job && this._job.replyTo) || this.session._whisperReplyTo;
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

  _findSpeaker(name) {
    const want = String(name || '').toLowerCase();
    for (const other of State.sessions.values()) {
      if (other.char && String(other.char.name || '').toLowerCase() === want) return other;
    }
    return null;
  }

  _orderForMe(text) {
    const named = String(text || '').match(/\b(hormin|sera|mordecai)\b/ig);
    if (!named) return true;
    return named.some((one) => one.toLowerCase() === 'hormin');
  }

  handleChat(text, sender) {
    const line = String(text || '');
    const speaker = this._findSpeaker(sender);
    if (speaker && speaker.isCompanion) {
      super.handleChat(text, sender);
      return;
    }
    if (!this._orderForMe(line)) {
      super.handleChat(text, sender);
      return;
    }

    const pick = /\bpick(?:\s+\w+){0,4}\s+locks?\b/i.test(line) || /\block\s*pick\b/i.test(line) || /\bpicklock\b/i.test(line);
    const trap = /\bdisarm(?:\s+\w+){0,4}\s+traps?\b/i.test(line);
    if (!pick && !trap) {
      super.handleChat(text, sender);
      return;
    }

    const where = speaker && speaker.char ? speaker.char : this.session.char;
    this._job = {
      type: pick ? 'pick' : 'trap',
      x: where.x,
      y: where.y,
      z: where.z,
      replyTo: this.session._whisperReplyTo || null,
    };
    this._stuck = 0;
    if (this.session.inCombat || this.session.autoFight) {
      this._sayGroup(pick
        ? 'I will pick it once this one is down.'
        : 'I will check for a trap once this one is down.');
      return;
    }
    this._sayGroup(pick ? 'I am on the lock.' : 'I will look for the trap.');
  }

  async tick() {
    if (this.session.casting) return;
    this.applyStanceToConfig();
    this.applyRoleMindsetToConfig();
    this._releaseCivicFight();
    if (this._job && !this.session.inCombat && !this.session.autoFight) {
      if (await this.CheckOrders()) return;
    }
    if (await this.CheckCombat()) return;
    if (await this.CheckOrders()) return;
    this._keepStealthed();
    this.CheckMovement();
    this.CheckSurvival();
  }

  async CheckPullerDuty() {
    return false;
  }

  CheckMedding() {}

  _groupIsFighting(focus) {
    const group = this.session.group;
    if (!group || !focus) return false;
    return group.members.some((member) => {
      if (!member || member === this.session) return false;
      if (!member.inCombat && !member.autoFight) return false;
      const ct = member.combatTarget || member.attackTarget;
      return ct === focus || (ct && focus.id != null && ct.id === focus.id);
    });
  }

  _engage(focus) {
    if (!this._isKillMob(focus)) return;
    const OocRegen = require('../../oocRegen');
    const Movement = require('../../movement');
    if (!this.session.inCombat) OocRegen.markCombatStarted(this.session);
    this.session.attackTarget = focus;
    this.session.combatTarget = focus;
    this.session.autoFight = true;
    this.session.inCombat = true;
    this.session.sittingHold = false;
    this.session.holdPosition = false;
    if (this.session.attackTimer == null) this.session.attackTimer = 0;
    if (this.session.char.state === 'sitting' || this.session.char.state === 'medding') {
      this.session.char.state = 'standing';
    }
    Movement.breakSneak(this.session);
    Movement.breakHide(this.session);
  }

  _leaveFight() {
    if (!this.session.autoFight && !this.session.inCombat) return;
    const OocRegen = require('../../oocRegen');
    if (this.session.inCombat) OocRegen.markCombatEnded(this.session);
    this.session.autoFight = false;
    this.session.inCombat = false;
    this.session.attackTarget = null;
  }

  async CheckCombat() {
    const focus = this.getFocusTarget() || Camp.focusOf(this.session);
    if (!focus || Camp.isMezzed(focus) || !this._groupIsFighting(focus)) {
      this._leaveFight();
      return false;
    }

    const maxHp = focus.maxHp || 100;
    const pct = maxHp > 0 ? ((focus.hp || 0) / maxHp) * 100 : 100;
    if (pct > this.config.assistPct && !this.session.autoFight) return false;

    const spot = behindPoint(this.session, focus);
    const positioned = inBackstabPosition(this.session, focus);
    const assisting = this.session.autoFight || this.session.inCombat;

    if (!positioned) {
      const Path = require('../../companionPath');
      if (!assisting && this._stuck < 10) {
        this._keepStealthed();
        const moved = Path.stepToward(this.session, spot.x, spot.y, spot.z, Path.pace(true));
        this._stuck = moved ? 0 : this._stuck + 1;
        return true;
      }
      this._engage(focus);
      const moved = Path.stepToward(this.session, spot.x, spot.y, spot.z, Path.pace(true));
      this._stuck = moved ? 0 : this._stuck + 1;
      return true;
    }

    this._stuck = 0;
    this._engage(focus);
    return true;
  }

  _keepStealthed() {
    if (this.session.inCombat || this.session.autoFight) return;
    const Movement = require('../../movement');
    const me = this.session.char;
    if (!me.isSneaking && combat.getCharSkill(me, 'sneak') > 0) {
      const wait = this.session.skillCooldowns && this.session.skillCooldowns.sneak > 0;
      if (!wait) Movement.handleUpdateSneak(this.session, { sneaking: true, solo: true });
    }
    if (me.isSneaking && !me.isHidden && combat.getCharSkill(me, 'hide') > 0) {
      const wait = this.session.skillCooldowns && this.session.skillCooldowns.hide > 0;
      if (!wait) Movement.handleHide(this.session, { hiding: true });
    }
  }

  async CheckOrders() {
    const job = this._job;
    if (!job) return false;
    if (this.session.inCombat || this.session.autoFight) return false;
    const me = this.session.char;
    const dist = Math.hypot((job.x || me.x) - me.x, (job.y || me.y) - me.y);
    if (dist > ORDER_RANGE) {
      const Path = require('../../companionPath');
      const moved = Path.stepToward(this.session, job.x, job.y, job.z || me.z, Path.pace(true));
      this._stuck = moved ? 0 : this._stuck + 1;
      if (this._stuck < 12) return true;
    }
    if (job.type === 'pick') this._tryPick();
    else this._tryDisarm();
    this._job = null;
    this._stuck = 0;
    return true;
  }

  _zone() {
    return State.zoneInstances && State.zoneInstances[this.session.char.zoneId];
  }

  _nearest(list, radius, pred) {
    const me = this.session.char;
    let best = null;
    let bestD = radius * radius;
    for (const row of list || []) {
      if (!row || (pred && !pred(row))) continue;
      const x = row.pos_x != null ? row.pos_x : row.x;
      const y = row.pos_y != null ? row.pos_y : row.y;
      const d = ((x || 0) - me.x) ** 2 + ((y || 0) - me.y) ** 2;
      if (d > bestD) continue;
      best = row;
      bestD = d;
    }
    return best;
  }

  _tryPick() {
    const skill = combat.getCharSkill(this.session.char, 'pick_lock');
    if (skill <= 0) {
      this._sayGroup('I have not learned to pick locks yet.');
      return;
    }
    combat.trySkillUp(this.session, 'pick_lock');
    const zone = this._zone();
    const door = this._nearest(zone && zone.doors, 20, (row) => Number(row.lockpick) > 0 && !row.unlocked);
    if (!door) {
      this._sayGroup('I work the picks. There is no lock here.');
      return;
    }
    if (skill >= Number(door.lockpick)) {
      door.unlocked = true;
      this._sayGroup('The lock gives.');
      return;
    }
    this._sayGroup('The lock is too much for me. I need more practice.');
  }

  _tryDisarm() {
    const skill = combat.getCharSkill(this.session.char, 'disarm_traps');
    if (skill <= 0) {
      this._sayGroup('I have not learned to disarm traps yet.');
      return;
    }
    combat.trySkillUp(this.session, 'disarm_traps');
    const zone = this._zone();
    const traps = (zone && zone.traps) || [];
    const trap = this._nearest(traps, 25, (row) => !row.disarmed);
    if (!trap) {
      this._sayGroup('I search the ground. I find no trap.');
      return;
    }
    const difficulty = Number(trap.skill) || 1;
    const roll = Math.floor(Math.random() * 50) + skill;
    const need = Math.floor(Math.random() * 50) + difficulty;
    if (roll >= need) {
      trap.disarmed = true;
      this._sayGroup('The trap is disarmed.');
      return;
    }
    this._sayGroup('I fail to disarm it. Careful where you step.');
  }
}

RogueBot.PERSONA = PERSONA;
RogueBot.isBehind = isBehind;

module.exports = RogueBot;
module.exports.isBehind = isBehind;
