/**
 * FollowingSystem
 * Manages player-following-player logic and breadcrumb trails.
 */

const { send } = require('../utils');
const State = require('../state');

const FOLLOW_STOP_RADIUS = 10; // Stop moving if this close
const FOLLOW_RESUME_RADIUS = 18; // Resume moving if target moves further than this
const BREADCRUMB_DISTANCE = 5; // Distance between trail points
const MAX_BREADCRUMBS = 50;

let sendCombatLogFn, broadcastEntityStateFn, handleStandFn;

function init(deps) {
  sendCombatLogFn = deps.sendCombatLog;
  broadcastEntityStateFn = deps.broadcastEntityState;
  handleStandFn = deps.handleStand;
}

/**
 * Updates breadcrumbs for a session. Called every tick for all active players.
 */
function updateBreadcrumbs(session) {
  if (!session.char || session.isBot) return;

  if (!session.breadcrumbs) {
    session.breadcrumbs = [];
  }

  const char = session.char;
  const last = session.breadcrumbs[session.breadcrumbs.length - 1];

  // Only drop breadcrumb if moved enough or no breadcrumbs exist
  if (!last || getDistanceSq(char.x, char.y, last.x, last.y) > BREADCRUMB_DISTANCE * BREADCRUMB_DISTANCE) {
    session.breadcrumbs.push({
      x: char.x,
      y: char.y,
      z: char.z,
      zoneId: char.zoneId,
      time: Date.now()
    });

    if (session.breadcrumbs.length > MAX_BREADCRUMBS) {
      session.breadcrumbs.shift();
    }
  }
}

/**
 * Handles the /follow command logic.
 */
function handleFollow(session, msg) {
  const char = session.char;
  const target = session.combatTarget;

  if (!target) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You must have a target to follow.' }]);
    return;
  }

  // Target must be a player session
  let targetSession = null;
  if (target.char) {
    // It's a player session already (if combatTarget is another session)
    targetSession = target;
  } else {
    // If combatTarget is just a mob object, it might be a player's mob proxy
    // We need to find the session
    for (const [, s] of State.sessions) {
      if (s.char && (s.char.id === target.id || `player_${s.char.id}` === target.id)) {
        targetSession = s;
        break;
      }
    }
  }

  if (!targetSession || targetSession === session) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You can only follow other players.' }]);
    return;
  }

  if (targetSession.char.zoneId !== char.zoneId) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'Your target is not in this zone.' }]);
    return;
  }

  const distSq = getDistanceSq(char.x, char.y, targetSession.char.x, targetSession.char.y);
  if (distSq > 200 * 200) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'Your target is too far away to follow.' }]);
    return;
  }

  session.followingTarget = targetSession;
  session.isMovingToFollow = false;
  sendCombatLog(session, [{ event: 'MESSAGE', text: `You are now following ${targetSession.char.name}.` }]);
}

/**
 * Process follow movement for a session.
 */
function processFollowTick(session, dt) {
  if (!session.followingTarget || !session.followingTarget.char) return;

  const target = session.followingTarget;
  const me = session.char;

  if (target.char.zoneId !== me.zoneId) {
    breakFollow(session, "You have lost your target (zone change).");
    return;
  }

  const dx = target.char.x - me.x;
  const dy = target.char.y - me.y;
  const distSq = dx * dx + dy * dy;

  // Distance check for breaking follow (too far)
  if (distSq > 500 * 500) {
    breakFollow(session, "You have lost your target (too far).");
    return;
  }

  // Toggle movement state based on radius
  if (distSq > FOLLOW_RESUME_RADIUS * FOLLOW_RESUME_RADIUS) {
    if (!session.isMovingToFollow) {
      session.isMovingToFollow = true;
      // Standing up if sitting/medding
      if (me.state === 'sitting' || me.state === 'medding') {
        me.state = 'standing';
        if (handleStandFn) handleStandFn(session);
      }
    }
  } else if (distSq < FOLLOW_STOP_RADIUS * FOLLOW_STOP_RADIUS) {
    session.isMovingToFollow = false;
    return;
  }

  if (!session.isMovingToFollow) return;

  // Breadcrumb logic: find the oldest breadcrumb that is further than STOP_RADIUS
  let nextPoint = null;
  if (target.breadcrumbs && target.breadcrumbs.length > 0) {
    for (const point of target.breadcrumbs) {
      const pdx = point.x - me.x;
      const pdy = point.y - me.y;
      if (pdx * pdx + pdy * pdy > FOLLOW_STOP_RADIUS * FOLLOW_STOP_RADIUS) {
        nextPoint = point;
        break;
      }
    }
  }

  // If no breadcrumb is far enough, or no breadcrumbs, just go to target directly
  if (!nextPoint) {
    nextPoint = target.char;
  }

  const ndx = nextPoint.x - me.x;
  const ndy = nextPoint.y - me.y;
  const ndist = Math.sqrt(ndx * ndx + ndy * ndy);

  if (ndist > 0) {
    // Use effective speed if available, or base run speed
    const speed = (session.effectiveStats && session.effectiveStats.speedMod) ? (25.0 * session.effectiveStats.speedMod) : 25.0;
    const moveDist = Math.min(speed * dt, ndist);

    const angle = Math.atan2(ndy, ndx);
    me.x += Math.cos(angle) * moveDist;
    me.y += Math.sin(angle) * moveDist;
    me.z = nextPoint.z;

    // Heading calculation (0-511)
    let heading = (Math.atan2(ndx, ndy) / (2 * Math.PI)) * 512;
    if (heading < 0) heading += 512;
    me.heading = heading;

    // Send position to the follower's client
    if (session.ws) {
      send(session.ws, {
        type: 'TELEPORT',
        x: me.x,
        y: me.y,
        z: me.z,
        heading: me.heading,
        zoneId: me.zoneId
      });
    }

    // Broadcast movement to others
    if (broadcastEntityStateFn) {
      broadcastEntityStateFn(session, 'MOB_MOVE', {
        x: me.x,
        y: me.y,
        z: me.z,
        heading: me.heading,
        hasLightSource: me.hasLightSource
      });
    }
  }
}

function breakFollow(session, reason) {
  if (!session.followingTarget) return;
  
  const targetName = session.followingTarget.char ? session.followingTarget.char.name : "target";
  session.followingTarget = null;
  session.isMovingToFollow = false;
  
  if (session.ws) {
    const text = reason ? `You stop following ${targetName}. (${reason})` : `You stop following ${targetName}.`;
    sendCombatLog(session, [{ event: 'MESSAGE', text }]);
  }
}

function getDistanceSq(x1, y1, x2, y2) {
  return (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
}

function sendCombatLog(session, events) {
  if (sendCombatLogFn) sendCombatLogFn(session, events);
}

module.exports = {
  init,
  updateBreadcrumbs,
  handleFollow,
  processFollowTick,
  breakFollow
};
