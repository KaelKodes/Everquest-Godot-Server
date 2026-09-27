'use strict';

const { buildBotApi } = require('./botApi');
const { loadBotPlugins } = require('./pluginHost');

let api = null;
let plugins = null;

function ensureLoaded() {
  if (plugins) return;
  api = buildBotApi();
  plugins = loadBotPlugins(api);
}

function matches(list, value) {
  const want = String(value || '').toLowerCase();
  if (!want) return false;
  return (list || []).some((item) => String(item).toLowerCase() === want);
}

/**
 * Class brain for a bot session. A named plugin wins over a class plugin.
 * A class with no plugin follows and meds, and does not borrow another class.
 */
function createClassBot(session) {
  ensureLoaded();
  const char = session && session.char;
  const named = plugins.find((plugin) => matches(plugin.names, char && char.name));
  const picked = named || plugins.find((plugin) => matches(plugin.classes, char && char.class));
  if (picked) return picked.create(session, api);
  return new api.BaseBot(session);
}

module.exports = { createClassBot };
