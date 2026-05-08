require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const DB = require('./db');
const broker = require('./network/broker');
const tokenManager = require('./network/tokenManager');

const PORT = process.env.PORT || 3006;

async function main() {
  await DB.initDatabase();
  await broker.init();

  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    console.log(`[WORLD] Client connected.`);

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        await handleMessage(ws, msg);
      } catch (err) {
        console.error('[WORLD] Error:', err.message);
      }
    });

    ws.on('close', () => {
        // Handle disconnect
    });
  });

  async function handleMessage(ws, msg) {
    if (msg.type === 'TOKEN_LOGIN') {
        const data = await tokenManager.verifyToken(msg.token);
        if (!data) {
            return ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid or expired token' }));
        }

        console.log(`[WORLD] ${data.characterName} authenticated via token.`);
        
        // Fetch character data to find zone
        const character = await DB.getCharacter(data.characterName);
        if (!character) {
            return ws.send(JSON.stringify({ type: 'ERROR', message: 'Character data not found' }));
        }

        const zoneId = character.zoneId || 'gfaydark';

        // For now, let's assume a single zone server on port 3010
        // In the future, master.js will tell us where each zone is.
        const zoneUrl = process.env.ZONE_URL || 'ws://localhost:3010';

        // Handoff to Zone Server
        const zoneToken = await tokenManager.generateToken(data);
        
        ws.send(JSON.stringify({
            type: 'HANDOFF',
            token: zoneToken,
            url: zoneUrl
        }));
        
        console.log(`[WORLD] Handoff to Zone (${zoneId}) generated for ${data.characterName}`);
    }
  }

  server.listen(PORT, () => {
    console.log(`[WORLD] World Server listening on port ${PORT}`);
  });
}

main().catch(console.error);
