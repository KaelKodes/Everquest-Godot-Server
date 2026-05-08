require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const DB = require('./db');
const engine = require('./gameEngine');

const PORT = process.env.PORT || 3005;

async function main() {
  // ── Initialize Game Engine (DB, Zones, Spells, Items) ──
  await engine.bootstrapServer();
  engine.startGameLoop();

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

  // ── Start Listening (only after everything is initialized) ──────
  server.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`  EQMUD Server running on port ${PORT}`);
    console.log(`  WebSocket: ws://localhost:${PORT}`);
    console.log(`========================================\n`);
  });

  // ── Graceful Shutdown ───────────────────────────────────────────
  async function shutdown(signal) {
    console.log(`\n[SERVER] Received ${signal}. Shutting down gracefully...`);
    try {
      // Save all active sessions
      const savePromises = [];
      for (const [ws, session] of engine.sessions) {
        if (session && session.char) {
          savePromises.push(DB.forceFlushCharacter(session.char.id));
        }
      }
      await Promise.all(savePromises);
      
      // Flush write-behind cache
      await DB.flushWriteBehindCache();
      
      console.log('[SERVER] All character data saved successfully.');
    } catch (err) {
      console.error('[SERVER] Error during shutdown:', err);
    } finally {
      process.exit(0);
    }
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
