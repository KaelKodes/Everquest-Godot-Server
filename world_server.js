require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const DB = require('./db');
const broker = require('./network/broker');
const tokenManager = require('./network/tokenManager');
const zoneRouter = require('./network/zoneRouter');

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

        // Always route off the canonical PEQ short_name. Different characters can
        // carry the same logical zone under different string forms ('gfaydark',
        // 'greater_faydark', a numeric 'zone_54' fallback, etc.) — without this
        // normalization the routing table matches one form and misses the other,
        // sending the two players to different zone nodes and giving each their
        // own private zoneInstances.
        const rawZoneId = character.zoneId || 'gfaydark';
        const zoneId = DB.getArchiveShortName(rawZoneId) || rawZoneId;

        let zoneUrl = process.env.ZONE_URL || process.env.ZONE_URL_DEFAULT || 'ws://localhost:3010';
        const routed = await zoneRouter.getUrlForZone(zoneId, DB);
        if (routed && routed.url) zoneUrl = routed.url;

        // Handoff to Zone Server
        const zoneToken = await tokenManager.generateToken(data);
        
        ws.send(JSON.stringify({
            type: 'HANDOFF',
            token: zoneToken,
            url: zoneUrl
        }));

        const routedNode = (routed && routed.node) || 'default';
        console.log(`[WORLD] Handoff for ${data.characterName} → zone='${zoneId}' (raw='${rawZoneId}') node='${routedNode}' url=${zoneUrl}`);
    }
  }

  server.listen(PORT, () => {
    console.log(`[WORLD] World Server listening on port ${PORT}`);
  });
}

main().catch(console.error);
