// server/combat.js
// ═══════════════════════════════════════════════════════════════════
//  EQ-Authentic Combat Math — based on classic EQ (Kunark/Velious era)
// ═══════════════════════════════════════════════════════════════════

const { Skills, RACIAL_SKILLS } = require('./data/skills');
const ItemDB = require('./data/itemDatabase');
let ITEMS;
setTimeout(() => { ITEMS = ItemDB.createLegacyProxy(); }, 0);

function roll(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
function chance(pct) {
  return Math.random() * 100 < pct;
}

// ── Skill System ────────────────────────────────────────────────────

function getMaxSkill(charClassId, skillName, level, charRaceId) {
  const CLASS_ID_TO_NAME = {
    1: 'warrior', 2: 'cleric', 3: 'paladin', 4: 'ranger', 5: 'shadowknight',
    6: 'druid', 7: 'monk', 8: 'bard', 9: 'rogue', 10: 'shaman',
    11: 'necromancer', 12: 'wizard', 13: 'magician', 14: 'enchanter',
    15: 'beastlord', 16: 'berserker'
  };
  const RACE_ID_TO_NAME = {
    1: 'human', 2: 'barbarian', 3: 'erudite', 4: 'wood_elf', 5: 'high_elf',
    6: 'dark_elf', 7: 'half_elf', 8: 'dwarf', 9: 'troll', 10: 'ogre',
    11: 'halfling', 12: 'gnome', 128: 'iksar', 130: 'vah_shir', 330: 'froglok'
  };

  const charClass = typeof charClassId === 'string' ? charClassId : CLASS_ID_TO_NAME[charClassId];
  const charRace = typeof charRaceId === 'string' ? charRaceId : RACE_ID_TO_NAME[charRaceId];

  let classCap = 0;
  const skillDef = Skills[skillName];
  if (skillDef && charClass && skillDef.classes[charClass]) {
    const c = skillDef.classes[charClass];
    if (level >= c.levelGranted) {
      classCap = Math.min(c.maxCap, c.capFormula(level));
    }
  }

  // Check racial innate skill (e.g., Halfling Hide/Sneak)
  let racialCap = 0;
  if (charRace && RACIAL_SKILLS[charRace] && RACIAL_SKILLS[charRace][skillName]) {
    const r = RACIAL_SKILLS[charRace][skillName];
    if (level >= r.levelGranted) {
      racialCap = Math.min(r.maxCap, r.capFormula(level));
    }
  }

  return Math.max(classCap, racialCap);
}

function getCharSkill(char, skillName) {
  let skill = (char.skills && char.skills[skillName]) || 0;
  if (skill === 0 && getMaxSkill(char.class, skillName, char.level, char.race) > 0) {
      skill = 1;
      if (char.skills) char.skills[skillName] = 1;
  }
  return skill;
}

function trySkillUp(session, skillName, targetLevel) {
  const char = session.char;
  if (!char.skills) char.skills = {};
  
  const currentSkill = getCharSkill(char, skillName);
  const maxSkill = getMaxSkill(char.class, skillName, char.level);
  
  if (currentSkill >= maxSkill) return false;
  
  let chanceToSkillUp = Math.max(1, 10 - Math.floor(currentSkill / 20));
  
  // Massive boost for very low skills (new characters)
  if (currentSkill < 15) chanceToSkillUp += 25;
  else if (currentSkill < 40) chanceToSkillUp += 10;

  const statBoost = Math.floor((Math.max(session.effectiveStats.intel, session.effectiveStats.wis) - 75) / 10);
  
  let catchUpBonus = 0;
  if (targetLevel !== undefined) {
    const targetMax = getMaxSkill(char.class, skillName, targetLevel);
    if (currentSkill < targetMax * 0.5) {
      catchUpBonus = 5 + (targetMax - currentSkill) / 10;
    }
  }

  if (chance(chanceToSkillUp + statBoost + catchUpBonus)) {
    char.skills[skillName] = currentSkill + 1;
    if (!session.skillUpMessages) session.skillUpMessages = [];
    session.skillUpMessages.push({ skillName: Skills[skillName].name, newLevel: currentSkill + 1 });
    return true;
  }
  return false;
}

// ── To-Hit Calculation ──────────────────────────────────────────────

function calcPlayerATK(session, weaponSkillName = '1h_slashing') {
  const char = session.char;
  const offSkill = getCharSkill(char, 'offense');
  const wpnSkill = getCharSkill(char, weaponSkillName);
  const strBonus = Math.floor((session.effectiveStats.str - 75) / 2);
  return Math.floor((offSkill + wpnSkill) / 2) + strBonus;
}

function calcMobDefense(mob) {
  return (mob.defense || mob.level * 5);
}

function calcHitChance(attackerATK, defenderDefense, levelDiff) {
  const skillDiff = attackerATK - defenderDefense;
  const modifier = skillDiff * 0.2;
  const levelMod = levelDiff * 2;
  return clamp(42 + modifier - levelMod, 5, 95);
}

function calcMobHitChance(mob, session) {
  const defSkill = getCharSkill(session.char, 'defense');
  const mobATK = (mob.offense || mob.level * 5);
  const skillDiff = mobATK - defSkill;
  const modifier = skillDiff * 0.2;
  return clamp(42 + modifier, 10, 95);
}

// ── Avoidance Checks ────────────────────────────────────────────────

function checkAvoidance(session) {
  const char = session.char;
  const agiBonus = Math.floor((session.effectiveStats.agi - 75) / 10);

  const riposteSkill = getCharSkill(char, 'riposte');
  if (riposteSkill > 0 && chance(riposteSkill / 4.5 + agiBonus)) {
    trySkillUp(session, 'riposte');
    return 'RIPOSTE';
  }

  const blockSkill = getCharSkill(char, 'block');
  if (blockSkill > 0 && chance(blockSkill / 5.0)) {
    trySkillUp(session, 'block');
    return 'BLOCK';
  }

  const parrySkill = getCharSkill(char, 'parry');
  if (parrySkill > 0 && chance(parrySkill / 4.5 + agiBonus)) {
    trySkillUp(session, 'parry');
    return 'PARRY';
  }

  const dodgeSkill = getCharSkill(char, 'dodge');
  if (dodgeSkill > 0 && chance(dodgeSkill / 5.0 + agiBonus)) {
    trySkillUp(session, 'dodge');
    return 'DODGE';
  }

  return null;
}

// ── AC System (Dzarn's Formula) ──────────────────────────────────────
const SOFT_CAPS = {
  enchanter: { cap: 408, mult: 0.25 }, magician: { cap: 408, mult: 0.25 },
  necromancer: { cap: 408, mult: 0.25 }, wizard: { cap: 408, mult: 0.25 },
  druid: { cap: 418, mult: 0.265 }, beastlord: { cap: 432, mult: 0.28 },
  berserker: { cap: 432, mult: 0.28 }, rogue: { cap: 432, mult: 0.28 },
  shaman: { cap: 432, mult: 0.28 }, bard: { cap: 448, mult: 0.3 },
  cleric: { cap: 448, mult: 0.3 }, monk: { cap: 448, mult: 0.3 },
  ranger: { cap: 468, mult: 0.315 }, paladin: { cap: 488, mult: 0.33 },
  shadow_knight: { cap: 488, mult: 0.33 }, warrior: { cap: 510, mult: 0.35 }
};

function calcAvoidanceAC(char, effectiveStats) {
  const defenseSkill = getCharSkill(char, 'defense');
  const step1 = Math.floor((defenseSkill * 400) / 225);
  
  // Agility Bonus
  const functionalAgi = effectiveStats.agi;
  const stepAgi1 = Math.floor((8000 * (functionalAgi - 40)) / 36000);
  const stepAgi2 = Math.floor((char.heroic_agi || 0) / 10);
  const agiBonus = stepAgi1 + stepAgi2;
  
  const itemAvoidance = Math.min(100, char.avoidance || 0);
  
  const drunkenness = char.drunk || 0;
  let reduction = 1.0;
  const value = drunkenness / 2;
  if (value > 20.0) {
    reduction = (110 - value) / 100.0;
  }
  if (reduction > 1.0) reduction = 1.0;
  
  let computedDefense = Math.floor((step1 + agiBonus + itemAvoidance) * reduction);
  return Math.max(1, computedDefense);
}

function calcACSum(char, inventory, effectiveStats, buffAC) {
  let rawItemAC = 0;
  let shieldAC = 0;
  
  for (const row of inventory) {
    if (row.equipped !== 1) continue;
    // Resolve item definition from key or stored def
    const itemDef = row.item_def || ItemDB.getById(row.item_key) || ITEMS[row.item_key] || {};
    if (itemDef.ac) {
      rawItemAC += itemDef.ac;
      if (row.slot === 14) { // Secondary slot
        shieldAC = itemDef.ac + Math.floor((char.heroic_str || 0) / 10);
      }
    }
  }
  
  // Step 7: EQ Math Multiplier (4/3)
  let acSum = Math.floor((rawItemAC * 4) / 3);
  
  // Step 8: Anti-twink cap
  if (char.level < 50) {
    const cap = 25 + (6 * char.level);
    if (acSum > cap) acSum = cap;
  }
  
  // Step 9: Race/Class Bonuses
  if (char.race === 'iksar') {
    acSum += Math.max(10, Math.min(35, char.level));
  }
  
  // Step 12-15: Buffs and Skills
  const isSilk = ['enchanter', 'magician', 'necromancer', 'wizard'].includes(char.class);
  const defenseSkill = getCharSkill(char, 'defense');
  
  if (isSilk) {
    acSum += Math.floor(defenseSkill / 2);
    acSum += Math.floor(buffAC / 3);
  } else {
    acSum += Math.floor(defenseSkill / 3);
    acSum += Math.floor(buffAC / 4);
  }
  
  // Agility Bonus (Step 17)
  if (effectiveStats.agi > 70) {
    acSum += Math.floor(effectiveStats.agi / 20);
  }
  
  return { acSum, shieldAC };
}

function calcMitigationAC(char, acSum, shieldAC) {
  const capData = SOFT_CAPS[char.class] || SOFT_CAPS.warrior;
  
  let acCap = capData.cap;
  // Combat Stability AA (SPA 259)
  const csRank = char.combat_stability || 0;
  acCap = acCap + Math.floor((acCap * csRank) / 100);
  
  const totalCap = acCap + shieldAC;
  
  if (acSum > totalCap) {
    return Math.floor(totalCap + (acSum - totalCap) * capData.mult);
  }
  return acSum;
}

function calcDisplayedAC(acSum, avoidanceAC) {
  return Math.floor((1000 * (acSum + avoidanceAC)) / 847);
}

// ── Damage Calculation ──────────────────────────────────────────────

const DAMAGE_BONUS_TABLE = [
  { minLevel: 28, bonus: delay => Math.max(0, Math.floor(delay / 10) - 1) },
  { minLevel: 35, bonus: delay => Math.max(0, Math.floor(delay / 8)) },
  { minLevel: 40, bonus: delay => Math.max(0, Math.floor(delay / 6)) },
  { minLevel: 45, bonus: delay => Math.max(0, Math.floor(delay / 5) + 1) },
  { minLevel: 50, bonus: delay => Math.max(0, Math.floor(delay / 4) + 2) },
];

function getDamageBonus(level, weaponDelay) {
  let bonus = 0;
  for (let i = DAMAGE_BONUS_TABLE.length - 1; i >= 0; i--) {
    if (level >= DAMAGE_BONUS_TABLE[i].minLevel) {
      bonus = DAMAGE_BONUS_TABLE[i].bonus(weaponDelay);
      break;
    }
  }
  return bonus;
}

function calcPlayerDamage(session, weaponDmg, weaponDelay) {
  const char = session.char;
  const baseDmg = roll(1, weaponDmg);
  const strBonus = Math.max(0, Math.floor((session.effectiveStats.str - 75) / 10));
  const dmgBonus = getDamageBonus(char.level, weaponDelay);
  return Math.max(1, baseDmg + strBonus + dmgBonus);
}

function calcMobDamage(mob, defenderMitigationAC) {
  const baseDmg = roll(mob.minDmg, mob.maxDmg);
  // Improved mitigation logic using the Real Mitigation AC
  const mitigation = Math.floor(defenderMitigationAC * 0.15); // Adjusted multiplier for classic feel
  return Math.max(1, baseDmg - mitigation);
}

function getMobAttackText(mob) {
    if (mob.attackType === 1 || mob.attackType === 3) return 'slash';
    if (mob.attackType === 36) return 'pierce';
    if (mob.attackType === 4 || mob.attackType === 5) return 'crush';
    if (mob.attackType === 0) return 'hit';
    
    // 28 is hand_to_hand, used for unarmed / monsters
    if (mob.attackType === 28 || mob.attackType === undefined) {
        const BITE_RACES = [36, 42, 43, 38, 46, 59, 65, 66, 74, 118, 120];
        const CLAW_RACES = [44, 57, 61, 117, 116];
        const STRIKE_RACES = [60, 63, 154];
        
        if (BITE_RACES.includes(mob.race)) return 'bite';
        if (CLAW_RACES.includes(mob.race)) return 'claw';
        if (STRIKE_RACES.includes(mob.race)) return 'strike';
        return 'hit';
    }
    return 'slash';
}

// ── Critical Hits ───────────────────────────────────────────────────

function checkCritical(charClass, level) {
  const critChance = (charClass === 'warrior') ? 1 + Math.floor(level / 20)
                   : (charClass === 'rogue')   ? 1
                   : 0;
  return chance(critChance);
}

function checkCripplingBlow(charLevel, mobLevel) {
  if (charLevel - mobLevel >= 5) return chance(2);
  return false;
}

// ── Double Attack ───────────────────────────────────────────────────
function checkDoubleAttack(session) {
  const skill = getCharSkill(session.char, 'double_attack');
  if (skill <= 0) return false;
  if (chance(skill / 3.0)) {
    trySkillUp(session, 'double_attack');
    return true;
  }
  return false;
}

// ── Dual Wield ──────────────────────────────────────────────────────
function checkDualWield(session) {
  const skill = getCharSkill(session.char, 'dual_wield');
  if (skill <= 0) return false;
  if (chance(skill / 4.0)) {
    trySkillUp(session, 'dual_wield');
    return true;
  }
  return false;
}

// ── Special Abilities ───────────────────────────────────────────────

function calcKickDamage(session) {
  const skill = getCharSkill(session.char, 'kick');
  if (skill <= 0) return 0;
  trySkillUp(session, 'kick');
  return roll(1, Math.max(1, Math.floor(skill / 3)));
}

function calcBashDamage(session) {
  const skill = getCharSkill(session.char, 'bash');
  if (skill <= 0) return 0;
  trySkillUp(session, 'bash');
  return roll(1, Math.max(1, Math.floor(skill / 4)));
}

function calcBackstabDamage(session, weaponDmg) {
  const skill = getCharSkill(session.char, 'backstab');
  if (skill <= 0) return 0;
  trySkillUp(session, 'backstab');
  const multiplier = Math.max(2, 2 + Math.floor(skill / 50));
  return weaponDmg * multiplier + roll(1, weaponDmg);
}

// ── Spell Resist System ─────────────────────────────────────────────

const RESIST_TYPES = ['fire', 'cold', 'magic', 'poison', 'disease'];

function calcSpellResist(mob, casterLevel, spellResistType, spellResistAdjust) {
  const resistType = spellResistType || 'magic';
  const mobResist = (mob.resists && mob.resists[resistType]) || (mob.level * 2);

  const effectiveResist = mobResist - (casterLevel * 1.5) + (spellResistAdjust || 0);
  const resistRoll = roll(0, 200);

  if (effectiveResist <= 0) return 'LANDED';           
  if (resistRoll < effectiveResist * 0.25) return 'FULL_RESIST';
  if (resistRoll < effectiveResist * 0.5)  return 'PARTIAL_RESIST'; 
  return 'LANDED';
}

function getCon(playerLevel, mobLevel) {
  const diff = mobLevel - playerLevel;
  if (diff >= 4)       return { color: 'RED',        label: 'threatens to eat you', xpMod: 1.3 };
  if (diff >= 1)       return { color: 'YELLOW',     label: 'looks tough',          xpMod: 1.15 };
  if (diff === 0)      return { color: 'WHITE',      label: 'is a worthy opponent', xpMod: 1.0 };
  if (diff >= -2)      return { color: 'BLUE',       label: 'could be a challenge',  xpMod: 0.8 };
  if (diff >= -5)      return { color: 'LIGHT_BLUE', label: 'looks like an easy fight', xpMod: 0.5 };
  if (diff >= -10)     return { color: 'GREEN',      label: 'looks like a pushover', xpMod: 0.15 };
  return                       { color: 'GRAY',       label: 'looks harmless',       xpMod: 0 };
}

const CUSTOM_XP_TABLE = [
  0,          // 0 (unused)
  0,          // 1
  300,        // 2
  1677,       // 3
  5040,       // 4
  11373,      // 5
  21720,      // 6
  37173,      // 7
  58866,      // 8
  87966,      // 9
  125673,     // 10
  187652,     // 11
  251176,     // 12
  328104,     // 13
  419842,     // 14
  527826,     // 15
  653510,     // 16
  798369,     // 17
  963895,     // 18
  1151602,    // 19
  1363018,    // 20
  1722742,    // 21
  2006501,    // 22
  2320840,    // 23
  2667469,    // 24
  3048122,    // 25
  3464545,    // 26
  3918495,    // 27
  4411743,    // 28
  4946078,    // 29
  5523298,    // 30
  6456174,    // 31
  7633515,    // 32
  8401515,    // 33
  9223305,    // 34
  10100880,   // 35
  11503924,   // 36
  12499091,   // 37
  13556089,   // 38
  14676956,   // 39
  15863741,   // 40
  17745889,   // 41
  20342084,   // 42
  21832160,   // 43
  23401404,   // 44
  25052056,   // 45
  27653524,   // 46
  29473756,   // 47
  31382180,   // 48
  33381076,   // 49
  35472736,   // 50
  41174871,   // 51
  43601723,   // 52
  46134494,   // 53
  48775661,   // 54
  51527701,   // 55
  54393111,   // 56
  57374388,   // 57
  60474045,   // 58
  63694597,   // 59
  67038574    // 60
];

function xpForLevel(level) {
  if (level <= 1) return 0;
  if (level <= 60) return CUSTOM_XP_TABLE[level];
  // Fallback for levels above 60, if they ever become possible
  let diff = CUSTOM_XP_TABLE[60] - CUSTOM_XP_TABLE[59];
  return CUSTOM_XP_TABLE[60] + diff * (level - 60);
}

function calcXPGain(playerLevel, mobLevel, mobXpBase, zoneZEM) {
  const con = getCon(playerLevel, mobLevel);
  if (con.xpMod <= 0) return 0;
  const zem = zoneZEM || 1.0;
  const baseXP = mobXpBase || Math.floor(mobLevel * mobLevel * 0.8);
  return Math.max(1, Math.floor(baseXP * con.xpMod * zem));
}

const CLASS_REGEN = {
  warrior: { hpSit: (lv, sta) => Math.ceil(lv / 3 + sta / 25 + 2), hpStand: (lv, sta) => Math.ceil(lv / 8 + sta / 50 + 1), manaSit: () => 0, manaStand: () => 0 },
  rogue:   { hpSit: (lv, sta) => Math.ceil(lv / 3 + sta / 25 + 2), hpStand: (lv, sta) => Math.ceil(lv / 8 + sta / 50 + 1), manaSit: () => 0, manaStand: () => 0 },
  cleric:  { hpSit: (lv, sta) => Math.ceil(lv / 4 + sta / 30 + 1), hpStand: (lv, sta) => Math.ceil(lv / 10 + sta / 60 + 1), manaSit: (lv, wis) => Math.ceil(lv / 3 + wis / 20 + 2), manaStand: (lv, wis) => Math.ceil(lv / 15 + 1) },
  wizard:  { hpSit: (lv, sta) => Math.ceil(lv / 5 + sta / 35 + 1), hpStand: (lv, sta) => Math.ceil(lv / 12 + 1), manaSit: (lv, intel) => Math.ceil(lv / 3 + intel / 20 + 2), manaStand: (lv, intel) => Math.ceil(lv / 15 + 1) },
};

CLASS_REGEN.paladin = CLASS_REGEN.warrior;
CLASS_REGEN.shadow_knight = CLASS_REGEN.warrior;
CLASS_REGEN.ranger = CLASS_REGEN.rogue;
CLASS_REGEN.monk = CLASS_REGEN.rogue;
CLASS_REGEN.druid = CLASS_REGEN.cleric;
CLASS_REGEN.shaman = CLASS_REGEN.cleric;
CLASS_REGEN.necromancer = CLASS_REGEN.wizard;
CLASS_REGEN.magician = CLASS_REGEN.wizard;
CLASS_REGEN.enchanter = CLASS_REGEN.wizard;
CLASS_REGEN.bard = CLASS_REGEN.rogue;

function getRegenRates(charClass, level, stats) {
  const regen = CLASS_REGEN[charClass] || CLASS_REGEN.warrior;
  const sta = stats.sta || 75;
  const wis = stats.wis || 75;
  const intel = stats.intel || 75;
  const castStat = (charClass === 'cleric') ? wis : intel;

  return {
    hpSitting:  regen.hpSit(level, sta),
    hpStanding: regen.hpStand(level, sta),
    hpCombat:   0,
    manaSitting:  regen.manaSit(level, castStat),
    manaStanding: regen.manaStand(level, castStat),
    manaCombat:   0,
  };
}

function checkFizzle(casterLevel, spellLevel) {
  if (!spellLevel || spellLevel <= 0) return false;
  const levelDiff = casterLevel - spellLevel;
  const fizzleChance = Math.max(1, 15 - levelDiff * 3);
  return chance(fizzleChance);
}

// ── Classic EQ Max HP Calculation ───────────────────────────────────
// Based on classic EQ (pre-Luclin) formulas.
// At level 1: Warrior with 85 STA → ~37 HP
// HP scales with level and stamina using class-specific multipliers.

const CLASS_HP_TABLE = {
  // { baseHP, staMult, levelMult } — baseHP is level 1 starting HP before STA
  warrior:       { baseHP: 20, staMult: 0.20, levelMult: 14 },
  paladin:       { baseHP: 18, staMult: 0.18, levelMult: 13 },
  shadow_knight: { baseHP: 18, staMult: 0.18, levelMult: 13 },
  ranger:        { baseHP: 16, staMult: 0.17, levelMult: 12 },
  monk:          { baseHP: 18, staMult: 0.18, levelMult: 13 },
  rogue:         { baseHP: 15, staMult: 0.16, levelMult: 12 },
  bard:          { baseHP: 15, staMult: 0.16, levelMult: 12 },
  cleric:        { baseHP: 14, staMult: 0.15, levelMult: 10 },
  druid:         { baseHP: 12, staMult: 0.14, levelMult: 9 },
  shaman:        { baseHP: 14, staMult: 0.15, levelMult: 10 },
  wizard:        { baseHP: 10, staMult: 0.10, levelMult: 7 },
  magician:      { baseHP: 10, staMult: 0.10, levelMult: 7 },
  necromancer:   { baseHP: 10, staMult: 0.10, levelMult: 7 },
  enchanter:     { baseHP: 10, staMult: 0.10, levelMult: 7 },
  beastlord:     { baseHP: 16, staMult: 0.17, levelMult: 12 },
};

function calcMaxHP(charClass, level, stamina) {
  const entry = CLASS_HP_TABLE[charClass] || CLASS_HP_TABLE.warrior;
  // Level 1: baseHP + floor(sta * staMult)
  // Level 2+: adds levelMult per additional level
  const baseHP = entry.baseHP + Math.floor(stamina * entry.staMult);
  const levelHP = Math.max(0, (level - 1)) * entry.levelMult;
  return baseHP + levelHP;
}

// ── Classic EQ Max Mana Calculation ─────────────────────────────────
// Only caster/hybrid classes get mana. Pure melee = 0.
// Mana scales from primary casting stat (WIS for priests, INT for casters).

const CLASS_MANA_TABLE = {
  warrior:       null,
  rogue:         null,
  monk:          null,
  // Priests (WIS-based)
  cleric:        { baseMana: 20, statMult: 0.20, levelMult: 10, stat: 'wis' },
  druid:         { baseMana: 20, statMult: 0.20, levelMult: 10, stat: 'wis' },
  shaman:        { baseMana: 20, statMult: 0.20, levelMult: 10, stat: 'wis' },
  // Casters (INT-based)
  wizard:        { baseMana: 25, statMult: 0.25, levelMult: 12, stat: 'intel' },
  magician:      { baseMana: 25, statMult: 0.25, levelMult: 12, stat: 'intel' },
  necromancer:   { baseMana: 25, statMult: 0.25, levelMult: 12, stat: 'intel' },
  enchanter:     { baseMana: 25, statMult: 0.25, levelMult: 12, stat: 'intel' },
  // Hybrids
  paladin:       { baseMana: 10, statMult: 0.10, levelMult: 6, stat: 'wis' },
  shadow_knight: { baseMana: 10, statMult: 0.10, levelMult: 6, stat: 'intel' },
  ranger:        { baseMana: 10, statMult: 0.10, levelMult: 6, stat: 'wis' },
  bard:          { baseMana: 10, statMult: 0.08, levelMult: 5, stat: 'intel' },
  beastlord:     { baseMana: 10, statMult: 0.10, levelMult: 6, stat: 'wis' },
};

function calcMaxMana(charClass, level, stats) {
  const entry = CLASS_MANA_TABLE[charClass];
  if (!entry) return 0; // Pure melee
  const castingStat = stats[entry.stat] || 75;
  const baseMana = entry.baseMana + Math.floor(castingStat * entry.statMult);
  const levelMana = Math.max(0, (level - 1)) * entry.levelMult;
  return baseMana + levelMana;
}

module.exports = {
  roll, clamp, chance, 
  getMaxSkill, getCharSkill, trySkillUp,
  calcPlayerATK, calcMobDefense, calcHitChance, calcMobHitChance,
  checkAvoidance, calcPlayerDamage, calcMobDamage,
  checkCritical, checkCripplingBlow, checkDoubleAttack, checkDualWield,
  calcKickDamage, calcBashDamage, calcBackstabDamage,
  calcSpellResist, RESIST_TYPES,
  getCon, xpForLevel, calcXPGain, getRegenRates, checkFizzle,
  calcMaxHP, calcMaxMana,
  calcAvoidanceAC, calcACSum, calcMitigationAC, calcDisplayedAC, getMobAttackText,
};
