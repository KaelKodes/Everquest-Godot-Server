const fs = require('fs');
const path = 'd:/Kael Kodes/EQMUD/server/gameEngine.js';
let content = fs.readFileSync(path, 'utf8');

const newFunc = `function calcEffectiveStats(char, inventory, buffs = []) {
  const stats = {
    str: char.str, sta: char.sta, agi: char.agi,
    dex: char.dex, wis: char.wis, intel: char.intel, cha: char.cha,
    ac: 0, hp: 0, mana: 0, dmg: 2, dly: 30, offhandDmg: 0, offhandDly: 0,
    mitigationAC: 0, avoidanceAC: 0, acSum: 0
  };

  let buffAC = 0;
  const invWithDefs = inventory.map(row => ({ ...row, item_def: ItemDB.getById(row.item_key) }));

  for (const row of invWithDefs) {
    if (row.equipped !== 1) continue;
    const itemDef = row.item_def;
    if (!itemDef) continue;
    if (itemDef.str) stats.str += itemDef.str;
    if (itemDef.sta) stats.sta += itemDef.sta;
    if (itemDef.agi) stats.agi += itemDef.agi;
    if (itemDef.dex) stats.dex += itemDef.dex;
    if (itemDef.wis) stats.wis += itemDef.wis;
    if (itemDef.intel) stats.intel += itemDef.intel;
    if (itemDef.cha) stats.cha += itemDef.cha;
    if (row.slot === 13) { stats.dmg = itemDef.damage || 2; stats.dly = itemDef.delay || 30; }
    else if (row.slot === 14) { stats.offhandDmg = itemDef.damage || 0; stats.offhandDly = itemDef.delay || 0; }
  }

  if (Array.isArray(buffs)) {
    for (const buff of buffs) {
      if (!Array.isArray(buff.effects)) {
        if (buff.ac) buffAC += buff.ac;
        continue;
      }
      for (const eff of buff.effects) {
        switch (eff.spa) {
          case 1:  buffAC     += eff.base; break;
          case 4:  stats.str  += eff.base; break;
          case 5:  stats.dex  += eff.base; break;
          case 6:  stats.agi  += eff.base; break;
          case 7:  stats.sta  += eff.base; break;
          case 8:  stats.intel += eff.base; break;
          case 9:  stats.wis  += eff.base; break;
          case 10: stats.cha  += eff.base; break;
        }
      }
    }
  }

  stats.avoidanceAC = combat.calcAvoidanceAC(char, stats);
  const { acSum, shieldAC } = combat.calcACSum(char, invWithDefs, stats, buffAC);
  stats.acSum = acSum;
  stats.mitigationAC = combat.calcMitigationAC(char, acSum, shieldAC);
  stats.ac = combat.calcDisplayedAC(acSum, stats.avoidanceAC);

  stats.hp = combat.calcMaxHP(char.class, char.level, stats.sta);
  stats.mana = combat.calcMaxMana(char.class, char.level, stats);

  for (const row of invWithDefs) {
    if (row.equipped !== 1) continue;
    const itemDef = row.item_def;
    if (itemDef && itemDef.hp) stats.hp += itemDef.hp;
    if (itemDef && itemDef.mana) stats.mana += itemDef.mana;
  }

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

  return stats;
}`;

// Use a regex to replace the old function completely
// We look for function calcEffectiveStats up to its closing brace
// Since we know the approximate lines, we can be safe
const startIdx = content.indexOf('function calcEffectiveStats');
let braceCount = 0;
let endIdx = -1;
for (let i = startIdx; i < content.length; i++) {
  if (content[i] === '{') braceCount++;
  if (content[i] === '}') {
    braceCount--;
    if (braceCount === 0) {
      endIdx = i + 1;
      break;
    }
  }
}

if (startIdx !== -1 && endIdx !== -1) {
  content = content.substring(0, startIdx) + newFunc + content.substring(endIdx);
  fs.writeFileSync(path, content, 'utf8');
  console.log('Successfully patched calcEffectiveStats');
} else {
  console.error('Could not find function calcEffectiveStats');
  process.exit(1);
}
