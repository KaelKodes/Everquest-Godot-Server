/**
 * FPS-independent fall damage: client reports fall height (EQ/Godot vertical units)
 * and peak downward speed; server applies formula + buff/skill checks.
 */
const combat = require('../combat');
const CombatSystem = require('./combat');

let sendCombatLogFn;
let sendStatusFn;
let flushSkillUpsFn;

function init(deps) {
  sendCombatLogFn = deps.sendCombatLog;
  sendStatusFn = deps.sendStatus;
  flushSkillUpsFn = deps.flushSkillUps;
}

function sendCombatLog(session, events) {
  if (sendCombatLogFn && events && events.length) sendCombatLogFn(session, events);
}

function sendStatus(session) {
  if (sendStatusFn) sendStatusFn(session);
}

function flushSkillUps(session) {
  if (flushSkillUpsFn) flushSkillUpsFn(session);
}

/** MIN(STR,DEX,AGI): low "weakest link" → slightly harder falls (immersive nudge). */
function worstStatDamageFactor(stats) {
  if (!stats) return 1.0;
  const s = Number(stats.str) || 0;
  const d = Number(stats.dex) || 0;
  const a = Number(stats.agi) || 0;
  const w = Math.min(s, d, a);
  const t = Math.max(0, Math.min(1, (w - 35) / 210));
  return 1.09 - t * 0.16;
}

/** Heavier packs → tiny extra oomph on impact (capped). */
function encumbranceDamageFactor(stats) {
  const wt = Number(stats && stats.weight) || 0;
  const bump = Math.min(0.06, Math.max(0, wt - 50) / 850);
  return 1 + bump;
}

const MIN_FALL_HEIGHT = 11;
// Must sit above the natural impact velocity of a flat-ground jump
// (jump_velocity=30 in WorldManager.cs, gravity=50 → impact ≈30 m/s).
// At 20 the previous threshold was below that, so every jump trip-wired the
// server even when the client correctly reported a fall distance of ~0.
const MIN_IMPACT_IF_LOW_HEIGHT = 32;
const MAX_CLIENT_FALL = 380;
const MAX_CLIENT_SPEED = 155;
const COOLDOWN_MS = 850;

async function handleFallImpact(session, msg) {
  if (!session || !session.char) return;
  if (session.char.state === 'dead') return;
  if (session.loginFreeze && Date.now() < session.loginFreeze) return;

  const now = Date.now();
  if (session._lastFallImpactAt && now - session._lastFallImpactAt < COOLDOWN_MS) return;

  if (session.char.isLevitating) return;

  let fallHeight = Number(msg.fallHeight);
  let impactSpeed = Number(msg.impactSpeed);
  if (!Number.isFinite(fallHeight) || !Number.isFinite(impactSpeed)) return;

  fallHeight = Math.max(0, Math.min(MAX_CLIENT_FALL, fallHeight));
  impactSpeed = Math.max(0, Math.min(MAX_CLIENT_SPEED, impactSpeed));

  if (fallHeight < MIN_FALL_HEIGHT && impactSpeed < MIN_IMPACT_IF_LOW_HEIGHT) return;

  const eff = session.effectiveStats || {};
  const maxHp = Math.max(1, eff.hp || session.char.maxHp || 100);

  const safeFall = combat.getCharSkill(session.char, 'safe_fall') || 0;
  const safeMit = Math.min(0.52, safeFall / 340);

  let severity = fallHeight * 1.02 + impactSpeed * 0.62;
  severity *= 1 - safeMit;

  const frac = 1 - Math.exp(-severity / 86);
  let dmg = Math.floor(
    maxHp * frac * worstStatDamageFactor(eff) * encumbranceDamageFactor(eff)
  );

  dmg = Math.max(0, Math.min(Math.floor(maxHp * 2.2), dmg));
  if (dmg < 1) return;

  session._lastFallImpactAt = now;
  session.char.hp = Math.max(0, session.char.hp - dmg);

  const events = [{ event: 'MESSAGE', text: `You hit the ground hard for ${dmg} points of damage.` }];

  if (fallHeight >= 40 && impactSpeed >= 28) {
    combat.trySkillUp(session, 'safe_fall');
    flushSkillUps(session);
  }

  if (session.char.hp <= 0) {
    await CombatSystem.handlePlayerDeath(session, events);
  } else {
    sendCombatLog(session, events);
    sendStatus(session);
  }
}

module.exports = {
  init,
  handleFallImpact,
};
