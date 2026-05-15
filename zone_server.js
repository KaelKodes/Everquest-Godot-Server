require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const DB = require('./db');
const engine = require('./gameEngine');
const State = require('./state');
const broker = require('./network/broker');
const tokenManager = require('./network/tokenManager');
const zoneRouter = require('./network/zoneRouter');

const PORT = process.env.PORT || 3010;
// Zone server is assigned a node name; routing is DB-backed.
const NODE = process.env.NODE || 'unknown';

async function main() {
  await engine.bootstrapServer();
  await broker.init();

  // ── Cross-node message handlers ──────────────────────────────────
  // When another node publishes a whisper, deliver it to the local target.
  broker.subscribe('cross_node_whisper', (data) => {
    if (!data || !data.targetName) return;
    const targetLower = data.targetName.toLowerCase();
    for (const [, s] of State.sessions) {
      if (s.char && s.char.name.toLowerCase() === targetLower) {
        s.ws.send(JSON.stringify({
          type: 'CHAT', channel: 'whisper',
          sender: data.senderName, text: data.text, direction: 'from'
        }));
        return;
      }
    }
  });

  // Cross-node announcements (GM broadcast to all nodes)
  broker.subscribe('cross_node_announcement', (data) => {
    if (!data || !data.text) return;
    for (const [, s] of State.sessions) {
      if (s.char && s.ws.readyState === 1) {
        s.ws.send(JSON.stringify({
          type: 'CHAT', channel: 'announcement',
          sender: data.senderName || 'System', text: data.text
        }));
      }
    }
  });

  // Don't pre-initialize zones in cluster mode; load on-demand.
  await engine.initZones([]);
  engine.startGameLoop();

  // Publish active session count so the Server Select screen on the
  // client can show a real player number. Single-node usage just reads
  // 'player_count_total' directly; multi-node setups can swap this out
  // for a per-NODE key and aggregate in the login server later.
  setInterval(() => {
    try {
      const count = State.sessions ? State.sessions.size : 0;
      broker.setGlobalState('player_count_total', count);
    } catch (_) { /* broker not available */ }
  }, 5000);

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

      // Determine which zone this character should be in.
      // Always normalize to canonical PEQ short_name first (matches world_server
      // and gameEngine.createSession) so routing decisions are stable across
      // every zone string variant a character row might carry.
      const character = await DB.getCharacter(data.characterName);
      if (!character) {
        return ws.send(JSON.stringify({ type: 'ERROR', message: 'Character data not found' }));
      }
      const rawZoneId = character.zoneId || 'gfaydark';
      const zoneId = DB.getArchiveShortName(rawZoneId) || rawZoneId;
      const routed = await zoneRouter.getUrlForZone(zoneId, DB);
      const targetNode = routed.node;

      // If DB routing assigns a different node, redirect
      if (targetNode && targetNode !== NODE) {
        if (!routed.url) return ws.send(JSON.stringify({ type: 'ERROR', message: `No zone node route found for ${zoneId}` }));
        const zoneToken = await tokenManager.generateToken(data);
        ws.send(JSON.stringify({ type: 'HANDOFF', token: zoneToken, url: routed.url }));
        console.log(`[ZONE:${NODE}] Redirecting ${data.characterName} (${zoneId}) to node '${targetNode}' via ${routed.url}`);
        return;
      }

      const pop = (engine && engine.getPopulation) ? engine.getPopulation(zoneId) : null;
      const popStr = pop != null ? ` (zone pop before login: ${pop})` : '';
      console.log(`[ZONE:${NODE} pid=${process.pid}] ${data.characterName} entering zone '${zoneId}' (raw='${rawZoneId}', route='${targetNode || 'default'}')${popStr}`);

      // Inject session into game engine
      // We need to simulate the login logic but using the token data
      await engine.handleManualLogin(ws, data);
  }

  server.listen(PORT, () => {
    console.log(`[ZONE:${NODE} pid=${process.pid}] Zone Node listening on port ${PORT} (routing via DB).`);
  });
}

main().catch(console.error);
