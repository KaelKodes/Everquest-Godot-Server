const combat = require('../combat');

function processMobRoaming(mob, dt, zoneId, api) {
  if (mob.gridPauseTimer > 0) {
    mob.gridPauseTimer -= dt;
    if (mob.gridPauseTimer <= 0) {
      mob.gridPauseTimer = 0;
      if (mob.gridId > 0 && mob.gridEntries && mob.gridEntries.length > 0) {
        mob.gridIndex++;
        if (mob.gridIndex >= mob.gridEntries.length) {
          mob.gridIndex = 0; // loop back
        }
      } else if (mob.wanderDist > 0) {
        // Generate new random wander waypoint around spawn
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * mob.wanderDist;
        mob.gridEntries = [{
          x: (mob.spawnX || mob.x) + Math.cos(angle) * radius,
          y: (mob.spawnY || mob.y) + Math.sin(angle) * radius,
          z: mob.z,
          pause: 5 + Math.random() * 10 // Pause 5-15s at destination
        }];
        mob.gridIndex = 0;
      }
    }
    return;
  }

  // Initialize first wander if needed
  if (!mob.gridEntries || mob.gridEntries.length === 0) {
    if (mob.wanderDist > 0) {
      mob.gridPauseTimer = 2 + Math.random() * 5; // Initial delay before first roam
    }
    return;
  }

  const targetNode = mob.gridEntries[mob.gridIndex];
  if (!targetNode) return;

  const dx = targetNode.x - mob.x;
  const dy = targetNode.y - mob.y;
  const distSq = dx * dx + dy * dy;

  let moved = false;

  if (distSq < 1.0) {
    // Reached waypoint
    mob.x = targetNode.x;
    mob.y = targetNode.y;
    mob.z = targetNode.z || mob.z;
    if (targetNode.heading > 0) mob.heading = targetNode.heading;
    
    // Authentic pause logic
    mob.gridPauseTimer = targetNode.pause || 0;
    
    // If no pause, instantly advance to next node
    if (mob.gridPauseTimer <= 0) {
      mob.gridIndex++;
      if (mob.gridIndex >= mob.gridEntries.length) mob.gridIndex = 0;
    }
    moved = true;
  } else {
    // Walk towards waypoint
    const roamSpeed = 6.0; // Gentle walking pace
    const moveAmount = roamSpeed * dt;
    const dist = Math.sqrt(distSq);

    if (dist <= moveAmount) {
      mob.x = targetNode.x;
      mob.y = targetNode.y;
    } else {
      const dirX = dx / dist;
      const dirY = dy / dist;
      mob.x += dirX * moveAmount;
      mob.y += dirY * moveAmount;
      
      // Update heading to face walking direction
      let newHeading = (Math.atan2(dirX, dirY) / (2 * Math.PI)) * 512;
      if (newHeading < 0) newHeading += 512;
      mob.heading = newHeading;
    }
    moved = true;
  }

  if (moved) {
    api.broadcastMobMove(mob, zoneId);
  }
}

function processMobAI(zone, zoneId, dt, api) {
  if (!zone || !zone.liveMobs) return;
  for (const mob of zone.liveMobs) {
    // Skip pets — they use separate pet AI
    if (mob.isPet) {
      api.processPetAI(mob, zone, zoneId, dt);
      // Check if pet died (from DOTs, etc.)
      if (mob.hp <= 0 && mob.alive !== false) {
        mob.alive = false;
        api.handlePetDeath(mob, zone);
      }
      continue;
    }
    // Process mob debuffs (DOTs, snares, etc.)
    if (Array.isArray(mob.buffs)) {
      for (let i = mob.buffs.length - 1; i >= 0; i--) {
        const debuff = mob.buffs[i];
        debuff.duration -= dt;

        // DOT tick damage
        if (debuff.tickDamage && debuff.tickDamage > 0) {
          if (!debuff.tickTimer) debuff.tickTimer = 6;
          debuff.tickTimer -= dt;
          if (debuff.tickTimer <= 0) {
            debuff.tickTimer = 6; // 6-second EQ tick
            mob.hp -= debuff.tickDamage;
            // Notify the caster if they're still in this zone
            for (const [, s] of api.sessions) {
              if (s.char && s.char.name === debuff.casterSession && s.char.zoneId === zoneId) {
                api.sendCombatLog(s, [{ event: 'SPELL_DAMAGE', source: debuff.name, target: mob.name, spell: debuff.name, damage: debuff.tickDamage }]);
              }
            }
          }
        }

        if (debuff.duration <= 0) {
          mob.buffs.splice(i, 1);
        }
      }
      // Check if DOT killed the mob
      if (mob.hp <= 0) {
        // Find caster session for XP/loot
        for (const [, s] of api.sessions) {
          if (s.combatTarget === mob) {
            api.handleMobDeath(s, mob, []);
            break;
          }
        }
        continue;
      }
    }

    if (mob.hp > 0 && mob.target) {
      // Check if mob is CC'd (mez/stun/fear) — skip attack if so
      if (Array.isArray(mob.buffs)) {
        const isCCd = mob.buffs.some(b => b.isMez || b.isStun || b.isFear);
        if (isCCd) continue; // Mob can't act while CC'd
      }

      // Determine if target is a pet or a player session
      const targetIsPet = mob.target.isPet === true;
      const targetIsSession = !targetIsPet && mob.target.char;

      // If target is dead or invalid, reset aggro
      if (targetIsPet) {
        if (!mob.target.alive || mob.target.hp <= 0) {
          mob.target = null;
          continue;
        }
      } else if (targetIsSession) {
        const session = mob.target;
        if (!session.char || session.char.hp <= 0 || session.char.zoneId !== zoneId) {
          mob.target = null;
          continue;
        }
      } else {
        mob.target = null;
        continue;
      }

      // Get target position and HP reference
      let targetX, targetY;
      if (targetIsPet) {
        targetX = mob.target.x;
        targetY = mob.target.y;
      } else {
        targetX = mob.target.char.x;
        targetY = mob.target.char.y;
      }

      // Check for slow debuffs on mob (SPA 11 with negative base)
      let mobSlowMod = 1.0;
      if (Array.isArray(mob.buffs)) {
        for (const debuff of mob.buffs) {
          if (Array.isArray(debuff.effects)) {
            const slowEff = debuff.effects.find(e => e.spa === 11 && e.base < 0);
            if (slowEff) mobSlowMod = Math.max(0.3, 1.0 + (slowEff.base / 100));
          }
        }
      }

      // ── Range check & mob movement ──
      const MELEE_RANGE = 15;

      let inMeleeRange = true;
      let distSq = 0;
      let dist = 0;
      if (mob.x != null && targetX != null) {
        const dx = targetX - mob.x;
        const dy = targetY - mob.y;
        distSq = dx * dx + dy * dy;
        inMeleeRange = distSq <= (MELEE_RANGE * MELEE_RANGE);
      }

      // Leash: if target is > 1300 units away, drop aggro and return to spawn
      const LEASH_RANGE = 1300;
      if (distSq > LEASH_RANGE * LEASH_RANGE) {
        mob.target = null;
        mob.x = mob.spawnX ?? mob.x;
        mob.y = mob.spawnY ?? mob.y;
        continue;
      }

      // If out of range, chase
      if (!inMeleeRange) {
        const mobSpeed = 5 + (mob.level || 1) * 0.5;
        const moveAmount = mobSpeed * mobSlowMod * dt;
        if (distSq > 0) {
          dist = Math.sqrt(distSq);
          const dx = targetX - mob.x;
          const dy = targetY - mob.y;
          mob.x += (dx / dist) * Math.min(moveAmount, dist);
          mob.y += (dy / dist) * Math.min(moveAmount, dist);
        }
        continue;
      }

      mob.attackTimer -= dt;
      if (mob.attackTimer <= 0) {
        mob.attackTimer = mob.attackDelay * (1 / mobSlowMod);

        const events = [];

        if (targetIsPet) {
          // ── Mob attacks pet ──
          const pet = mob.target;
          const hitChance = Math.min(90, Math.max(20, 60 + (mob.level - pet.level) * 3));
          if (Math.random() * 100 < hitChance) {
            const petAC = pet.ac || 0;
            let dmgRoll = combat.calcMobDamage(mob, petAC);

            // Pet dodge/parry
            if (pet.skills && pet.skills.dodge && Math.random() < 0.15) {
              // Dodged
            } else if (pet.skills && pet.skills.parry && Math.random() < 0.10) {
              // Parried
            } else {
              pet.hp -= dmgRoll;

              // Add hate for the pet's owner
              if (pet.ownerSession) {
                api.sendCombatLog(pet.ownerSession, [{ event: 'MELEE_HIT', source: mob.name, target: pet.name, damage: dmgRoll }]);
              }
            }
          }
          // Check if pet died
          if (pet.hp <= 0 && pet.alive !== false) {
            pet.alive = false;
            api.handlePetDeath(pet, zone);
            mob.target = null;
          }
        } else {
          // ── Mob attacks player session (existing code) ──
          const session = mob.target;
          combat.trySkillUp(session, 'defense');

          const avoidance = combat.checkAvoidance(session);
          if (avoidance) {
            events.push({ event: 'MESSAGE', text: `You ${avoidance.toLowerCase()} ${mob.name}'s attack!` });
            if (avoidance === 'RIPOSTE') {
              const { damage, delay } = api.getWeaponStats(session.inventory);
              let ripoDmg = combat.calcPlayerDamage(session, damage, delay);
              mob.hp -= ripoDmg;
              events.push({ event: 'MELEE_HIT', source: 'You', target: mob.name, damage: ripoDmg, text: 'Riposte' });
            }
          } else {
            const mobHitChance = combat.calcMobHitChance(mob, session);
            if (combat.chance(mobHitChance)) {
              let dmgRoll = combat.calcMobDamage(mob, session.effectiveStats.ac);
              session.char.hp -= dmgRoll;
              events.push({ event: 'MELEE_HIT', source: mob.name, target: 'You', damage: dmgRoll });

              // Damage Shield reflection (SPA 59 = DS)
              if (Array.isArray(session.buffs)) {
                for (const buff of session.buffs) {
                  if (Array.isArray(buff.effects)) {
                    const dsEffect = buff.effects.find(e => e.spa === 59);
                    if (dsEffect && dsEffect.base !== 0) {
                      const dsDmg = Math.abs(dsEffect.base);
                      mob.hp -= dsDmg;
                      events.push({ event: 'SPELL_DAMAGE', source: buff.name, target: mob.name, spell: 'Damage Shield', damage: dsDmg });
                    }
                  }
                }
              }
              api.tryInterruptCasting(session, mob.name);
              api.breakSneak(session);
              api.breakHide(session);
            } else {
              events.push({ event: 'MELEE_MISS', source: mob.name, target: 'You' });
            }
          }
        
          // Check player death from async mob logic
          if (session.char.hp <= 0) {
              session.char.hp = 0;
              events.push({ event: 'DEATH', who: 'YOU' });
              events.push({ event: 'MESSAGE', text: 'You have been slain! You return to your bind point.' });
              
              session.char.hp = Math.floor(session.effectiveStats.hp * 0.5);
              session.char.mana = Math.floor(session.effectiveStats.mana * 0.5);
              session.char.state = 'standing';
              session.inCombat = false;
              session.combatTarget = null;
              // Despawn pet on owner death
              if (session.pet) {
                api.despawnPet(session, 'Your pet has lost its master and fades away.');
              }
              
              const xpPenalty = Math.floor(combat.xpForLevel(session.char.level) * 0.05);
              session.char.experience = Math.max(0, session.char.experience - xpPenalty);
              events.push({ event: 'MESSAGE', text: `You lost ${xpPenalty} experience.` });
              mob.target = null;
          }
        }

        if (events.length > 0 && !targetIsPet) api.sendCombatLog(mob.target, events);
      }
    } else if (mob.hp > 0 && !mob.target && mob.isRoaming) {
      // Roaming logic when not in combat
      processMobRoaming(mob, dt, zoneId, api);
    }
  }
}

module.exports = {
  processMobRoaming,
  processMobAI
};
