const { spawn } = require('child_process');
const path = require('path');

const servers = [
  { name: 'LOGIN', script: 'login_server.js', port: 3005 },
  { name: 'WORLD', script: 'world_server.js', port: 3006 },
  { name: 'ZONE_GFAY', script: 'zone_server.js', port: 3010, env: { ZONES: 'gfaydark,kelethin,crushbone' } },
  { name: 'ZONE_BUTCHER', script: 'zone_server.js', port: 3011, env: { ZONES: 'butcher,felwithea,felwitheb' } }
];

const children = new Set();

function startServer(config) {
  console.log(`[MASTER] Starting ${config.name} on port ${config.port}...`);
  
  const childEnv = { 
    ...process.env, 
    PORT: config.port,
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
