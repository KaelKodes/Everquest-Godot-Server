const { MQWrapper } = require('../botEngine');
const SpellDB = require('../../data/spellDatabase');
const ItemDB = require('../../data/itemDatabase');
const { send } = require('../../utils');
const State = require('../../state');

/**
 * BaseBot — MacroQuest-style orchestrator (heals → combat → buffs → move → med).
 */
class BaseBot {
  constructor(session) {
    this.session = session;
    this.mq = new MQWrapper(session);

    this.config = {
      assistPct: 98,
      followDistance: 15,
      medPct: 40,
      /** How many mobs the puller tries to bring home (1–6). */
      pullCount: 1,
      /** Max scout distance from camp when looking for pulls. */
      pullRadius: 280,
    };

    this._stanceBaseline = {
      assistPct: 98,
      followDistance: 15,
      medPct: 40,
    };

    this.stance = 'balanced';
    this.actionQueue = [];
    this.state = 'idle';
  }

  applyStanceToConfig() {
    const b = this._stanceBaseline;
    this.config.assistPct = b.assistPct;
    this.config.followDistance = b.followDistance;
    this.config.medPct = b.medPct;

    switch (this.stance) {
      case 'aggressive':
        this.config.assistPct = Math.min(100, b.assistPct + 8);
        this.config.followDistance = Math.max(8, b.followDistance - 3);
        this.config.medPct = Math.max(25, b.medPct - 10);
        break;
      case 'conservative':
        this.config.assistPct = Math.max(70, b.assistPct - 12);
        this.config.followDistance = b.followDistance + 5;
        this.config.medPct = Math.min(55, b.medPct + 10);
        break;
      case 'passive':
        this.config.assistPct = Math.max(55, b.assistPct - 25);
        this.config.followDistance = b.followDistance + 8;
        this.config.medPct = Math.min(50, b.medPct + 5);
        break;
      default:
        break;
    }
  }

  /**
   * Group roles are optional "booster packs" — they nudge priorities without
   * replacing class identity. One bot can hold multiple roles.
   */
  applyRoleMindsetToConfig() {
    const roles = this.getMyRoles();
    if (roles.has('dps')) {
      // Assist early and stay close to the tank's kill target.
      this.config.assistPct = Math.min(100, Math.max(this.config.assistPct, 98));
    }
    if (roles.has('healer')) {
      this.config.medPct = Math.min(70, Math.max(this.config.medPct, 55));
      this.config.followDistance = Math.max(this.config.followDistance, 18);
    }
    if (roles.has('puller')) {
      this.config.followDistance = Math.max(this.config.followDistance, 12);
    }
    if (roles.has('cc')) {
      // Hang slightly back so mez doesn't get broken by proximity melee.
      this.config.followDistance = Math.max(this.config.followDistance, 16);
      this.config.assistPct = Math.min(this.config.assistPct, 90);
    }
    if (roles.has('tank')) {
      this.config.followDistance = Math.min(this.config.followDistance, 10);
    }
  }

  getGroupRoles() {
    const group = this.session && this.session.group;
    return group && group.roles ? group.roles : null;
  }

  getMyRoles() {
    const roles = this.getGroupRoles();
    const me = this.session && this.session.char && this.session.char.id;
    const set = new Set();
    if (!roles || me == null) return set;
    if (roles.mainTank === me) set.add('tank');
    if (roles.puller === me) set.add('puller');
    if (roles.healer === me) set.add('healer');
    if (roles.dps === me) set.add('dps');
    if (roles.cc === me) set.add('cc');
    return set;
  }

  getRoleMember(roleKey) {
    const group = this.session && this.session.group;
    const roles = this.getGroupRoles();
    if (!group || !roles) return null;
    const id = roles[roleKey];
    if (id == null) return null;
    return group.members.find((m) => m.char && m.char.id === id) || null;
  }

  getTankSession() {
    return this.getRoleMember('mainTank')
      || (this.session.group && this.session.group.members[0])
      || null;
  }

  /** A creature the group can kill. Merchants, bankers, and other NPCs are not. */
  _isKillMob(ct) {
    if (!ct || ct.char || ct.isPet || ct.type === 'corpse') return false;
    if (ct.alive === false || (ct.hp != null && ct.hp <= 0)) return false;
    if (ct.npcType && ct.npcType !== 'mob') return false;
    return true;
  }

  /** Kill-focus for DPS / assists: prefer tank target, then main assist. */
  getFocusTarget() {
    const tank = this.getTankSession();
    if (tank && this._isKillMob(tank.combatTarget)) return tank.combatTarget;
    const ma = this.getRoleMember('mainAssist');
    if (ma && this._isKillMob(ma.combatTarget)) return ma.combatTarget;
    return null;
  }

  /** Stop swinging if the current target is a merchant or any other non-monster. */
  _releaseCivicFight() {
    const civic = (ct) => ct && !ct.char && ct.npcType && ct.npcType !== 'mob';
    const swinging = this.session.autoFight || this.session.inCombat;
    if (!swinging) return;
    if (!civic(this.session.attackTarget) && !civic(this.session.combatTarget)) return;
    const OocRegen = require('../oocRegen');
    if (this.session.inCombat) OocRegen.markCombatEnded(this.session);
    this.session.autoFight = false;
    this.session.inCombat = false;
    this.session.attackTarget = null;
    if (civic(this.session.combatTarget)) this.session.combatTarget = null;
  }

  async tick() {
    if (this.session.casting) return;

    this.applyStanceToConfig();
    this.applyRoleMindsetToConfig();
    this._releaseCivicFight();

    if (this.actionQueue.length > 0) {
      const action = this.actionQueue.shift();
      this.executeAction(action);
      return;
    }

    if (await this.CheckRez()) return;
    if (await this.CheckCures()) return;
    if (await this.CheckHeals()) return;
    // Puller cycle owns targeting/movement while mid-pull (including FD waits).
    if (this.getMyRoles().has('puller')) {
      const Puller = require('./puller');
      const Feign = require('../feignDeath');
      const midPull = Puller.isBusy(this.session) || Feign.isFeigned(this.session);
      if (midPull) {
        if (await this.CheckPullerDuty()) return;
        if (Feign.isFeigned(this.session) || Puller.isBusy(this.session)) return;
      }
    }
    if (await this.CheckCrowdControl()) return;
    if (await this.CheckCombat()) return;
    if (await this.CheckPullerDuty()) return;
    if (await this.CheckBuffs()) return;
    this.CheckMovement();
    this.CheckMedding();
    this.CheckSurvival();
  }

  executeAction(action) {
    if (action.type === 'CAST') {
      void this.mq.cmdf('/cast "%s"', action.spellName);
    } else if (action.type === 'TARGET') {
      void this.mq.cmdf('/target "%s"', action.targetName);
    }
  }

  /** Override in Cleric: resurrection before cures/heals. */
  async CheckRez() {
    return false;
  }

  /**
   * Cast on someone. If they are out of range, remember to walk there and do not
   * retry the slash commands every tick.
   */
  async castSpellOn(targetChar, spellPick) {
    if (!targetChar || !spellPick) return false;
    const me = this.session.char;
    const range = (spellPick.def && spellPick.def.range && spellPick.def.range.range) || 100;
    const dist = Math.hypot((targetChar.x || 0) - me.x, (targetChar.y || 0) - me.y);
    const key = `${spellPick.name}|${targetChar.name}`;
    const now = Date.now();
    const hold = this.session._castHold;
    if (hold && hold.key === key && hold.until > now) return false;
    if (dist > range) {
      if (me.state === 'sitting' || me.state === 'medding') me.state = 'standing';
      this.session.sittingHold = false;
      this.session.castApproach = {
        x: targetChar.x,
        y: targetChar.y,
        z: targetChar.z || me.z,
        range,
        name: targetChar.name,
      };
      console.log(`[COMPANION] ${me.name} cannot reach ${targetChar.name} to cast ${spellPick.name}. Closing.`);
      this.session._castHold = { key, until: now + 2000 };
      return false;
    }
    this.session.castApproach = null;
    await this.mq.cmdf('/target "%s"', targetChar.name);
    const ok = await this.mq.cmdf('/cast "%s"', spellPick.name);
    if (!ok) this.session._castHold = { key, until: now + 2000 };
    return ok === true;
  }

  /** Override in Cleric: disease/poison/curses before heals. */
  async CheckCures() {
    return false;
  }

  handleChat(text, sender) {
    const char = this.session.char;
    text = String(text || '').toLowerCase();

    if (text.includes('missing spells') || text.includes('missing any spells')) {
      const myClass = char.class;
      let minLvl = 1;
      let maxLvl = char.level;

      const matchRange = text.match(/levels?\s+(\d+)\s+(?:to|and)\s+(\d+)/);
      const matchSingle = text.match(/level\s+(\d+)/);

      if (matchRange) {
        minLvl = parseInt(matchRange[1], 10);
        maxLvl = parseInt(matchRange[2], 10);
      } else if (matchSingle) {
        minLvl = parseInt(matchSingle[1], 10);
        maxLvl = parseInt(matchSingle[1], 10);
      }

      const allSpells = SpellDB.getSpellsForClass(myClass, maxLvl).filter((s) => {
        const lvl = s.classes[myClass.toLowerCase().replace(/_/g, '')];
        return lvl >= minLvl && lvl <= maxLvl;
      });

      const scribed = new Set((this.session.spellbook || []).map((s) => s.spell_key));
      const missing = allSpells.filter((s) => !scribed.has(s._key));

      if (missing.length === 0) {
        this.replyGroup(`I have all my spells up to level ${maxLvl}, ${sender}!`);
      } else {
        const spellNames = missing.map((s) => s.name).slice(0, 10).join(', ');
        const more = missing.length > 10 ? ` and ${missing.length - 10} more.` : '.';
        this.replyGroup(`I am missing ${missing.length} spells. For example: ${spellNames}${more}`);
      }
      return;
    }

    if (text.includes('supply check')) {
      const inventory = this.session.inventory || [];
      let foodCount = 0;
      let waterCount = 0;
      let bandagesCount = 0;

      if (Array.isArray(inventory)) {
        for (const slot of inventory) {
          const def = slot.item_id != null ? ItemDB.getById(slot.item_id) : null;
          const name = (def && def.name) ? def.name.toLowerCase() : '';
          if (!name) continue;
          const qty = slot.quantity || 1;
          if (name.includes('ration') || name.includes('loaf') || name.includes('pie')) foodCount += qty;
          if (name.includes('water') || name.includes('milk') || name.includes('ale')) waterCount += qty;
          if (name.includes('bandage')) bandagesCount += qty;
        }
      }

      this.replyGroup(`Supply Report: I have ${foodCount} food, ${waterCount} water, and ${bandagesCount} bandages, ${sender}.`);
      return;
    }

    if (text.includes('heal me')) {
      this.replyGroup('On it!');
      this.actionQueue.push({ type: 'TARGET', targetName: sender });
      return;
    }

    if (text.includes('buff')) {
      this.replyGroup('Checking buffs for everyone now!');
      return;
    }

    if (text.includes('camp here')) {
      this.config.campX = char.x;
      this.config.campY = char.y;
      this.config.campZ = char.z;
      this.config.isCamping = true;
      this.replyGroup('I am setting up camp here. I will return to this spot after combat!');
      return;
    }

    if (text.includes('follow me')) {
      this.config.isCamping = false;
      this.replyGroup("Breaking camp. I'm right behind you!");
      return;
    }

    // Puller knobs: "pull count 2", "pull radius 400", or "set pullcount 2"
    const pullCountMatch = text.match(/\bpull\s*count\s+(\d+)\b/) || text.match(/\bset\s+pullcount\s+(\d+)\b/);
    if (pullCountMatch) {
      const n = Math.max(1, Math.min(6, parseInt(pullCountMatch[1], 10)));
      this.config.pullCount = n;
      this.replyGroup(`I'll try to bring ${n} mob${n === 1 ? '' : 's'} at a time.`);
      return;
    }
    const pullRadiusMatch = text.match(/\bpull\s*radius\s+(\d+)\b/) || text.match(/\bset\s+pullradius\s+(\d+)\b/);
    if (pullRadiusMatch) {
      const n = Math.max(60, Math.min(800, parseInt(pullRadiusMatch[1], 10)));
      this.config.pullRadius = n;
      this.replyGroup(`I'll scout up to ${n} units from camp.`);
      return;
    }
    if (text.includes('pull settings') || text.includes('puller settings')) {
      this.replyGroup(`Pull settings: count ${this.config.pullCount || 1}, radius ${this.config.pullRadius || 280}.`);
      return;
    }

    if (text.startsWith('set ')) {
      const parts = text.split(' ').slice(1);
      if (parts.length === 2) {
        const key = parts[0];
        const value = parseInt(parts[1], 10);
        if (key === 'pullcount') {
          this.config.pullCount = Math.max(1, Math.min(6, value));
          this.replyGroup(`I'll try to bring ${this.config.pullCount} mob${this.config.pullCount === 1 ? '' : 's'} at a time.`);
          return;
        }
        if (key === 'pullradius') {
          this.config.pullRadius = Math.max(60, Math.min(800, value));
          this.replyGroup(`I'll scout up to ${this.config.pullRadius} units from camp.`);
          return;
        }
        this.config[key] = value;
        if (this._stanceBaseline[key] !== undefined) this._stanceBaseline[key] = value;
        this.replyGroup(`I have updated my default ${key} to ${value}.`);
      } else if (parts.length === 3) {
        const targetName = parts[0].toLowerCase();
        const key = parts[1];
        const value = parseInt(parts[2], 10);
        if (!this.config.targetOverrides) this.config.targetOverrides = {};
        if (!this.config.targetOverrides[targetName]) this.config.targetOverrides[targetName] = {};
        this.config.targetOverrides[targetName][key] = value;
        this.replyGroup(`Got it. For ${targetName}, I will use ${value} for ${key}.`);
      }
      return;
    }
  }

  GetConfig(key, targetSession = null) {
    if (targetSession && this.config.targetOverrides) {
      const charName = targetSession.char.name.toLowerCase();
      if (this.config.targetOverrides[charName] && this.config.targetOverrides[charName][key] !== undefined) {
        return this.config.targetOverrides[charName][key];
      }
      const group = this.session.group;
      if (group && group.roles) {
        if (group.roles.mainTank === targetSession.char.id && this.config.targetOverrides.maintank
            && this.config.targetOverrides.maintank[key] !== undefined) {
          return this.config.targetOverrides.maintank[key];
        }
        if (group.roles.puller === targetSession.char.id && this.config.targetOverrides.puller
            && this.config.targetOverrides.puller[key] !== undefined) {
          return this.config.targetOverrides.puller[key];
        }
      }
    }
    return this.config[key];
  }

  /**
   * Inventory is an array of `{ item_id, quantity, ... }` from `getInventory`.
   */
  CheckReagents(spellName) {
    const spellDef = SpellDB.getByName(spellName);
    if (!spellDef || !spellDef.reagents) return true;

    const inv = Array.isArray(this.session.inventory) ? this.session.inventory : [];
    const countsByItemId = new Map();
    for (const row of inv) {
      const id = row.item_id != null ? String(row.item_id) : null;
      if (!id) continue;
      const q = row.quantity || 1;
      countsByItemId.set(id, (countsByItemId.get(id) || 0) + q);
    }

    for (const reagentId of Object.keys(spellDef.reagents)) {
      const reqCount = spellDef.reagents[reagentId];
      if (reqCount > 0) {
        const have = countsByItemId.get(String(reagentId)) || 0;
        if (have < reqCount) {
          this.replyGroup(`I need reagents to cast ${spellName} (missing item ${reagentId}).`);
          return false;
        }
      }
    }
    return true;
  }

  replyGroup(text) {
    const whispered = this.session._whisperReplyTo;
    if (whispered && whispered.char) {
      require('../chat').deliverWhisper(this.session, whispered, text);
      return;
    }
    const channel = this.session.group ? 'group' : 'say';
    let ownerSession = null;
    const ownerId = this.session.char && this.session.char.ownerId;
    if (ownerId) {
      for (const [, s] of State.sessions) {
        if (s.char && s.char.id === ownerId && !s.isBot) {
          ownerSession = s;
          break;
        }
      }
    }
    if (!ownerSession) {
      for (const [, s] of State.sessions) {
        if (s.char && s.char.name === this.session.ownerCharName && !s.isBot) {
          ownerSession = s;
          break;
        }
      }
    }
    if (ownerSession && ownerSession.ws) {
      try {
        send(ownerSession.ws, { type: 'CHAT', channel, sender: this.session.char.name, text });
      } catch (e) { /* ignore */ }
    }
  }

  async CheckHeals() {
    return false;
  }

  async CheckCombat() {
    const myRoles = this.getMyRoles();

    // Tank: when the current kill is dead, take the next add (mezzed ones first).
    if (myRoles.has('tank')) {
      const Camp = require('./campControl');
      const focus = this.getFocusTarget();
      if (!focus) {
        const next = Camp.nextAdd(this.session);
        if (next) {
          this.session.combatTarget = next;
          this.session.attackTarget = next;
          this.session.autoFight = true;
          this.session.inCombat = true;
          return true;
        }
      }
    }

    // Designated CC stays off focus-fire unless the focus is nearly dead / solo.
    if (myRoles.has('cc') && !myRoles.has('dps') && !myRoles.has('tank')) {
      const focus = this.getFocusTarget();
      if (focus) {
        const maxHp = focus.maxHp || 100;
        const pct = maxHp > 0 ? ((focus.hp || 0) / maxHp) * 100 : 0;
        if (pct > 25) return false;
      }
    }

    // DPS / default: assist the tank's target (roles are a mindset boost).
    if (myRoles.has('dps') || myRoles.has('tank') || myRoles.size === 0) {
      const focus = this.getFocusTarget();
      if (focus) {
        const maxHp = focus.maxHp || 100;
        const pct = maxHp > 0 ? ((focus.hp || 0) / maxHp) * 100 : 100;
        if (pct <= this.config.assistPct) {
          if (this.session.combatTarget !== focus) this.session.combatTarget = focus;
          if (!this.session.char.autoAttack && (myRoles.has('dps') || myRoles.has('tank'))) {
            // melee engagement hook later
          }
          return true;
        }
      }
    }

    const maTarget = this.mq.TLO.Me.GroupAssistTarget();
    const myTarget = this.mq.TLO.Target;

    if (maTarget.ID() > 0 && maTarget.PctHPs() <= this.config.assistPct) {
      if (myTarget.ID() !== maTarget.ID()) {
        maTarget.DoTarget();
      }
      if (!this.session.char.autoAttack) {
        // melee bots: attack hook later
      }
      return true;
    }
    return false;
  }

  /**
   * CC mindset: disable adds that are not the tank's focus so the group can
   * focus-fire safely. Uses any memmed mez/root/snare/slow.
   */
  async CheckCrowdControl() {
    if (!this.getMyRoles().has('cc')) return false;
    const group = this.session.group;
    if (!group) return false;

    const focus = this.getFocusTarget();
    const focusId = focus && focus.id;
    const tank = this.getTankSession();
    const anchor = tank && tank.char ? tank.char : this.session.char;
    const zone = State.zoneInstances && State.zoneInstances[this.session.char.zoneId];
    const mobs = (zone && zone.liveMobs) || [];

    const { pickFirstMemmedByNames } = require('./botSpellUtils');
    const ccSpell = pickFirstMemmedByNames(this.session, [
      'Mesmerize', 'Enthrall', 'Entrance', 'Fascination',
      'Root', 'Ensnaring Roots', 'Grasping Roots', 'Engulfing Roots', 'Enveloping Roots',
      'Snare', 'Ensnare', 'Tashani', 'Tashania', 'Tashina',
    ]);
    if (!ccSpell) return false;

    let best = null;
    let bestDist = 80 * 80;
    for (const mob of mobs) {
      if (!mob || mob.alive === false) continue;
      if (focusId != null && mob.id === focusId) continue;
      // Prefer mobs that are already aggro'd / near camp.
      const onHate = mob.hateList && Array.isArray(mob.hateList.entries) && mob.hateList.entries.length > 0;
      const dx = (mob.x || 0) - (anchor.x || 0);
      const dy = (mob.y || 0) - (anchor.y || 0);
      const d2 = dx * dx + dy * dy;
      if (d2 > bestDist) continue;
      if (!onHate && d2 > 45 * 45) continue;
      // Skip if already mezzed/rooted (beneficial false crowd-control buffs).
      const buffs = mob.buffs || [];
      const controlled = buffs.some((b) => {
        const n = String(b.name || b.spellName || '').toLowerCase();
        return /mesmerize|enthrall|entrance|fascination|root|snare|ensnare/.test(n);
      });
      if (controlled) continue;
      best = mob;
      bestDist = d2;
    }
    if (!best) return false;
    if (!this.CheckReagents(ccSpell.name)) return false;
    return this.castSpellOn(best, ccSpell);
  }

  /**
   * Puller mindset: full scout → tag → return → FD-split → handoff cycle.
   * Healers already deprioritize healing the puller while they are out.
   */
  async CheckPullerDuty() {
    if (!this.getMyRoles().has('puller')) return false;
    if (this.session.casting) return false;
    // Errands / companion voice-pull take priority over role pulls.
    if (this.session.errand) return false;

    const Puller = require('./puller');
    return Puller.tick(this, this.session);
  }

  async CheckBuffs() {
    return false;
  }

  CheckMovement() {
    const Path = require('../companionPath');
    const Feign = require('../feignDeath');
    const me = this.session.char;

    // Puller owns its own movement while mid-cycle (including FD wait).
    if (this.getMyRoles().has('puller')) {
      const Puller = require('./puller');
      if (Puller.isBusy(this.session) || Feign.isFeigned(this.session)) return;
    }

    const approach = this.session.castApproach;
    if (approach) {
      const dist = Math.hypot((approach.x || 0) - me.x, (approach.y || 0) - me.y);
      const closeEnough = Math.max(8, (approach.range || 100) - 15);
      if (dist > closeEnough) {
        Path.stepToward(this.session, approach.x, approach.y, approach.z || me.z, Path.pace(true));
        return;
      }
      this.session.castApproach = null;
    }
    if (this.session.sittingHold) {
      Path.settle(this.session);
      return;
    }
    if (this.session.holdPosition && !this.session.autoFight && !this.session.inCombat && !this.session.pullTarget && !this.session.errand) {
      Path.settle(this.session);
      require('../companionMind').considerMeditate(this.session);
      return;
    }
    if (this.session.errand && !this.session.inCombat) {
      const point = Path.errandPoint(this.session);
      if (!point) {
        this.session.errand = null;
      } else {
        const dist = Math.hypot(point.x - me.x, point.y - me.y);
        if (point.through && dist < 30) {
          void Path.crossZone(this.session, point.through);
          return;
        }
        if (!point.through && dist < 25) {
          Path.arrived(this.session);
          return;
        }
        const steer = Path.nextSteerPoint(this.session, point);
        const moved = Path.stepToward(this.session, steer.x, steer.y, steer.z, Path.pace(true));
        if (!moved) {
          this.session._leadStuck = (this.session._leadStuck || 0) + 1;
          if (this.session._leadStuck >= 6) {
            const blocked = this.session.errand.route && this.session.errand.route[this.session.errand.routeIndex || 0];
            if (blocked) {
              this.session.errand.avoid = this.session.errand.avoid || [];
              this.session.errand.avoid.push(`${Math.floor(blocked.x / 22)},${Math.floor(blocked.y / 22)}`);
            }
            this.session.errand.route = null;
            this.session._leadStuck = 0;
          }
        } else {
          this.session._leadStuck = 0;
        }
        return;
      }
    }
    if (this.session.autoFight) {
      const foe = this.session.attackTarget;
      const foeAlive = foe && !foe.char && foe.alive !== false && (foe.hp == null || foe.hp > 0);
      if (!foeAlive) {
        this.session.autoFight = false;
        this.session.attackTarget = null;
        if (this.session.combatTarget && this.session.combatTarget.char) {
          this.session.inCombat = false;
        }
      } else if (!this.session.casting && !this.session.lookHold) {
        this.session.combatTarget = foe;
        const dist = Math.hypot((foe.x || 0) - me.x, (foe.y || 0) - me.y);
        if (dist > 10) Path.stepToward(this.session, foe.x || 0, foe.y || 0, foe.z || me.z, Path.pace(true));
        return;
      }
    }
    if (this.session.inCombat) {
      const group = this.session.group;
      const tankId = group && group.roles && (group.roles.mainTank || (group.members[0] && group.members[0].char.id));
      const tank = group && (group.members.find((m) => m.char && m.char.id === tankId) || group.members[0]);
      if (tank && tank.char && tank !== this.session) {
        const hold = this.config.avoidMelee ? Math.max(this.config.followDistance || 18, 18) : 0;
        const dx = (tank.char.x || 0) - me.x;
        const dy = (tank.char.y || 0) - me.y;
        const distToTank = Math.hypot(dx, dy);
        if (this.config.avoidMelee) {
          if (distToTank > hold + 4) {
            Path.stepToward(this.session, tank.char.x, tank.char.y, tank.char.z || me.z, Path.pace(true));
          }
        } else if (distToTank > 10) {
          Path.stepToward(this.session, tank.char.x, tank.char.y, tank.char.z || me.z, Path.pace(true));
        }
      }
      return;
    }
    if (this.session.pullTarget) {
      const mob = this.session.pullTarget;
      const me = this.session.char;
      if (!mob || mob.alive === false) {
        this.session.pullTarget = null;
      } else {
        const dx = (mob.x || 0) - me.x;
        const dy = (mob.y || 0) - me.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 25) {
          const fightable = !mob.char && (!mob.npcType || mob.npcType === 'mob');
          if (fightable) {
            this.session.attackTarget = mob;
            this.session.combatTarget = mob;
          }
          this.session.pullTarget = null;
          if (this.session.castOnArrival) {
            const spellName = this.session.castOnArrival;
            this.session.castOnArrival = null;
            const mind = require('../companionMind');
            void mind.castRemembered(this.session, spellName);
          }
          if (this.session.hailOnArrival) {
            this.session.hailOnArrival = false;
            const Chat = require('../chat');
            void Chat.handleHail(this.session, {});
          }
          if (this.session.browseOnArrival || this.session.buyOnArrival || this.session.sellOnArrival) {
            const mind = require('../companionMind');
            const buyName = this.session.buyOnArrival;
            const sellName = this.session.sellOnArrival;
            this.session.browseOnArrival = false;
            this.session.buyOnArrival = null;
            this.session.sellOnArrival = null;
            if (sellName) void mind.sellRemembered(this.session, sellName);
            else if (buyName) void mind.buyRemembered(this.session, buyName);
            else void mind.browseTarget(this.session);
          }
          return;
        }
        const step = Math.min(Path.pace(true), Math.max(0, dist - 18));
        const Path = require('../companionPath');
        Path.stepToward(this.session, mob.x || 0, mob.y || 0, mob.z || me.z, Math.max(Path.pace(false), step));
        return;
      }
    }

    const group = this.session.group;
    if (group && group.members.length > 0) {
      const me = this.session.char;

      let targetX; let targetY; let targetZ;
      let followRadius = 0;

      if (this.config.isCamping) {
        targetX = this.config.campX;
        targetY = this.config.campY;
        targetZ = this.config.campZ || 0;
        followRadius = 5;
      } else {
        const leader = group.members[0].char;
        const pullerId = group.roles && group.roles.puller;
        const iAmPuller = pullerId != null && pullerId === me.id;
        // Non-pullers stay with the tank/camp so they do not chase the puller out.
        if (pullerId && !iAmPuller) {
          const tank = this.getTankSession();
          const camp = (tank && tank.char) || leader;
          targetX = camp.x;
          targetY = camp.y;
          targetZ = camp.z || 0;
        } else if (iAmPuller) {
          // Puller between pulls stays near tank so the camp is clear to leave from.
          const tank = this.getTankSession();
          if (tank && tank.char && tank.char.id !== me.id) {
            targetX = tank.char.x;
            targetY = tank.char.y;
            targetZ = tank.char.z || 0;
          } else {
            targetX = leader.x;
            targetY = leader.y;
            targetZ = leader.z || 0;
          }
        } else {
          targetX = leader.x;
          targetY = leader.y;
          targetZ = leader.z || 0;
        }
        followRadius = this.session.isCompanion
          ? require('../companionMind').followRadiusOf(this.session)
          : this.config.followDistance;
        if (this.session.isCompanion) {
          const anchor = group.members[0] && group.members[0].char;
          const pose = Path.noteAnchor(group, anchor);
          const slot = Path.standPoint(this.session, targetX, targetY, pose.heading, followRadius);
          targetX = slot.x;
          targetY = slot.y;
          if (Path.holdFormation(this.session, targetX, targetY, pose.moving)) {
            require('../companionMind').considerMeditate(this.session);
            return;
          }
          if (!pose.moving && Path.overlapping(this.session)) {
            Path.settle(this.session);
            require('../companionMind').considerMeditate(this.session);
            return;
          }
          followRadius = 4;
        }
      }

      const dx = targetX - me.x;
      const dy = targetY - me.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (this.session.isCompanion) {
        require('../companionMind').considerMeditate(this.session);
      }

      // EQ heading: 0 north, 128 west, 256 south, 384 east. 0-512.
      let heading = (Math.atan2(dx, dy) / (2 * Math.PI)) * 512;
      if (heading < 0) heading += 512;

      let moved = false;
      if (dist > followRadius) {
        const Path = require('../companionPath');
        moved = Path.stepToward(this.session, targetX, targetY, targetZ, Math.min(Path.pace(dist > followRadius + 8), Math.max(0.5, dist - followRadius)));
      }

      const headingChanged = Math.abs((me.heading || 0) - heading) > 1;
      if (!moved && headingChanged) {
        me.heading = heading;
        for (const [ws, otherSession] of State.sessions) {
          if (otherSession.char && otherSession.char.zoneId === me.zoneId && otherSession !== this.session) {
            try {
              ws.send(JSON.stringify({
                type: 'MOB_MOVE',
                id: `player_${me.id}`,
                x: me.x,
                y: me.y,
                z: me.z,
                heading: me.heading,
              }));
            } catch (e) { /* ignore */ }
          }
        }
      }
    }
  }

  CheckMedding() {
    if (this.session.isCompanion) {
      if (!this.session.group || !this.session.group.members || this.session.group.members.length < 2) {
        require('../companionMind').considerMeditate(this.session);
      }
      return;
    }
    if (this.session.inCombat) return;

    const maxM = this.session.effectiveStats?.mana || this.session.char.maxMana || 1;
    const myPctMana = (this.session.char.mana / maxM) * 100;
    if (myPctMana < this.config.medPct && this.session.char.state !== 'sitting') {
      this.session.char.state = 'sitting';
    } else if (myPctMana >= 95 && this.session.char.state === 'sitting') {
      this.session.char.state = 'standing';
    }
  }

  CheckSurvival() {
    const now = Date.now();
    if (this._lastSurvivalCheck && now - this._lastSurvivalCheck < 60000) return;
    this._lastSurvivalCheck = now;

    const inventory = this.session.inventory || [];
    let hasFood = false;
    let hasWater = false;

    if (Array.isArray(inventory)) {
      for (const slot of inventory) {
        const def = slot.item_id != null ? ItemDB.getById(slot.item_id) : null;
        const name = def && def.name ? def.name.toLowerCase() : '';
        if (name.includes('ration') || name.includes('loaf') || name.includes('pie') || name.includes('meat') || name.includes('muffin')) hasFood = true;
        if (name.includes('water') || name.includes('milk') || name.includes('ale') || name.includes('mead') || name.includes('drink')) hasWater = true;
      }
    }

    if (!hasWater && Math.random() < 0.25) {
      const complaints = [
        'I have run out of water...',
        'I could really use a drink soon.',
        'My throat is parched...',
        'Get me to some water, you... ugh!',
        'I am so thirsty, I can barely cast.',
      ];
      this.replyGroup(complaints[Math.floor(Math.random() * complaints.length)]);
      return;
    }

    if (!hasFood && Math.random() < 0.25) {
      const complaints = [
        'I am starving! Do you have any food?',
        'My stomach is growling louder than an orc...',
        "I need rations, or I'm not going to be much use to you.",
        "I'm completely out of food.",
      ];
      this.replyGroup(complaints[Math.floor(Math.random() * complaints.length)]);
    }
  }
}

module.exports = BaseBot;
