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
    awardExp(session, xp, events);
  } else {
    events.push({ event: 'MESSAGE', text: 'You gain no experience for such a trivial opponent.' });
  }
}

function awardExp(session, xp, events = null) {
  const localEvents = events || [];
  session.char.experience += xp;
  localEvents.push({ event: 'XP_GAIN', amount: xp });

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
    localEvents.push({ event: 'LEVEL_UP', level: session.char.level });

    const newSpells = SpellDB.getNewSpellsAtLevel(session.char.class, session.char.level);
    for (const spell of newSpells) {
      const result = SpellSystem.scribeSpellToBook(session, spell._key);
      if (result >= 0) {
        localEvents.push({ event: 'MESSAGE', text: `You have learned ${spell.name}! It has been scribed to your spellbook.` });
      }
    }
    if (newSpells.length > 0) SpellSystem.sendSpellbookFull(session);
  }

  if (!events) {
    sendCombatLog(session, localEvents);
    sendFullState(session);
  }


  // Generate loot
  const generatedLoot = [];
  for (const lootEntry of mob.loot) {
    if (Math.random() < lootEntry.chance) {
      const itemDef = ITEMS[lootEntry.itemKey];
      if (itemDef) {
         generatedLoot.push({ itemKey: lootEntry.itemKey, qty: 1 });
      }
    }
  }

  // Create Corpse
  if (zone) {
    if (!zone.corpses) zone.corpses = [];
    
    // According to EQ rules: 30s if empty, 7.5m if items, 30m if lvl 55+ and items
    let decayMs = 30 * 1000;
    if (generatedLoot.length > 0) {
        decayMs = (mob.level >= 55 ? 30 : 7.5) * 60 * 1000;
    }
    
    // Find all players that got credit - for now, just the killing player
    let lootLockUntil = Date.now() + (generatedLoot.length > 0 ? (mob.level >= 55 ? 5 : 2.5) * 60 * 1000 : 0);
    
    const corpse = {
        id: `corpse_${mob.id}_${Date.now()}`,
        name: `${mob.name}'s corpse`,
        type: 'corpse',
        originalName: mob.name,
        mobId: mob.id,
        level: mob.level,
        x: mob.x,
        y: mob.y,
        z: mob.z,
        heading: mob.heading || 0,
        race: mob.race || 1,
        gender: mob.gender || 0,
        face: mob.face || 0,
        appearance: mob.appearance || {},
        equipVisuals: mob.equipVisuals || {},
        size: mob.size || 6,
        isNpc: true,
        loot: generatedLoot,
        spawnTime: Date.now(),
        decayTime: Date.now() + decayMs,
        lootLockGroup: session.char.name,
        lootLockUntil: lootLockUntil
    };
    
    zone.corpses.push(corpse);
    
    events.push({ event: 'MESSAGE', text: `You have slain ${mob.name}!` });
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
  const isTargetPlayer = !!mob.char;
  const tName = isTargetPlayer ? mob.char.name : mob.name;
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
        if (isTargetPlayer) mob.char.hp -= bsDmg;
        else {
          mob.hp -= bsDmg;
          if (mob.hateList) mob.hateList.addEntToHateList(session.char.name, bsDmg, bsDmg);
        }
        events.push({ event: 'MELEE_HIT', source: 'You', target: tName, damage: bsDmg, text: 'Backstab!', type: 'piercing' });
      } else {
        events.push({ event: 'MELEE_MISS', source: 'You', target: tName, text: 'Backstab missed', type: 'piercing' });
      }
      session.abilityCooldowns['backstab'] = 10; // 10s cooldown
    }
  } 
  // -- The Warrior Loop (Taunt) --
  else if (session.char.class === 'warrior') {
    if ((!session.abilityCooldowns['taunt'] || session.abilityCooldowns['taunt'] <= 0) && session.attackTimer <= 0) {
      if (!isTargetPlayer && mob.hateList) {
        const topEnt = mob.hateList.getMobWithMostHateOnList();
        if (topEnt !== session.char.name) {
          const topEntry = mob.hateList.entries.find(e => e.entityId === topEnt);
          const topHate = topEntry ? topEntry.hateAmount : 0;
          // Taunt sets hate to Top Hate + 1 (classic EQ rule) + small flat amount
          mob.hateList.setHateAmount(session.char.name, topHate + 10);
          events.push({ event: 'MESSAGE', text: `You taunt ${tName} to ignore others and attack you!` });
        } else {
          events.push({ event: 'MESSAGE', text: `You fail to taunt ${tName}.` });
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
        events.push({ event: 'RESIST', target: tName, spell: 'Shock of Lightning' });
      } else {
        let dmg = 45;
        if (resist === 'PARTIAL_RESIST') dmg = Math.floor(dmg / 2);
        
        if (isTargetPlayer) {
           mob.char.hp -= dmg;
           if (mob.ws) mob.ws.send(JSON.stringify({ type: 'CHAT', channel: 'system', text: `${session.char.name} hits YOU for ${dmg} points of non-melee damage.` }));
        } else {
           mob.hp -= dmg;
        }
        
        events.push({ event: 'SPELL_DAMAGE', source: 'You', target: tName, spell: 'Shock of Lightning', damage: dmg });
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
    const { damage, delay, weight, offhandWeight } = StatsSystem.getWeaponStats(session.inventory);
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
      const tX = mob.char ? mob.char.x : mob.x;
      const tY = mob.char ? mob.char.y : mob.y;
      if (session.char.x != null && tX != null) {
        const dx = session.char.x - tX;
        const dy = session.char.y - tY;
        const distSq = dx * dx + dy * dy;
        serverOutOfRange = distSq > (MELEE_RANGE * MELEE_RANGE);
      }

      if (serverOutOfRange) {
        events.push({ event: 'MESSAGE', text: 'Your target is too far away!' });
      } else {
      const wpnSkill = StatsSystem.getWeaponSkillName(session.inventory);
      const atk = combat.calcPlayerATK(session, wpnSkill);
      
      const isTargetPlayer = !!mob.char;
      const tLevel = isTargetPlayer ? mob.char.level : mob.level;
      const tName = isTargetPlayer ? mob.char.name : mob.name;
      // In combat.js, calcMobDefense expects an NPC with .defense or .level.
      // If it's a player, we'll pass an object that has what it needs.
      const def = combat.calcMobDefense(isTargetPlayer ? { defense: mob.effectiveStats?.ac || mob.char.level * 5, level: mob.char.level } : mob);
      const charLvl = session.char.level;

      const executeAttack = (isOffhand) => {
        if (session.char.fatigue === undefined) session.char.fatigue = 0;
        
        let swingWeight = isOffhand ? (offhandWeight || 0.5) : (weight || 1.0);
        if (swingWeight < 0.1) swingWeight = 1.0; // Default punch weight

        // Cost Formula: Base Cost * (150 / (100 + STA_Stat))
        let baseCost = 0.05 * swingWeight;
        let staMod = 150.0 / (100.0 + (session.effectiveStats.sta || 100));
        session.char.fatigue += (baseCost * staMod);
        if (session.char.fatigue > 100) session.char.fatigue = 100;

        combat.trySkillUp(session, wpnSkill);
        combat.trySkillUp(session, 'offense');

        const hitChance = combat.calcHitChance(atk, def, charLvl - tLevel);
        if (combat.chance(hitChance)) {
          if (!isTargetPlayer && mob.target !== session) mob.target = session;
          if (isTargetPlayer && mob.combatTarget !== session) {
            // PvP auto-retaliate? No, just let them be hit.
          }

          let dmgRoll = combat.calcPlayerDamage(session, damage, delay);
          const isCrit = combat.checkCritical(session.char.class, charLvl, session);
          const isCripple = combat.checkCripplingBlow(charLvl, tLevel, session);
          
          if (isCrit || isCripple) dmgRoll *= 2;
          
          if (isTargetPlayer) {
              mob.char.hp -= dmgRoll;
              if (mob.ws) {
                  mob.ws.send(JSON.stringify({ type: 'CHAT', channel: 'system', text: `${session.char.name} hits YOU for ${dmgRoll} points of damage.` }));
              }
          } else {
              mob.hp -= dmgRoll;
              // SPA 92: Hate/Aggro Modifier — scales melee-generated hate
              let hateMod = 1.0;
              if (Array.isArray(session.buffs)) {
                for (const buff of session.buffs) {
                  if (Array.isArray(buff.effects)) {
                    const hateEff = buff.effects.find(e => e.spa === 92 && e.base !== 0);
                    if (hateEff) hateMod += (hateEff.base / 100);
                  }
                }
              }
              hateMod = Math.max(0.01, hateMod); // Never go to 0
              const hateAmt = Math.floor(dmgRoll * hateMod);
              if (mob.hateList) mob.hateList.addEntToHateList(session.char.name, hateAmt, dmgRoll);
              SpellSystem.breakMez(mob, events);

              // SPA 85: Check for weapon proc buffs
              if (Array.isArray(session.buffs)) {
                for (const buff of session.buffs) {
                  if (buff.procSpellId && buff.procRate) {
                    // Base proc chance ~5% modified by procRate
                    const procChance = Math.min(50, 5 * (buff.procRate / 100));
                    if (combat.chance(procChance)) {
                      // Fire the proc spell as bonus damage
                      const procSpell = SpellDB ? SpellDB.getById(buff.procSpellId) : null;
                      if (procSpell) {
                        const procDmg = procSpell.effects?.find(e => e.spa === 0 && e.base < 0);
                        if (procDmg) {
                          const dmg = Math.abs(procDmg.base);
                          mob.hp -= dmg;
                          if (mob.hateList) mob.hateList.addEntToHateList(session.char.name, dmg, dmg);
                          events.push({ event: 'SPELL_DAMAGE', source: 'You', target: tName, spell: buff.name, damage: dmg });
                        }
                      } else {
                        // Fallback: small flat damage proc
                        const flatProc = Math.floor(session.char.level / 2) + 5;
                        mob.hp -= flatProc;
                        if (mob.hateList) mob.hateList.addEntToHateList(session.char.name, flatProc, flatProc);
                        events.push({ event: 'SPELL_DAMAGE', source: 'You', target: tName, spell: buff.name, damage: flatProc });
                      }
                    }
                  }
                }
              }

              // SPA 121: Reverse Damage Shield — mob deals damage back to attacker on hit
              if (Array.isArray(mob.buffs)) {
                for (const mbuff of mob.buffs) {
                  if (Array.isArray(mbuff.effects)) {
                    const rdsEff = mbuff.effects.find(e => e.spa === 121 && e.base !== 0);
                    if (rdsEff) {
                      const rdsDmg = Math.abs(rdsEff.base);
                      session.char.hp -= rdsDmg;
                      events.push({ event: 'SPELL_DAMAGE', source: mbuff.name, target: 'You', spell: 'Reverse DS', damage: rdsDmg });
                    }
                  }
                }
              }
          }

          let txt = isOffhand ? '' : null;
          if (isCrit) txt = isOffhand ? '(Offhand Crit)' : 'Critical hit!';
          else if (isCripple) txt = isOffhand ? '(Offhand Cripple)' : 'Crippling blow!';
          else if (isOffhand) txt = 'Offhand hit';

          if (txt) {
            events.push({ event: 'MELEE_HIT', source: 'You', target: tName, damage: dmgRoll, text: txt, type: wpnSkill });
          } else {
            events.push({ event: 'MELEE_HIT', source: 'You', target: tName, damage: dmgRoll, type: wpnSkill });
          }
        } else {
          events.push({ event: 'MELEE_MISS', source: 'You', target: tName, text: isOffhand ? 'Offhand miss' : null, type: wpnSkill });
        }
      };

      // Main hand
      executeAttack(false);

      // Double attack
      if ((isTargetPlayer ? mob.char.hp : mob.hp) > 0 && combat.checkDoubleAttack(session)) {
        events.push({ event: 'MESSAGE', text: 'You double attack!' });
        executeAttack(false);
      }

      // Dual wield
      if ((isTargetPlayer ? mob.char.hp : mob.hp) > 0 && combat.checkDualWield(session)) {
        setTimeout(() => {
          if (session.inCombat && session.char.state === 'standing' && (isTargetPlayer ? mob.char.hp : mob.hp) > 0 && !session.isOutOfRange) {
             executeAttack(true);
             if (events.length > 0) sendCombatLog(session, events);
          }
        }, 150);
      }
      }
    }
  }

  // Check mob death
  if (!isTargetPlayer && mob.hp <= 0) {
    await handleMobDeath(session, mob, events);
  }
  
  // Player target death check
  if (isTargetPlayer && mob.char.hp <= 0) {
    mob.char.hp = 0;
    // For now, let the player's own combat tick handle their death, or force it here.
    // We will just wait for their own process loop to kill them.
    session.inCombat = false;
    session.autoFight = false;
    session.combatTarget = null;
    events.push({ event: 'MESSAGE', text: `You have slain ${mob.char.name}!` });
  }

  // Check player death
  if (session.char.hp <= 0) {
    session.char.hp = 0;
    events.push({ event: 'DEATH', who: 'YOU' });
    events.push({ event: 'MESSAGE', text: 'You have been slain! You return to your bind point.' });

    const zone = zoneInstances[session.char.zoneId];
    if (zone) {
        if (!zone.corpses) zone.corpses = [];
        const corpse = {
            id: `corpse_player_${session.char.id}_${Date.now()}`,
            name: `${session.char.name}'s corpse`,
            type: 'corpse',
            originalName: session.char.name,
            mobId: session.char.id,
            level: session.char.level,
            x: session.char.x,
            y: session.char.y,
            z: session.char.z,
            heading: session.char.heading || 0,
            race: session.char.race || 1,
            gender: session.char.gender || 0,
            face: session.char.face || 0,
            appearance: session.char.appearance || {},
            equipVisuals: session.char.equipVisuals || {}, // Player equipment is on the corpse!
            size: 6,
            isNpc: false,
            loot: [], // Empty for MVP to prevent actual item loss, just a visual marker
            spawnTime: Date.now(),
            decayTime: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
            lootLockGroup: session.char.name,
            lootLockUntil: Date.now() + 7 * 24 * 60 * 60 * 1000
        };
        zone.corpses.push(corpse);
    }

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

function canInteract(source, target, isBeneficial) {
  if (source === target) return isBeneficial; // Self-casting always allowed for beneficial, mostly irrelevant for detrimental but true means ok. Wait, detrimental on self? Some spells do it, but generally we follow standard rules.
  
  // If target is an NPC (not a session), interactions are normal PvE.
  if (!target.char || target.type === 'enemy' || target.type === 'npc' || target.type === 'corpse' || target.type === 'pet') {
    // If it's a pet, beneficial is ok if it's your pet, otherwise PvP rules apply? For now assume normal.
    // If target is NPC, we can always attack them. Beneficial? Sure.
    return true; 
  }
  
  if (!source.char) return true; // Source is an NPC

  const sF = source.char.pvpFaction || 0;
  const tF = target.char.pvpFaction || 0;

  if (isBeneficial) {
      return sF === tF;
  } else {
      return (sF !== 0 && tF !== 0 && sF !== tF);
  }
}

module.exports = {
  setDependencies,
  processCombatTick,
  handleMobDeath,
  canInteract,
  awardExp
};
