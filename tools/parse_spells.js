#!/usr/bin/env node
/**
 * parse_spells.js - Full EQ RoF2 spells_us.txt Parser
 * 
 * Parses ALL 237 columns from spells_us.txt into named JSON records.
 * Preserves the entire EQ spell template as our template — nothing thrown away.
 * Adds derived convenience fields on top (type classification, etc).
 * 
 * Usage:
 *   node parse_spells.js [options]
 * 
 * Options:
 *   --source=<path>          Path to spells_us.txt (default: D:\everquest_rof2\everquest_rof2\spells_us.txt)
 *   --output=<path>          Output JSON path (default: ../data/spells_parsed.json)
 *   --max-id=<N>             Only parse spells up to this ID
 *   --max-level=<N>          Only include spells learnable at or below this level
 *   --classes=<list>         Comma-separated class filter (e.g., cleric,druid)
 *   --player-only            Skip spells with no player class assignments
 *   --pretty                 Pretty-print JSON output
 *   --test                   Run built-in validation tests
 *   --stats                  Print statistics after parsing
 */

const fs = require('fs');
const readline = require('readline');
const path = require('path');

const { SPELL_COLUMNS } = require('./spell_columns');
const {
    RESIST_TYPES,
    TARGET_TYPES,
    CASTING_SKILLS,
    SPA_EFFECTS,
    CLASS_NAMES,
    DURATION_FORMULAS,
    SPELL_AFFECT_INDEX
} = require('./spell_enums');

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function parseArgs() {
    const args = {
        source: path.join('D:', 'everquest_rof2', 'everquest_rof2', 'spells_us.txt'),
        output: path.join(__dirname, '..', 'data', 'spells_parsed.json'),
        maxId: null,
        maxLevel: null,
        classes: null,
        playerOnly: false,
        pretty: false,
        test: false,
        stats: false
    };

    for (const arg of process.argv.slice(2)) {
        if (arg.startsWith('--source=')) args.source = arg.split('=')[1];
        else if (arg.startsWith('--output=')) args.output = arg.split('=')[1];
        else if (arg.startsWith('--max-id=')) args.maxId = parseInt(arg.split('=')[1]);
        else if (arg.startsWith('--max-level=')) args.maxLevel = parseInt(arg.split('=')[1]);
        else if (arg.startsWith('--classes=')) args.classes = arg.split('=')[1].toLowerCase().split(',');
        else if (arg === '--player-only') args.playerOnly = true;
        else if (arg === '--pretty') args.pretty = true;
        else if (arg === '--test') args.test = true;
        else if (arg === '--stats') args.stats = true;
        else if (arg === '--help') {
            console.log(`
EQ Spell Parser - RoF2 spells_us.txt → JSON

Usage: node parse_spells.js [options]

Options:
  --source=<path>      Path to spells_us.txt
  --output=<path>      Output JSON file path
  --max-id=<N>         Only parse spells up to this ID
  --max-level=<N>      Only include spells learnable at/below this level
  --classes=<list>     Comma-separated class names (e.g., cleric,druid)
  --player-only        Skip NPC-only spells (all class levels = 255)
  --pretty             Pretty-print the JSON output
  --test               Run built-in validation tests
  --stats              Print parsing statistics
            `);
            process.exit(0);
        }
    }

    return args;
}

// ============================================================================
// Column Parsing
// ============================================================================

/**
 * Parse a single raw field value according to its column type definition
 */
function parseFieldValue(rawValue, colDef) {
    if (rawValue === '' || rawValue === undefined || rawValue === null) {
        return colDef.type === 'string' ? '' : 0;
    }
    switch (colDef.type) {
        case 'int':
            return parseInt(rawValue, 10) || 0;
        case 'float':
            return parseFloat(rawValue) || 0;
        case 'string':
            return rawValue;
        default:
            return rawValue;
    }
}

/**
 * Parse a single line from spells_us.txt into a structured spell object
 */
function parseSpellLine(line) {
    const rawFields = line.split('^');

    // Build the named field object from all 237 columns
    const named = {};
    const raw = [];

    for (const colDef of SPELL_COLUMNS) {
        const rawValue = rawFields[colDef.index];
        const parsed = parseFieldValue(rawValue, colDef);
        named[colDef.name] = parsed;
        raw[colDef.index] = rawValue !== undefined ? rawValue : '';
    }

    // Fill any raw values beyond what SPELL_COLUMNS defines
    for (let i = 0; i < rawFields.length; i++) {
        if (raw[i] === undefined) {
            raw[i] = rawFields[i] || '';
        }
    }

    return { named, raw };
}

// ============================================================================
// Structured Output Building
// ============================================================================

/**
 * Build the effects array from the 12 effect slots
 */
function buildEffects(named) {
    const effects = [];
    for (let i = 1; i <= 12; i++) {
        const spa = named[`effectId${i}`];
        if (spa === 254 || spa === undefined) continue; // 254 = blank/unused

        effects.push({
            slot: i,
            spa: spa,
            spaName: SPA_EFFECTS[spa] || `unknown_${spa}`,
            base: named[`baseValue${i}`],
            limit: named[`limitValue${i}`],
            max: named[`maxValue${i}`],
            formula: named[`formula${i}`]
        });
    }
    return effects;
}

/**
 * Build the class levels map
 */
function buildClassLevels(named) {
    const classes = {};
    for (let i = 0; i < CLASS_NAMES.length; i++) {
        const colName = `classLevel${CLASS_NAMES[i].charAt(0).toUpperCase() + CLASS_NAMES[i].slice(1)}`;
        classes[CLASS_NAMES[i]] = named[colName] || 255;
    }
    return classes;
}

/**
 * Build the components array (reagents required to cast)
 */
function buildComponents(named) {
    const components = [];
    for (let i = 1; i <= 4; i++) {
        const itemId = named[`component${i}`];
        if (itemId === -1 || itemId === 0) continue;
        components.push({
            itemId: itemId,
            count: named[`componentCount${i}`] || 1
        });
    }
    return components;
}

/**
 * Build noexpend reagents (focus items)
 */
function buildNoexpendReagents(named) {
    const reagents = [];
    for (let i = 1; i <= 4; i++) {
        const itemId = named[`noexpendReagent${i}`];
        if (itemId === -1 || itemId === 0) continue;
        reagents.push({ itemId: itemId });
    }
    return reagents;
}

// ============================================================================
// Type Derivation (our added intelligence on top of EQ's template)
// ============================================================================

/**
 * Derive the high-level spell type from the SPA effect IDs
 * This is the main "added value" we provide beyond EQ's raw data
 */
function deriveSpellType(effects, named) {
    const spaIds = effects.map(e => e.spa);
    const goodEffect = named.goodEffect === 1;
    const hasDuration = named.buffDuration > 0 || named.buffDurationFormula > 0;

    // Check for specific SPAs first (order matters)
    if (spaIds.includes(31))  return 'mez';
    if (spaIds.includes(20))  return 'charm';
    if (spaIds.includes(21))  return 'fear';
    if (spaIds.includes(99))  return 'root';
    if (spaIds.includes(33))  return 'pet';
    if (spaIds.includes(120)) return 'pet';         // Temp pet
    if (spaIds.includes(111)) return 'resurrect';
    if (spaIds.includes(106)) return 'teleport';
    if (spaIds.includes(24))  return 'gate';
    if (spaIds.includes(60))  return 'illusion';
    if (spaIds.includes(57))  return 'rune';
    if (spaIds.includes(25))  return 'dispel';
    if (spaIds.includes(32))  return 'summonItem';

    // HP-based spells
    if (spaIds.includes(0)) {
        const hpEffect = effects.find(e => e.spa === 0);
        if (hpEffect) {
            if (hpEffect.base > 0 || (goodEffect && hpEffect.base !== 0)) {
                // Positive HP = heal
                return hasDuration ? 'hot' : 'heal';
            } else {
                // Negative HP = damage
                return hasDuration ? 'dot' : 'dd';
            }
        }
    }

    // Lifetap (both damages target and heals caster)
    if (spaIds.includes(139)) return hasDuration ? 'lifetapDot' : 'lifetap';

    // Slow/Haste
    if (spaIds.includes(11)) {
        const atkSpd = effects.find(e => e.spa === 11);
        if (atkSpd && atkSpd.base < 0) return 'slow';
        return 'haste';
    }

    // Snare (movement speed reduction)
    if (spaIds.includes(3)) {
        const moveSpd = effects.find(e => e.spa === 3);
        if (moveSpd && moveSpd.base < 0) return 'snare';
    }

    // Stun
    if (spaIds.includes(19)) return 'stun';

    // Pacify/Lull
    if (spaIds.includes(18)) return 'lull';

    // Damage shield
    if (spaIds.includes(61)) return 'damageShield';

    // Mana drain/feed
    if (spaIds.includes(15) && !goodEffect) return 'manaDrain';

    // Stat buffs/debuffs
    const statSpas = [1, 2, 4, 5, 6, 7, 8, 9, 10, 46, 47, 48, 49, 50, 85];
    const hasStats = spaIds.some(id => statSpas.includes(id));
    if (hasStats && hasDuration) {
        return goodEffect ? 'buff' : 'debuff';
    }

    // Movement speed buff (that isn't a snare)
    if (spaIds.includes(3))  return 'buff';

    // Invisibility
    if (spaIds.includes(12) || spaIds.includes(26) || spaIds.includes(27)) return 'invisibility';

    // Generic beneficial/detrimental with duration
    if (hasDuration) return goodEffect ? 'buff' : 'debuff';

    // Instant beneficial/detrimental
    if (goodEffect) return 'utility';
    return 'dd'; // Default to direct damage if detrimental
}

/**
 * Check if the spell is a bard song based on casting skill
 */
function isBardSong(named) {
    const songSkills = [41, 12, 49, 54, 70]; // singing, brass, stringed, wind, percussion
    return songSkills.includes(named.skill);
}

/**
 * Check if this is a discipline (endurance-based ability)
 */
function isDiscipline(named) {
    return named.mana === 0 && named.stamina > 0;
}

// ============================================================================
// Filtering
// ============================================================================

function shouldInclude(spell, args) {
    // ID filter
    if (args.maxId !== null && spell.id > args.maxId) return false;

    // Player-only filter
    if (args.playerOnly) {
        const allMax = CLASS_NAMES.every(cn => spell.classes[cn] === 255);
        if (allMax) return false;
    }

    // Class filter
    if (args.classes) {
        const hasClass = args.classes.some(cls => spell.classes[cls] !== undefined && spell.classes[cls] !== 255);
        if (!hasClass) return false;
    }

    // Level filter
    if (args.maxLevel !== null) {
        const minLevel = spell.derived.minLevel;
        if (minLevel > args.maxLevel) return false;
    }

    return true;
}

// ============================================================================
// Main Parse Function
// ============================================================================

async function parseSpellsFile(sourcePath) {
    const spells = [];
    const stream = fs.createReadStream(sourcePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let lineCount = 0;
    let skippedEmpty = 0;

    for await (const line of rl) {
        lineCount++;
        if (!line.trim()) {
            skippedEmpty++;
            continue;
        }

        const { named, raw } = parseSpellLine(line);

        // Skip invalid entries (no ID or name)
        if (!named.id || !named.name) {
            skippedEmpty++;
            continue;
        }

        // Build structured data
        const effects = buildEffects(named);
        const classes = buildClassLevels(named);
        const components = buildComponents(named);
        const noexpendReagents = buildNoexpendReagents(named);

        // Determine minimum level any class can learn this
        const classLevels = Object.values(classes).filter(v => v !== 255);
        const minLevel = classLevels.length > 0 ? Math.min(...classLevels) : 255;
        const maxLevel = classLevels.length > 0 ? Math.max(...classLevels) : 255;
        const isPlayerSpell = classLevels.length > 0;

        // Derive our type classification
        const spellType = deriveSpellType(effects, named);
        const bardSong = isBardSong(named);
        const discipline = isDiscipline(named);

        const spell = {
            // Core identity
            id: named.id,
            name: named.name,

            // Messages
            messages: {
                youCast: named.youCast,
                otherCasts: named.otherCasts,
                castOnYou: named.castOnYou,
                castOnOther: named.castOnOther,
                spellFades: named.spellFades
            },

            // Timing (preserve raw ms values)
            timing: {
                castTime: named.castTime,
                recoveryTime: named.recoveryTime,
                recastTime: named.recastTime
            },

            // Cost
            cost: {
                mana: named.mana,
                endurance: named.stamina || 0
            },

            // Range & Physics
            range: {
                range: named.range,
                aoeRange: named.aoeRange,
                pushback: named.pushback,
                pushup: named.pushup,
                minRange: named.minRange || 0,
                maxDistance: named.maxDistance || 0,
                minDistance: named.minDistance || 0
            },

            // Duration
            duration: {
                formula: named.buffDurationFormula,
                formulaName: DURATION_FORMULAS[named.buffDurationFormula] || `formula_${named.buffDurationFormula}`,
                ticks: named.buffDuration,
                aeDuration: named.aeDuration
            },

            // Properties with resolved names
            resistType: {
                id: named.resistType,
                name: RESIST_TYPES[named.resistType] || `unknown_${named.resistType}`
            },
            targetType: {
                id: named.targetType,
                name: TARGET_TYPES[named.targetType] || `unknown_${named.targetType}`
            },
            skill: {
                id: named.skill,
                name: CASTING_SKILLS[named.skill] || `unknown_${named.skill}`
            },
            goodEffect: named.goodEffect === 1,

            // The 12 effect slots (only non-empty ones)
            effects: effects,

            // Class level requirements
            classes: classes,

            // Reagent requirements
            components: components,
            noexpendReagents: noexpendReagents,

            // Visual
            visual: {
                icon: named.icon,
                memIcon: named.memIcon,
                castingAnimation: named.castingAnimation,
                targetAnimation: named.targetAnimation,
                spellAffectIndex: named.spellAffectIndex,
                spellAffectName: SPELL_AFFECT_INDEX[named.spellAffectIndex] || null
            },

            // Stacking
            stacking: {
                spellGroupId: named.spellGroupId || 0,
                spellGroupRank: named.spellGroupRank || 0,
                spellGroup2: named.spellGroup2 || 0,
                spellGroupRank2: named.spellGroupRank2 || 0
            },

            // Properties
            properties: {
                lightType: named.lightType,
                activated: named.activated,
                zoneType: named.zoneType,
                environmentType: named.environmentType,
                timeOfDay: named.timeOfDay,
                reflectable: named.reflectable,
                bonusHate: named.bonusHate,
                resistPerLevel: named.resistPerLevel,
                resistCap: named.resistCap,
                hateMod: named.hateMod,
                npcNoLos: named.npcNoLos,
                canMGB: named.canMGB,
                dispelFlag: named.dispelFlag,
                allowRest: named.allowRest,
                inCombatFlag: named.inCombatFlag,
                outOfCombatFlag: named.outOfCombatFlag,
                spellCategory: named.spellCategory,
                recastTimerIndex: named.recastTimerIndex,
                coneStartAngle: named.coneStartAngle,
                coneStopAngle: named.coneStopAngle,
                spellRecourseId: named.spellRecourseId,
                descriptionId: named.descriptionId
            },

            // Links
            links: {
                teleportZone: named.teleportZone,
                spellRecourseId: named.spellRecourseId
            },

            // Our derived intelligence (the value we ADD on top of EQ's template)
            derived: {
                type: spellType,
                isBardSong: bardSong,
                isDiscipline: discipline,
                isPlayerSpell: isPlayerSpell,
                minLevel: minLevel,
                maxLevel: maxLevel,
                usableByClasses: CLASS_NAMES.filter(cn => classes[cn] !== 255)
            },

            // The complete raw row — insurance policy, never lose data
            raw: raw
        };

        spells.push(spell);
    }

    return { spells, lineCount, skippedEmpty };
}

// ============================================================================
// Validation Tests
// ============================================================================

function runTests(spells) {
    const tests = [];
    let passed = 0;
    let failed = 0;

    function assert(testName, condition, details = '') {
        if (condition) {
            passed++;
            tests.push({ name: testName, status: 'PASS' });
        } else {
            failed++;
            tests.push({ name: testName, status: 'FAIL', details });
        }
    }

    // Test 1: Minor Healing (ID 200)
    const mh = spells.find(s => s.id === 200);
    assert('Minor Healing exists', !!mh);
    if (mh) {
        assert('MH name', mh.name === 'Minor Healing', `got: ${mh.name}`);
        assert('MH mana = 10', mh.cost.mana === 10, `got: ${mh.cost.mana}`);
        assert('MH castTime = 1500', mh.timing.castTime === 1500, `got: ${mh.timing.castTime}`);
        assert('MH cleric level = 1', mh.classes.cleric === 1, `got: ${mh.classes.cleric}`);
        assert('MH druid level = 1', mh.classes.druid === 1, `got: ${mh.classes.druid}`);
        assert('MH shaman level = 1', mh.classes.shaman === 1, `got: ${mh.classes.shaman}`);
        assert('MH warrior = 255', mh.classes.warrior === 255, `got: ${mh.classes.warrior}`);
        assert('MH goodEffect = true', mh.goodEffect === true, `got: ${mh.goodEffect}`);
        assert('MH type = heal', mh.derived.type === 'heal', `got: ${mh.derived.type}`);
        assert('MH resistType = none', mh.resistType.name === 'none', `got: ${mh.resistType.name}`);
        assert('MH effect1 SPA = 0 (HP)', mh.effects[0]?.spa === 0, `got: ${mh.effects[0]?.spa}`);
        assert('MH effect1 base = 10', mh.effects[0]?.base === 10, `got: ${mh.effects[0]?.base}`);
        assert('MH effect1 max = 20', mh.effects[0]?.max === 20, `got: ${mh.effects[0]?.max}`);
    }

    // Test 2: Shock of Lightning (ID 383)
    const shock = spells.find(s => s.id === 383);
    assert('Shock of Lightning exists', !!shock);
    if (shock) {
        assert('Shock type = dd', shock.derived.type === 'dd', `got: ${shock.derived.type}`);
        assert('Shock resistType = magic', shock.resistType.name === 'magic', `got: ${shock.resistType.name}`);
        assert('Shock wizard level = 10', shock.classes.wizard === 10, `got: ${shock.classes.wizard}`);
        assert('Shock skill = evocation', shock.skill.name === 'evocation', `got: ${shock.skill.name}`);
        assert('Shock mana = 50', shock.cost.mana === 50, `got: ${shock.cost.mana}`);
        assert('Shock isPlayerSpell', shock.derived.isPlayerSpell === true);
    }

    // Test 3: Spirit of Wolf (ID 278)
    const sow = spells.find(s => s.id === 278);
    assert('Spirit of Wolf exists', !!sow);
    if (sow) {
        assert('SoW type = buff', sow.derived.type === 'buff', `got: ${sow.derived.type}`);
        assert('SoW druid = 10', sow.classes.druid === 10, `got: ${sow.classes.druid}`);
        assert('SoW shaman = 9', sow.classes.shaman === 9, `got: ${sow.classes.shaman}`);
        assert('SoW ranger = 28', sow.classes.ranger === 28, `got: ${sow.classes.ranger}`);
        assert('SoW beastlord = 24', sow.classes.beastlord === 24, `got: ${sow.classes.beastlord}`);
        assert('SoW has duration', sow.duration.ticks > 0, `got: ${sow.duration.ticks}`);
        assert('SoW has movement speed effect', sow.effects.some(e => e.spa === 3), 
            `SPAs: ${sow.effects.map(e => e.spa).join(',')}`);
    }

    // Test 4: Mesmerize (ID 292)
    const mez = spells.find(s => s.id === 292);
    assert('Mesmerize exists', !!mez);
    if (mez) {
        assert('Mez type = mez', mez.derived.type === 'mez', `got: ${mez.derived.type}`);
        assert('Mez has SPA 31', mez.effects.some(e => e.spa === 31),
            `SPAs: ${mez.effects.map(e => e.spa).join(',')}`);
        assert('Mez resistType = magic', mez.resistType.name === 'magic', `got: ${mez.resistType.name}`);
    }

    // Test 5: Fire Bolt (ID 477)
    const fireBolt = spells.find(s => s.id === 477);
    assert('Fire Bolt exists', !!fireBolt);
    if (fireBolt) {
        assert('Fire Bolt resistType = fire', fireBolt.resistType.name === 'fire', `got: ${fireBolt.resistType.name}`);
        assert('Fire Bolt type = dd', fireBolt.derived.type === 'dd', `got: ${fireBolt.derived.type}`);
    }

    // Test 6: Quickness (Haste)
    const quickness = spells.find(s => s.name === 'Quickness');
    assert('Quickness exists', !!quickness);
    if (quickness) {
        assert('Quickness type = haste', quickness.derived.type === 'haste', `got: ${quickness.derived.type}`);
        assert('Quickness has SPA 11', quickness.effects.some(e => e.spa === 11));
    }

    // Test 7: Total spell count
    assert('Total spells ≈ 37000+', spells.length > 37000, `got: ${spells.length}`);

    // Print results
    console.log('\n=== VALIDATION TESTS ===');
    for (const t of tests) {
        const icon = t.status === 'PASS' ? '✓' : '✗';
        const details = t.details ? ` (${t.details})` : '';
        console.log(`  ${icon} ${t.name}${details}`);
    }
    console.log(`\n  ${passed}/${passed + failed} tests passed\n`);

    return failed === 0;
}

// ============================================================================
// Statistics
// ============================================================================

function printStats(spells) {
    console.log('\n=== PARSING STATISTICS ===');
    console.log(`  Total spells: ${spells.length}`);

    // Type distribution
    const typeCounts = {};
    for (const s of spells) {
        typeCounts[s.derived.type] = (typeCounts[s.derived.type] || 0) + 1;
    }
    console.log('\n  Type distribution:');
    const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
    for (const [type, count] of sortedTypes) {
        console.log(`    ${type}: ${count}`);
    }

    // Player spells vs NPC
    const playerSpells = spells.filter(s => s.derived.isPlayerSpell);
    console.log(`\n  Player-usable spells: ${playerSpells.length}`);
    console.log(`  NPC-only spells: ${spells.length - playerSpells.length}`);

    // Class distribution
    console.log('\n  Spells per class:');
    for (const cn of CLASS_NAMES) {
        const count = spells.filter(s => s.classes[cn] !== 255).length;
        console.log(`    ${cn}: ${count}`);
    }

    // Level ranges
    const levels = playerSpells.map(s => s.derived.minLevel).filter(l => l < 255);
    if (levels.length > 0) {
        console.log(`\n  Level range: ${Math.min(...levels)} - ${Math.max(...levels)}`);
    }

    // Resist type distribution
    const resistCounts = {};
    for (const s of spells) {
        const rn = s.resistType.name;
        resistCounts[rn] = (resistCounts[rn] || 0) + 1;
    }
    console.log('\n  Resist type distribution:');
    for (const [type, count] of Object.entries(resistCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${type}: ${count}`);
    }

    console.log('');
}

// ============================================================================
// Main
// ============================================================================

async function main() {
    const args = parseArgs();

    // Verify source file exists
    if (!fs.existsSync(args.source)) {
        console.error(`Error: Source file not found: ${args.source}`);
        console.error('Use --source=<path> to specify the location of spells_us.txt');
        process.exit(1);
    }

    console.log(`Parsing: ${args.source}`);
    const startTime = Date.now();

    // Parse the file
    const { spells: allSpells, lineCount, skippedEmpty } = await parseSpellsFile(args.source);
    const parseTime = Date.now() - startTime;
    console.log(`Parsed ${allSpells.length} spells from ${lineCount} lines in ${parseTime}ms`);

    // Apply filters
    let filteredSpells = allSpells;
    if (args.maxId || args.playerOnly || args.classes || args.maxLevel) {
        filteredSpells = allSpells.filter(s => shouldInclude(s, args));
        console.log(`Filtered to ${filteredSpells.length} spells`);
    }

    // Run tests if requested
    if (args.test) {
        const testsPassed = runTests(allSpells);
        if (!testsPassed) {
            console.error('Some tests failed!');
            process.exit(1);
        }
    }

    // Print stats if requested
    if (args.stats) {
        printStats(filteredSpells);
    }

    // Ensure output directory exists
    const outputDir = path.dirname(args.output);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write output
    const outputData = {
        meta: {
            source: args.source,
            parsedAt: new Date().toISOString(),
            totalSpells: allSpells.length,
            filteredSpells: filteredSpells.length,
            filters: {
                maxId: args.maxId,
                maxLevel: args.maxLevel,
                classes: args.classes,
                playerOnly: args.playerOnly
            },
            columnCount: SPELL_COLUMNS.length,
            version: 'RoF2'
        },
        spells: filteredSpells
    };

    // Remove raw arrays from output for file size savings (they're huge)
    // Comment this out if you need the raw data preserved
    const outputSpells = filteredSpells.map(spell => {
        const { raw, ...rest } = spell;
        return rest;
    });
    outputData.spells = outputSpells;

    const jsonStr = args.pretty
        ? JSON.stringify(outputData, null, 2)
        : JSON.stringify(outputData);

    fs.writeFileSync(args.output, jsonStr, 'utf8');
    const fileSizeMB = (Buffer.byteLength(jsonStr) / (1024 * 1024)).toFixed(2);
    console.log(`Wrote ${args.output} (${fileSizeMB} MB)`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
