const combat = require('../combat');
const StatsSystem = require('./stats');

let handleMobDeathFn, sendCombatLog, sendStatus, despawnPet, combat_utility, zoneInstances, SpellDB, SpellSystem, ITEMS, DB, sendFullState, calcEffectiveStats;

function setDependencies(deps) {
  handleMobDeathFn = deps.handleMobDeath;
  sendCombatLog = deps.sendCombatLog;
  sendStatus = deps.sendStatus;
  despawnPet = deps.despawnPet;
  combat_utility = deps.combat;
  zoneInstances = deps.zoneInstances;
  SpellDB = deps.SpellDB;
  SpellSystem = deps.SpellSystem;
  ITEMS = deps.ITEMS;
  DB = deps.DB;
  sendFullState = deps.sendFullState;
  calcEffectiveStats = deps.calcEffectiveStats;
}

async function handleMobDeath(session, mob, events) {
  events.push({ event: 'DEATH', who: mob.name });

  // XP
  const zone = zoneInstances[session.char.zoneId];
  const zem = zone && zone.def ? zone.def.zem : 1.0;
  const xp = combat_utility.calcXPGain(session.char.level, mob.level, mob.xpBase, zem);
  
  if (xp > 0) {
    session.char.experience += xp;
    events.push({ event: 'XP_GAIN', amount: xp });
  } else {
    events.push({ event: 'MESSAGE', text: 'You gain no experience for such a trivial opponent.' });
  }

  // Level up check
  let levelsGained = 0;
  while (session.char.level < 60 && levelsGained < 5) {
    const nextLevelXp = combat_utility.xpForLevel(session.char.level + 1);
    if (session.char.experience < nextLevelXp) break;
    
    session.char.level++;
    levelsGained++;
    session.char.practices = (session.char.practices || 0) + 5;
    session.effectiveStats = calcEffectiveStats(session.char, session.inventory, session.buffs);
    session.char.maxHp = session.effectiveStats.hp;
    session.char.maxMana = session.effectiveStats.mana;
    session.char.hp = session.char.maxHp;
    session.char.mana = session.char.maxMana;
    events.push({ event: 'LEVEL_UP', level: session.char.level });

    const newSpells = SpellDB.getNewSpellsAtLevel(session.char.class, session.char.level);
    for (const spell of newSpells) {
      const result = SpellSystem.scribeSpellToBook(session, spell._key);
      if (result >= 0) {
        events.push({ event: 'MESSAGE', text: `You have learned ${spell.name}! It has been scribed to your spellbook.` });
      }
    }
    if (newSpells.length > 0) SpellSystem.sendSpellbookFull(session);
  }

  // Loot
  for (const lootEntry of mob.loot) {
    if (Math.random() < lootEntry.chance) {
      const itemDef = ITEMS[lootEntry.itemKey];
      if (itemDef) {
        if (itemDef.type !== 'weapon' && itemDef.type !== 'armor' && itemDef.type !== 'shield' && itemDef.type !== 'clothing') {
            const existing = session.inventory.find(i => i.item_key === lootEntry.itemKey);
            if (existing) {
                DB.updateItemQuantity(existing.id, session.char.id, 1);
            } else {
                DB.addItem(session.char.id, lootEntry.itemKey, 0, 0, 1);
            }
        } else {
            DB.addItem(session.char.id, lootEntry.itemKey, 0, 0, 1);
        }
        
        session.inventory = await DB.getInventory(session.char.id);
        events.push({ event: 'LOOT', item: itemDef.name, source: mob.name });
      }
    }
  }

  // Remove mob
  if (zone) {
    zone.liveMobs = zone.liveMobs.filter(m => m.id !== mob.id);
  }

  session.combatTarget = null;
  session.inCombat = false;
  session.autoFight = false;

  sendFullState(session);
}

async function processCombatTick(session, dt) {
  if (!session.inCombat || !session.combatTarget) return;

  const mob = session.combatTarget;
  const events = [];

  // Player auto-attack & AI Behaviors
  session.attackTimer -= dt;

  let skipMelee = false;

  // -- The Rogue Loop --
  if (session.char.class === 'rogue') {
    if ((!session.abilityCooldowns['backstab'] || session.abilityCooldowns['backstab'] <= 0) && session.attackTimer <= 0) {
      const { damage } = StatsSystem.getWeaponStats(session.inventory);
      const bsDmg = combat.calcBackstabDamage(session, damage);
      if (bsDmg > 0) {
        mob.hp -= bsDmg;
        if (mob.hateList) mob.hateList.addEntToHateList(session.char.name, bsDmg, bsDmg);
        events.push({ event: 'MELEE_HIT', source: 'You', target: mob.name, damage: bsDmg, text: 'Backstab!', type: 'piercing' });
      } else {
        events.push({ event: 'MELEE_MISS', source: 'You', target: mob.name, text: 'Backstab missed', type: 'piercing' });
      }
      session.abilityCooldowns['backstab'] = 10; // 10s cooldown
    }
  } 
  // -- The Warrior Loop (Taunt) --
  else if (session.char.class === 'warrior') {
    if ((!session.abilityCooldowns['taunt'] || session.abilityCooldowns['taunt'] <= 0) && session.attackTimer <= 0) {
      if (mob.hateList) {
        const topEnt = mob.hateList.getMobWithMostHateOnList();
        if (topEnt !== session.char.name) {
          const topEntry = mob.hateList.entries.find(e => e.entityId === topEnt);
          const topHate = topEntry ? topEntry.hateAmount : 0;
          // Taunt sets hate to Top Hate + 1 (classic EQ rule) + small flat amount
          mob.hateList.setHateAmount(session.char.name, topHate + 10);
          events.push({ event: 'MESSAGE', text: `You taunt ${mob.name} to ignore others and attack you!` });
        } else {
          events.push({ event: 'MESSAGE', text: `You fail to taunt ${mob.name}.` });
        }
      }
      session.abilityCooldowns['taunt'] = 6; // 6s cooldown
    }
  }
  // -- The Cleric Loop --
  else if (session.char.class === 'cleric') {
    if (session.char.hp < session.effectiveStats.hp * 0.5 && session.char.mana >= 20 && !session.abilityCooldowns['cast']) {
      session.char.mana -= 20;
      session.char.hp = Math.min(session.char.hp + 60, session.effectiveStats.hp);
      events.push({ event: 'SPELL_HEAL', source: 'You', target: 'You', spell: 'Lesser Healing', amount: 60 });
      session.abilityCooldowns['cast'] = 4; 
      skipMelee = true;
    } else if (session.char.hp > session.effectiveStats.hp * 0.7 && session.char.mana < session.effectiveStats.mana * 0.9) {
      if (session.char.state === 'standing') {
        session.char.state = 'medding';
        events.push({ event: 'MESSAGE', text: 'You sit down to conserve mana.' });
      }
      skipMelee = true;
    } else {
      if (session.char.state === 'medding') session.char.state = 'standing';
    }
  } 
  // -- The Wizard Loop --
  else if (session.char.class === 'wizard') {
    if (session.char.mana >= 30 && !session.abilityCooldowns['cast']) {
      session.char.mana -= 30;
      const resist = combat.calcSpellResist(mob, session.char.level, 'magic');
      if (resist === 'FULL_RESIST') {
        events.push({ event: 'RESIST', target: mob.name, spell: 'Shock of Lightning' });
      } else {
        let dmg = 45;
        if (resist === 'PARTIAL_RESIST') dmg = Math.floor(dmg / 2);
        mob.hp -= dmg;
        events.push({ event: 'SPELL_DAMAGE', source: 'You', target: mob.name, spell: 'Shock of Lightning', damage: dmg });
      }
      session.abilityCooldowns['cast'] = 6;
      skipMelee = true;
    } else if (session.char.mana < 30) {
      if (session.char.state === 'standing') {
        session.char.state = 'medding';
        events.push({ event: 'MESSAGE', text: 'You sit down to meditate.' });
      }
      skipMelee = true;
    } else {
      if (session.char.state === 'medding') session.char.state = 'standing';
    }
  }

  if (session.attackTimer <= 0 && !skipMelee && session.char.state === 'standing') {
    const { damage, delay } = StatsSystem.getWeaponStats(session.inventory);
    // Check for haste/slow buffs (SPA 11)
    let maxHaste = 1.0;
    let minSlow = 1.0;
    if (Array.isArray(session.buffs)) {
      for (const buff of session.buffs) {
        if (Array.isArray(buff.effects)) {
          const atkEff = buff.effects.find(e => e.spa === 11 && e.base !== 0);
          if (atkEff) {
              const mod = atkEff.base / 100.0;
              if (mod > 1.0 && mod > maxHaste) maxHaste = mod;
              if (mod < 1.0 && mod < minSlow) minSlow = mod;
          }
        }
      }
    }
    let atkSpeedMod = maxHaste * minSlow;
    atkSpeedMod = Math.min(2.0, Math.max(0.3, atkSpeedMod)); // Cap at 100% haste, 70% slow
    session.attackTimer = (delay / 10) / atkSpeedMod;

    if (session.isOutOfRange) {
      events.push({ event: 'MESSAGE', text: 'You cannot reach your target!' });
    } else {
      // Server-side range validation — don't trust client alone
      const MELEE_RANGE = 50; // EQ world units — characters next to mobs are ~20-40 apart
      let serverOutOfRange = false;
      if (session.char.x != null && mob.x != null) {
        const dx = session.char.x - mob.x;
        const dy = session.char.y - mob.y;
        const distSq = dx * dx + dy * dy;
        serverOutOfRange = distSq > (MELEE_RANGE * MELEE_RANGE);
      }

      if (serverOutOfRange) {
        events.push({ event: 'MESSAGE', text: 'Your target is too far away!' });
      } else {
      const wpnSkill = StatsSystem.getWeaponSkillName(session.inventory);
      const atk = combat.calcPlayerATK(session, wpnSkill);
      const def = combat.calcMobDefense(mob);
      const charLvl = session.char.level;

      const executeAttack = (isOffhand) => {
        combat.trySkillUp(session, wpnSkill);
        combat.trySkillUp(session, 'offense');

        const hitChance = combat.calcHitChance(atk, def, charLvl - mob.level);
        if (combat.chance(hitChance)) {
          if (mob.target !== session) mob.target = session;

          let dmgRoll = combat.calcPlayerDamage(session, damage, delay);
          const isCrit = combat.checkCritical(session.char.class, charLvl);
          const isCripple = combat.checkCripplingBlow(charLvl, mob.level);
          
          if (isCrit || isCripple) dmgRoll *= 2;
          mob.hp -= dmgRoll;
          if (mob.hateList) mob.hateList.addEntToHateList(session.char.name, dmgRoll, dmgRoll);
          SpellSystem.breakMez(mob, events);

          let txt = isOffhand ? '' : null;
          if (isCrit) txt = isOffhand ? '(Offhand Crit)' : 'Critical hit!';
          else if (isCripple) txt = isOffhand ? '(Offhand Cripple)' : 'Crippling blow!';
          else if (isOffhand) txt = 'Offhand hit';

          if (txt) {
            events.push({ event: 'MELEE_HIT', source: 'You', target: mob.name, damage: dmgRoll, text: txt, type: wpnSkill });
          } else {
            events.push({ event: 'MELEE_HIT', source: 'You', target: mob.name, damage: dmgRoll, type: wpnSkill });
          }
        } else {
          events.push({ event: 'MELEE_MISS', source: 'You', target: mob.name, text: isOffhand ? 'Offhand miss' : null, type: wpnSkill });
        }
      };

      // Main hand
      executeAttack(false);

      // Double attack
      if (mob.hp > 0 && combat.checkDoubleAttack(session)) {
        events.push({ event: 'MESSAGE', text: 'You double attack!' });
        executeAttack(false);
      }

      // Dual wield
      if (mob.hp > 0 && combat.checkDualWield(session)) {
        setTimeout(() => {
          if (session.inCombat && session.char.state === 'standing' && mob.hp > 0 && !session.isOutOfRange) {
             executeAttack(true);
             if (events.length > 0) sendCombatLog(session, events);
          }
        }, 150);
      }
      }
    }
  }

  // Check mob death
  if (mob.hp <= 0) {
    await handleMobDeath(session, mob, events);
  }

  // Check player death
  if (session.char.hp <= 0) {
    session.char.hp = 0;
    events.push({ event: 'DEATH', who: 'YOU' });
    events.push({ event: 'MESSAGE', text: 'You have been slain! You return to your bind point.' });

    session.char.hp = Math.floor(session.effectiveStats.hp * 0.5);
    session.char.mana = Math.floor(session.effectiveStats.mana * 0.5);
    session.char.state = 'standing';
    session.inCombat = false;
    session.combatTarget = null;
    if (session.pet) {
      despawnPet(session, 'Your pet has lost its master and fades away.');
    }

    const xpPenalty = Math.floor(combat.xpForLevel(session.char.level) * 0.05);
    session.char.experience = Math.max(0, session.char.experience - xpPenalty);
    events.push({ event: 'MESSAGE', text: `You lost ${xpPenalty} experience.` });
  }

  if (session.skillUpMessages && session.skillUpMessages.length > 0) {
    for (const msg of session.skillUpMessages) {
       events.push({ event: 'MESSAGE', text: `[color=yellow]You have become better at ${msg.skillName}! (${msg.newLevel})[/color]` });
    }
    
    // Sync the updated skills payload to the client so the UI matches the new rank
    try {
        session.ws.send(JSON.stringify({
            type: 'SKILLS_UPDATE',
            skills: session.char.skills
        }));
    } catch (e) {
        console.error('[COMBAT] Failed to send SKILLS_UPDATE:', e);
    }
    
    session.skillUpMessages = [];
  }

  if (events.length > 0) {
    sendCombatLog(session, events);
    sendStatus(session);
  }
}

module.exports = {
  setDependencies,
  processCombatTick,
  handleMobDeath
};
