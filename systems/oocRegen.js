/**
 * Post-combat "rested" regen gate: after leaving combat, fast sit/medd regen (and meditate skill-ups)
 * stay disabled for OOC_REGEN_REST_DELAY_MS. Until then, sitting uses standing MP/HP regen rates.
 */

const OOC_REGEN_REST_DELAY_MS = 15000;

function markCombatStarted(session) {
  if (!session) return;
  session.oocRegenReadyAtMs = null;
}

function markCombatEnded(session) {
  if (!session) return;
  session.oocRegenReadyAtMs = Date.now() + OOC_REGEN_REST_DELAY_MS;
}

/** True when out of combat and the post-combat delay has elapsed (or never applied). */
function isRestedRegenActive(session) {
  if (!session || session.inCombat) return false;
  const t = session.oocRegenReadyAtMs;
  if (t == null) return true;
  if (Date.now() >= t) {
    session.oocRegenReadyAtMs = null;
    return true;
  }
  return false;
}

/** Full fast medding regen (in combat OR post-delay rested). */
function fastMeddingRegen(session) {
  return !!session && (!!session.inCombat || isRestedRegenActive(session));
}

module.exports = {
  OOC_REGEN_REST_DELAY_MS,
  markCombatStarted,
  markCombatEnded,
  isRestedRegenActive,
  fastMeddingRegen,
};
