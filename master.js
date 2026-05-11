require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');

// Public hostname/IP that we advertise to *remote clients* in HANDOFF packets.
// On a dev box hosting only local connections this stays as 'localhost'.
// On the public/LAN tester host, set PUBLIC_HOST in .env to e.g. 24.33.88.252
// (WAN) or 192.168.1.51 (LAN). Whatever IP testers will type into the client
// is what belongs here.
const PUBLIC_HOST = process.env.PUBLIC_HOST || 'localhost';

// Cluster ports, env-overridable so multiple deployments can coexist behind
// one WAN IP. Defaults match the original "stable" range (3005–3011) used by
// Erollisi Marr. Override per-machine in .env, e.g. on Mithaniel Marr:
//   PORT_LOGIN=4005  PORT_WORLD=4006  PORT_TUNARE=4010  PORT_INNORUUK=4011
const PORT_LOGIN    = parseInt(process.env.PORT_LOGIN    || '3005', 10);
const PORT_WORLD    = parseInt(process.env.PORT_WORLD    || '3006', 10);
const PORT_TUNARE   = parseInt(process.env.PORT_TUNARE   || '3010', 10);
const PORT_INNORUUK = parseInt(process.env.PORT_INNORUUK || '3011', 10);

const servers = [
  { name: 'LOGIN', script: 'login_server.js', port: PORT_LOGIN },
  { name: 'WORLD', script: 'world_server.js', port: PORT_WORLD },

  // Two "god" nodes. They dynamically load zones on-demand, but ownership is fixed by continent.
  { name: 'TUNARE',   script: 'zone_server.js', port: PORT_TUNARE,   env: { NODE: 'tunare' } },
  { name: 'INNORUUK', script: 'zone_server.js', port: PORT_INNORUUK, env: { NODE: 'innoruuk' } },
];

const children = new Set();

function buildNodeUrls() {
  const urls = {};
  for (const s of servers) {
    if (s.script !== 'zone_server.js') continue;
    const node = (s.env && s.env.NODE) ? s.env.NODE : null;
    if (!node) continue;
    urls[node] = `ws://${PUBLIC_HOST}:${s.port}`;
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
  const defaultZoneUrl = nodeUrls.tunare || Object.values(nodeUrls)[0] || `ws://${PUBLIC_HOST}:${PORT_TUNARE}`;

  // Login server uses WORLD_URL to tell clients where to handoff after login.
  // Auto-derive it from PUBLIC_HOST + PORT_WORLD so remote clients don't get
  // told to connect to ws://localhost. An explicit WORLD_URL in .env wins.
  const worldUrl = process.env.WORLD_URL || `ws://${PUBLIC_HOST}:${PORT_WORLD}`;

  const childEnv = {
    ...process.env,
    PORT: config.port,
    NODE_URLS: JSON.stringify(nodeUrls),
    CONTINENT_NODE_MAP: JSON.stringify(continentNodeMap),
    ZONE_URL_DEFAULT: defaultZoneUrl,
    WORLD_URL: worldUrl,
    PUBLIC_HOST,
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
console.log(`[MASTER] Advertised public host: ${PUBLIC_HOST}`);
if (PUBLIC_HOST === 'localhost') {
  console.log('[MASTER] (Set PUBLIC_HOST in .env to your LAN/WAN IP to allow remote clients.)');
}

servers.forEach(startServer);
