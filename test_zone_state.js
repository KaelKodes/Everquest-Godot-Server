// Connect to server and dump the ZONE_STATE payload to see actual mob data
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000');

ws.on('open', () => {
  console.log('Connected');
  ws.send(JSON.stringify({ type: 'LOGIN', name: 'TestDump' }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'ZONE_STATE') {
    console.log('\n=== ZONE_STATE ===');
    console.log(`Entities: ${msg.entities.length}`);
    for (const e of msg.entities) {
      console.log(`  ${e.name} (${e.id}): x=${e.x}, y=${e.y}, type=${e.type}`);
    }
    ws.close();
    process.exit(0);
  }
});

ws.on('error', (err) => {
  console.error('Connection failed:', err.message);
  console.log('Make sure the game is running first!');
  process.exit(1);
});

setTimeout(() => { console.log('Timeout - no ZONE_STATE received'); process.exit(1); }, 5000);
