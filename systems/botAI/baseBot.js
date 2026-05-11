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

  async tick() {
    if (this.session.casting) return;

    this.applyStanceToConfig();

    if (this.actionQueue.length > 0) {
      const action = this.actionQueue.shift();
      this.executeAction(action);
      return;
    }

    if (await this.CheckRez()) return;
    if (await this.CheckCures()) return;
    if (await this.CheckHeals()) return;
    if (await this.CheckCombat()) return;
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

    if (text.startsWith('set ')) {
      const parts = text.split(' ').slice(1);
      if (parts.length === 2) {
        const key = parts[0];
        const value = parseInt(parts[1], 10);
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

  async CheckBuffs() {
    return false;
  }

  CheckMovement() {
    if (this.session.inCombat) return;

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
        if (group.roles && group.roles.puller === leader.id) {
          const alternateTargetId = group.roles.mainTank || group.roles.mainAssist;
          const alternateMember = alternateTargetId
            ? group.members.find((m) => m.char.id === alternateTargetId)
            : null;
          if (alternateMember && alternateMember.char.id !== leader.id) {
            targetX = alternateMember.char.x;
            targetY = alternateMember.char.y;
            targetZ = alternateMember.char.z || 0;
          } else {
            return;
          }
        } else {
          targetX = leader.x;
          targetY = leader.y;
          targetZ = leader.z || 0;
        }
        followRadius = this.config.followDistance;
      }

      const dx = targetX - me.x;
      const dy = targetY - me.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > followRadius) {
        const angle = Math.atan2(dy, dx);
        const speed = 15.0;
        const moveDist = Math.min(speed, dist - followRadius);

        me.x += Math.cos(angle) * moveDist;
        me.y += Math.sin(angle) * moveDist;
        me.heading = angle;
        me.z = targetZ;

        for (const [ws, otherSession] of State.sessions) {
          if (otherSession.char && otherSession.char.zoneId === me.zoneId) {
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
