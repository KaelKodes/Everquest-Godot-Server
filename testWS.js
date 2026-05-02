const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:3005');

ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'LOGIN', username: 'test', password: 'password' }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('Received:', msg.type);
    
    if (msg.type === 'WELCOME') {
        ws.send(JSON.stringify({ type: 'REQUEST_CHAR_CREATE_DATA', raceId: 330 }));
    }
    else if (msg.type === 'CHAR_CREATE_DATA') {
        console.log('FACES M:', msg.faceCountMale, 'F:', msg.faceCountFemale);
        process.exit(0);
    }
});

ws.on('error', (err) => {
    console.log('Error:', err.message);
    process.exit(1);
});
