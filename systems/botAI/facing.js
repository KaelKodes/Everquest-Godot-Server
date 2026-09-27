'use strict';

function entityPos(ent) {
  if (!ent) return null;
  if (ent.char) return ent.char;
  return ent;
}

/**
 * True when the attacker is in the mob's rear arc (more than 90 degrees
 * off its facing). Player rogues do not use this; bot plugins do.
 */
function isBehind(session, mob) {
  if (!session || !session.char || !mob) return false;
  const mobPos = entityPos(mob);
  if (!mobPos) return false;
  const angle = ((mob.heading || mobPos.heading || 0) / 512) * Math.PI * 2;
  const fx = Math.sin(angle);
  const fy = Math.cos(angle);
  const ax = (session.char.x || 0) - (mobPos.x || 0);
  const ay = (session.char.y || 0) - (mobPos.y || 0);
  if (Math.hypot(ax, ay) < 1) return false;
  return ax * fx + ay * fy < 0;
}

module.exports = { isBehind };
