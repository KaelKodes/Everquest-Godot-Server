const { VISION_MODES, RACE_VISION, SPELL_VISION_MODES, AMBIENT_LIGHT } = require('../data/visionModes');
const Calendar = require('../data/calendar');
const ItemDB = require('../data/itemDatabase');
const State = require('../state');

function getAvailableVisionModes(session) {
  const raceVisions = RACE_VISION[session.char.race] || ['normal'];
  const modes = new Set(raceVisions);

  if (Array.isArray(session.buffs)) {
    for (const buff of session.buffs) {
      if (!Array.isArray(buff.effects)) continue;
      for (const eff of buff.effects) {
        const spellVision = SPELL_VISION_MODES[eff.spa];
        if (spellVision) modes.add(spellVision.mode);
      }
    }
  }

  return Array.from(modes);
}

function getVisionState(session, zoneDef) {
  const char = session.char;
  const isOutdoor = zoneDef && zoneDef.environment === 'outdoor';
  const season = Calendar.getSeason(State.worldCalendar.month);
  const isDay = Calendar.isDaytime(State.worldCalendar.hour, State.worldCalendar.month);

  // 1. Base ambient light from environment
  let ambientLight;
  if (isOutdoor) {
    ambientLight = isDay ? AMBIENT_LIGHT.outdoor_day : AMBIENT_LIGHT.outdoor_night;
  } else {
    ambientLight = (zoneDef && zoneDef.baseLightLevel != null)
      ? zoneDef.baseLightLevel
      : AMBIENT_LIGHT.indoor_dark;
  }

  // 1b. Apply weather light modifier
  const zoneInst = State.zoneInstances[char.zoneId];
  const zoneWeatherKey = (zoneInst && zoneInst.weather) ? zoneInst.weather.current : 'clear';
  const weatherDef = Calendar.getWeatherDef(zoneWeatherKey);
  ambientLight += weatherDef.lightModifier;

  // 1c. Moonlight bonus (outdoor night only)
  const moonState = Calendar.getMoonPhases(State.worldCalendar.totalDays);
  let moonlightBonus = 0;
  if (isOutdoor && !isDay) {
    moonlightBonus = moonState.totalMoonlight; // 0 to +3 based on phases
    ambientLight += moonlightBonus;
  }

  ambientLight = Math.max(0, ambientLight);

  // 2. Determine active vision mode
  const raceVisions = RACE_VISION[char.race] || ['normal'];
  const racialModeKey = raceVisions[0];
  const availableModes = getAvailableVisionModes(session);

  let spellModeKey = null;
  let spellBonus = 0;
  if (Array.isArray(session.buffs)) {
    for (const buff of session.buffs) {
      if (!Array.isArray(buff.effects)) continue;
      for (const eff of buff.effects) {
        const spellVision = SPELL_VISION_MODES[eff.spa];
        if (spellVision && spellVision.bonus > spellBonus) {
          spellBonus = spellVision.bonus;
          spellModeKey = spellVision.mode;
        }
      }
    }
  }

  let activeModeKey;
  if (session.activeVisionMode && availableModes.includes(session.activeVisionMode)) {
    activeModeKey = session.activeVisionMode;
  } else if (spellModeKey) {
    activeModeKey = spellModeKey;
  } else {
    activeModeKey = racialModeKey;
  }

  const mode = VISION_MODES[activeModeKey] || VISION_MODES.normal;

  // 3. Calculate base effectiveness
  let effectiveness = ambientLight;

  if (activeModeKey === 'normal') {
    // Normal vision gets no bonus
  } else if (!isOutdoor) {
    effectiveness += mode.indoorBonus;
  } else if (!isDay) {
    effectiveness += mode.nightBonus;
  }

  // 4. Equipped light sources
  let lightSourceBonus = 0;
  let hasLightSource = false;
  if (session.inventory) {
    for (const item of session.inventory) {
      if (item.equipped !== 1) continue;
      const def = ItemDB.getById(item.item_key);
      if (!def) continue;
      if (def.light && def.light > 0) {
        hasLightSource = true;
        const bonus = def.light >= 10 ? 8 : def.light >= 7 ? 5 : 3;
        lightSourceBonus = Math.max(lightSourceBonus, bonus);
      } else {
        const name = (def.name || '').toLowerCase();
        if (name.includes('torch') || name.includes('lantern') || name.includes('lightstone')) {
          hasLightSource = true;
          lightSourceBonus = Math.max(lightSourceBonus, 5);
        }
      }
    }
  }
  effectiveness += lightSourceBonus;

  // 5. Light sensitivity penalties
  let sensitivityPenalty = 0;
  if (ambientLight >= 8 && mode.brightPenalty) {
    sensitivityPenalty += mode.brightPenalty;
  }
  if (hasLightSource && mode.torchPenalty) {
    sensitivityPenalty += mode.torchPenalty;
  }
  effectiveness += sensitivityPenalty;

  effectiveness = Math.max(0, Math.min(10, effectiveness));
  const isBlind = effectiveness <= 2;

  // 6. View distance calculation
  let viewDistance = isDay ? mode.baseViewDist : mode.nightViewDist;
  viewDistance = Math.round(viewDistance * (effectiveness / 10));
  viewDistance = Math.min(viewDistance, weatherDef.viewDistCap);

  if (!isOutdoor) {
    viewDistance = Math.min(viewDistance, 3000);
  }
  viewDistance = Math.max(viewDistance, 200);

  const daylight = Calendar.getDaylightHours(State.worldCalendar.month);

  return {
    mode: activeModeKey,
    modeName: mode.name,
    renderStyle: mode.renderStyle,
    effectiveness,
    isBlind,
    viewDistance,
    ambientLight,
    sensitivityPenalty,
    timeOfDay: isDay ? 'day' : 'night',
    weather: zoneWeatherKey,
    weatherName: weatherDef.name,
    weatherIntensity: weatherDef.intensity,
    weatherRenderEffect: weatherDef.renderEffect,
    worldHour: State.worldCalendar.hour,
    isOutdoor,
    hasLightSource,
    canSeeUnlit: mode.canSeeUnlit,
    description: mode.description,
    availableModes,
    season: season.name,
    dawn: daylight.dawn,
    dusk: daylight.dusk,
    moons: {
      drinal: moonState.drinal,
      luclin: moonState.luclin,
      totalMoonlight: moonState.totalMoonlight,
      isTwinFull: moonState.isTwinFull,
    },
  };
}

module.exports = {
  getAvailableVisionModes,
  getVisionState
};
