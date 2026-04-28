// ── Norrath Calendar & Weather System ────────────────────────────────
// 
// Calendar based on EQ2's Norrathian calendar with 12 months, 4 seasons,
// and 10-day weeks. Time runs on EQ's accelerated clock:
//   3 real minutes = 1 game hour
//  72 real minutes = 1 game day (24 game hours)
//  ~3.6 real days  = 1 game month (28 game days)
//  ~43 real days   = 1 game year (12 months × 28 days = 336 game days)
//
// Weather is per-zone, driven by zone climate + season. Each zone has
// its own weather state that transitions gradually with atmospheric messages.
// ────────────────────────────────────────────────────────────────────

// ── Days of the Week (10-day Norrathian week) ───────────────────────
const DAYS_OF_WEEK = [
  'Feastday',   // 0 - Rest / holiday
  'Darkday',    // 1 - Start of work week
  'Burnday',    // 2 - Burning day
  'Soulday',    // 3 - Remembrance
  'Windday',    // 4 - Caravanning / industry
  'Steelday',   // 5 - Forges and crafting
  'Spryday',    // 6 - Commerce / busiest
  'Moorday',    // 7 - Shipping / docks
  'Brewday',    // 8 - Merchants / trading
  'Mirthday',   // 9 - End of work, celebration
];

// ── Months & Seasons ────────────────────────────────────────────────
// 12 months, 28 days each (336-day year). Each has a season.
const MONTHS = [
  { name: 'Deepice',     season: 'winter',  index: 0  },  // Jan - Deep winter
  { name: 'Grayeven',    season: 'winter',  index: 1  },  // Feb - Late winter
  { name: 'Stargazing',  season: 'spring',  index: 2  },  // Mar - Early spring
  { name: 'Weeping',     season: 'spring',  index: 3  },  // Apr - Spring rains
  { name: 'Blossoming',  season: 'spring',  index: 4  },  // May - Full bloom
  { name: 'Oceansfull',  season: 'summer',  index: 5  },  // Jun - Early summer
  { name: 'Scorchedsky', season: 'summer',  index: 6  },  // Jul - Peak heat
  { name: 'Warmstill',   season: 'summer',  index: 7  },  // Aug - Late summer
  { name: 'Busheldown',  season: 'autumn',  index: 8  },  // Sep - Harvest begins
  { name: 'Lastleaf',    season: 'autumn',  index: 9  },  // Oct - Leaves falling
  { name: 'Fenin',       season: 'autumn',  index: 10 },  // Nov - Late autumn
  { name: 'Deadening',   season: 'winter',  index: 11 },  // Dec - Winter returns
];

const DAYS_PER_MONTH = 28;
const MONTHS_PER_YEAR = 12;
const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR; // 336
const DAYS_PER_WEEK = 10;

// ── Moons of Norrath ────────────────────────────────────────────────
// Norrath has two moons:
//   Drinal  — "The Silver Reaper". The visible white moon, associated
//             with death and werewolves. 28-day cycle (synced to months).
//   Luclin  — "The Hidden Moon". Normally veiled by magic but in our
//             world we make it faintly visible. 14-day cycle (faster,
//             smaller). Occasionally both moons are full simultaneously.
//
// Moon phase affects nighttime ambient light:
//   New moon  = +0 (darkest nights)
//   Crescent  = +1
//   Half      = +1
//   Gibbous   = +2
//   Full      = +3 (brightest nights)
//
// When BOTH moons are full at once = "Twin Full" event (+4 total).
// This happens every 28 days (LCM of 28 and 14).

const MOONS = {
  drinal: {
    name: 'Drinal',
    title: 'The Silver Reaper',
    cycleDays: 28,        // One full cycle per month
    offset: 0,            // Starts at new moon on day 0
    maxLight: 2,          // +2 ambient light at full moon
    color: 'silver',
    description: 'The pale disc of Drinal hangs in the sky.',
  },
  luclin: {
    name: 'Luclin',
    title: 'The Veiled Moon',
    cycleDays: 14,        // Faster cycle — two cycles per month
    offset: 7,            // Offset so it starts at half when Drinal is new
    maxLight: 1,          // +1 ambient light at full (smaller, dimmer)
    color: 'pale blue',
    description: 'The faint shimmer of Luclin pierces its magical veil.',
  },
};

// Moon phase names (8-phase cycle)
const MOON_PHASES = [
  { name: 'New',              icon: '🌑', lightFraction: 0.0  },
  { name: 'Waxing Crescent',  icon: '🌒', lightFraction: 0.25 },
  { name: 'First Quarter',    icon: '🌓', lightFraction: 0.5  },
  { name: 'Waxing Gibbous',   icon: '🌔', lightFraction: 0.75 },
  { name: 'Full',             icon: '🌕', lightFraction: 1.0  },
  { name: 'Waning Gibbous',   icon: '🌖', lightFraction: 0.75 },
  { name: 'Last Quarter',     icon: '🌗', lightFraction: 0.5  },
  { name: 'Waning Crescent',  icon: '🌘', lightFraction: 0.25 },
];

// ── Seasons ─────────────────────────────────────────────────────────
// Each season affects daylight hours and base temperature.
const SEASONS = {
  spring: {
    name: 'Spring',
    dawnHour: 5,          // Earlier sunrise
    duskHour: 20,         // Later sunset
    tempModifier: 0,      // Baseline
    precipChance: 0.25,   // Moderate rain chance
    description: 'The air smells of fresh growth.',
  },
  summer: {
    name: 'Summer',
    dawnHour: 4,          // Earliest sunrise
    duskHour: 21,         // Latest sunset
    tempModifier: 2,      // Hotter
    precipChance: 0.15,   // Less rain (except tropical)
    description: 'The sun beats down with relentless heat.',
  },
  autumn: {
    name: 'Autumn',
    dawnHour: 6,          // Standard
    duskHour: 18,         // Earlier sunset
    tempModifier: -1,     // Cooling
    precipChance: 0.20,   // Moderate
    description: 'A chill breeze carries the scent of fallen leaves.',
  },
  winter: {
    name: 'Winter',
    dawnHour: 7,          // Latest sunrise
    duskHour: 17,         // Earliest sunset
    tempModifier: -3,     // Cold
    precipChance: 0.30,   // More precipitation (snow/rain)
    description: 'The cold bites at exposed skin.',
  },
};

// ── Zone Climate Types ──────────────────────────────────────────────
// Determines which weather events can occur in a zone and their
// relative probability. Each climate defines a weather pool.
const CLIMATES = {
  // Temperate forests, plains, hills (most Antonica zones)
  temperate: {
    name: 'Temperate',
    weatherPool: {
      spring: ['clear', 'cloudy', 'rain', 'light_rain', 'fog'],
      summer: ['clear', 'clear', 'cloudy', 'light_rain', 'rain'],
      autumn: ['clear', 'cloudy', 'fog', 'light_rain', 'rain'],
      winter: ['clear', 'cloudy', 'snow', 'light_snow', 'fog'],
    },
    defaultWeather: 'clear',
  },

  // Cold regions (Everfrost, Permafrost, Halas)
  arctic: {
    name: 'Arctic',
    weatherPool: {
      spring: ['clear', 'cloudy', 'light_snow', 'snow', 'fog'],
      summer: ['clear', 'cloudy', 'light_rain', 'fog', 'light_snow'],
      autumn: ['cloudy', 'snow', 'light_snow', 'blizzard', 'fog'],
      winter: ['snow', 'light_snow', 'blizzard', 'blizzard', 'cloudy'],
    },
    defaultWeather: 'light_snow',
  },

  // Hot dry regions (Ro desert, Lavastorm)
  arid: {
    name: 'Arid',
    weatherPool: {
      spring: ['clear', 'clear', 'clear', 'cloudy', 'dust'],
      summer: ['clear', 'clear', 'clear', 'clear', 'dust'],
      autumn: ['clear', 'clear', 'cloudy', 'dust', 'light_rain'],
      winter: ['clear', 'clear', 'cloudy', 'light_rain', 'fog'],
    },
    defaultWeather: 'clear',
  },

  // Jungles, swamps (Feerrott, Innothule)
  tropical: {
    name: 'Tropical',
    weatherPool: {
      spring: ['rain', 'heavy_rain', 'cloudy', 'fog', 'clear'],
      summer: ['heavy_rain', 'rain', 'rain', 'cloudy', 'fog'],
      autumn: ['rain', 'cloudy', 'fog', 'heavy_rain', 'clear'],
      winter: ['cloudy', 'light_rain', 'rain', 'fog', 'clear'],
    },
    defaultWeather: 'cloudy',
  },

  // Underground / indoor zones (dungeons, caves)
  underground: {
    name: 'Underground',
    weatherPool: {
      spring: ['none', 'none', 'none', 'none', 'dripping'],
      summer: ['none', 'none', 'none', 'none', 'dripping'],
      autumn: ['none', 'none', 'none', 'none', 'dripping'],
      winter: ['none', 'none', 'none', 'none', 'dripping'],
    },
    defaultWeather: 'none',
  },

  // Coastal zones (Ocean of Tears, Erud's Crossing)
  coastal: {
    name: 'Coastal',
    weatherPool: {
      spring: ['clear', 'cloudy', 'fog', 'rain', 'light_rain'],
      summer: ['clear', 'clear', 'cloudy', 'light_rain', 'fog'],
      autumn: ['cloudy', 'fog', 'rain', 'heavy_rain', 'clear'],
      winter: ['cloudy', 'fog', 'rain', 'heavy_rain', 'snow'],
    },
    defaultWeather: 'cloudy',
  },
};

// ── Weather Types ───────────────────────────────────────────────────
// Each weather type defines its visual/gameplay impact.
const WEATHER_TYPES = {
  none: {
    name: 'None',
    intensity: 0,
    lightModifier: 0,       // No effect on ambient light
    viewDistCap: 15000,     // No cap
    movementPenalty: 0,     // No movement slowdown
    renderEffect: 'none',  // No particle effect
    soundLoop: null,
    transitionIn: null,     // No transition message (underground)
    transitionOut: null,
  },
  clear: {
    name: 'Clear',
    intensity: 0,
    lightModifier: 0,
    viewDistCap: 15000,
    movementPenalty: 0,
    renderEffect: 'none',
    soundLoop: null,
    transitionIn: 'The skies clear and the sun shines through.',
    transitionOut: null,
  },
  cloudy: {
    name: 'Cloudy',
    intensity: 0,
    lightModifier: -1,      // Slightly dimmer
    viewDistCap: 12000,     // Slight haze
    movementPenalty: 0,
    renderEffect: 'overcast',
    soundLoop: null,
    transitionIn: 'Clouds gather overhead, dimming the light.',
    transitionOut: 'The clouds begin to break apart.',
  },
  fog: {
    name: 'Fog',
    intensity: 1,
    lightModifier: -2,      // Noticeably dimmer
    viewDistCap: 1500,      // Severely limited
    movementPenalty: 0,
    renderEffect: 'fog',
    soundLoop: null,
    transitionIn: 'A thick fog rolls in, obscuring the landscape.',
    transitionOut: 'The fog begins to lift.',
  },
  dust: {
    name: 'Dust Storm',
    intensity: 1,
    lightModifier: -2,
    viewDistCap: 2000,      // Dust obscures vision
    movementPenalty: 0.1,   // 10% slower movement
    renderEffect: 'dust',
    soundLoop: 'wind_howl',
    transitionIn: 'The wind picks up, kicking sand and dust into the air.',
    transitionOut: 'The dust settles and the air clears.',
  },
  light_rain: {
    name: 'Light Rain',
    intensity: 1,
    lightModifier: -1,
    viewDistCap: 10000,
    movementPenalty: 0,
    renderEffect: 'rain_light',
    soundLoop: 'rain_light',
    transitionIn: 'A light drizzle begins to fall.',
    transitionOut: 'The drizzle tapers off.',
  },
  rain: {
    name: 'Rain',
    intensity: 2,
    lightModifier: -2,
    viewDistCap: 6000,
    movementPenalty: 0.05,  // 5% slower
    renderEffect: 'rain',
    soundLoop: 'rain',
    transitionIn: 'Rain begins to pour from the darkened sky.',
    transitionOut: 'The rain eases to a drizzle.',
  },
  heavy_rain: {
    name: 'Heavy Rain',
    intensity: 3,
    lightModifier: -3,
    viewDistCap: 3000,      // Torrential rain
    movementPenalty: 0.1,   // 10% slower
    renderEffect: 'rain_heavy',
    soundLoop: 'rain_heavy',
    transitionIn: 'A torrential downpour hammers the ground. Lightning flashes in the distance.',
    transitionOut: 'The downpour weakens to a steady rain.',
  },
  light_snow: {
    name: 'Light Snow',
    intensity: 1,
    lightModifier: 0,       // Snow reflects light — not much dimmer
    viewDistCap: 8000,
    movementPenalty: 0.05,  // 5% slower
    renderEffect: 'snow_light',
    soundLoop: 'wind_light',
    transitionIn: 'Gentle snowflakes begin to drift down from the sky.',
    transitionOut: 'The snowfall slows to a stop.',
  },
  snow: {
    name: 'Snow',
    intensity: 2,
    lightModifier: -1,
    viewDistCap: 4000,
    movementPenalty: 0.1,   // 10% slower
    renderEffect: 'snow',
    soundLoop: 'wind',
    transitionIn: 'Snow falls heavily, blanketing the ground in white.',
    transitionOut: 'The snow lightens to scattered flurries.',
  },
  blizzard: {
    name: 'Blizzard',
    intensity: 3,
    lightModifier: -3,
    viewDistCap: 1000,      // Near-whiteout
    movementPenalty: 0.2,   // 20% slower
    renderEffect: 'blizzard',
    soundLoop: 'wind_howl',
    transitionIn: 'A howling blizzard descends! Visibility drops to almost nothing.',
    transitionOut: 'The blizzard weakens. You can see shapes through the snow again.',
  },
  dripping: {
    name: 'Dripping',
    intensity: 0,
    lightModifier: 0,
    viewDistCap: 3000,
    movementPenalty: 0,
    renderEffect: 'drip',   // Occasional water droplet particles
    soundLoop: 'drip',
    transitionIn: 'Water drips steadily from the ceiling above.',
    transitionOut: 'The dripping fades to silence.',
  },
};

// ── Calendar State ──────────────────────────────────────────────────
// Tracks the current date. Advanced by processEnvironment().
// Starting date: 1st of Stargazing (spring), Year 3100 of the Age of Turmoil.

const DEFAULT_CALENDAR = {
  year: 3100,
  month: 2,       // Stargazing (index 2, spring)
  day: 1,         // 1st of the month
  hour: 8,        // 8 AM
  totalDays: 0,   // Running total for day-of-week calculation
};

// ── Helper Functions ────────────────────────────────────────────────

/**
 * Get the current month definition.
 */
function getMonth(monthIndex) {
  return MONTHS[monthIndex % MONTHS_PER_YEAR];
}

/**
 * Get the current season definition.
 */
function getSeason(monthIndex) {
  const month = getMonth(monthIndex);
  return SEASONS[month.season];
}

/**
 * Get the day-of-week name from total elapsed days.
 */
function getDayOfWeek(totalDays) {
  return DAYS_OF_WEEK[totalDays % DAYS_PER_WEEK];
}

/**
 * Check if a given hour is daytime based on the current season.
 */
function isDaytime(hour, monthIndex) {
  const season = getSeason(monthIndex);
  return hour >= season.dawnHour && hour < season.duskHour;
}

/**
 * Get daylight hours for the current season (for client rendering).
 */
function getDaylightHours(monthIndex) {
  const season = getSeason(monthIndex);
  return { dawn: season.dawnHour, dusk: season.duskHour };
}

/**
 * Calculate the current phase of a moon based on total elapsed days.
 * Returns { name, icon, lightFraction, phaseIndex }.
 */
function getMoonPhase(moonKey, totalDays) {
  const moon = MOONS[moonKey];
  if (!moon) return MOON_PHASES[0];
  const dayInCycle = ((totalDays + moon.offset) % moon.cycleDays + moon.cycleDays) % moon.cycleDays;
  const phaseIndex = Math.floor((dayInCycle / moon.cycleDays) * 8) % 8;
  return { ...MOON_PHASES[phaseIndex], phaseIndex };
}

/**
 * Get the state of both moons for a given day.
 * Returns an object with each moon's phase and the combined moonlight bonus.
 */
function getMoonPhases(totalDays) {
  const drinal = getMoonPhase('drinal', totalDays);
  const luclin = getMoonPhase('luclin', totalDays);

  // Moonlight bonus = sum of each moon's contribution
  const drinalLight = Math.round(drinal.lightFraction * MOONS.drinal.maxLight);
  const luclinLight = Math.round(luclin.lightFraction * MOONS.luclin.maxLight);
  const totalMoonlight = drinalLight + luclinLight;

  // Twin Full — both moons full simultaneously
  const isTwinFull = drinal.name === 'Full' && luclin.name === 'Full';

  return {
    drinal: {
      name: MOONS.drinal.name,
      phase: drinal.name,
      icon: drinal.icon,
      light: drinalLight,
      color: MOONS.drinal.color,
    },
    luclin: {
      name: MOONS.luclin.name,
      phase: luclin.name,
      icon: luclin.icon,
      light: luclinLight,
      color: MOONS.luclin.color,
    },
    totalMoonlight,
    isTwinFull,
  };
}

/**
 * Get the nighttime ambient light bonus from the current moon phases.
 * Only applies at night (caller should check isDaytime).
 */
function getMoonlightBonus(totalDays) {
  const moons = getMoonPhases(totalDays);
  return moons.totalMoonlight;
}

/**
 * Format the current date as a readable string.
 * e.g., "Steelday, the 15th of Blossoming, 3100 A.T."
 */
function formatDate(calendar) {
  const month = getMonth(calendar.month);
  const dayName = getDayOfWeek(calendar.totalDays);
  const daySuffix = getOrdinalSuffix(calendar.day);
  return `${dayName}, the ${calendar.day}${daySuffix} of ${month.name}, ${calendar.year} A.T.`;
}

/**
 * Format just the time.
 * e.g., "14:00" or "2 PM"
 */
function formatTime(hour) {
  if (hour === 0 || hour === 24) return '12:00 AM';
  if (hour === 12) return '12:00 PM';
  if (hour < 12) return `${hour}:00 AM`;
  return `${hour - 12}:00 PM`;
}

function getOrdinalSuffix(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

/**
 * Advance the calendar by one hour. Returns events that occurred.
 */
function advanceHour(calendar) {
  const events = [];
  const prevHour = calendar.hour;
  const prevMonth = calendar.month;

  calendar.hour = (calendar.hour + 1) % 24;

  // Check for dawn/dusk transitions
  const season = getSeason(calendar.month);
  if (prevHour === season.dawnHour - 1 && calendar.hour === season.dawnHour) {
    events.push({ type: 'DAWN', message: 'The sun rises over the horizon.' });
  }
  if (prevHour === season.duskHour - 1 && calendar.hour === season.duskHour) {
    events.push({ type: 'DUSK', message: 'The sun sets, and darkness spreads across the land.' });
  }

  // Day rollover at midnight
  if (calendar.hour === 0) {
    calendar.day++;
    calendar.totalDays++;

    // ── Moon phase events (check at start of night) ──
    const moons = getMoonPhases(calendar.totalDays);
    if (moons.isTwinFull) {
      events.push({
        type: 'TWIN_FULL_MOON',
        message: 'Both Drinal and Luclin burn full and bright above! The twin moons bathe the land in brilliant silver light.',
      });
    } else if (moons.drinal.phase === 'Full') {
      events.push({
        type: 'FULL_MOON',
        moon: 'drinal',
        message: 'Drinal the Silver Reaper hangs full and heavy in the night sky.',
      });
    } else if (moons.drinal.phase === 'New') {
      events.push({
        type: 'NEW_MOON',
        moon: 'drinal',
        message: 'Drinal is dark tonight. The shadows deepen.',
      });
    }

    // Month rollover
    if (calendar.day > DAYS_PER_MONTH) {
      calendar.day = 1;
      calendar.month = (calendar.month + 1) % MONTHS_PER_YEAR;

      const newMonth = getMonth(calendar.month);
      const newSeason = getSeason(calendar.month);
      events.push({
        type: 'NEW_MONTH',
        message: `The month of ${newMonth.name} begins. ${newSeason.description}`,
      });

      // Season change check
      if (getMonth(prevMonth).season !== newMonth.season) {
        events.push({
          type: 'SEASON_CHANGE',
          season: newMonth.season,
          message: `The season turns to ${newSeason.name}.`,
        });
      }

      // Year rollover
      if (calendar.month === 0) {
        calendar.year++;
        events.push({
          type: 'NEW_YEAR',
          message: `A new year dawns: ${calendar.year} A.T.`,
        });
      }
    }
  }

  return events;
}

// ── Per-Zone Weather State ──────────────────────────────────────────

/**
 * Create a new weather state for a zone.
 */
function createZoneWeather(climate) {
  const climateDef = CLIMATES[climate] || CLIMATES.temperate;
  return {
    climate: climate,
    current: climateDef.defaultWeather,
    previous: climateDef.defaultWeather,
    transitionTimer: 0,    // Ticks until next potential weather change
    stormDuration: 0,      // How many more hours this weather persists
  };
}

/**
 * Roll for a weather change based on zone climate and current season.
 * Returns { weather, changed, message } or null.
 */
function rollWeatherChange(zoneWeather, season) {
  const climateDef = CLIMATES[zoneWeather.climate] || CLIMATES.temperate;
  const pool = climateDef.weatherPool[season] || [climateDef.defaultWeather];
  const seasonDef = SEASONS[season] || SEASONS.spring;

  // Don't change weather while a storm is still ongoing
  if (zoneWeather.stormDuration > 0) {
    zoneWeather.stormDuration--;
    return null;
  }

  // Chance to change weather each tick
  if (Math.random() > seasonDef.precipChance + 0.10) {
    return null; // No change this tick
  }

  // Pick a new weather from the season pool
  const newWeather = pool[Math.floor(Math.random() * pool.length)];

  // Don't "change" to the same weather
  if (newWeather === zoneWeather.current) return null;

  const oldType = WEATHER_TYPES[zoneWeather.current] || WEATHER_TYPES.clear;
  const newType = WEATHER_TYPES[newWeather] || WEATHER_TYPES.clear;

  // Set storm duration based on intensity (more intense = longer lasting)
  zoneWeather.stormDuration = newType.intensity >= 3 ? 3 + Math.floor(Math.random() * 4)  // 3-6 hours
                            : newType.intensity >= 2 ? 2 + Math.floor(Math.random() * 3)  // 2-4 hours
                            : newType.intensity >= 1 ? 1 + Math.floor(Math.random() * 2)  // 1-2 hours
                            : 0;

  // Build transition message
  let message = null;
  if (newType.transitionIn) {
    message = newType.transitionIn;
  } else if (oldType.transitionOut) {
    message = oldType.transitionOut;
  }

  zoneWeather.previous = zoneWeather.current;
  zoneWeather.current = newWeather;

  return { weather: newWeather, changed: true, message };
}

/**
 * Get the current weather definition for a zone.
 */
function getWeatherDef(weatherKey) {
  return WEATHER_TYPES[weatherKey] || WEATHER_TYPES.clear;
}

// ── Exports ─────────────────────────────────────────────────────────

module.exports = {
  // Calendar
  DAYS_OF_WEEK,
  MONTHS,
  SEASONS,
  DAYS_PER_MONTH,
  DAYS_PER_WEEK,
  DAYS_PER_YEAR,
  MONTHS_PER_YEAR,
  DEFAULT_CALENDAR,
  getMonth,
  getSeason,
  getDayOfWeek,
  isDaytime,
  getDaylightHours,
  formatDate,
  formatTime,
  advanceHour,

  // Moons
  MOONS,
  MOON_PHASES,
  getMoonPhase,
  getMoonPhases,
  getMoonlightBonus,

  // Weather
  CLIMATES,
  WEATHER_TYPES,
  createZoneWeather,
  rollWeatherChange,
  getWeatherDef,
};
