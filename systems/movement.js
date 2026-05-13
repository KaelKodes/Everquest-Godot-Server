const { send } = require('../utils');
const DB = require('../db');
const State = require('../state');
const combat = require('../combat');
const { zoneInstances, sessions } = State;

function getZoneDef(zoneId) {
  return module.exports.getZoneDefFn ? module.exports.getZoneDefFn(zoneId) : null;
}
function handleStopCombat(session) {
  return module.exports.handleStopCombatFn ? module.exports.handleStopCombatFn(session) : null;
}
function despawnPet(session, msg) {
  return module.exports.despawnPetFn ? module.exports.despawnPetFn(session, msg) : null;
}
function flushSkillUps(session) {
  if (module.exports.flushSkillUpsFn) module.exports.flushSkillUpsFn(session);
}
function sendCombatLog(session, events) {
  return module.exports.sendCombatLogFn ? module.exports.sendCombatLogFn(session, events) : null;
}
function broadcastEntityState(session, type, payload) {
  return module.exports.broadcastEntityStateFn ? module.exports.broadcastEntityStateFn(session, type, payload) : null;
}
async function ensureZoneLoaded(zoneKey) {
  if (module.exports.ensureZoneLoadedFn) return module.exports.ensureZoneLoadedFn(zoneKey);
}
function sendStatus(session) {
  if (module.exports.sendStatusFn) return module.exports.sendStatusFn(session);
}
function interruptCasting(session, message) {
  if (module.exports.interruptCastingFn) return module.exports.interruptCastingFn(session, message);
}
function handleStand(session) {
  if (module.exports.handleStandFn) return module.exports.handleStandFn(session);
}

function init(deps) {
  module.exports.getZoneDefFn = deps.getZoneDef;
  module.exports.handleStopCombatFn = deps.handleStopCombat;
  module.exports.despawnPetFn = deps.despawnPet;
  module.exports.flushSkillUpsFn = deps.flushSkillUps;
  module.exports.sendCombatLogFn = deps.sendCombatLog;
  module.exports.broadcastEntityStateFn = deps.broadcastEntityState;
  module.exports.ensureZoneLoadedFn = deps.ensureZoneLoaded;
  module.exports.sendStatusFn = deps.sendStatus;
  module.exports.interruptCastingFn = deps.interruptCasting;
  module.exports.handleStandFn = deps.handleStand;
  module.exports.sendFullStateFn = deps.sendFullState;
}

function handleSwimTick(session, msg) {
  if (session && session.char) {
    session.isInWater = true;
    combat.trySkillUp(session, 'swimming');
  }
}

async function handleZone(session, msg) {
  const currentZone = session.char.zoneId;
  const targetZone = DB.getArchiveShortName(msg.zoneId);

  // Zone transition cooldown — prevent instant bounce-back between adjacent zones
  const now = Date.now();
  if (session.lastZoneTime && (now - session.lastZoneTime) < 3000) {
    return; // Silently ignore rapid zone requests
  }

  const zoneDef = getZoneDef(currentZone);
  const zoneLine = zoneDef && zoneDef.zoneLines && zoneDef.zoneLines.find(zl => zl.target === targetZone);

  if (!zoneLine) {
    return sendCombatLog(session, [{ event: 'MESSAGE', text: 'You cannot go that way.' }]);
  }

  try {
    const SpellSystem = require('./spells');
    SpellSystem.cancelPendingScribe(session, 'zone', false);
    SpellSystem.cancelPendingMemorize(session, 'zone', false);
  } catch (_) { /* ignore */ }

  handleStopCombat(session);
  // Despawn pet on zone transition (P99: pets don't zone)
  if (session.pet) {
    despawnPet(session, 'Your pet could not follow you.');
  }
  session.lastZoneTime = now;

  // Dynamically load the target zone if needed
  await ensureZoneLoaded(targetZone);

  session.char.zoneId = targetZone;

  const newZoneDef = getZoneDef(targetZone);
  session.char.roomId = (newZoneDef && newZoneDef.defaultRoom) || '';
  
  // Use the zone_point's target coordinates for spawn position
  // 999999 means "keep the player's current coordinate on that axis"
  let spawnX = zoneLine.targetX || 0;
  let spawnY = zoneLine.targetY || 0;
  let spawnZ = zoneLine.targetZ || 0;

  if (spawnX > 900000) spawnX = session.char.x || 0;
  if (spawnY > 900000) spawnY = session.char.y || 0;
  if (spawnZ > 900000) spawnZ = session.char.z || 0;

  session.char.x = spawnX;
  session.char.y = spawnY;
  session.char.z = spawnZ;

  DB.saveCharacterLocation(session.char.id, targetZone, spawnX, spawnY, spawnZ);
  session.pendingTeleport = { x: spawnX, y: spawnY, z: spawnZ }; // Client handles its own safety boost and snapping
  session.loginFreeze = Date.now() + 5000; // Freeze movement updates after zoning
  
  // Force a full flush on zoning to prevent "ghost zoning" rollbacks
  DB.forceFlushCharacter(session.char.id);

  const zoneName = (newZoneDef && newZoneDef.name) || targetZone;
  sendCombatLog(session, [{ event: 'MESSAGE', text: `You have entered ${zoneName}.` }]);
  sendStatus(session);
}

function handleUpdatePos(session, msg) {
  if (session.char) {
    if (session.loginFreeze && Date.now() < session.loginFreeze) {
      return; // Ignore movement updates while login/zone freeze is active
    }

    if (session.tickDistance === undefined) session.tickDistance = 0;
    
    const now = Date.now();
    let dx = 0, dy = 0, dz = 0;

    // msg.z from client is the EQ Z coordinate (height)
    const clientZ = msg.z != null ? msg.z : (session.char.z || 0);

    // Movement Validation (Anti-Cheat / Speed Hack Prevention)
    if (session.char.x != null && session.char.y != null) {
      dx = (msg.x != null ? msg.x : session.char.x) - session.char.x;
      dy = (msg.y != null ? msg.y : session.char.y) - session.char.y;
      dz = clientZ - (session.char.z || 0);

      // Update session state (SOURCE OF TRUTH)
      session.char.x = msg.x != null ? msg.x : session.char.x;
      session.char.y = msg.y != null ? msg.y : session.char.y;
      session.char.z = clientZ;
      session.char.heading = msg.heading != null ? msg.heading : (session.char.heading || 0);
      session.char.hasLightSource = msg.hasLightSource != null ? msg.hasLightSource : session.char.hasLightSource;

      // Broadcast player movement to others in the zone AFTER updating session.char
      // so spatial culling distance checks use the new coordinates.
      broadcastEntityState(session, 'MOB_MOVE', {
        x: session.char.x,
        y: session.char.y,
        z: session.char.z,
        heading: session.char.heading,
        hasLightSource: session.char.hasLightSource
      });
      
      const distSq = dx * dx + dy * dy; // Horizontal distance only
      
      // Calculate allowable distance based on time delta
      // Max expected speed (e.g. Bard/Mount) is roughly 60 units/sec
      const dt = session.lastMoveTime ? (now - session.lastMoveTime) / 1000.0 : 0;
      
      // Bypass GM accounts from rubberbanding (EQEmu convention: status >= 200 == GM)
      const auth = State.authSessions.get(session.ws);
      const isGM = !!(auth && (auth.status || 0) >= 200);

      // Slightly higher dt floor reduces false positives from bursty client frames / WebSocket batching.
      if (dt > 0.07 && !isGM) {
        // Allow a generous buffer for lag spikes (e.g., 2 seconds of buffered movement max)
        const maxDt = Math.min(dt, 2.0);
        // ~Run speed 7–14 in classic units/sec depending on rules; mounts/SOW higher — keep headroom.
        const maxHorizSpeed = 72.0;
        const maxSpeedSq = (maxHorizSpeed * maxDt) * (maxHorizSpeed * maxDt);

        // Upward Z only (downward is gravity / falling). Client spawn, stairs, lifts, and Godot↔EQ
        // height fixes can legitimately jump tens of units while HorizDistSq ≈ 0 — use a floor so
        // we do not rubberband every login when mesh Z disagrees slightly with DB Z.
        const maxUpwardDz = Math.max(55.0 * maxDt, 36.0);

        if (dt < 10.0 && (distSq > maxSpeedSq || dz > maxUpwardDz)) {
          if (!session._rubberbandLogAt || now - session._rubberbandLogAt > 2500) {
            session._rubberbandLogAt = now;
            console.log(`[ENGINE] Rubberbanding ${session.char.name} (Speed hack or heavy lag detected). HorizDistSq: ${distSq.toFixed(1)}, dz: ${dz.toFixed(1)}, Dt: ${dt.toFixed(2)}`);
          }
          if (session.ws) {
            session.ws.send(JSON.stringify({
              type: 'TELEPORT',
              x: session.char.x,
              y: session.char.y,
              z: session.char.z,
              heading: session.char.heading,
              zoneId: session.char.zoneId
            }));
          }
          return; // Reject movement
        }
      }
    }

    session.lastMoveTime = now;
    session.tickDistance += Math.sqrt(dx*dx + dy*dy);

    // Movement breaks sitting/medding
    if (dx !== 0 || dy !== 0 || dz !== 0) {
      if (session.char.state === 'sitting' || session.char.state === 'medding') {
        handleStand(session);
      }
    }

    // Movement interrupts casting
    if (session.casting && session.casting.startPos) {
      const isBardSong = session.casting.spellDef?.derived?.isBardSong === true;
      const cdx = session.char.x - session.casting.startPos.x;
      const cdy = session.char.y - session.casting.startPos.y;
      const cdistSq = cdx * cdx + cdy * cdy;
      if (cdistSq > 25 && !isBardSong) { // Small threshold to avoid jitter false-positives
        interruptCasting(session, 'Your spell is interrupted!');
      }
    }
  }
}

function handleUpdateSneak(session, msg) {
  if (!session.char) return;
  const char = session.char;

  // Turning sneak OFF
  if (!msg.sneaking) {
    const wasSneaking = char.isSneaking;
    const wasHidden = char.isHidden;
    char.isSneaking = false;
    // Turning off sneak also breaks hide
    if (wasHidden) {
      char.isHidden = false;
      broadcastEntityState(session, 'ENTITY_HIDE', { hidden: false });
    }
    broadcastEntityState(session, 'ENTITY_SNEAK', { sneaking: false });
    // Only show "stop sneaking" if they were actually sneaking (had the skill)
    if (wasSneaking) {
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'You stop sneaking.' }]);
    }
    return;
  }

  // Turning sneak ON — skill check
  const sneakSkill = combat.getCharSkill(char, 'sneak');
  if (sneakSkill <= 0) {
    // No sneak skill — still allow the crouch visual, just no stealth benefit
    // Don't spam "You do not have the Sneak skill" every time they press Ctrl
    broadcastEntityState(session, 'ENTITY_SNEAK', { sneaking: true });
    return;
  }

  // Cooldown check (10s on failure)
  if (!session.skillCooldowns) session.skillCooldowns = {};
  if (session.skillCooldowns.sneak > 0) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You must wait before sneaking again.' }]);
    send(session.ws, { type: 'SNEAK_RESULT', success: false });
    return;
  }

  // Skill check: higher skill = better chance. At 200 skill, near-guaranteed.
  const successChance = Math.min(95, sneakSkill * 0.5 + 5);
  const succeeded = Math.random() * 100 < successChance;

  if (succeeded) {
    char.isSneaking = true;
    combat.trySkillUp(session, 'sneak');

    // Rogue gets explicit success message
    if (char.class === 'rogue') {
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'You are as quiet as a cat stalking its prey.' }]);
    } else {
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'You begin to move silently.' }]);
    }
    broadcastEntityState(session, 'ENTITY_SNEAK', { sneaking: true });
    send(session.ws, { type: 'SNEAK_RESULT', success: true });
  } else {
    // Failed — 10s cooldown
    session.skillCooldowns.sneak = 10;
    if (char.class === 'rogue') {
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'You are as quiet as a herd of stampeding elephants.' }]);
    } else {
      // Non-rogues don't get explicit failure message (authentic behavior)
      // but we still need to tell the client it failed
    }
    send(session.ws, { type: 'SNEAK_RESULT', success: false });
  }

  // Send skill-up messages if any
  flushSkillUps(session);
}

function handleHide(session, msg) {
  if (!session.char) return;
  const char = session.char;

  // Turning hide OFF
  if (msg && msg.hiding === false) {
    char.isHidden = false;
    broadcastEntityState(session, 'ENTITY_HIDE', { hidden: false });
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You are no longer hidden.' }]);
    send(session.ws, { type: 'HIDE_RESULT', success: false, action: 'off' });
    return;
  }

  // Turning hide ON — skill check
  const hideSkill = combat.getCharSkill(char, 'hide');
  if (hideSkill <= 0) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You do not have the Hide skill.' }]);
    send(session.ws, { type: 'HIDE_RESULT', success: false });
    return;
  }

  // Cooldown check (10s reuse)
  if (!session.skillCooldowns) session.skillCooldowns = {};
  if (session.skillCooldowns.hide > 0) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You must wait before hiding again.' }]);
    send(session.ws, { type: 'HIDE_RESULT', success: false });
    return;
  }

  // Skill check
  const successChance = Math.min(95, hideSkill * 0.5 + 5);
  const succeeded = Math.random() * 100 < successChance;

  if (succeeded) {
    char.isHidden = true;
    combat.trySkillUp(session, 'hide');

    if (char.class === 'rogue') {
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'You have hidden yourself from view.' }]);
    }
    // Non-rogues: no explicit success message (authentic — you see yourself hide but don't know if it worked)
    broadcastEntityState(session, 'ENTITY_HIDE', { hidden: true });
    send(session.ws, { type: 'HIDE_RESULT', success: true });
  } else {
    session.skillCooldowns.hide = 10;
    if (char.class === 'rogue') {
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'You failed to hide yourself.' }]);
    }
    send(session.ws, { type: 'HIDE_RESULT', success: false });
  }

  flushSkillUps(session);
}

function breakSneak(session) {
  if (!session.char || !session.char.isSneaking) return;
  session.char.isSneaking = false;
  broadcastEntityState(session, 'ENTITY_SNEAK', { sneaking: false });
  sendCombatLog(session, [{ event: 'MESSAGE', text: 'Your sneaking has been interrupted!' }]);
  send(session.ws, { type: 'SNEAK_BROKEN' });
}

function breakHide(session) {
  if (!session.char || !session.char.isHidden) return;
  session.char.isHidden = false;
  broadcastEntityState(session, 'ENTITY_HIDE', { hidden: false });
  sendCombatLog(session, [{ event: 'MESSAGE', text: 'You are no longer hidden.' }]);
  send(session.ws, { type: 'HIDE_BROKEN' });
}

function handleTeleporterPad(session, door) {
  let destZone = session.char.zoneId;
  let destX = door.dest_x || 0;
  let destY = door.dest_y || 0;
  let destZ = door.dest_z || 0;

  // Fallback for broken DB entries where dest is 0,0,0 (like Felwitheb caster portals)
  if (destX === 0 && destY === 0) {
    if (session.char.zoneId === 'felwitheb') {
      if (door.pos_z > -2) {
        // Upper pad, send to lower pad
        destX = -841; destY = 415; destZ = -7;
      } else {
        // Lower pad, send to upper pad
        destX = -841; destY = 510; destZ = 0;
      }
    } else {
      // Unknown teleporter, ignore to prevent getting stuck
      return;
    }
  }

  // Prevent instant re-teleporting when arriving at the destination pad
  session.teleportCooldown = true;
  setTimeout(() => { session.teleportCooldown = false; }, 3000);

  sendCombatLog(session, [{ event: 'MESSAGE', text: '[color=cyan]You feel yourself being pulled through space...[/color]' }]);

  session.char.x = destX;
  session.char.y = destY;
  session.char.z = destZ;

  // Force the client to update their position
  send(session.ws, {
    type: 'TELEPORT',
    zoneId: destZone,
    x: destX,
    y: destY,
    z: destZ
  });
}

/**
 * GM: teleport to PEQ zone succor (safe_x/safe_y/safe_z). Uses same client path as bind respawn.
 * @param {string} zoneArg EQ `zone.short_name` (e.g. cshome, qeytoqrg) or internal key resolvable via ZONES.
 */
async function adminGotoZoneSuccor(session, zoneArg) {
  const char = session.char;
  const raw = (zoneArg || '').trim().toLowerCase();
  if (!raw) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'Usage: /zone <shortname> — PEQ zone short_name (e.g. cshome, qeytoqrg).' }]);
    return;
  }

  const ZoneSystem = require('./zones');
  const eqemuDB = require('../eqemu_db');
  const zoneKey = ZoneSystem.resolveZoneKey(raw);
  const archiveShort = DB.getArchiveShortName(zoneKey);
  let def = ZoneSystem.getZoneDef(archiveShort);
  let dbShort = (def && def.shortName) ? def.shortName : archiveShort;

  let coords = await eqemuDB.getZoneSuccorCoords(dbShort);
  if (!coords && dbShort !== raw) {
    coords = await eqemuDB.getZoneSuccorCoords(raw);
    if (coords) dbShort = raw;
  }
  if (!coords) {
    sendCombatLog(session, [{ event: 'MESSAGE', text: `No succor row in PEQ zone table for '${raw}' (short_name).` }]);
    return;
  }

  try {
    const SpellSystem = require('./spells');
    SpellSystem.cancelPendingScribe(session, 'zone', false);
    SpellSystem.cancelPendingMemorize(session, 'zone', false);
  } catch (_) { /* ignore */ }

  handleStopCombat(session);
  if (session.pet) {
    despawnPet(session, 'Your pet could not follow you.');
  }

  session.lastZoneTime = Date.now();

  await ensureZoneLoaded(archiveShort);
  def = ZoneSystem.getZoneDef(archiveShort);
  if (def && def.shortName) dbShort = def.shortName;

  char.zoneId = archiveShort;
  char.roomId = (def && def.defaultRoom) || '';
  char.x = coords.safe_x;
  char.y = coords.safe_y;
  char.z = coords.safe_z;

  DB.saveCharacterLocation(char.id, archiveShort, char.x, char.y, char.z);
  session.pendingTeleport = { x: char.x, y: char.y, z: char.z };
  session.loginFreeze = Date.now() + 5000;
  DB.forceFlushCharacter(char.id);

  const sendFullState = module.exports.sendFullStateFn;
  if (sendFullState) {
    sendFullState(session, { forceZoneSync: true });
  } else {
    sendStatus(session);
  }

  const zname = (def && def.name) || dbShort;
  sendCombatLog(session, [{ event: 'MESSAGE', text: `[GM] Zoned to ${zname} (${dbShort}) succor.` }]);
}

async function handleSuccor(session) {
  const char = session.char;

  try {
    const eqemuDB = require('../eqemu_db');
    const zoneDef = getZoneDef(char.zoneId);
    const dbShort = zoneDef && zoneDef.shortName
      ? String(zoneDef.shortName).toLowerCase()
      : String(char.zoneId).toLowerCase();

    const safe = await eqemuDB.getZoneSuccorCoords(dbShort);
    if (!safe) {
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'No safe point found for this zone.' }]);
      return;
    }

    console.log(`[ENGINE] Succor: ${char.name} teleporting to safe point (${safe.safe_x}, ${safe.safe_y}, ${safe.safe_z}) in ${dbShort}`);

    char.x = safe.safe_x;
    char.y = safe.safe_y;
    char.z = safe.safe_z;

    send(session.ws, {
      type: 'TELEPORT',
      x: char.x,
      y: char.y,
      z: char.z,
    });

    sendCombatLog(session, [{ event: 'MESSAGE', text: 'You have been transported to safety.' }]);
  } catch (e) {
    console.error('[ENGINE] Succor error:', e.message);
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'Succor failed.' }]);
  }
}

/**
 * GM: succor everyone in the leader's group who is in the same zone (online clients only).
 */
async function handleGmGroupSuccor(session) {
  const char = session.char;
  try {
    const eqemuDB = require('../eqemu_db');
    const zoneDef = getZoneDef(char.zoneId);
    const dbShort = zoneDef && zoneDef.shortName
      ? String(zoneDef.shortName).toLowerCase()
      : String(char.zoneId).toLowerCase();
    const safe = await eqemuDB.getZoneSuccorCoords(dbShort);
    if (!safe) {
      sendCombatLog(session, [{ event: 'MESSAGE', text: 'No safe point found for this zone.' }]);
      return;
    }
    const zoneId = char.zoneId;
    const group = session.group;
    const members = (group && group.members && group.members.length > 0)
      ? group.members
      : [session];
    const moved = [];
    for (const m of members) {
      if (!m || !m.char || !m.ws) continue;
      if (m.char.zoneId !== zoneId) continue;
      m.char.x = safe.safe_x;
      m.char.y = safe.safe_y;
      m.char.z = safe.safe_z;
      send(m.ws, { type: 'TELEPORT', x: m.char.x, y: m.char.y, z: m.char.z });
      sendCombatLog(m, [{ event: 'MESSAGE', text: 'You have been transported to safety. (Group succor)' }]);
      moved.push(m.char.name);
    }
    sendCombatLog(session, [{ event: 'MESSAGE', text: `[GM] Group succor in ${dbShort}: ${moved.length} member(s) — ${moved.join(', ')}` }]);
  } catch (e) {
    console.error('[ENGINE] GM group succor error:', e.message);
    sendCombatLog(session, [{ event: 'MESSAGE', text: 'Group succor failed.' }]);
  }
}


function handleJump(session) {
  if (!session || !session.char) return;

  // Jumping breaks sitting/medding
  if (session.char.state === 'sitting' || session.char.state === 'medding') {
    handleStand(session);
  }

  if (session.char.fatigue === undefined) session.char.fatigue = 0;
  
  let staMod = 150.0 / (100.0 + (session.effectiveStats && session.effectiveStats.sta ? session.effectiveStats.sta : 100));
  let cost = 4.0 * staMod;
  
  session.char.fatigue += cost;
  if (session.char.fatigue > 100) session.char.fatigue = 100;
}

module.exports = {
  handleZone,
  handleUpdatePos,
  handleUpdateSneak,
  handleHide,
  handleSwimTick,
  handleJump,
  breakSneak,
  breakHide,
  handleTeleporterPad,
  handleSuccor,
  handleGmGroupSuccor,
  adminGotoZoneSuccor,
  init,
};
