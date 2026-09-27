'use strict';

const fs = require('fs');
const path = require('path');

function pluginsDir() {
  if (process.env.BOT_PLUGINS_DIR) return path.resolve(process.env.BOT_PLUGINS_DIR);
  return path.resolve(__dirname, '../../../bots');
}

/**
 * Read every subfolder that contains plugin.js.
 * A plugin is either `function (api) { return { id, classes, names, create } }`
 * or that object already. One broken plugin does not stop the others.
 */
function loadBotPlugins(api) {
  const dir = pluginsDir();
  const loaded = [];
  if (!fs.existsSync(dir)) {
    console.warn(`[BOTS] Plugin folder not found: ${dir}`);
    return loaded;
  }

  const names = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'plugin.js')))
    .map((entry) => entry.name)
    .sort();

  for (const name of names) {
    const entry = path.join(dir, name, 'plugin.js');
    try {
      const mod = require(entry);
      const plugin = typeof mod === 'function' ? mod(api) : mod;
      if (!plugin || typeof plugin.create !== 'function') {
        console.warn(`[BOTS] ${name} did not export create().`);
        continue;
      }
      plugin.id = plugin.id || name;
      loaded.push(plugin);
      const classes = (plugin.classes || []).join(', ') || 'no class';
      console.log(`[BOTS] Loaded ${plugin.id} for ${classes}.`);
    } catch (err) {
      console.warn(`[BOTS] Could not load ${name}: ${err.stack || err.message}`);
    }
  }

  if (loaded.length === 0) console.warn(`[BOTS] No plugins in ${dir}.`);
  return loaded;
}

module.exports = { loadBotPlugins, pluginsDir };
