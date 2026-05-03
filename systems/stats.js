const DB = require('../db');
const combat = require('../combat');
const ItemDB = require('../data/itemDatabase');
let ITEMS;
setTimeout(() => { ITEMS = ItemDB.createLegacyProxy(); }, 0);

// Training cost formula (P99 community polynomial: cost in copper per point)
function getTrainingCostCopper(currentSkillValue) {
  if (currentSkillValue <= 0) return 0; // First point is always free
  const x = currentSkillValue;
  // Cost in platinum (3rd-order polynomial from P99 data fitting)
  const pp = 9.99389e-6 * x*x*x - 2.97456e-4 * x*x + 2.68839e-3 * x;
  return Math.max(0, Math.round(pp * 1000)); // Convert pp to copper (1pp = 1000cp)
}

// Break copper into pp/gp/sp/cp
function copperToCoins(totalCopper) {
  const pp = Math.floor(totalCopper / 1000);
  const gp = Math.floor((totalCopper % 1000) / 100);
  const sp = Math.floor((totalCopper % 100) / 10);
  const cp = totalCopper % 10;
  return { pp, gp, sp, cp };
}

function formatCurrency(copper) {
  const { pp, gp, sp, cp } = copperToCoins(copper);
  let str = [];
  if (pp > 0) str.push(`${pp}pp`);
  if (gp > 0) str.push(`${gp}gp`);
  if (sp > 0) str.push(`${sp}sp`);
  if (cp > 0 || str.length === 0) str.push(`${cp}cp`);
  return str.join(' ');
}

function getChaSellMod(session) {
  const cha = session.effectiveStats.cha || 75;
  // Typical EQ charisma modifier curve for selling items
  let mod = 1.0 + ((cha - 75) * 0.005);
  if (mod < 0.8) mod = 0.8;
  if (mod > 1.3) mod = 1.3;
  return mod;
}

// Skill rank label based on current value vs cap
function getSkillRank(value, cap) {
  if (cap <= 0) return 'N/A';
  const pct = (value / cap) * 100;
  if (pct >= 91) return 'Master';
  if (pct >= 81) return 'Excellent';
  if (pct >= 71) return 'Very Good';
  if (pct >= 61) return 'Good';
  if (pct >= 51) return 'Above Avg';
  if (pct >= 41) return 'Average';
  if (pct >= 31) return 'Below Avg';
  if (pct >= 21) return 'Bad';
  if (pct >= 11) return 'Very Bad';
  if (pct >= 6) return 'Feeble';
  return 'Awful';
}

function calcEffectiveStats(char, inventory, buffs = []) {
  const stats = {
    str: char.str, sta: char.sta, agi: char.agi,
    dex: char.dex, wis: char.wis, intel: char.intel, cha: char.cha,
    ac: 0, mitigationAC: 0, avoidanceAC: 0,
    hp: 0, mana: 0,
    dmg: 2, dly: 30, offhandDmg: 0, offhandDly: 0,
    // Resists (SPA 46-50)
    resistFire: 0, resistCold: 0, resistPoison: 0, resistDisease: 0, resistMagic: 0,
    // ATK bonus (SPA 2)
    atkBonus: 0
  };

  // 1. Equipment Stat Bonuses (Primary Stats + Resists + ATK)
  for (const row of inventory) {
    if (row.equipped !== 1) continue;
    const itemDef = ItemDB.getById(row.item_key) || ITEMS[row.item_key];
    if (!itemDef) continue;
    
    if (itemDef.str) stats.str += itemDef.str;
    if (itemDef.sta) stats.sta += itemDef.sta;
    if (itemDef.agi) stats.agi += itemDef.agi;
    if (itemDef.dex) stats.dex += itemDef.dex;
    if (itemDef.wis) stats.wis += itemDef.wis;
    if (itemDef.intel) stats.intel += itemDef.intel;
    if (itemDef.cha) stats.cha += itemDef.cha;
    // Resists from gear
    if (itemDef.fr) stats.resistFire += itemDef.fr;
    if (itemDef.cr) stats.resistCold += itemDef.cr;
    if (itemDef.pr) stats.resistPoison += itemDef.pr;
    if (itemDef.dr) stats.resistDisease += itemDef.dr;
    if (itemDef.mr) stats.resistMagic += itemDef.mr;
    // ATK from gear
    if (itemDef.attack) stats.atkBonus += itemDef.attack;
  }

  // 2. Buff Stat Bonuses (SPAs 3-10)
  let buffAC = 0;
  let maxSPA3 = 0;
  let minSPA3 = 0;
  if (Array.isArray(buffs)) {
    for (const buff of buffs) {
      if (!Array.isArray(buff.effects)) {
        if (buff.ac) buffAC += buff.ac;
        continue;
      }
      for (const eff of buff.effects) {
        switch (eff.spa) {
          case 1:  buffAC    += eff.base; break;
          case 2:  stats.atkBonus += eff.base; break; // ATK
          case 3: 
            if (eff.base < 0 && eff.base < minSPA3) minSPA3 = eff.base;
            if (eff.base > 0 && eff.base > maxSPA3) maxSPA3 = eff.base;
            break;
          case 4:  stats.str += eff.base; break;
          case 5:  stats.dex += eff.base; break;
          case 6:  stats.agi += eff.base; break;
          case 7:  stats.sta += eff.base; break;
          case 8:  stats.intel += eff.base; break;
          case 9:  stats.wis += eff.base; break;
          case 10: stats.cha += eff.base; break;
          // Resists from buffs (SPA 46-50)
          case 46: stats.resistFire += eff.base; break;
          case 47: stats.resistCold += eff.base; break;
          case 48: stats.resistPoison += eff.base; break;
          case 49: stats.resistDisease += eff.base; break;
          case 50: stats.resistMagic += eff.base; break;
        }
      }
    }
  }

  if (minSPA3 < 0) {
    stats.speedMod = Math.max(0.1, 1.0 + (minSPA3 / 100)); // Snared
  } else {
    stats.speedMod = 1.0 + (maxSPA3 / 100); // Hasted
  }

  // 2.5 Calculate Weight and Encumbrance Penalties
  let totalWeight = 0;
  totalWeight += ((char.copper || 0) + (char.silver || 0) + (char.gold || 0) + (char.platinum || 0)) * 0.1;
  for (const row of inventory) {
    const itemDef = ItemDB.getById(row.item_key) || ITEMS[row.item_key];
    if (itemDef && itemDef.weight) {
      totalWeight += (itemDef.weight / 10) * (row.quantity || 1);
    }
  }
  stats.weight = totalWeight;

  // Encumbrance check
  const maxWeight = stats.str; // Basic classic ratio
  let encumbranceSnare = 0;
  if (totalWeight > maxWeight) {
    const overage = totalWeight - maxWeight;
    // Snare penalty (drops to 0 if extremely overweight)
    encumbranceSnare = -Math.min(100, Math.floor((overage / 10) * 5)); // Lose 5% speed per 10 weight over limit
    // Agility penalty
    stats.agi = Math.max(1, stats.agi - Math.floor(overage));
  }

  // Apply Encumbrance Snare ONLY if they don't have magical Haste/Snare overriding it
  if (minSPA3 >= 0 && maxSPA3 === 0 && encumbranceSnare < 0) {
    stats.speedMod = Math.max(0.1, 1.0 + (encumbranceSnare / 100));
  }

  // 3. AC Calculation (Mitigation/Avoidance Split)
  const { acSum, shieldAC } = combat.calcACSum(char, inventory, stats, buffAC);
  stats.mitigationAC = combat.calcMitigationAC(char, acSum, shieldAC);
  stats.avoidanceAC = combat.calcAvoidanceAC(char, stats);
  stats.ac = combat.calcDisplayedAC(acSum, stats.avoidanceAC);

  // 4. Max HP/Mana
  stats.hp = combat.calcMaxHP(char.class, char.level, stats.sta);
  stats.mana = combat.calcMaxMana(char.class, char.level, stats);

  // 5. Equipment HP/Mana and Flat Bonuses
  for (const row of inventory) {
    if (row.equipped !== 1) continue;
    const itemDef = ItemDB.getById(row.item_key) || ITEMS[row.item_key];
    if (!itemDef) continue;
    if (itemDef.hp) stats.hp += itemDef.hp;
    if (itemDef.mana) stats.mana += itemDef.mana;
  }

  // 6. Buff Flat HP/Mana Bonuses
  if (Array.isArray(buffs)) {
    for (const buff of buffs) {
      if (!Array.isArray(buff.effects)) continue;
      for (const eff of buff.effects) {
        switch (eff.spa) {
          case 79: stats.hp += eff.base; break;
          case 15: stats.mana += eff.base; break;
        }
      }
    }
  }

  // 7. Weapon Stats
  const weapon = getWeaponStats(inventory);
  stats.dmg = weapon.damage;
  stats.dly = weapon.delay;
  stats.offhandDmg = weapon.offhandDmg;
  stats.offhandDly = weapon.offhandDly;

  // 8. Fatigue Penalties
  if (char.fatigue >= 100 && stats.sta < 100) {
    stats.str = Math.max(1, stats.str - 15);
    stats.agi = Math.max(1, stats.agi - 15);
    stats.dex = Math.max(1, stats.dex - 15);
  }

  return stats;
}

function getWeaponStats(inventory) {
  let stats = { damage: 2, delay: 30, weight: 0.0, offhandDmg: 0, offhandDly: 0, offhandWeight: 0.0 };
  
  for (const row of inventory) {
    if (row.equipped !== 1) continue;
    const itemDef = ItemDB.getById(row.item_key) || ITEMS[row.item_key];
    if (!itemDef) continue;

    if (row.slot === 13) { // Primary
      stats.damage = itemDef.damage || 2;
      stats.delay = itemDef.delay || 30;
      stats.weight = (itemDef.weight || 0) / 10.0;
    } else if (row.slot === 14) { // Secondary
      stats.offhandDmg = itemDef.damage || 0;
      stats.offhandDly = itemDef.delay || 0;
      stats.offhandWeight = (itemDef.weight || 0) / 10.0;
    }
  }
  return stats;
}

function getWeaponSkillName(inventory) {
  for (const row of inventory) {
    if (row.equipped === 1 && row.slot === 13) {
      const itemDef = ItemDB.getById(row.item_key) || ITEMS[row.item_key];
      if (itemDef) {
        switch (itemDef.itemtype) {
          case 0:  return '1h_slashing';
          case 1:  return '2h_slashing';
          case 2:  return 'piercing';
          case 3:  return '1h_blunt';
          case 4:  return '2h_blunt';
          case 5:  return 'archery';
          case 7:  return 'throwing';
          case 35: case 45: return 'hand_to_hand';
          case 36: return 'piercing';
          default: return '1h_slashing';
        }
      }
      break;
    }
  }
  return 'hand_to_hand';
}

let sendCombatLog, SpellSystem;
function setDependencies(deps) {
  sendCombatLog = deps.sendCombatLog;
  SpellSystem = deps.SpellSystem;
}

function processRegen(session, dt) {
  if (!session.abilityCooldowns) session.abilityCooldowns = {};
  for (let key in session.abilityCooldowns) {
    if (session.abilityCooldowns[key] > 0) session.abilityCooldowns[key] -= dt;
  }

  const char = session.char;
  const effective = session.effectiveStats;
  if (char.hp <= 0) return;

  if (session.regenTimer === undefined) session.regenTimer = 6.0;
  session.regenTimer -= dt;
  
  if (session.regenTimer <= 0) {
    session.regenTimer = 6.0;
    const rates = combat.getRegenRates(char.class, char.level, effective);

    if (char.fatigue === undefined) char.fatigue = 0;
    let fatigueChange = 0;

    const dist = session.tickDistance || 0;
    const isMoving = dist > 1.0;
    const isSprinting = dist > 10.0; 
    const isSwimming = session.isInWater || false;
    session.isInWater = false;

    if (isMoving) {
      if (isSwimming) {
        let swimSkill = combat.getCharSkill(char, 'swimming') || 0;
        fatigueChange += (1.0 - (swimSkill / 100));
      } else if (isSprinting) {
        fatigueChange += 0.5;
      } else {
        fatigueChange -= 0.5;
      }
    } else {
      if (char.state === 'medding') {
        fatigueChange -= 4.0;
      } else {
        fatigueChange -= 2.0;
      }
    }

    let totalWeight = 0;
    const ItemDB = require('../data/itemDatabase');
    for (const row of session.inventory) {
      const itemDef = ItemDB.getById(row.item_key) || ITEMS[row.item_key];
      if (itemDef && itemDef.weight) {
        totalWeight += (itemDef.weight / 10) * (row.quantity || 1);
      }
    }
    const maxWeight = effective.str; 
    if (totalWeight > maxWeight) {
      fatigueChange += ((totalWeight - maxWeight) * 0.2);
    }

    let oldFatigue = char.fatigue;
    char.fatigue += fatigueChange;
    if (char.fatigue < 0) char.fatigue = 0;
    if (char.fatigue > 100) char.fatigue = 100;
    session.tickDistance = 0; // reset

    if ((oldFatigue < 100 && char.fatigue >= 100) || (oldFatigue >= 100 && char.fatigue < 100)) {
        session.effectiveStats = calcEffectiveStats(char, session.inventory, session.buffs);
    }

    const SurvivalSystem = require('./survival');
    const penalty = SurvivalSystem.getRegenPenalty(char);

    if (char.state === 'medding') {
      char.hp = combat.clamp(char.hp + Math.max(0, Math.floor(rates.hpSitting * penalty)), 0, effective.hp);
      if (effective.mana > 0) {
        char.mana = combat.clamp(char.mana + Math.max(0, Math.floor(rates.manaSitting * penalty)), 0, effective.mana);
      }
    } else if (!session.inCombat) {
      char.hp = combat.clamp(char.hp + Math.max(0, Math.floor(rates.hpStanding * penalty)), 0, effective.hp);
      if (effective.mana > 0) {
        char.mana = combat.clamp(char.mana + Math.max(0, Math.floor(rates.manaStanding * penalty)), 0, effective.mana);
      }
    }
  }
}

function processBuffs(session, dt) {
  let changed = false;
  for (let i = session.buffs.length - 1; i >= 0; i--) {
    const buff = session.buffs[i];
    buff.duration -= dt;

    if (Array.isArray(buff.effects)) {
      // HoT (SPA 0 positive = heal over time, e.g. Chloroplast/Regeneration)
      const hotEffect = buff.effects.find(e => e.spa === 0 && e.base > 0);
      if (hotEffect) {
        if (!buff.tickTimer) buff.tickTimer = 6;
        buff.tickTimer -= dt;
        if (buff.tickTimer <= 0) {
          buff.tickTimer = 6;
          const healAmt = hotEffect.base;
          session.char.hp = Math.min(session.char.hp + healAmt, session.effectiveStats.hp);
          sendCombatLog(session, [{ event: 'SPELL_HEAL', source: buff.name, target: 'You', spell: buff.name, amount: healAmt }]);
        }
      }

      // Mana Regen over time (SPA 15 positive = mana per tick, e.g. Clarity/Breeze)
      const manaRegenEffect = buff.effects.find(e => e.spa === 15 && e.base > 0);
      if (manaRegenEffect && buff.duration > 0) {
        if (!buff.manaTickTimer) buff.manaTickTimer = 6;
        buff.manaTickTimer -= dt;
        if (buff.manaTickTimer <= 0) {
          buff.manaTickTimer = 6;
          const manaAmt = manaRegenEffect.base;
          const maxMana = session.effectiveStats.mana || session.char.maxMana || 0;
          if (maxMana > 0) {
            session.char.mana = Math.min(session.char.mana + manaAmt, maxMana);
          }
        }
      }

      // HP Regen (SPA 100 = flat HP regen per tick, stacks with SPA 0)
      const hpRegenEffect = buff.effects.find(e => e.spa === 100 && e.base > 0);
      if (hpRegenEffect && buff.duration > 0) {
        if (!buff.hpRegenTickTimer) buff.hpRegenTickTimer = 6;
        buff.hpRegenTickTimer -= dt;
        if (buff.hpRegenTickTimer <= 0) {
          buff.hpRegenTickTimer = 6;
          const hpAmt = hpRegenEffect.base;
          session.char.hp = Math.min(session.char.hp + hpAmt, session.effectiveStats.hp);
        }
      }
    }

    if (buff.duration <= 0) {
      sendCombatLog(session, [{ event: 'MESSAGE', text: `${buff.name} has worn off.` }]);
      // Clean up state flags tied to specific buff types
      if (buff.isLevitate) session.char.isLevitating = false;
      if (buff.isWaterBreathing) session.char.canWaterBreathe = false;
      if (buff.isSizeMod) {
        session.char.sizeMod = 100;
        if (session.char.networkData) session.char.networkData = null;
      }
      if (buff.isBindSight) {
        session.bindSightTarget = null;
        session.bindSightTargetId = null;
        // Notify client to return camera to player
        const { send } = require('../utils');
        if (session.ws) send(session.ws, { type: 'BIND_SIGHT', active: false });
      }
      session.buffs.splice(i, 1);
      changed = true;
    }
  }
  if (changed) {
    session.effectiveStats = calcEffectiveStats(session.char, session.inventory, session.buffs);
    session.char.maxHp = session.effectiveStats.hp;
    session.char.maxMana = session.effectiveStats.mana;
    if (session.char.hp > session.effectiveStats.hp) session.char.hp = session.effectiveStats.hp;
    if (session.char.mana > session.effectiveStats.mana) session.char.mana = session.effectiveStats.mana;
    SpellSystem.sendBuffs(session);
  }
}

module.exports = {
  setDependencies,
  processRegen,
  processBuffs,
  getTrainingCostCopper,
  copperToCoins,
  formatCurrency,
  getChaSellMod,
  getSkillRank,
  calcEffectiveStats,
  getWeaponStats,
  getWeaponSkillName,
};
