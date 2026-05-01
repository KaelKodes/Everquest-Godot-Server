const Calendar = require('../data/calendar');
const State = require('../state');

function processEnvironment(engineCtx) {
  const { zoneInstances, sessions, getZoneDef, sendCombatLog } = engineCtx;
  const worldCalendar = State.worldCalendar;

  State.envTickCounter++;
  // Every 45 ticks (90 seconds at 2s tick) = 1 in-game hour
  if (State.envTickCounter >= 45) {
    State.envTickCounter = 0;

    // Advance the Norrathian calendar by one hour
    const calendarEvents = Calendar.advanceHour(worldCalendar);
    const currentSeason = Calendar.getMonth(worldCalendar.month).season;

    // Roll weather changes for each loaded zone
    for (const [zoneId, zone] of Object.entries(zoneInstances)) {
      if (!zone.weather) continue;
      const result = Calendar.rollWeatherChange(zone.weather, currentSeason);

      // If weather changed, notify players in that zone
      if (result && result.changed && result.message) {
        const zoneDef = zone.def || getZoneDef(zoneId);
        const isOutdoor = zoneDef && zoneDef.environment === 'outdoor';
        if (isOutdoor) {
          for (const [, session] of sessions) {
            if (session.char.zoneId === zoneId) {
              sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=gray]${result.message}[/color]` }]);
            }
          }
        }
      }
    }

    // Broadcast calendar events (dawn, dusk, new month, season changes)
    for (const evt of calendarEvents) {
      for (const [, session] of sessions) {
        const zoneDef = getZoneDef(session.char.zoneId);
        const isOutdoor = zoneDef && zoneDef.environment === 'outdoor';

        if (evt.type === 'DAWN' || evt.type === 'DUSK') {
          if (isOutdoor) {
            sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=gold]${evt.message}[/color]` }]);
          }
        } else if (evt.type === 'SEASON_CHANGE') {
          sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=cyan]${evt.message}[/color]` }]);
        } else if (evt.type === 'NEW_MONTH' || evt.type === 'NEW_YEAR') {
          sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=gray]${evt.message}[/color]` }]);
        } else if (evt.type === 'TWIN_FULL_MOON') {
          if (isOutdoor) {
            sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=gold]${evt.message}[/color]` }]);
          }
        } else if (evt.type === 'FULL_MOON' || evt.type === 'NEW_MOON') {
          if (isOutdoor) {
            sendCombatLog(session, [{ event: 'MESSAGE', text: `[color=silver]${evt.message}[/color]` }]);
          }
        }
      }
    }

    // Broadcast environment update to sync day/night cycles on clients
    const daylight = Calendar.getDaylightHours(worldCalendar.month);
    for (const [, session] of sessions) {
      if (!session.char) continue;
      session.ws.send(JSON.stringify({
        type: 'ENVIRONMENT_UPDATE',
        worldHour: worldCalendar.hour,
        dawn: daylight.dawn,
        dusk: daylight.dusk,
        season: currentSeason.name,
        moons: Calendar.getMoonPhases(worldCalendar.totalDays)
      }));
    }
  }
}

module.exports = {
  processEnvironment
};
