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
};

// Interaction range for non-combat NPCs (in world units).
// Players must be within this distance to Hail and interact.
const HAIL_RANGE = 15;

module.exports = { NPC_TYPES, HAIL_RANGE };
