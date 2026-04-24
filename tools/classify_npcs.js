/**
 * classify_npcs.js — Injects `type` field into all mob definition files.
 * 
 * Classification logic:
 *   1. Explicit overrides from the NPC_CLASSIFICATION map below.
 *   2. Keys starting with 'a_' or 'an_' default to 'mob'.
 *   3. Keys starting with 'guard_' or 'watchman_' default to 'blank'.
 *   4. Everything else defaults to 'blank' (named humanoid filler).
 * 
 * Usage: node tools/classify_npcs.js
 */

const fs = require('fs');
const path = require('path');

// ── Explicit NPC Classifications ────────────────────────────────────
// Override the heuristic defaults for specific named NPCs.
const NPC_CLASSIFICATION = {
  // ─── Qeynos Hills ───
  // Named Mobs (hostile named creatures)
  'tovax_vmar':           'mob',
  'gnasher_furgutt':      'mob',
  'pyzjn':                'mob',
  'varsoon':              'mob',
  'holly_windstalker':    'mob',
  'scruffy':              'mob',

  // Guards — blank sentinels
  'guard_cheslin':        'blank',
  'guard_yalroen':        'blank',
  'guard_sironan':        'blank',
  'guard_beris':          'blank',
  'guard_kellot':         'blank',
  'guard_bixby':          'blank',
  'guard_philbin':        'blank',
  'guard_monroe':         'blank',
  'guard_leopold':        'blank',
  'guard_miles':          'blank',
  'guard_nash':           'blank',
  'guard_chrighton':      'blank',

  // Merchants
  'axe_broadsmith':       'merchant',
  'chanda_miller':        'merchant',
  'baobob_miller':        'merchant',
  'crumpy_irontoe':       'merchant',
  'wyle_bimlin':          'merchant',
  'barn_bloodstone':      'merchant',
  'tol_nicelot':          'merchant',
  'hefax_tinmar':         'merchant',
  'mogan_delfin':         'merchant',

  // Quest NPCs
  'yollis_jenkins':       'quest',
  'neclo_rheslar':        'quest',
  'sir_edwin_motte':      'quest',
  'hadden':               'quest',
  'konem_matse':          'quest',
  'buzzlin_bornahm':      'quest',

  // Trainers / Guildmasters
  'cethernee_vellestan':  'trainer',
  'pemawen_vorana':       'trainer',
  'lamangao_fallstine':   'trainer',
  'waradern_skymoor':     'trainer',
  'sarri_modav':          'trainer',
  'ubzial_iyeaql':        'trainer',

  // Blank/Filler NPCs
  'erudite_traveler':     'blank',
  'talym_shoontar':       'blank',
  'rephas':               'blank',
  'mira_sayer':           'blank',
  'marton_sayer':         'blank',
  'niclaus_ressinn':      'blank',
  'rilca_leafrunner':     'blank',

  // ─── West Karana ───
  // Named Mobs
  'frostbite':            'mob',
  'maligar':              'mob',
  'chief_goonda':         'mob',
  'the_fabled_chief_goonda': 'mob',
  'mystik':               'mob',
  'spinner':              'mob',

  // Farmers / Civilians
  'a_farmer':             'blank',
  'minda':                'blank',
  'anderia':              'blank',
  'rongol':               'blank',
  'florence':             'blank',
  'doreen':              'blank',
  'analya':              'blank',
  'alysa':               'blank',
  'caninel':             'blank',
  'scary_miller':        'blank',
  'tiny_miller':         'blank',
  'furball_miller':      'blank',
  'cleet_miller':        'blank',
  'cleet_miller_jr':     'blank',
  'tukk':                'blank',
  'carlan_the_young':    'blank',
  'maldin_the_old':      'blank',
  'vilnius_the_small':   'blank',

  // Guards
  'guard_gregor':         'blank',
  'guard_donlan':         'blank',
  'guard_pryde':          'blank',
  'guard_kilson':         'blank',
  'guard_ason':           'blank',
  'guard_justyn':         'blank',
  'guard_mccluskey':      'blank',

  // Merchants
  'innkeep_danin':        'merchant',
  'innkeep_rislarn':      'merchant',
  'linaya_sowlin':        'merchant',
  'chrislin_baker':       'merchant',
  'silna_weaver':         'merchant',
  'minya_coldtoes':       'merchant',
  'brellsan_tarn':        'merchant',

  // Quest NPCs
  'brother_estle':        'quest',
  'brother_trintle':      'quest',
  'brother_chintle':      'quest',
  'misty_storyswapper':   'quest',
  'lukas_hergo':          'quest',
  'larkin_tolman':        'quest',
  'lempeck_hargrin':      'quest',
  'henina_miller':        'quest',
  'ryshon_hunsti':        'quest',
  'nenika_lightfoot':     'quest',
  'alzekar_kerda':        'quest',
  'misla_mcmannus':       'quest',
  'sera_mcmannus':        'quest',
  'brenzl_mcmannus':      'quest',
  'ulrich_mcmannus':      'quest',
  'einhorst_mcmannus':    'quest',
  'junth_mcmannus':       'quest',
  'lars_mcmannus':        'quest',
  'mistrana_two_notes':   'quest',
  'ollysa_bladefinder':   'quest',
  'konia_swiftfoot':      'quest',
  'thurgen_thunderhead':   'quest',
  'choon':                'quest',
  'froon':                'quest',
  'tarnar':               'quest',

  // Trainers / Guildmasters
  'grebin_sneztop':       'trainer',
  'habastash_gikin':      'trainer',
  'kyle_rinlin':          'trainer',
  'tolony_marle':         'trainer',
  'quegin_hadder':        'trainer',
  'kobot_dellin':         'trainer',
  'lander_billkin':       'trainer',
  'ronly_jogmill':        'trainer',
  'parcil_vinder':        'trainer',
  'yiz_pon':              'trainer',
  'gomo_limerin':         'trainer',

  // Misc named merchants/quest
  'oobnopterbevny_biddilets': 'merchant',
  'gindlin_toxfodder':    'merchant',
  'sonagin_fartide':      'merchant',
  'renux_herkanor':       'merchant',
  'tarnic_mcwillows':     'merchant',
  'melaara_tenwinds':     'merchant',

  // ─── North Karana ───
  // Named Mobs
  'ashenpaw':             'mob',
  'swiftclaw':            'mob',
  'bristletoe':           'mob',
  'callowwing':           'mob',
  'grimtooth':            'mob',
  'grimfeather':          'mob',
  'the_fabled_grimfeather': 'mob',
  'the_silver_griffon':   'mob',
  'korvik_the_cursed':    'mob',
  'zahal_the_vile':       'mob',
  'timbur_the_tiny':      'mob',
  'withered_treant':      'mob',
  'nexus_scion':          'mob',
  'xanuusus':             'mob',

  // Guards
  'guard_shilster':       'blank',
  'guard_fredrick':       'blank',
  'guard_oystin':         'blank',
  'guard_westyn':         'blank',
  'guard_stanard':        'blank',
  'guard_bartley':        'blank',
  'watchman_dexlin':      'blank',
  'capt_linarius':        'blank',

  // Merchants
  'innkeep_disda':        'merchant',
  'innkeep_james':        'merchant',
  'barkeep_milo':         'merchant',
  'barkeep_jeny':         'merchant',
  'shiel_glimmerspindle': 'merchant',

  // Quest NPCs
  'cordelia_minster':     'quest',
  'cory_bumbleye':        'quest',
  'fixxin_followig':      'quest',
  'ezmirella':            'quest',
  'brother_nallin':       'quest',
  'bunu_stoutheart':      'quest',
  'mrysila':              'quest',
  'nul_aleswiller':       'quest',
  'romi':                 'quest',
  'roule':                'quest',
  'romella':              'quest',
  'tak_whistler':         'quest',
  'bilbis_briar':         'quest',
  'gorri_fallstine':      'quest',
  'balglaiel_delver':     'quest',
  'tellqueen_sithmoor':   'quest',
  'briana_treewhisper':   'quest',

  // Trainer / Druid
  'a_druid':              'trainer',
};

// ── Classification Heuristic ────────────────────────────────────────

function classifyNpc(key) {
  // Check explicit overrides first
  if (NPC_CLASSIFICATION[key]) return NPC_CLASSIFICATION[key];

  // Heuristic: creature-type keys
  if (key.startsWith('a_') || key.startsWith('an_')) return 'mob';

  // Heuristic: guards/watchmen
  if (key.startsWith('guard_') || key.startsWith('watchman_')) return 'blank';

  // Default: named humanoid = blank filler
  return 'blank';
}

// ── File Processing ─────────────────────────────────────────────────

const MOB_FILES = [
  path.join(__dirname, '..', 'data', 'mobs', 'qeynos_hills.js'),
  path.join(__dirname, '..', 'data', 'mobs', 'west_karana.js'),
  path.join(__dirname, '..', 'data', 'mobs', 'north_karana.js'),
];

let totalMobs = 0;
let totalClassified = 0;
const typeCounts = {};

for (const filePath of MOB_FILES) {
  const fileName = path.basename(filePath);
  console.log(`\nProcessing ${fileName}...`);

  const mobs = require(filePath);
  
  for (const mob of mobs) {
    const type = classifyNpc(mob.key);
    mob.type = type;
    totalMobs++;
    totalClassified++;
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  }

  // Write back as formatted JS module
  const output = 'module.exports = ' + JSON.stringify(mobs, null, 2) + ';\n';
  fs.writeFileSync(filePath, output, 'utf8');
  console.log(`  ✓ ${mobs.length} entries classified and saved.`);
}

console.log(`\n── Summary ──`);
console.log(`Total entries: ${totalMobs}`);
for (const [type, count] of Object.entries(typeCounts).sort()) {
  console.log(`  ${type}: ${count}`);
}
console.log('Done.');
