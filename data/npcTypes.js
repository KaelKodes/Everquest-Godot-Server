// ── NPC Type Constants ──────────────────────────────────────────────
// Defines the behavioral classification for all spawnable entities.

const NPC_TYPES = {
  MOB:       'mob',        // Hostile creature — fights players
  BLANK:     'blank',      // Filler NPC — no interaction beyond targeting
  QUEST:     'quest',      // Quest NPC — keyword dialog system
  MERCHANT:  'merchant',   // Merchant — buy/sell services
  TRAINER:   'trainer',    // Trainer — class skill training
  BIND:      'bind',       // Bind Point — soul binding (placeholder)
  BANK:      'bank',       // Banker — item/coin storage
  STATION:   'station',    // Crafting Station — oven, forge, etc.
};

// Interaction range for non-combat NPCs (world X/Y units, same plane as getDistanceSq).
// Used for Hail, merchants, trainers, bankers, etc. Too small feels "nose to nose"; classic
// play is a short conversation distance without shouting across the zone.
const HAIL_RANGE = 25;

module.exports = { NPC_TYPES, HAIL_RANGE };
