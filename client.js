const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000');

ws.on('open', () => {
    console.log("Connected. Sending LOGIN.");
    ws.send(JSON.stringify({ type: 'LOGIN', name: 'ERES' }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.type === 'STATUS') {
        process.exit(0);
    }
});
