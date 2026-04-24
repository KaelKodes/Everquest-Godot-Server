/**
 * spell_enums.js - Lookup tables for EQ spell data
 * 
 * Extracted from EQEmu source (spdat.h, skills.h)
 * These map the integer codes in spells_us.txt to human-readable names.
 */

// Resist Types (from enum RESISTTYPE in spdat.h)
const RESIST_TYPES = {
    0: 'none',
    1: 'magic',
    2: 'fire',
    3: 'cold',
    4: 'poison',
    5: 'disease',
    6: 'chromatic',
    7: 'prismatic',
    8: 'physical',
    9: 'corruption'
};

// Target Types (from SpellTargetType in spdat.h)
const TARGET_TYPES = {
    1:  'targetOptional',
    2:  'aeClientV1',
    3:  'groupTeleport',
    4:  'aeCaster',         // PBAE
    5:  'target',           // Single target
    6:  'self',
    8:  'aeTarget',         // Targeted AE
    9:  'animal',
    10: 'undead',
    11: 'summoned',
    13: 'lifetap',
    14: 'pet',
    15: 'corpse',
    16: 'plant',
    17: 'giant',
    18: 'dragon',
    20: 'targetAETap',
    24: 'aeUndeadV1',
    25: 'aeSummonedV1',
    32: 'hateList',
    33: 'selfBuff',         // Targeted buff that falls back to self
    34: 'castAugmentation',
    35: 'directionTarget',
    36: 'freeTarget',       // Ground-targeted AE
    40: 'aePlayerV2',
    41: 'groupPet',
    42: 'directionalAE',
    43: 'groupSingleTarget',
    44: 'ringSelect',       // Ground-targeted ring AE
    45: 'targetOfTarget',
    46: 'petOwner',
    47: 'targetAENoPlayersOrPets',
    50: 'beamFrontal',
    52: 'selfSingleTarget'
};

// Casting Skill Types (from enum SkillType in skills.h)
// These are the values found in the "skill" column of spells_us.txt
const CASTING_SKILLS = {
    0:  '1HBlunt',
    1:  '1HSlashing',
    2:  '2HBlunt',
    3:  '2HSlashing',
    4:  'abjuration',
    5:  'alteration',
    6:  'applyPoison',
    7:  'archery',
    8:  'backstab',
    9:  'bindWound',
    10: 'bash',
    11: 'block',
    12: 'brassInstruments',
    13: 'channeling',
    14: 'conjuration',
    15: 'defense',
    16: 'disarm',
    17: 'disarmTraps',
    18: 'divination',
    19: 'dodge',
    20: 'doubleAttack',
    21: 'dragonPunch',
    22: 'dualWield',
    23: 'eagleStrike',
    24: 'evocation',
    25: 'feignDeath',
    26: 'flyingKick',
    27: 'forage',
    28: 'handToHand',
    29: 'hide',
    30: 'kick',
    31: 'meditate',
    32: 'mend',
    33: 'offense',
    34: 'parry',
    35: 'pickLock',
    36: '1HPiercing',
    37: 'riposte',
    38: 'roundKick',
    39: 'safeFall',
    40: 'senseHeading',
    41: 'singing',
    42: 'sneak',
    43: 'specializeAbjuration',
    44: 'specializeAlteration',
    45: 'specializeConjuration',
    46: 'specializeDivination',
    47: 'specializeEvocation',
    48: 'pickPockets',
    49: 'stringedInstruments',
    50: 'swimming',
    51: 'throwing',
    52: 'tigerClaw',
    53: 'tracking',
    54: 'windInstruments',
    55: 'fishing',
    56: 'makePoison',
    57: 'tinkering',
    58: 'research',
    59: 'alchemy',
    60: 'baking',
    61: 'tailoring',
    62: 'senseTraps',
    63: 'blacksmithing',
    64: 'fletching',
    65: 'brewing',
    66: 'alcoholTolerance',
    67: 'begging',
    68: 'jewelryMaking',
    69: 'pottery',
    70: 'percussionInstruments',
    71: 'intimidation',
    72: 'berserking',
    73: 'taunt',
    74: 'frenzy',
    75: 'removeTraps',
    76: 'tripleAttack',
    77: '2HPiercing',
    98: 'alchemy2',         // Varies by implementation
    // Spell-specific skills (used in spells_us.txt skill column)
    // These overlap with the above in EQ's implementation
};

// Spell Effect IDs (SPA - Spell Promotion Ability)
// These identify what each of the 12 effect slots in a spell actually does.
// Values found in columns 86-97 of spells_us.txt
const SPA_EFFECTS = {
    0:   'currentHP',               // + heals, - damages
    1:   'armorClass',
    2:   'attackPower',
    3:   'movementSpeed',
    4:   'STR',
    5:   'DEX',
    6:   'AGI',
    7:   'STA',
    8:   'INT',
    9:   'WIS',
    10:  'CHA',                     // Also used as "attackSpeed" in some contexts
    11:  'attackSpeed',             // Haste/Slow
    12:  'invisibility',
    13:  'seeInvisible',
    14:  'waterBreathing',
    15:  'currentMana',
    18:  'pacify',                  // Lull
    19:  'stun',
    20:  'charm',
    21:  'fear',
    22:  'stamina',                 // Fatigue
    23:  'bindAffinity',
    24:  'gate',                    // Send to bind point
    25:  'cancelMagic',             // Dispel
    26:  'invisibilityVsUndead',
    27:  'invisibilityVsAnimals',
    28:  'harmony',                 // Faction adjust (lower)
    29:  'addFaction',
    30:  'blindness',
    31:  'mesmerize',
    32:  'summonItem',
    33:  'summonPet',
    34:  'confuse',                 // NPC only
    35:  'disease',
    36:  'poison',
    46:  'fireResist',
    47:  'coldResist',
    48:  'poisonResist',
    49:  'diseaseResist',
    50:  'magicResist',
    54:  'senseUndead',
    55:  'senseSummoned',
    56:  'senseAnimals',
    57:  'rune',                    // Absorb damage
    58:  'trueNorth',
    59:  'levitate',
    60:  'illusion',
    61:  'damageShield',
    63:  'sentinelCall',            // Spirit call at low HP
    64:  'identify',
    67:  'spinStun',                // Whirl Till You Hurl
    68:  'infravision',
    69:  'ultravision',
    71:  'summonSkeleton',
    73:  'bindSight',
    74:  'feignDeath',
    75:  'voiceGraft',
    76:  'sentinel',
    77:  'locateCorpse',
    78:  'absorbMagicDamage',       // Spell rune
    79:  'maxCurrentHP',            // Max HP increase
    85:  'resistAll',               // All resists buff
    86:  'castingLevel',
    87:  'summonHorse',
    88:  'changeAggro',             // Hate adjust, aggro multiplier
    89:  'hungerThirst',            // Enduring Breath, etc.
    90:  'curseCounter',
    91:  'magicWeapon',             // Enchant weapon
    92:  'amplification',           // Singing modifier
    93:  'attackSpeedMax',          // Attack speed cap
    94:  'healRate',                // Heal effectiveness
    95:  'reverseDS',               // Reverse damage shield
    96:  'reduceSkill',             // Screech, etc.
    97:  'immunity',                // Stun immunity, etc.
    98:  'spellDamageShield',
    99:  'root',
    100: 'etherealBody',            // Gate-like (recall)
    101: 'berserkSPA',              // Berserk state
    102: 'divineAura',              // Invulnerability
    103: 'destroyTarget',           // Banish
    104: 'shadowStep',              // Short-range teleport
    105: 'bane',                    // Bane damage
    106: 'teleport',                // Zone teleport
    108: 'summonCorpse',
    109: 'modifyResistChance',      // Tash, malo, etc.
    111: 'resurrect',
    112: 'summonPC',
    113: 'teleportGroup',
    114: 'bonusHP',                 // Temporary HP
    116: 'procOnAttack',            // Add melee proc
    117: 'projectIllusion',         // NPC illusion
    118: 'massGroupBuff',
    119: 'groupFearImmunity',
    120: 'tempPet',                 // Temporary pet (swarm)
    121: 'balanceHP',               // Balance party health
    123: 'currentEndurance',
    124: 'balanceMana',
    125: 'criticalDDChance',        // Crit nuke chance
    127: 'criticalHealChance',
    128: 'criticalDoTChance',
    130: 'criticalMend',
    131: 'dualWieldChance',
    132: 'stunResist',
    134: 'criticalDDValue',         // Crit nuke damage
    135: 'dodgeChance',
    138: 'currentHPOnce',           // Instant HP (not recurring)
    139: 'lifetap', 
    140: 'spell_damage',            // Focus: spell damage
    141: 'damageModifier',          // Focus: damage modifier
    142: 'healAmount',              // Focus: heal amount
    143: 'healModifier',            // Focus: heal modifier
    147: 'percentCurrentHP',        // % based HP change
    148: 'spellDamageTaken',        // Incoming spell damage modifier
    149: 'maxEndurance',
    152: 'hatePct',                 // % hate modify
    153: 'skillDamageTaken',        // Incoming melee damage by skill
    154: 'fadeNPCTarget',           // Drop NPC aggro
    155: 'stunAndStifle',           // Stun and prevent casting
    157: 'spellDamageBonus',
    158: 'notUsedSPA158',
    159: 'doubleAttackChance',
    160: 'stunBashChance',
    161: 'consumeProjectile',       // Endless quiver
    162: 'fearImmunity',
    163: 'voiceGraft2',
    164: 'petDiscipline',
    167: 'percussionSkill',
    168: 'headShotDamage',
    169: 'petCrit',
    172: 'rootBreakChance',
    173: 'trapCircumvention',
    174: 'lungCapacity',
    175: 'increaseSkillCap',
    176: 'spellProcChance',
    177: 'channelingChance',
    178: 'doubleRiposte',
    179: 'additionalAura',
    180: 'spellCritDmgIncrease',    // Focus: crit spell damage
    181: 'additionalSpellSlots',
    182: 'subtlety',                // Reduce hate from casts
    183: 'spellProcOnAtk',          // Proc spell on attack
    185: 'charmBreakChance',
    186: 'rootBreakChanceReduction',
    188: 'damageModAll',            // Damage taken modifier (all)
    189: 'avoidanceMod',
    190: 'accuracyMod',
    191: 'stunResistChance',
    192: 'strikethroughChance',
    193: 'skillDmgTaken',
    194: 'enduranceRegen',
    195: 'tauntOverride',
    196: 'spellCritChance',         // Focus: crit chance
    197: 'crippleChance',
    198: 'avoidMeleeChance',
    199: 'riposteChance',
    200: 'dodgeChanceMod',
    201: 'parryChanceMod',
    202: 'knockbackChance',
    203: 'weightChange',
    204: 'hastev3',                 // Overhaste
    205: 'skillDmgBonus',
    206: 'hitChance',
    207: 'damageDoneModifier',
    208: 'minDamageBase',
    209: 'manaAbsorbPct',
    210: 'enduranceAbsorbPct',
    212: 'spellHateMod',            // Focus: spell hate modifier
    214: 'skillBaseDamageMod',      // Focus: skill base damage
    216: 'focusCritChance',
    218: 'petMaxHP',
    220: 'focusManaCost',           // Focus: mana cost reduction
    227: 'spellDamageAbsorb',       // Spell absorb shield
    254: 'blank',                   // Unused/empty effect slot
    // Higher SPA values exist for later expansions but these cover classic through RoF2
};

// Class order as they appear in cols 104-119 of spells_us.txt
// Index 0 = col 104, index 15 = col 119
const CLASS_NAMES = [
    'warrior',      // 104
    'cleric',       // 105
    'paladin',      // 106
    'ranger',       // 107
    'shadowknight', // 108
    'druid',        // 109
    'monk',         // 110
    'bard',         // 111
    'rogue',        // 112
    'shaman',       // 113
    'necromancer',  // 114
    'wizard',       // 115
    'magician',     // 116
    'enchanter',    // 117
    'beastlord',    // 118
    'berserker'     // 119
];

// Class IDs used elsewhere in EQ (1-indexed, matching character creation)
const CLASS_IDS = {
    1:  'warrior',
    2:  'cleric',
    3:  'paladin',
    4:  'ranger',
    5:  'shadowknight',
    6:  'druid',
    7:  'monk',
    8:  'bard',
    9:  'rogue',
    10: 'shaman',
    11: 'necromancer',
    12: 'wizard',
    13: 'magician',
    14: 'enchanter',
    15: 'beastlord',
    16: 'berserker'
};

// Buff duration formulas
// The actual duration in ticks is calculated from the formula + duration value
const DURATION_FORMULAS = {
    0:  'none',                     // No duration (instant)
    1:  'levelDiv2_capped',         // ceil(level/2), capped at value
    2:  'levelDiv5p3_capped',       // ceil(level*3/5+3?), capped at value  
    3:  'levelMul30_capped',        // level*30, capped at value
    4:  'fixed',                    // Fixed duration = value ticks
    5:  'levelDiv3_capped',         // level/3, capped at value
    6:  'levelDiv2_capped_v2',      // Similar to formula 1
    7:  'fixed2',                   // Always = value
    8:  'levelPlus10',              // level + 10
    9:  'levelMul2Plus10',          // level*2 + 10
    10: 'levelMul3Plus10',          // level*3 + 10
    11: 'fixed_or_permanent',       // Exact value or permanent
    12: 'permanent',                // Permanent until cancelled
    15: 'fixed3',                   // Fixed = value
    50: 'permanentV2',              // Permanent
    3600: 'permanentV3'             // Permanent
};

// Spell affect index (graphical category, col 144 or similar)
const SPELL_AFFECT_INDEX = {
    '-1': 'summonMount',
    0:  'directDamage',
    1:  'healCure',
    2:  'acBuff',
    3:  'aeDamage',
    4:  'summon',
    5:  'sight',
    6:  'manaRegenResistSong',
    7:  'statBuff',
    9:  'vanish',
    10: 'appearance',
    11: 'enchanterPet',
    12: 'calm',
    13: 'fear',
    14: 'dispelSight',
    15: 'stun',
    16: 'hasteRunspeed',
    17: 'combatSlow',
    18: 'damageShield',
    19: 'cannibalizeWeaponProc',
    20: 'weaken',
    21: 'banish',
    22: 'blindPoison',
    23: 'coldDD',
    24: 'poisonDiseaseDD',
    25: 'fireDD',
    27: 'memoryBlur',
    28: 'gravityFling',
    29: 'suffocate',
    30: 'lifetapOverTime',
    31: 'fireAE',
    33: 'coldAE',
    34: 'poisonDiseaseAE',
    40: 'teleport',
    41: 'directDamageSong',
    42: 'combatBuffSong',
    43: 'calmSong',
    45: 'firework',
    46: 'fireworkAE',
    47: 'weatherRocket',
    50: 'convertVitals'
};

module.exports = {
    RESIST_TYPES,
    TARGET_TYPES,
    CASTING_SKILLS,
    SPA_EFFECTS,
    CLASS_NAMES,
    CLASS_IDS,
    DURATION_FORMULAS,
    SPELL_AFFECT_INDEX
};
