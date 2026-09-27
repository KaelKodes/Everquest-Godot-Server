'use strict';

function lazy(load) {
  let value;
  let ready = false;
  return () => {
    if (!ready) {
      value = load();
      ready = true;
    }
    return value;
  };
}

/**
 * What a bot plugin is allowed to use. Add a field here when a plugin needs
 * a new server capability. Plugins should not require server files themselves.
 */
function buildBotApi() {
  const slots = {
    BaseBot: lazy(() => require('./baseBot')),
    spells: lazy(() => require('./botSpellUtils')),
    Camp: lazy(() => require('./campControl')),
    Puller: lazy(() => require('./puller')),
    State: lazy(() => require('../../state')),
    combat: lazy(() => require('../../combat')),
    chat: lazy(() => require('../chat')),
    groups: lazy(() => require('../groups')),
    oocRegen: lazy(() => require('../oocRegen')),
    movement: lazy(() => require('../movement')),
    path: lazy(() => require('../companionPath')),
    facing: lazy(() => require('./facing')),
  };

  const api = {};
  for (const key of Object.keys(slots)) {
    Object.defineProperty(api, key, {
      enumerable: true,
      get: slots[key],
    });
  }
  return api;
}

module.exports = { buildBotApi };
