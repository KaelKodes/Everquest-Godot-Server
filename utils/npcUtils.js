const { NPC_TYPES } = require('../data/npcTypes');

/** PEQ race 240 = invisible trigger / bind_trap / flavor — never a combat mob (227+ zones). */
const TRIGGER_PLACEHOLDER_RACE = 240;

/** Exact display names after normalizeTriggerName(). */
const TRIGGER_NPC_NAMES = new Set([
  'bind trap', 'betabstgmspawner', 'timer', 'timerone', 'timertwo', 'jpetimer',
  'trigger', 'zone status', 'doorman', '_',
]);

function normalizeTriggerName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * PEQ script placeholders — must never enter liveMobs or aggro players.
 * Race 240 covers ~3.5k spawn rows across all zones; name rules catch non-240 edge cases.
 */
function shouldSkipCombatSpawn(npcRow) {
  if (!npcRow) return true;

  const race = Number(npcRow.race) || 0;
  if (race === TRIGGER_PLACEHOLDER_RACE) return true;

  const raw = normalizeTriggerName(npcRow.name);
  if (!raw) return false;

  if (TRIGGER_NPC_NAMES.has(raw)) return true;
  if (raw.startsWith('#')) return true;
  if (raw.startsWith('flavor text')) return true;
  if (/^timer\d*$/.test(raw.replace(/\s/g, ''))) return true;
  if (raw.includes('spawn condition') || raw.includes('daytrigger') || raw.includes('nighttrigger')) {
    return true;
  }

  return false;
}

/** Alias for combat/AI guards. */
const isTriggerPlaceholder = shouldSkipCombatSpawn;

/** Remove trigger placeholders from a loaded zone (any zone, on load or periodic sweep). */
function purgeTriggerMobs(zone) {
  if (!zone) return 0;
  let removed = 0;
  if (Array.isArray(zone.liveMobs)) {
    const before = zone.liveMobs.length;
    zone.liveMobs = zone.liveMobs.filter(
      (m) => !shouldSkipCombatSpawn({ race: m.race, name: m.name })
    );
    removed = before - zone.liveMobs.length;
  }
  if (Array.isArray(zone.spawnPointState)) {
    for (const sp of zone.spawnPointState) {
      if (Array.isArray(sp.pool)) {
        sp.pool = sp.pool.filter((p) => !shouldSkipCombatSpawn({ race: p.race, name: p.name }));
      }
      if (sp.currentMobId && !zone.liveMobs.some((m) => m.id === sp.currentMobId)) {
        sp.currentMobId = null;
      }
      if (sp.mobDef && shouldSkipCombatSpawn({ race: sp.mobDef.race, name: sp.mobDef.name })) {
        sp.mobDef = null;
        sp.currentMobId = null;
      }
    }
  }
  return removed;
}

/** Sweep every in-memory zone instance (e.g. after server start or hotfix). */
function purgeTriggerMobsAllZones(zoneInstances) {
  if (!zoneInstances) return 0;
  let total = 0;
  for (const key of Object.keys(zoneInstances)) {
    const n = purgeTriggerMobs(zoneInstances[key]);
    if (n > 0) {
      console.log(`[ZONE] ${key}: purged ${n} trigger placeholder mob(s).`);
    }
    total += n;
  }
  return total;
}

function mapEqemuClassToNpcType(eqClass) {
  if (eqClass === 41 || eqClass === 61) return NPC_TYPES.MERCHANT;
  if (eqClass === 40) return NPC_TYPES.BANK;
  if ((eqClass >= 20 && eqClass <= 35) || eqClass === 63) return NPC_TYPES.TRAINER;
  return NPC_TYPES.MOB;
}

const GUILD_MASTER_CLASS = {
  1: 'warrior', 2: 'cleric', 3: 'paladin', 4: 'ranger',
  5: 'shadow_knight', 6: 'druid', 7: 'monk', 8: 'bard',
  9: 'rogue', 10: 'shaman', 11: 'necromancer', 12: 'wizard',
  13: 'magician', 14: 'enchanter', 15: 'beastlord', 16: 'berserker',
  20: 'warrior', 21: 'cleric', 22: 'paladin', 23: 'ranger',
  24: 'shadow_knight', 25: 'druid', 26: 'monk', 27: 'bard',
  28: 'rogue', 29: 'shaman', 30: 'necromancer', 31: 'wizard',
  32: 'magician', 33: 'enchanter', 34: 'beastlord', 35: 'berserker'
};

const constants = require('../data/constants');
const CLASSES_MAP = constants.CLASSES;

function getTaughtClassId(npcClass) {
  const className = GUILD_MASTER_CLASS[npcClass];
  if (!className) return null;
  return CLASSES_MAP[className] || null;
}

module.exports = {
  shouldSkipCombatSpawn,
  isTriggerPlaceholder,
  purgeTriggerMobs,
  purgeTriggerMobsAllZones,
  TRIGGER_PLACEHOLDER_RACE,
  mapEqemuClassToNpcType,
  GUILD_MASTER_CLASS,
  CLASSES_MAP,
  getTaughtClassId
};
