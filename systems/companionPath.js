'use strict';

const Spatial = require('./spatial');
const State = require('../state');

const STEP = 2;
const WALK_PER_TICK = 10 * 0.2;
const RUN_PER_TICK = 10 * 2.15 * 0.2;

function pace(running) {
  return running ? RUN_PER_TICK : WALK_PER_TICK;
}

function headingOf(dx, dy) {
  let heading = (Math.atan2(dx, dy) / (2 * Math.PI)) * 512;
  if (heading < 0) heading += 512;
  return heading;
}

function broadcastMove(session) {
  const me = session.char;
  const packet = JSON.stringify({
    type: 'MOB_MOVE',
    id: `player_${me.id}`,
    x: me.x,
    y: me.y,
    z: me.z,
    heading: me.heading,
  });
  for (const other of State.sessions.values()) {
    if (!other.char || other === session || other.char.zoneId !== me.zoneId) continue;
    if (!other.ws || other.ws.readyState !== 1) continue;
    try { other.ws.send(packet); } catch (e) { /* ignore */ }
  }
}

function clearStep(zoneId, x, y, z, nx, ny, nz) {
  return Spatial.hasLineOfSight(zoneId, x, y, nx, ny, z, nz);
}

const BODY_GAP = 7;

function otherCompanions(session) {
  const me = session.char;
  const list = [];
  if (!me) return list;
  for (const other of State.sessions.values()) {
    if (!other || other === session || !other.isCompanion || !other.char) continue;
    if (other.char.zoneId !== me.zoneId) continue;
    list.push(other);
  }
  return list;
}

function nearbyBodies(session) {
  const me = session.char;
  const list = otherCompanions(session);
  if (!me) return list;
  for (const other of State.sessions.values()) {
    if (!other || !other.char || other === session || other.isCompanion || other.isBot) continue;
    if (other.char.zoneId !== me.zoneId) continue;
    list.push(other);
  }
  return list;
}

function overlapping(session) {
  const me = session && session.char;
  if (!me) return false;
  for (const other of nearbyBodies(session)) {
    if (Math.hypot(me.x - other.char.x, me.y - other.char.y) < BODY_GAP - 0.35) return true;
  }
  return false;
}

function stepsIntoBody(session, nx, ny) {
  const me = session.char;
  for (const other of nearbyBodies(session)) {
    const next = Math.hypot(nx - other.char.x, ny - other.char.y);
    if (next >= BODY_GAP) continue;
    const now = Math.hypot(me.x - other.char.x, me.y - other.char.y);
    if (next < now - 0.05) return true;
  }
  return false;
}

function standPoint(session, x, y, heading, radius) {
  const names = otherCompanions(session).map((other) => other.char.name);
  names.push(session.char.name);
  names.sort();
  const n = names.length;
  const index = Math.max(0, names.indexOf(session.char.name));
  let ring = Math.max(BODY_GAP + 1, Number(radius) || 8);
  let spread = 0;
  if (n > 1) {
    const minChord = BODY_GAP + 2;
    const arc = Math.min(Math.PI * 0.95, (n - 1) * 0.85);
    const delta = arc / (n - 1);
    const chord = 2 * ring * Math.sin(delta / 2);
    if (chord < minChord) ring = minChord / (2 * Math.sin(delta / 2));
    spread = (index - (n - 1) / 2) * delta;
  }
  const behind = ((Number(heading) || 0) / 512) * Math.PI * 2 + Math.PI;
  const ang = behind + spread;
  return {
    x: x + Math.sin(ang) * ring,
    y: y + Math.cos(ang) * ring,
  };
}

const PARK_RADIUS = 6;
const TRAVEL_WINDOW_MS = 1000;
const TRAVEL_DISTANCE = 4;

function noteAnchor(group, anchor) {
  if (!group || !anchor) return { moving: false, heading: 0 };
  const now = Date.now();
  const x = Number(anchor.x) || 0;
  const y = Number(anchor.y) || 0;
  if (group._formationHeading == null) {
    const look = Number(anchor.heading);
    group._formationHeading = Number.isFinite(look) ? look : 0;
  }
  const prev = group._anchorPose;
  if (prev && now - prev.t < 400) {
    return { moving: !!prev.moving, heading: group._formationHeading };
  }
  const trail = group._anchorTrail || [];
  trail.push({ x, y, t: now });
  while (trail.length && now - trail[0].t > TRAVEL_WINDOW_MS) trail.shift();
  group._anchorTrail = trail;
  const origin = trail[0];
  const dx = x - origin.x;
  const dy = y - origin.y;
  // Where they are looking is not travel. Turning in place used to spin the
  // stand arc, and everyone walked to the new spots.
  const moving = Math.hypot(dx, dy) >= TRAVEL_DISTANCE;
  if (moving) group._formationHeading = headingOf(dx, dy);
  group._anchorPose = { x, y, t: now, moving };
  return { moving, heading: group._formationHeading };
}

function holdFormation(session, slotX, slotY, leaderMoving) {
  if (!session || !session.char) return false;
  if (leaderMoving) {
    session._formationPark = false;
    return false;
  }
  if (session._formationPark) {
    if (overlapping(session)) settle(session);
    return true;
  }
  const dist = Math.hypot(slotX - session.char.x, slotY - session.char.y);
  if (dist <= PARK_RADIUS && !overlapping(session)) {
    session._formationPark = true;
    return true;
  }
  return false;
}

function settle(session) {
  if (!session || !session.isCompanion || !session.char) return false;
  if (session.casting || session.autoFight || session.inCombat || session.errand || session.pullTarget) return false;
  const me = session.char;
  let px = 0;
  let py = 0;
  const bodies = nearbyBodies(session);
  for (const other of bodies) {
    let dx = me.x - other.char.x;
    let dy = me.y - other.char.y;
    let dist = Math.hypot(dx, dy);
    if (dist >= BODY_GAP) continue;
    if (dist < 0.2) {
      dx = (me.id || 0) > (other.char.id || 0) ? 1 : -1;
      dy = 0;
      dist = 1;
    }
    const push = BODY_GAP - dist;
    px += (dx / dist) * push;
    py += (dy / dist) * push;
  }
  const len = Math.hypot(px, py);
  if (len < 0.4) return false;
  const step = Math.min(pace(false), len);
  return stepToward(session, me.x + (px / len) * step, me.y + (py / len) * step, me.z, step);
}

function stepToward(session, tx, ty, tz, speed) {
  const Feign = require('./feignDeath');
  if (Feign.isFeigned(session)) {
    Feign.breakFeign(session, 'move');
  }
  const me = session.char;
  const dx = tx - me.x;
  const dy = ty - me.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) {
    session._steer = 0;
    return false;
  }
  const step = Math.min(speed || STEP, dist);
  const base = Math.atan2(dy, dx);
  // Straight first. A remembered sidestep used to be tried before the direct
  // step, and a blocked tick added more angle, so bots curved away and kept going.
  const offsets = [0, 0.4, -0.4, 0.8, -0.8, 1.15, -1.15];
  const dz = Math.max(-3, Math.min(3, (Number(tz) || me.z) - me.z));
  for (const offset of offsets) {
    const ang = base + offset;
    const nx = me.x + Math.cos(ang) * step;
    const ny = me.y + Math.sin(ang) * step;
    const nz = me.z + dz;
    if (Math.hypot(tx - nx, ty - ny) >= dist - 0.05) continue;
    if (!clearStep(me.zoneId, me.x, me.y, me.z, nx, ny, nz)) continue;
    if (stepsIntoBody(session, nx, ny)) continue;
    me.x = nx;
    me.y = ny;
    me.z = nz;
    me.heading = headingOf(Math.cos(ang), Math.sin(ang));
    session._steer = 0;
    broadcastMove(session);
    return true;
  }
  session._steer = 0;
  return false;
}

function zoneLineToward(session, zoneId) {
  const Zones = require('./zones');
  const def = Zones.getZoneDef(session.char.zoneId);
  if (!def || !Array.isArray(def.zoneLines)) return null;
  return def.zoneLines.find((line) => line.target === zoneId) || null;
}

function errandPoint(session) {
  const errand = session.errand;
  if (!errand) return null;
  if (errand.zoneId === session.char.zoneId) return { x: errand.x, y: errand.y, z: errand.z, arrived: false };
  const line = zoneLineToward(session, errand.zoneId);
  if (!line) return null;
  return { x: line.x, y: line.y, z: line.z || session.char.z, arrived: false, through: errand.zoneId };
}

async function setTownErrand(session) {
  const eqemuDB = require('../eqemu_db');
  const c = session.char;
  let dest = null;
  if (c.hasBindPoint && c.bindZoneId != null && c.bindZoneId !== '') {
    dest = {
      zoneId: eqemuDB.getArchiveShortName(c.bindZoneId),
      x: Number(c.bindX) || 0,
      y: Number(c.bindY) || 0,
      z: Number(c.bindZ) || 0,
    };
  } else {
    const zone = eqemuDB.getArchiveShortName(c.zoneId);
    const succor = await eqemuDB.getZoneSuccorCoords(zone);
    if (succor) dest = { zoneId: zone, x: succor.safe_x, y: succor.safe_y, z: succor.safe_z };
  }
  if (!dest) return false;
  session.errand = dest;
  session.pullTarget = null;
  session.sittingHold = false;
  console.log(`[COMPANION] ${c.name} sets out for ${dest.zoneId} ${Math.round(dest.x)},${Math.round(dest.y)}`);
  return true;
}

function arrived(session) {
  const errand = session.errand;
  session.errand = null;
  session._steer = 0;
  const mind = require('./companionMind');
  if (errand && errand.lead) {
    mind.overhear(session, 'Place', `You have arrived at ${errand.label}. The people with you can catch up.`);
    console.log(`[COMPANION] ${session.char.name} led the way to ${errand.label}`);
    return;
  }
  const zone = State.zoneInstances && State.zoneInstances[session.char.zoneId];
  const nearby = [];
  if (zone && zone.liveMobs) {
    for (const mob of zone.liveMobs) {
      if (!mob || mob.npcType !== 'merchant') continue;
      const d = Math.hypot((mob.x || 0) - session.char.x, (mob.y || 0) - session.char.y);
      if (d < 250) nearby.push(String(mob.name || '').replace(/_/g, ' '));
    }
  }
  const names = nearby.slice(0, 6).join(', ') || 'none close by';
  mind.overhear(session, 'Town', `You have arrived. Merchants near you: ${names}. You can browse and buy with your own coin.`);
  console.log(`[COMPANION] ${session.char.name} arrived from errand`);
}

async function crossZone(session, zoneId) {
  const Movement = require('./movement');
  await Movement.handleZone(session, { zoneId, x: session.char.x, y: session.char.y, z: session.char.z });
}

const NAV_CELL = 22;

function planRoute(zoneId, x1, y1, x2, y2, avoid) {
  const dest = { x: x2, y: y2 };
  if (Spatial.hasLineOfSight(zoneId, x1, y1, x2, y2)) return [dest];
  const map = Spatial.loadZoneMap(zoneId);
  if (!map || !map.bounds) return [dest];

  const cell = (v) => Math.floor(v / NAV_CELL);
  const center = (g) => g * NAV_CELL + NAV_CELL / 2;
  const key = (gx, gy) => `${gx},${gy}`;
  const avoidSet = new Set(avoid || []);
  const sx = cell(x1);
  const sy = cell(y1);
  const gx = cell(x2);
  const gy = cell(y2);
  const minGX = Math.min(sx, gx, cell(map.bounds.minX)) - 1;
  const maxGX = Math.max(sx, gx, cell(map.bounds.maxX)) + 1;
  const minGY = Math.min(sy, gy, cell(map.bounds.minY)) - 1;
  const maxGY = Math.max(sy, gy, cell(map.bounds.maxY)) + 1;
  if ((maxGX - minGX) * (maxGY - minGY) > 250000) return [dest];

  const losCache = new Map();
  const clear = (ax, ay, bx, by) => {
    const k = `${ax.toFixed(0)},${ay.toFixed(0)}>${bx.toFixed(0)},${by.toFixed(0)}`;
    if (losCache.has(k)) return losCache.get(k);
    const ok = Spatial.hasLineOfSight(zoneId, ax, ay, bx, by);
    losCache.set(k, ok);
    return ok;
  };

  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const startKey = key(sx, sy);
  const openList = [{ gx: sx, gy: sy, g: 0, f: Math.hypot(x2 - x1, y2 - y1) }];
  const best = new Map([[startKey, 0]]);
  const came = new Map();
  let found = sx === gx && sy === gy;
  let expansions = 0;
  while (!found && openList.length && expansions < 5000) {
    let bi = 0;
    for (let i = 1; i < openList.length; i++) {
      if (openList[i].f < openList[bi].f) bi = i;
    }
    const cur = openList.splice(bi, 1)[0];
    expansions += 1;
    if (cur.gx === gx && cur.gy === gy) {
      found = true;
      break;
    }
    const fromStart = cur.gx === sx && cur.gy === sy && cur.g === 0;
    const cx = fromStart ? x1 : center(cur.gx);
    const cy = fromStart ? y1 : center(cur.gy);
    for (const [dx, dy] of dirs) {
      const nx = cur.gx + dx;
      const ny = cur.gy + dy;
      if (nx < minGX || nx > maxGX || ny < minGY || ny > maxGY) continue;
      const nk = key(nx, ny);
      if (avoidSet.has(nk)) continue;
      if (dx !== 0 && dy !== 0) {
        if (avoidSet.has(key(cur.gx + dx, cur.gy)) || avoidSet.has(key(cur.gx, cur.gy + dy))) continue;
      }
      const px = center(nx);
      const py = center(ny);
      if (!clear(cx, cy, px, py)) continue;
      if (dx !== 0 && dy !== 0 && !fromStart) {
        if (!clear(cx, cy, center(cur.gx + dx), center(cur.gy))) continue;
        if (!clear(cx, cy, center(cur.gx), center(cur.gy + dy))) continue;
      }
      const step = Math.hypot(px - cx, py - cy);
      const g = cur.g + step;
      if (g >= (best.get(nk) ?? Infinity)) continue;
      best.set(nk, g);
      came.set(nk, key(cur.gx, cur.gy));
      openList.push({ gx: nx, gy: ny, g, f: g + Math.hypot(x2 - px, y2 - py) });
    }
  }

  if (!found) return [dest];
  const cells = [];
  let walk = key(gx, gy);
  let guard = 0;
  while (walk && walk !== startKey && guard < 5000) {
    guard += 1;
    const parts = walk.split(',');
    cells.push({ x: center(Number(parts[0])), y: center(Number(parts[1])) });
    walk = came.get(walk);
  }
  cells.reverse();
  cells.push(dest);
  return smoothRoute(zoneId, [{ x: x1, y: y1 }, ...cells]);
}

function smoothRoute(zoneId, points) {
  if (points.length <= 2) return points.slice(1);
  const out = [];
  let anchor = 0;
  for (let i = 2; i < points.length; i++) {
    if (!Spatial.hasLineOfSight(zoneId, points[anchor].x, points[anchor].y, points[i].x, points[i].y)) {
      out.push(points[i - 1]);
      anchor = i - 1;
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

function nextSteerPoint(session, point) {
  const errand = session.errand;
  const me = session.char;
  if (!errand.route || errand.routeZone !== me.zoneId) {
    const started = Date.now();
    errand.route = planRoute(me.zoneId, me.x, me.y, point.x, point.y, errand.avoid);
    errand.routeZone = me.zoneId;
    errand.routeIndex = 0;
    console.log(`[COMPANION] ${me.name} route ${errand.route.length} points in ${Date.now() - started}ms`);
  }
  while (errand.routeIndex < errand.route.length) {
    const wp = errand.route[errand.routeIndex];
    if (Math.hypot(wp.x - me.x, wp.y - me.y) < 14) {
      errand.routeIndex += 1;
      continue;
    }
    return { x: wp.x, y: wp.y, z: me.z };
  }
  return { x: point.x, y: point.y, z: point.z == null ? me.z : point.z };
}

module.exports = {
  stepToward, errandPoint, setTownErrand, arrived, crossZone, pace, nextSteerPoint, planRoute,
  settle, standPoint, noteAnchor, holdFormation, overlapping,
};
