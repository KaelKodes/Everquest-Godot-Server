'use strict';

/**
 * Group Puller role AI — KissAssist / monk-split inspired state machine.
 *
 * States:
 *   idle        — wait for camp to be clear (or chain-pull HP)
 *   scout       — pick a pull target near camp
 *   approach    — path to the mob
 *   tag         — get hate with a brief engage, then leave
 *   return      — path back to camp while mobs chase
 *   split_fd    — feign death to dump extras / survive
 *   wait_split  — stay down while the pack separates, then re-tag the closest
 *   handoff     — arrive at camp, stop fighting so the tank can take over
 *
 * Roles are a mindset booster: this runs only when the bot is Set Puller.
 */

const State = require('../../state');
const Path = require('../companionPath');
const Feign = require('../feignDeath');
const { NPC_TYPES } = require('../../data/npcTypes');

const DEFAULTS = {
  campRadius: 30,
  maxPullRadius: 280,
  minPullDistance: 40,
  packRadius: 35,
  tagRange: 14,
  handoffRange: 28,
  chainPullHp: 22,
  desiredPullCount: 1,
  maxPullCount: 3,
  splitClosestDist: 16,
  emergencyHpPct: 45,
  fdWaitMs: 4500,
  maxSplitAttempts: 4,
  tagHoldMs: 1200,
  zRange: 40,
};

const STATES = {
  IDLE: 'idle',
  SCOUT: 'scout',
  APPROACH: 'approach',
  TAG: 'tag',
  RETURN: 'return',
  SPLIT_FD: 'split_fd',
  WAIT_SPLIT: 'wait_split',
  HANDOFF: 'handoff',
};

function ensure(session) {
  if (!session.puller) {
    session.puller = {
      state: STATES.IDLE,
      camp: null,
      targetId: null,
      taggedIds: [],
      splitAttempts: 0,
      waitUntil: 0,
      tagUntil: 0,
      cfg: { ...DEFAULTS },
    };
  } else if (!session.puller.cfg) {
    session.puller.cfg = { ...DEFAULTS };
  }
  return session.puller;
}

/** Sync pullCount / pullRadius from bot.config into the live puller cfg. */
function applyBotConfig(session, bot) {
  const p = ensure(session);
  const cfg = p.cfg;
  const count = Number(bot && bot.config && bot.config.pullCount);
  const radius = Number(bot && bot.config && bot.config.pullRadius);
  if (Number.isFinite(count) && count > 0) {
    cfg.desiredPullCount = Math.max(1, Math.min(6, Math.floor(count)));
    // Emergency FD kicks in a couple past the desired haul.
    cfg.maxPullCount = Math.max(cfg.desiredPullCount + 1, Math.min(8, cfg.desiredPullCount + 2));
  }
  if (Number.isFinite(radius) && radius > 0) {
    cfg.maxPullRadius = Math.max(60, Math.min(800, Math.floor(radius)));
    cfg.minPullDistance = Math.min(cfg.minPullDistance, Math.max(20, Math.floor(cfg.maxPullRadius * 0.12)));
  }
}

function resetPull(session, nextState = STATES.IDLE) {
  const p = ensure(session);
  p.state = nextState;
  p.targetId = null;
  p.taggedIds = [];
  p.splitAttempts = 0;
  p.waitUntil = 0;
  p.tagUntil = 0;
  session.pullTarget = null;
  if (nextState === STATES.IDLE) {
    session.autoFight = false;
  }
}

function dist2(ax, ay, bx, by) {
  const dx = (ax || 0) - (bx || 0);
  const dy = (ay || 0) - (by || 0);
  return dx * dx + dy * dy;
}

function dist(ax, ay, bx, by) {
  return Math.sqrt(dist2(ax, ay, bx, by));
}

function liveMobs(session) {
  const zone = State.zoneInstances && State.zoneInstances[session.char.zoneId];
  return (zone && zone.liveMobs) || [];
}

function isPullableMob(mob) {
  if (!mob || mob.alive === false || mob.pendingRemove) return false;
  if (mob.hp != null && mob.hp <= 0) return false;
  if (mob.isPet) return false;
  if (mob.npcType && mob.npcType !== NPC_TYPES.MOB) return false;
  return true;
}

function mobChasingSession(mob, session) {
  if (!isPullableMob(mob)) return false;
  if (mob.target === session) return true;
  if (mob.hateList && session.char) {
    return mob.hateList.entries.some((e) => e.entityId === session.char.name);
  }
  return false;
}

function chasingMobs(session) {
  return liveMobs(session).filter((m) => mobChasingSession(m, session));
}

function campAnchor(bot, session) {
  const p = ensure(session);
  const tank = bot.getTankSession && bot.getTankSession();
  const anchorChar = (tank && tank.char) || (session.group && session.group.members[0] && session.group.members[0].char) || session.char;
  // Refresh camp while idle so the party can reposition between pulls.
  if (!p.camp || p.state === STATES.IDLE || p.state === STATES.SCOUT) {
    p.camp = {
      x: anchorChar.x,
      y: anchorChar.y,
      z: anchorChar.z || 0,
    };
  }
  return p.camp;
}

function mobsNearCamp(session, camp, radius) {
  const Camp = require('./campControl');
  const r2 = radius * radius;
  return liveMobs(session).filter((m) => {
    if (!isPullableMob(m)) return false;
    if (dist2(m.x, m.y, camp.x, camp.y) > r2) return false;
    // Mezzed adds are still the group's fight. Do not walk off and pull more.
    if (Camp.isMezzed(m)) return true;
    if (m.target || (m.hateList && m.hateList.entries.length > 0)) return true;
    return false;
  });
}

function groupFightClear(bot, session, camp, cfg) {
  // Wider than the stand-here radius so a mez behind the tank still counts.
  const near = mobsNearCamp(session, camp, Math.max(cfg.campRadius, 80));
  if (near.length === 0) return true;

  const focus = bot.getFocusTarget && bot.getFocusTarget();
  const extras = near.filter((m) => !focus || m.id !== focus.id);
  if (extras.length > 0) return false;

  if (focus && isPullableMob(focus)) {
    const maxHp = focus.maxHp || 100;
    const pct = maxHp > 0 ? ((focus.hp || 0) / maxHp) * 100 : 0;
    // Chain-pull only when this last mob is nearly dead and nothing is mezzed.
    if (pct <= cfg.chainPullHp) return true;
    return false;
  }
  return false;
}

function neighborCount(mob, all, packRadius) {
  const r2 = packRadius * packRadius;
  let n = 0;
  for (const other of all) {
    if (!isPullableMob(other) || other === mob || other.id === mob.id) continue;
    if (dist2(mob.x, mob.y, other.x, other.y) <= r2) n += 1;
  }
  return n;
}

/**
 * Prefer targets whose pack size matches desiredPullCount.
 * Soft-penalize denser packs (puller may still take them and FD-split).
 */
function findPullTarget(session, camp, cfg) {
  const all = liveMobs(session).filter(isPullableMob);
  const maxR2 = cfg.maxPullRadius * cfg.maxPullRadius;
  const minR2 = cfg.minPullDistance * cfg.minPullDistance;
  const want = Math.max(1, cfg.desiredPullCount || 1);
  let best = null;
  let bestScore = -Infinity;

  for (const mob of all) {
    if (mob.target && mob.target !== session) continue; // already on someone else
    const d2 = dist2(mob.x, mob.y, camp.x, camp.y);
    if (d2 > maxR2 || d2 < minR2) continue;
    const dz = Math.abs((mob.z || 0) - (camp.z || 0));
    if (dz > cfg.zRange) continue;

    const d = Math.sqrt(d2);
    const pack = neighborCount(mob, all, cfg.packRadius);
    const packSize = pack + 1;
    // Sweet spot ~mid radius; pack size near desiredPullCount favored.
    const distScore = 100 - Math.abs(d - cfg.maxPullRadius * 0.45) * 0.35;
    const packScore = 80 - Math.abs(packSize - want) * 40;
    // Extra penalty when pack is larger than we want (FD territory).
    const overPenalty = packSize > want ? (packSize - want) * 25 : 0;
    const score = distScore + packScore - overPenalty;
    if (score > bestScore) {
      bestScore = score;
      best = mob;
    }
  }
  return best;
}

function findMobById(session, id) {
  if (id == null) return null;
  return liveMobs(session).find((m) => m && m.id === id) || null;
}

function standIfNeeded(session) {
  if (Feign.isFeigned(session)) {
    Feign.breakFeign(session, 'puller_stand');
  }
  if (session.char.state === 'sitting' || session.char.state === 'medding') {
    session.char.state = 'standing';
  }
  session.sittingHold = false;
  session.holdPosition = false;
  session.restingMed = false;
}

function pathTo(session, x, y, z) {
  standIfNeeded(session);
  return Path.stepToward(session, x, y, z || session.char.z || 0, Path.pace(true));
}

function beginTag(session, mob) {
  standIfNeeded(session);
  session.combatTarget = mob;
  session.attackTarget = mob;
  session.pullTarget = mob;
  session.autoFight = true;
  session.inCombat = true;
  // Nudge hate immediately so chase starts even before the first swing lands.
  if (mob.hateList) {
    mob.hateList.addEntToHateList(session.char.name, 50, 0);
  }
  mob.target = session;
}

function stopSwinging(session) {
  session.autoFight = false;
}

function hpPct(session) {
  const maxHp = (session.effectiveStats && session.effectiveStats.hp) || session.char.maxHp || 1;
  return ((session.char.hp || 0) / maxHp) * 100;
}

function shouldEmergencyFd(session, chasing, cfg) {
  if (!Feign.canFeign(session)) return false;
  if (Feign.isFeigned(session)) return false;
  const count = chasing.length;
  if (count === 0) return false;
  if (count > cfg.maxPullCount) return true;
  if (hpPct(session) <= cfg.emergencyHpPct) return true;

  const me = session.char;
  let closest = Infinity;
  for (const m of chasing) {
    const d = dist(me.x, me.y, m.x, m.y);
    if (d < closest) closest = d;
  }
  // Classic split: too many on you and the pack is breathing down your neck.
  if (count > cfg.desiredPullCount && closest < cfg.splitClosestDist) return true;
  if (count > cfg.desiredPullCount && hpPct(session) < 80 && closest < 10) return true;
  return false;
}

function attemptFd(session, bot) {
  const result = Feign.tryFeignDeath(session);
  if (result.text && bot && typeof bot.replyGroup === 'function') {
    // Keep group chat quiet — log instead; FD spam is annoying.
  }
  if (result.text) {
    console.log(`[PULLER] ${session.char.name}: ${result.success ? 'FD ok' : (result.failText || result.text)}`);
  }
  // Surface fail/success to the puller's own combat log if available.
  try {
    const { send } = require('../../utils');
    if (session.ws && result.text) {
      send(session.ws, { type: 'CHAT', channel: 'combat', text: result.success ? result.text : (result.failText || result.text) });
    }
  } catch (_) { /* ignore */ }
  return result;
}

/**
 * Main puller tick. Returns true if it consumed the bot's action this tick.
 */
function tick(bot, session) {
  if (!session || !session.char) return false;
  if (session.casting) return false;

  const p = ensure(session);
  applyBotConfig(session, bot);
  const cfg = p.cfg;
  const camp = campAnchor(bot, session);
  const me = session.char;

  // If somehow feigned outside wait_split, recover.
  if (Feign.isFeigned(session) && p.state !== STATES.WAIT_SPLIT && p.state !== STATES.SPLIT_FD) {
    p.state = STATES.WAIT_SPLIT;
    p.waitUntil = Date.now() + cfg.fdWaitMs;
  }

  switch (p.state) {
    case STATES.IDLE: {
      if (!groupFightClear(bot, session, camp, cfg)) return false;
      // Don't leave camp while still being beaten on.
      if (chasingMobs(session).length > 0) return false;
      p.state = STATES.SCOUT;
      return true;
    }

    case STATES.SCOUT: {
      if (!groupFightClear(bot, session, camp, cfg)) {
        p.state = STATES.IDLE;
        return false;
      }
      const target = findPullTarget(session, camp, cfg);
      if (!target) {
        // Nothing to pull — hang near camp.
        const dCamp = dist(me.x, me.y, camp.x, camp.y);
        if (dCamp > cfg.campRadius * 0.6) {
          pathTo(session, camp.x, camp.y, camp.z);
          return true;
        }
        p.state = STATES.IDLE;
        return false;
      }
      p.targetId = target.id;
      p.taggedIds = [];
      p.splitAttempts = 0;
      p.state = STATES.APPROACH;
      session.pullTarget = target;
      console.log(`[PULLER] ${me.name} scouts ${target.name} (${Math.round(dist(camp.x, camp.y, target.x, target.y))}u from camp)`);
      return true;
    }

    case STATES.APPROACH: {
      const mob = findMobById(session, p.targetId);
      if (!mob || !isPullableMob(mob)) {
        resetPull(session, STATES.SCOUT);
        return true;
      }
      session.pullTarget = mob;

      const chasing = chasingMobs(session);
      if (shouldEmergencyFd(session, chasing, cfg)) {
        p.state = STATES.SPLIT_FD;
        return true;
      }

      const d = dist(me.x, me.y, mob.x, mob.y);
      if (d <= cfg.tagRange) {
        beginTag(session, mob);
        p.tagUntil = Date.now() + cfg.tagHoldMs;
        p.state = STATES.TAG;
        return true;
      }
      pathTo(session, mob.x, mob.y, mob.z);
      return true;
    }

    case STATES.TAG: {
      const mob = findMobById(session, p.targetId);
      if (!mob || !isPullableMob(mob)) {
        stopSwinging(session);
        resetPull(session, STATES.SCOUT);
        return true;
      }

      const chasing = chasingMobs(session);
      if (shouldEmergencyFd(session, chasing, cfg)) {
        stopSwinging(session);
        p.state = STATES.SPLIT_FD;
        return true;
      }

      // Stay close enough to land / keep hate for a brief window.
      const d = dist(me.x, me.y, mob.x, mob.y);
      if (d > cfg.tagRange + 4) {
        beginTag(session, mob);
        pathTo(session, mob.x, mob.y, mob.z);
        return true;
      }

      const tagged = mobChasingSession(mob, session) || Date.now() >= p.tagUntil;
      if (tagged) {
        if (!p.taggedIds.includes(mob.id)) p.taggedIds.push(mob.id);
        stopSwinging(session);
        // Keep mob on us so it follows home.
        mob.target = session;
        p.state = STATES.RETURN;
        console.log(`[PULLER] ${me.name} tagged ${mob.name}, returning to camp`);
        return true;
      }
      // Keep autoFight on until tag lands.
      session.autoFight = true;
      session.combatTarget = mob;
      return true;
    }

    case STATES.RETURN: {
      const chasing = chasingMobs(session);
      if (chasing.length === 0) {
        // Lost the pull — either leash or FD wipe without re-tag. Rescout.
        resetPull(session, STATES.SCOUT);
        return true;
      }

      if (shouldEmergencyFd(session, chasing, cfg)) {
        p.state = STATES.SPLIT_FD;
        return true;
      }

      const dCamp = dist(me.x, me.y, camp.x, camp.y);
      if (dCamp <= cfg.handoffRange) {
        p.state = STATES.HANDOFF;
        return true;
      }

      // Prefer running toward camp; keep the primary target remembered.
      const primary = findMobById(session, p.targetId) || chasing[0];
      if (primary) {
        session.combatTarget = primary;
        session.pullTarget = primary;
        stopSwinging(session);
      }
      pathTo(session, camp.x, camp.y, camp.z);
      return true;
    }

    case STATES.SPLIT_FD: {
      if (!Feign.canFeign(session)) {
        // No FD — just keep running home and hope.
        p.state = STATES.RETURN;
        return true;
      }
      if (Feign.isFeigned(session)) {
        p.state = STATES.WAIT_SPLIT;
        p.waitUntil = Date.now() + cfg.fdWaitMs;
        return true;
      }

      const result = attemptFd(session, bot);
      p.splitAttempts += 1;
      if (result.success) {
        p.state = STATES.WAIT_SPLIT;
        p.waitUntil = Date.now() + cfg.fdWaitMs;
        p.taggedIds = [];
        p.targetId = null;
        session.pullTarget = null;
        if (bot.replyGroup) {
          // silent — optional future: "splitting"
        }
        return true;
      }
      // Failed FD — keep kiting toward camp; retry later via shouldEmergencyFd.
      p.state = STATES.RETURN;
      pathTo(session, camp.x, camp.y, camp.z);
      return true;
    }

    case STATES.WAIT_SPLIT: {
      if (!Feign.isFeigned(session)) {
        // Something stood us up — evaluate.
        p.state = STATES.SCOUT;
        return true;
      }

      if (Date.now() < p.waitUntil) {
        return true; // stay down
      }

      const nearby = liveMobs(session)
        .filter(isPullableMob)
        .map((m) => ({ mob: m, d: dist(me.x, me.y, m.x, m.y) }))
        .filter((x) => x.d < cfg.packRadius * 2.5)
        .sort((a, b) => a.d - b.d);

      if (nearby.length === 0) {
        // Full reset — stand and scout from here (or return to camp first if far).
        Feign.breakFeign(session, 'split_clear');
        const dCamp = dist(me.x, me.y, camp.x, camp.y);
        if (dCamp > cfg.campRadius) {
          p.state = STATES.RETURN;
          // No chase — just walk home to rescout cleanly.
          session.pullTarget = null;
        } else {
          resetPull(session, STATES.SCOUT);
        }
        return true;
      }

      // Separated? Closest is alone-ish vs the rest of the pack.
      const closest = nearby[0];
      const second = nearby[1];
      const separated = !second || (second.d - closest.d) >= 12 || nearby.length <= cfg.desiredPullCount;

      if (separated || p.splitAttempts >= cfg.maxSplitAttempts) {
        Feign.breakFeign(session, 'split_retag');
        p.targetId = closest.mob.id;
        beginTag(session, closest.mob);
        p.tagUntil = Date.now() + cfg.tagHoldMs;
        p.state = STATES.TAG;
        console.log(`[PULLER] ${me.name} split complete — retagging ${closest.mob.name}`);
        return true;
      }

      // Still stacked — wait longer, or stand/run a few steps then FD again.
      if (p.splitAttempts < cfg.maxSplitAttempts && Feign.canFeign(session)) {
        Feign.breakFeign(session, 'split_reposition');
        // Jog slightly toward camp to stretch the pack, then FD again next ticks.
        pathTo(session, camp.x, camp.y, camp.z);
        p.state = STATES.RETURN;
        // Force another FD check quickly by leaving chase count high.
        return true;
      }

      p.waitUntil = Date.now() + Math.floor(cfg.fdWaitMs * 0.6);
      return true;
    }

    case STATES.HANDOFF: {
      const chasing = chasingMobs(session);
      stopSwinging(session);
      session.pullTarget = null;

      // Park beside the tank/camp so adds arrive on the group.
      const dCamp = dist(me.x, me.y, camp.x, camp.y);
      if (dCamp > 8) {
        pathTo(session, camp.x, camp.y, camp.z);
      }

      // Once mobs are at camp (or nothing chasing), release pull cycle.
      const atCamp = chasing.filter((m) => dist(m.x, m.y, camp.x, camp.y) <= cfg.campRadius + 10);
      if (chasing.length === 0 || atCamp.length >= Math.min(chasing.length, cfg.desiredPullCount)) {
        // Clear our self-hate preference so tank can climb.
        session.combatTarget = chasing[0] || null;
        session.autoFight = false;
        resetPull(session, STATES.IDLE);
        console.log(`[PULLER] ${me.name} handed off pull at camp`);
        return true;
      }
      return true;
    }

    default:
      p.state = STATES.IDLE;
      return false;
  }
}

function isBusy(session) {
  if (!session || !session.puller) return false;
  const s = session.puller.state;
  return s === STATES.APPROACH
    || s === STATES.TAG
    || s === STATES.RETURN
    || s === STATES.SPLIT_FD
    || s === STATES.WAIT_SPLIT
    || s === STATES.HANDOFF;
}

module.exports = {
  tick,
  ensure,
  resetPull,
  isBusy,
  STATES,
  DEFAULTS,
};
