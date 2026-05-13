const Calendar = require('./data/calendar');

module.exports = {
  sessions: new Map(), // ws -> session
  sessionsByZone: new Map(), // zoneId -> Set(session)
  authSessions: new Map(), // ws -> { accountId, accountName }
  zoneInstances: {},
  worldCalendar: { ...Calendar.DEFAULT_CALENDAR },
  envTickCounter: 0
};
