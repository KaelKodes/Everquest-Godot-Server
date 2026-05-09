const { spawn } = require('child_process');
const path = require('path');

const servers = [
  { name: 'LOGIN', script: 'login_server.js', port: 3005 },
  { name: 'WORLD', script: 'world_server.js', port: 3006 },

  // Two "god" nodes. They dynamically load zones on-demand, but ownership is fixed by continent.
  { name: 'TUNARE', script: 'zone_server.js', port: 3010, env: { NODE: 'tunare' } },
  { name: 'INNORUUK', script: 'zone_server.js', port: 3011, env: { NODE: 'innoruuk' } },
];

const children = new Set();

function buildNodeUrls() {
  const urls = {};
  for (const s of servers) {
    if (s.script !== 'zone_server.js') continue;
    const node = (s.env && s.env.NODE) ? s.env.NODE : null;
    if (!node) continue;
    urls[node] = `ws://localhost:${s.port}`;
  }
  return urls;
}

function buildContinentNodeMap() {
  const map = {};
  for (const s of servers) {
    if (s.script !== 'zone_server.js') continue;
    // Deprecated: routing is DB-backed now
  }
  return map;
}

function startServer(config) {
  console.log(`[MASTER] Starting ${config.name} on port ${config.port}...`);
  
  const nodeUrls = buildNodeUrls();
  const continentNodeMap = buildContinentNodeMap();
  const defaultZoneUrl = nodeUrls.tunare || Object.values(nodeUrls)[0] || 'ws://localhost:3010';
  const childEnv = { 
    ...process.env, 
    PORT: config.port,
    NODE_URLS: JSON.stringify(nodeUrls),
    CONTINENT_NODE_MAP: JSON.stringify(continentNodeMap),
    ZONE_URL_DEFAULT: defaultZoneUrl,
    ...config.env 
  };

  const child = spawn('node', [config.script], {
    cwd: __dirname,
    env: childEnv,
    stdio: 'pipe'
  });

  children.add(child);

  child.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      if (line.trim()) console.log(`[${config.name}] ${line.trim()}`);
    });
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      if (line.trim()) console.error(`[${config.name}] ${line.trim()}`);
    });
  });

  child.on('exit', (code) => {
    children.delete(child);
    if (code !== 0 && code !== null) {
        console.error(`[MASTER] ${config.name} exited with code ${code}. Restarting in 5s...`);
        setTimeout(() => startServer(config), 5000);
    }
  });
}

function shutdown() {
    console.log('\n[MASTER] Shutting down cluster...');
    for (const child of children) {
        child.kill('SIGINT');
    }
    setTimeout(() => process.exit(0), 2000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('========================================');
console.log('       EQMUD CLUSTER MASTER BOOT        ');
console.log('========================================');

servers.forEach(startServer);
