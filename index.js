const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const DB = require('./db');
const engine = require('./gameEngine');

const PORT = process.env.PORT || 3005;

async function main() {
  // ── Initialize Database ─────────────────────────────────────────
  await DB.initDatabase();

  // ── Express Setup ───────────────────────────────────────────────
  const app = express();
  const server = http.createServer(app);

  app.get('/', (req, res) => {
    res.json({
      name: 'EQMUD Server',
      status: 'online',
      players: engine.sessions.size,
    });
  });

  // ── WebSocket Setup ─────────────────────────────────────────────
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    console.log(`[SERVER] Client connected. (${wss.clients.size} total)`);

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        await engine.handleMessage(ws, msg);
      } catch (err) {
        console.error('[SERVER] Bad message:', err.message);
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid message format.' }));
      }
    });

    ws.on('close', () => {
      engine.removeSession(ws);
      console.log(`[SERVER] Client disconnected. (${wss.clients.size} total)`);
    });

    ws.on('error', (err) => {
      console.error('[SERVER] WebSocket error:', err.message);
    });

    ws.send(JSON.stringify({
      type: 'WELCOME',
      message: 'Welcome to EverQuest MUD!',
    }));
  });

  // ── Start Everything ──────────────────────────────────────────────
  await engine.initZones();
  engine.startGameLoop();

  server.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`  EQMUD Server running on port ${PORT}`);
    console.log(`  WebSocket: ws://localhost:${PORT}`);
    console.log(`========================================\n`);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
