require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const DB = require('./db');
const engine = require('./gameEngine');
const broker = require('./network/broker');
const tokenManager = require('./network/tokenManager');

const PORT = process.env.PORT || 3010;
// Zone server can be passed a list of zones via environment or command line
// e.g. ZONES=gfaydark,kelethin
const ZONE_LIST = (process.env.ZONES || '').split(',').filter(z => z);

async function main() {
  await engine.bootstrapServer();
  await broker.init();

  // Initialize only requested zones (we need to update engine.initZones to support this)
  await engine.initZones(ZONE_LIST.length > 0 ? ZONE_LIST : null);
  engine.startGameLoop();

  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    console.log(`[ZONE] Client connected.`);

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        
        // Handle Token Login for handoff
        if (msg.type === 'TOKEN_LOGIN') {
            await handleTokenLogin(ws, msg);
            return;
        }

        await engine.handleMessage(ws, msg);
      } catch (err) {
        console.error('[ZONE] Error:', err.message);
      }
    });

    ws.on('close', () => {
      engine.removeSession(ws);
    });
  });

  async function handleTokenLogin(ws, msg) {
      const data = await tokenManager.verifyToken(msg.token);
      if (!data) {
          return ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid or expired token' }));
      }

      console.log(`[ZONE] ${data.characterName} entering zone via token.`);
      
      // Inject session into game engine
      // We need to simulate the login logic but using the token data
      await engine.handleManualLogin(ws, data);
  }

  server.listen(PORT, () => {
    console.log(`[ZONE] Zone Server listening on port ${PORT} for zones: ${ZONE_LIST.join(', ') || 'ALL'}`);
  });
}

main().catch(console.error);
