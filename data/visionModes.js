// ── Vision Modes ────────────────────────────────────────────────────
// Defines per-race vision types with effectiveness tiers and
// render-style hints for the Godot client.
//
// Vision Effectiveness Scale:
//   0  = Pitch black, completely blind
//   3  = Extremely dim, shapes only
//   5  = Dim, can see nearby but colors washed out
//   8  = Functional, can see well with some limits
//  10  = Full daylight / perfect vision
//
// View Distance Scale (in game units, ~1 unit = 1 foot):
//   15000 = Maximum (~3 miles) — clear day, normal eyes
//    8000 = Moderate — night with good adaptation
//    2000 = Very short — groping in the dark
//    1500 = Minimum — dense fog
//
// Each mode has:
//   nightBonus      — added to base vision score at night / in darkness
//   indoorBonus     — added to base vision score in unlit indoor zones
//   brightPenalty   — subtracted from effectiveness in bright light (>= 8 ambient)
//   torchPenalty    — subtracted when a light source is equipped (stacks w/ bright)
//   baseViewDist    — max view distance under ideal conditions for this mode
//   nightViewDist   — view distance at night (before effectiveness scaling)
//   renderStyle     — hint string the Godot client uses to pick post-processing
//   description     — flavor text for the player
//   canSeeUnlit     — if true, this vision mode works even with zero ambient light
// ────────────────────────────────────────────────────────────────────

const VISION_MODES = {
  // Normal Vision
  // Best overall performance in daylight. Completely dependent on ambient light.
  normal: {
    name: 'Normal Vision',
    nightBonus: 0,
    indoorBonus: 0,
    brightPenalty: 0,
    torchPenalty: 0,
    baseViewDist: 15000,
    nightViewDist: 2000,
    renderStyle: 'normal',
    canSeeUnlit: false,
    description: 'You have no special vision abilities.',
  },

  // Weak Normal Vision
  // Weaker vision in direct sunlight or near a light source.
  normal_weak: {
    name: 'Weak Normal Vision',
    nightBonus: 0,
    indoorBonus: 0,
    brightPenalty: -5,
    torchPenalty: -5,
    baseViewDist: 10000,
    nightViewDist: 2000,
    renderStyle: 'normal_weak',
    canSeeUnlit: false,
    description: 'Your vision weakens in direct sunlight or near bright lights.',
  },

  // Infravision (Thermal)
  // Heat signatures. Works in darkness.
  infravision: {
    name: 'Infravision',
    nightBonus: 8,
    indoorBonus: 8,
    brightPenalty: -2,
    torchPenalty: -1,
    baseViewDist: 8000,
    nightViewDist: 10000,
    renderStyle: 'infravision',
    canSeeUnlit: true,
    description: 'The world dissolves into waves of heat. Living things burn bright against the cold.',
  },

  // Ultravision
  // Purple enhanced darkvision.
  ultravision: {
    name: 'Ultravision',
    nightBonus: 10,
    indoorBonus: 10,
    brightPenalty: -4,
    torchPenalty: -2,
    baseViewDist: 8000,
    nightViewDist: 12000,
    renderStyle: 'ultravision',
    canSeeUnlit: true,
    description: 'Your eyes dilate wide, revealing every shadow in a deep purple hue.',
  },

  // Cat-Eye
  // Light night vision with green/grey tint.
  cateye: {
    name: 'Cat-Eye',
    nightBonus: 6,
    indoorBonus: 5,
    brightPenalty: -1,
    torchPenalty: 0,
    baseViewDist: 10000,
    nightViewDist: 8000,
    renderStyle: 'cateye',
    canSeeUnlit: true,
    description: 'A pale green tint washes over the world, bringing clarity to the night.',
  },

  // Serpent Sight
  // Weaker infra/ultra, clear underwater.
  serpentsight: {
    name: 'Serpent Sight',
    nightBonus: 5,
    indoorBonus: 5,
    brightPenalty: -1,
    torchPenalty: -1,
    baseViewDist: 10000,
    nightViewDist: 6000,
    renderStyle: 'serpentsight',
    canSeeUnlit: true,
    description: 'Your serpentine eyes cut through darkness and pierce the watery depths.',
  },
};

// Race -> Available Vision Modes Mapping
const RACE_VISION = {
  barbarian:  ['normal'],
  dark_elf:   ['normal_weak', 'infravision', 'ultravision'],
  dwarf:      ['normal', 'infravision'],
  erudite:    ['normal'],
  gnome:      ['normal', 'ultravision'],
  half_elf:   ['normal', 'infravision'],
  halfling:   ['normal', 'infravision'],
  high_elf:   ['normal', 'infravision'],
  human:      ['normal'],
  iksar:      ['normal', 'serpentsight'],
  ogre:       ['normal_weak', 'infravision'],
  troll:      ['normal', 'ultravision'],
  vah_shir:   ['normal', 'cateye'],
  wood_elf:   ['normal', 'ultravision'],
  froglok:    ['normal', 'serpentsight'],
};

// ── Spell SPA → Vision Mode Override ────────────────────────────────
// When a buff with these SPAs is active, it overrides the character's
// racial vision with this mode (if it's better).
const SPELL_VISION_MODES = {
  65: { mode: 'infravision', bonus: 5 },   // SPA 65 = Infravision spell
  66: { mode: 'ultravision', bonus: 10 },   // SPA 66 = Ultravision spell
};

// ── Ambient Light Levels ────────────────────────────────────────────
// Base light levels for environment type ONLY. Weather modifiers are
// applied separately from WEATHER_TYPES.lightModifier in calendar.js.
const AMBIENT_LIGHT = {
  outdoor_day:   10,  // Full daylight (before weather modifier)
  outdoor_night:  2,  // Moonlight/starlight only (before weather modifier)
  indoor_lit:     6,  // Torchlit dungeon corridors
  indoor_dim:     3,  // Faint ambient light (bioluminescence, cracks)
  indoor_dark:    0,  // Sealed, pitch-black cave
};

module.exports = {
  VISION_MODES,
  RACE_VISION,
  SPELL_VISION_MODES,
  AMBIENT_LIGHT,
};
