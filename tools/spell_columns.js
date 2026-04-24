/**
 * spell_columns.js - Complete 237-column definition for RoF2 spells_us.txt
 * 
 * This is the SINGLE SOURCE OF TRUTH for the column layout.
 * Each entry maps a column index to a named field with its data type.
 * 
 * Verified against known spells:
 *   - Minor Healing (ID 200): mana=10, castTime=1500, classes.cleric=1
 *   - Shock of Lightning (ID 383): resistType=1(magic), skill=24(evocation)
 *   - Spirit of Wolf (ID 278): buffDuration=360, classes.druid=10
 *   - Mesmerize (ID 292): effectid1=31(mez), skill=14(conjuration)
 *   - Root (ID 230): effectid2=99(root)
 *   - Quickness (ID ?): effectid1=11(haste)
 *   - Fire Bolt (ID 477): resistType=2(fire)
 * 
 * Types: 'int', 'float', 'string'
 * Group: logical grouping for the output JSON
 */

const SPELL_COLUMNS = [
    // === Core Identity (0-2) ===
    { index: 0,   name: 'id',                group: 'core',       type: 'int' },
    { index: 1,   name: 'name',              group: 'core',       type: 'string' },
    { index: 2,   name: 'player1',           group: 'core',       type: 'string' },    // Always "PLAYER_1"

    // === Teleport / Pet / Summon Zone (3) ===
    { index: 3,   name: 'teleportZone',      group: 'misc',       type: 'string' },    // Teleport destination, pet name, or summoned item

    // === Cast Messages (4-8) ===
    { index: 4,   name: 'youCast',           group: 'messages',   type: 'string' },
    { index: 5,   name: 'otherCasts',        group: 'messages',   type: 'string' },
    { index: 6,   name: 'castOnYou',         group: 'messages',   type: 'string' },
    { index: 7,   name: 'castOnOther',       group: 'messages',   type: 'string' },
    { index: 8,   name: 'spellFades',        group: 'messages',   type: 'string' },

    // === Range & Physics (9-12) ===
    { index: 9,   name: 'range',             group: 'range',      type: 'float' },
    { index: 10,  name: 'aoeRange',          group: 'range',      type: 'float' },
    { index: 11,  name: 'pushback',          group: 'range',      type: 'float' },
    { index: 12,  name: 'pushup',            group: 'range',      type: 'float' },

    // === Timing (13-15) ===
    { index: 13,  name: 'castTime',          group: 'timing',     type: 'int' },       // milliseconds
    { index: 14,  name: 'recoveryTime',      group: 'timing',     type: 'int' },       // milliseconds
    { index: 15,  name: 'recastTime',        group: 'timing',     type: 'int' },       // milliseconds

    // === Duration (16-18) ===
    { index: 16,  name: 'buffDurationFormula', group: 'duration',  type: 'int' },
    { index: 17,  name: 'buffDuration',      group: 'duration',   type: 'int' },       // ticks (6 seconds each)
    { index: 18,  name: 'aeDuration',        group: 'duration',   type: 'int' },

    // === Cost (19) ===
    { index: 19,  name: 'mana',              group: 'cost',       type: 'int' },

    // === Effect Base Values 1-12 (20-31) ===
    // The base value for each of the 12 effect slots
    { index: 20,  name: 'baseValue1',        group: 'effects',    type: 'int' },
    { index: 21,  name: 'baseValue2',        group: 'effects',    type: 'int' },
    { index: 22,  name: 'baseValue3',        group: 'effects',    type: 'int' },
    { index: 23,  name: 'baseValue4',        group: 'effects',    type: 'int' },
    { index: 24,  name: 'baseValue5',        group: 'effects',    type: 'int' },
    { index: 25,  name: 'baseValue6',        group: 'effects',    type: 'int' },
    { index: 26,  name: 'baseValue7',        group: 'effects',    type: 'int' },
    { index: 27,  name: 'baseValue8',        group: 'effects',    type: 'int' },
    { index: 28,  name: 'baseValue9',        group: 'effects',    type: 'int' },
    { index: 29,  name: 'baseValue10',       group: 'effects',    type: 'int' },
    { index: 30,  name: 'baseValue11',       group: 'effects',    type: 'int' },
    { index: 31,  name: 'baseValue12',       group: 'effects',    type: 'int' },

    // === Effect Limit Values 1-12 (32-43) ===
    // Limit/calc values for each effect slot
    { index: 32,  name: 'limitValue1',       group: 'effects',    type: 'int' },
    { index: 33,  name: 'limitValue2',       group: 'effects',    type: 'int' },
    { index: 34,  name: 'limitValue3',       group: 'effects',    type: 'int' },
    { index: 35,  name: 'limitValue4',       group: 'effects',    type: 'int' },
    { index: 36,  name: 'limitValue5',       group: 'effects',    type: 'int' },
    { index: 37,  name: 'limitValue6',       group: 'effects',    type: 'int' },
    { index: 38,  name: 'limitValue7',       group: 'effects',    type: 'int' },
    { index: 39,  name: 'limitValue8',       group: 'effects',    type: 'int' },
    { index: 40,  name: 'limitValue9',       group: 'effects',    type: 'int' },
    { index: 41,  name: 'limitValue10',      group: 'effects',    type: 'int' },
    { index: 42,  name: 'limitValue11',      group: 'effects',    type: 'int' },
    { index: 43,  name: 'limitValue12',      group: 'effects',    type: 'int' },

    // === Effect Max Values 1-12 (44-55) ===
    { index: 44,  name: 'maxValue1',         group: 'effects',    type: 'int' },
    { index: 45,  name: 'maxValue2',         group: 'effects',    type: 'int' },
    { index: 46,  name: 'maxValue3',         group: 'effects',    type: 'int' },
    { index: 47,  name: 'maxValue4',         group: 'effects',    type: 'int' },
    { index: 48,  name: 'maxValue5',         group: 'effects',    type: 'int' },
    { index: 49,  name: 'maxValue6',         group: 'effects',    type: 'int' },
    { index: 50,  name: 'maxValue7',         group: 'effects',    type: 'int' },
    { index: 51,  name: 'maxValue8',         group: 'effects',    type: 'int' },
    { index: 52,  name: 'maxValue9',         group: 'effects',    type: 'int' },
    { index: 53,  name: 'maxValue10',        group: 'effects',    type: 'int' },
    { index: 54,  name: 'maxValue11',        group: 'effects',    type: 'int' },
    { index: 55,  name: 'maxValue12',        group: 'effects',    type: 'int' },

    // === Icons & Components (56-69) ===
    { index: 56,  name: 'icon',              group: 'visual',     type: 'int' },
    { index: 57,  name: 'memIcon',           group: 'visual',     type: 'int' },       // Spell gem icon
    { index: 58,  name: 'component1',        group: 'components', type: 'int' },       // Reagent item ID (-1 = none)
    { index: 59,  name: 'component2',        group: 'components', type: 'int' },
    { index: 60,  name: 'component3',        group: 'components', type: 'int' },
    { index: 61,  name: 'component4',        group: 'components', type: 'int' },
    { index: 62,  name: 'componentCount1',   group: 'components', type: 'int' },
    { index: 63,  name: 'componentCount2',   group: 'components', type: 'int' },
    { index: 64,  name: 'componentCount3',   group: 'components', type: 'int' },
    { index: 65,  name: 'componentCount4',   group: 'components', type: 'int' },
    { index: 66,  name: 'noexpendReagent1',  group: 'components', type: 'int' },       // Focus item (-1 = none)
    { index: 67,  name: 'noexpendReagent2',  group: 'components', type: 'int' },
    { index: 68,  name: 'noexpendReagent3',  group: 'components', type: 'int' },
    { index: 69,  name: 'noexpendReagent4',  group: 'components', type: 'int' },

    // === Effect Formulas 1-12 (70-81) ===
    // Determines how base/max values scale with level
    { index: 70,  name: 'formula1',          group: 'effects',    type: 'int' },
    { index: 71,  name: 'formula2',          group: 'effects',    type: 'int' },
    { index: 72,  name: 'formula3',          group: 'effects',    type: 'int' },
    { index: 73,  name: 'formula4',          group: 'effects',    type: 'int' },
    { index: 74,  name: 'formula5',          group: 'effects',    type: 'int' },
    { index: 75,  name: 'formula6',          group: 'effects',    type: 'int' },
    { index: 76,  name: 'formula7',          group: 'effects',    type: 'int' },
    { index: 77,  name: 'formula8',          group: 'effects',    type: 'int' },
    { index: 78,  name: 'formula9',          group: 'effects',    type: 'int' },
    { index: 79,  name: 'formula10',         group: 'effects',    type: 'int' },
    { index: 80,  name: 'formula11',         group: 'effects',    type: 'int' },
    { index: 81,  name: 'formula12',         group: 'effects',    type: 'int' },

    // === Spell Properties (82-85) ===
    { index: 82,  name: 'lightType',         group: 'properties', type: 'int' },
    { index: 83,  name: 'goodEffect',        group: 'properties', type: 'int' },       // 0=detrimental, 1=beneficial
    { index: 84,  name: 'activated',         group: 'properties', type: 'int' },
    { index: 85,  name: 'resistType',        group: 'properties', type: 'int' },       // See RESIST_TYPES enum

    // === Effect IDs (SPA) 1-12 (86-97) ===
    // These identify WHAT each effect slot does (HP change, mez, root, etc.)
    { index: 86,  name: 'effectId1',         group: 'effects',    type: 'int' },
    { index: 87,  name: 'effectId2',         group: 'effects',    type: 'int' },
    { index: 88,  name: 'effectId3',         group: 'effects',    type: 'int' },
    { index: 89,  name: 'effectId4',         group: 'effects',    type: 'int' },
    { index: 90,  name: 'effectId5',         group: 'effects',    type: 'int' },
    { index: 91,  name: 'effectId6',         group: 'effects',    type: 'int' },
    { index: 92,  name: 'effectId7',         group: 'effects',    type: 'int' },
    { index: 93,  name: 'effectId8',         group: 'effects',    type: 'int' },
    { index: 94,  name: 'effectId9',         group: 'effects',    type: 'int' },
    { index: 95,  name: 'effectId10',        group: 'effects',    type: 'int' },
    { index: 96,  name: 'effectId11',        group: 'effects',    type: 'int' },
    { index: 97,  name: 'effectId12',        group: 'effects',    type: 'int' },

    // === Targeting & Skill (98-103) ===
    { index: 98,  name: 'targetType',        group: 'targeting',  type: 'int' },       // See TARGET_TYPES enum
    { index: 99,  name: 'baseDifficulty',    group: 'targeting',  type: 'int' },
    { index: 100, name: 'skill',             group: 'targeting',  type: 'int' },       // Casting skill (see CASTING_SKILLS)
    { index: 101, name: 'zoneType',          group: 'targeting',  type: 'int' },       // -1=any, 0=outdoor, 1=indoor
    { index: 102, name: 'environmentType',   group: 'targeting',  type: 'int' },
    { index: 103, name: 'timeOfDay',         group: 'targeting',  type: 'int' },

    // === Class Levels (104-119) ===
    // 255 = class cannot use this spell. Any other value = minimum level to learn.
    { index: 104, name: 'classLevelWarrior',      group: 'classes', type: 'int' },
    { index: 105, name: 'classLevelCleric',        group: 'classes', type: 'int' },
    { index: 106, name: 'classLevelPaladin',       group: 'classes', type: 'int' },
    { index: 107, name: 'classLevelRanger',        group: 'classes', type: 'int' },
    { index: 108, name: 'classLevelShadowknight',  group: 'classes', type: 'int' },
    { index: 109, name: 'classLevelDruid',         group: 'classes', type: 'int' },
    { index: 110, name: 'classLevelMonk',          group: 'classes', type: 'int' },
    { index: 111, name: 'classLevelBard',          group: 'classes', type: 'int' },
    { index: 112, name: 'classLevelRogue',         group: 'classes', type: 'int' },
    { index: 113, name: 'classLevelShaman',        group: 'classes', type: 'int' },
    { index: 114, name: 'classLevelNecromancer',   group: 'classes', type: 'int' },
    { index: 115, name: 'classLevelWizard',        group: 'classes', type: 'int' },
    { index: 116, name: 'classLevelMagician',      group: 'classes', type: 'int' },
    { index: 117, name: 'classLevelEnchanter',     group: 'classes', type: 'int' },
    { index: 118, name: 'classLevelBeastlord',     group: 'classes', type: 'int' },
    { index: 119, name: 'classLevelBerserker',     group: 'classes', type: 'int' },

    // === Casting Animation & Misc (120-135) ===
    { index: 120, name: 'castingAnimation',  group: 'visual',     type: 'int' },
    { index: 121, name: 'targetAnimation',   group: 'visual',     type: 'int' },
    { index: 122, name: 'travelType',        group: 'visual',     type: 'int' },
    { index: 123, name: 'spellAffectIndex',  group: 'visual',     type: 'int' },       // Graphical category
    { index: 124, name: 'disallowSit',       group: 'properties', type: 'int' },
    { index: 125, name: 'deities0',          group: 'deities',    type: 'int' },
    { index: 126, name: 'deities1',          group: 'deities',    type: 'int' },
    { index: 127, name: 'deities2',          group: 'deities',    type: 'int' },
    { index: 128, name: 'deities3',          group: 'deities',    type: 'int' },
    { index: 129, name: 'deities4',          group: 'deities',    type: 'int' },
    { index: 130, name: 'deities5',          group: 'deities',    type: 'int' },
    { index: 131, name: 'deities6',          group: 'deities',    type: 'int' },
    { index: 132, name: 'deities7',          group: 'deities',    type: 'int' },
    { index: 133, name: 'deities8',          group: 'deities',    type: 'int' },
    { index: 134, name: 'deities9',          group: 'deities',    type: 'int' },
    { index: 135, name: 'deities10',         group: 'deities',    type: 'int' },

    // === More Misc (136-145) ===
    { index: 136, name: 'deities11',         group: 'deities',    type: 'int' },
    { index: 137, name: 'deities12',         group: 'deities',    type: 'int' },
    { index: 138, name: 'deities13',         group: 'deities',    type: 'int' },
    { index: 139, name: 'deities14',         group: 'deities',    type: 'int' },
    { index: 140, name: 'deities15',         group: 'deities',    type: 'int' },
    { index: 141, name: 'npcNoLos',          group: 'properties', type: 'int' },       // NPC no line of sight needed
    { index: 142, name: 'fieldAffectIdx',    group: 'properties', type: 'int' },       // New field affect index (post-SoF)
    { index: 143, name: 'reflectable',       group: 'properties', type: 'int' },
    { index: 144, name: 'bonusHate',         group: 'properties', type: 'int' },       // Additional hate generated
    { index: 145, name: 'resistPerLevel',    group: 'properties', type: 'int' },

    // === Resist & Timer (146-155) ===
    { index: 146, name: 'resistCap',         group: 'properties', type: 'int' },
    { index: 147, name: 'affectInanimate',   group: 'properties', type: 'int' },       // Can affect items
    { index: 148, name: 'stamina',           group: 'cost',       type: 'int' },       // Endurance cost
    { index: 149, name: 'timerValue',        group: 'timing',     type: 'int' },       // Timer ID
    { index: 150, name: 'isSkill',           group: 'properties', type: 'int' },
    { index: 151, name: 'hateMod',           group: 'properties', type: 'int' },       // Hate modifier
    { index: 152, name: 'resistMod',         group: 'properties', type: 'int' },
    { index: 153, name: 'focusArg0',         group: 'focus',      type: 'int' },
    { index: 154, name: 'focusArg1',         group: 'focus',      type: 'int' },
    { index: 155, name: 'spellRecourseId',   group: 'links',      type: 'int' },       // ID of recourse/response spell

    // === Timing & Links (156-163) ===
    { index: 156, name: 'spellRecourseCalc', group: 'links',      type: 'int' },
    { index: 157, name: 'spellRecourseMax',  group: 'links',      type: 'int' },
    { index: 158, name: 'unkn158',           group: 'unknown',    type: 'string' },
    { index: 159, name: 'unkn159',           group: 'unknown',    type: 'int' },
    { index: 160, name: 'unkn160',           group: 'unknown',    type: 'int' },
    { index: 161, name: 'unkn161',           group: 'unknown',    type: 'int' },
    { index: 162, name: 'unkn162',           group: 'unknown',    type: 'int' },
    { index: 163, name: 'maxDistance',       group: 'range',      type: 'int' },       // Max distance for spell
    { index: 164, name: 'minDistance',       group: 'range',      type: 'int' },       // Min distance for spell
    { index: 165, name: 'minDistanceMod',    group: 'range',      type: 'int' },
    { index: 166, name: 'maxDistanceMod',    group: 'range',      type: 'int' },
    { index: 167, name: 'minRange',          group: 'range',      type: 'int' },
    { index: 168, name: 'fieldNpcNoLos2',    group: 'properties', type: 'int' },
    { index: 169, name: 'unkn169',           group: 'unknown',    type: 'int' },
    { index: 170, name: 'unkn170',           group: 'unknown',    type: 'int' },
    { index: 171, name: 'unkn171',           group: 'unknown',    type: 'int' },
    { index: 172, name: 'unkn172',           group: 'unknown',    type: 'int' },
    { index: 173, name: 'unkn173',           group: 'unknown',    type: 'int' },
    { index: 174, name: 'unkn174',           group: 'unknown',    type: 'int' },
    { index: 175, name: 'unkn175',           group: 'unknown',    type: 'int' },
    { index: 176, name: 'unkn176',           group: 'unknown',    type: 'int' },

    // === Scaling & Level-based values (177-188) ===
    { index: 177, name: 'spellCategory',     group: 'properties', type: 'int' },       // Spell book category
    { index: 178, name: 'unkn178',           group: 'unknown',    type: 'int' },
    { index: 179, name: 'baseValueMin1',     group: 'scaling',    type: 'int' },       // Min base value (for scaling)
    { index: 180, name: 'baseValueMax1',     group: 'scaling',    type: 'int' },       // Max base value (for scaling)
    { index: 181, name: 'baseValueMin2',     group: 'scaling',    type: 'int' },
    { index: 182, name: 'baseValueMax2',     group: 'scaling',    type: 'int' },
    { index: 183, name: 'baseValueMin3',     group: 'scaling',    type: 'int' },
    { index: 184, name: 'baseValueMax3',     group: 'scaling',    type: 'int' },
    { index: 185, name: 'baseValueMin4',     group: 'scaling',    type: 'int' },
    { index: 186, name: 'baseValueMax4',     group: 'scaling',    type: 'int' },
    { index: 187, name: 'spellGroupId',      group: 'stacking',   type: 'int' },       // Stacking group
    { index: 188, name: 'spellGroupRank',    group: 'stacking',   type: 'int' },       // Rank within stacking group

    // === Stacking & Restrictions (189-200) ===
    { index: 189, name: 'unkn189',           group: 'unknown',    type: 'int' },
    { index: 190, name: 'unkn190',           group: 'unknown',    type: 'int' },
    { index: 191, name: 'unkn191',           group: 'unknown',    type: 'int' },
    { index: 192, name: 'unkn192',           group: 'unknown',    type: 'int' },
    { index: 193, name: 'unkn193',           group: 'unknown',    type: 'int' },
    { index: 194, name: 'unkn194',           group: 'unknown',    type: 'int' },
    { index: 195, name: 'unkn195',           group: 'unknown',    type: 'int' },
    { index: 196, name: 'unkn196',           group: 'unknown',    type: 'int' },
    { index: 197, name: 'unkn197',           group: 'unknown',    type: 'int' },
    { index: 198, name: 'unkn198',           group: 'unknown',    type: 'int' },
    { index: 199, name: 'unkn199',           group: 'unknown',    type: 'int' },
    { index: 200, name: 'descriptionId',     group: 'properties', type: 'int' },       // Links to dbstr_us.txt

    // === Restrictions & Flags (201-220) ===
    { index: 201, name: 'typDescriptionId',  group: 'properties', type: 'int' },
    { index: 202, name: 'effectDescriptionId', group: 'properties', type: 'int' },
    { index: 203, name: 'unkn203',           group: 'unknown',    type: 'int' },
    { index: 204, name: 'unkn204',           group: 'unknown',    type: 'int' },
    { index: 205, name: 'bonusHateRatio',    group: 'properties', type: 'int' },
    { index: 206, name: 'recastTimerIndex',  group: 'timing',     type: 'int' },       // Shared timer group
    { index: 207, name: 'unkn207',           group: 'unknown',    type: 'int' },
    { index: 208, name: 'unkn208',           group: 'unknown',    type: 'int' },
    { index: 209, name: 'unkn209',           group: 'unknown',    type: 'int' },
    { index: 210, name: 'canMGB',            group: 'properties', type: 'int' },       // Mass Group Buff capable
    { index: 211, name: 'dispelFlag',        group: 'properties', type: 'int' },
    { index: 212, name: 'npcCategory',       group: 'properties', type: 'int' },
    { index: 213, name: 'npcUsefulness',     group: 'properties', type: 'int' },
    { index: 214, name: 'unkn214',           group: 'unknown',    type: 'int' },
    { index: 215, name: 'unkn215',           group: 'unknown',    type: 'int' },
    { index: 216, name: 'resistDiffPerLevel', group: 'properties', type: 'int' },
    { index: 217, name: 'resistDiffCap',     group: 'properties', type: 'int' },
    { index: 218, name: 'unkn218',           group: 'unknown',    type: 'int' },
    { index: 219, name: 'unkn219',           group: 'unknown',    type: 'int' },
    { index: 220, name: 'unkn220',           group: 'unknown',    type: 'int' },

    // === Final Fields (221-236) ===
    { index: 221, name: 'spellGroup2',       group: 'stacking',   type: 'int' },       // Secondary spell group
    { index: 222, name: 'spellGroupRank2',   group: 'stacking',   type: 'int' },
    { index: 223, name: 'unkn223',           group: 'unknown',    type: 'int' },
    { index: 224, name: 'allowRest',         group: 'properties', type: 'int' },       // Can cast while resting
    { index: 225, name: 'inCombatFlag',      group: 'properties', type: 'int' },
    { index: 226, name: 'outOfCombatFlag',   group: 'properties', type: 'int' },
    { index: 227, name: 'unkn227',           group: 'unknown',    type: 'int' },
    { index: 228, name: 'unkn228',           group: 'unknown',    type: 'int' },
    { index: 229, name: 'coneStartAngle',    group: 'range',      type: 'int' },
    { index: 230, name: 'coneStopAngle',     group: 'range',      type: 'int' },
    { index: 231, name: 'unkn231',           group: 'unknown',    type: 'int' },
    { index: 232, name: 'unkn232',           group: 'unknown',    type: 'int' },
    { index: 233, name: 'unkn233',           group: 'unknown',    type: 'int' },
    { index: 234, name: 'unkn234',           group: 'unknown',    type: 'int' },
    { index: 235, name: 'unkn235',           group: 'unknown',    type: 'int' },
    { index: 236, name: 'unkn236',           group: 'unknown',    type: 'int' },
];

// Quick-access index for column lookup by name
const COLUMN_BY_NAME = {};
for (const col of SPELL_COLUMNS) {
    COLUMN_BY_NAME[col.name] = col;
}

// Quick-access for groups of columns
const COLUMNS_BY_GROUP = {};
for (const col of SPELL_COLUMNS) {
    if (!COLUMNS_BY_GROUP[col.group]) {
        COLUMNS_BY_GROUP[col.group] = [];
    }
    COLUMNS_BY_GROUP[col.group].push(col);
}

module.exports = { SPELL_COLUMNS, COLUMN_BY_NAME, COLUMNS_BY_GROUP };
