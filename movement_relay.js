const { WebSocketServer } = require('ws');
const http = require('http');

/**
 * MovementRelay - A high-performance, minimalist WebSocket server 
 * dedicated solely to relaying player movement (UPDATE_POS -> MOB_MOVE).
 * 
 * It operates independently of the main game engine loop to avoid
 * latency caused by complex AI, combat, or DB operations.
 */

const PORT = process.env.PORT_MOVEMENT || 3012;
const VIEW_DISTANCE = 800; // Matches gameEngine.js
const VIEW_DISTANCE_SQ = VIEW_DISTANCE * VIEW_DISTANCE;

// Minimal state for fast lookups
// characterId -> { ws, zoneId, x, y, z, heading }
const players = new Map();
// zoneId -> Set(characterId)
const playersByZone = new Map();

const server = http.createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let charId = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'RELAY_AUTH') {
        // Simple auth: main server tells client a token, client presents it here.
        // For now, we'll just trust the charId for development.
        charId = msg.charId;
        const zoneId = msg.zoneId;
        
        // Cleanup old session if it exists
        if (players.has(charId)) {
          removePlayer(charId);
        }

        players.set(charId, {
          ws,
          zoneId,
          x: msg.x || 0,
          y: msg.y || 0,
          z: msg.z || 0,
          heading: msg.heading || 0,
          hasLightSource: msg.hasLightSource === true
        });

        if (!playersByZone.has(zoneId)) {
          playersByZone.set(zoneId, new Set());
        }
        playersByZone.get(zoneId).add(charId);
        
        console.log(`[RELAY] Player ${charId} joined zone ${zoneId}`);
        return;
      }

      if (msg.type === 'UPDATE_POS' && charId) {
        handleUpdatePos(charId, msg);
        return;
      }
      
      if (msg.type === 'ZONE_CHANGE' && charId) {
        const p = players.get(charId);
        if (p) {
          // Remove from old zone
          if (playersByZone.has(p.zoneId)) {
            playersByZone.get(p.zoneId).delete(charId);
          }
          // Add to new zone
          p.zoneId = msg.zoneId;
          if (!playersByZone.has(p.zoneId)) {
            playersByZone.set(p.zoneId, new Set());
          }
          playersByZone.get(p.zoneId).add(charId);
        }
      }

    } catch (e) {
      console.error('[RELAY] Error:', e.message);
    }
  });

  ws.on('close', () => {
    if (charId) {
      removePlayer(charId);
    }
  });
});

function removePlayer(charId) {
  const p = players.get(charId);
  if (p) {
    if (playersByZone.has(p.zoneId)) {
      playersByZone.get(p.zoneId).delete(charId);
    }
    players.delete(charId);
    console.log(`[RELAY] Player ${charId} disconnected`);
  }
}

function handleUpdatePos(charId, msg) {
  const sender = players.get(charId);
  if (!sender) return;

  // Update internal state
  sender.x = msg.x ?? sender.x;
  sender.y = msg.y ?? sender.y;
  sender.z = msg.z ?? sender.z;
  sender.heading = msg.heading ?? sender.heading;
  sender.hasLightSource = msg.hasLightSource ?? sender.hasLightSource;

  const zoneId = sender.zoneId;
  const zonePlayers = playersByZone.get(zoneId);
  if (!zonePlayers) return;

  const payload = JSON.stringify({
    type: 'MOB_MOVE',
    id: `player_${charId}`,
    x: sender.x,
    y: sender.y,
    z: sender.z,
    heading: sender.heading,
    hasLightSource: sender.hasLightSource,
    serverTime: Date.now()
  });

  // Fast broadcast to others in same zone
  for (const otherId of zonePlayers) {
    if (otherId === charId) continue;
    const other = players.get(otherId);
    if (!other || other.ws.readyState !== 1) continue;

    // Proximity culling
    const dx = sender.x - other.x;
    const dy = sender.y - other.y;
    const distSq = dx * dx + dy * dy;
    
    if (distSq <= VIEW_DISTANCE_SQ) {
      // Check backpressure
      if (other.ws.bufferedAmount > 1024 * 64) {
         // Skip if outbound buffer is too full
         continue;
      }
      other.ws.send(payload);
    }
  }
}

server.listen(PORT, () => {
  console.log(`[RELAY] Movement Relay listening on port ${PORT}`);
});
