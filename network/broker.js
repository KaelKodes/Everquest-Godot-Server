const { createClient } = require('redis');

let publisher;
let subscriber;
let isConnected = false;

// Channel handlers
const subscribers = new Map(); // Map<channel, Function[]>

// ── Local fallback registries (used when Redis is offline) ──────────
// Mirrors the same shape as the Redis hashes so single-process mode
// works identically to clustered mode.
const localPlayerRegistry = new Map(); // charName(lower) -> JSON string
const localGroupRegistry = new Map();  // groupId -> JSON string

async function init() {
    try {
        const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
        
        publisher = createClient({ url });
        subscriber = createClient({ url });

        publisher.on('error', (err) => console.error('[BROKER] Publisher Error:', err));
        subscriber.on('error', (err) => console.error('[BROKER] Subscriber Error:', err));

        await publisher.connect();
        await subscriber.connect();

        isConnected = true;
        console.log('[BROKER] Connected to Redis successfully. Cluster mode enabled.');

        // Bind global message handler
        subscriber.subscribe('global_chat', (message) => {
            handleIncomingMessage('global_chat', message);
        });
        
        subscriber.subscribe('system_events', (message) => {
            handleIncomingMessage('system_events', message);
        });

        // Cross-node whisper delivery channel
        subscriber.subscribe('cross_node_whisper', (message) => {
            handleIncomingMessage('cross_node_whisper', message);
        });

        // Cross-node announcement delivery channel
        subscriber.subscribe('cross_node_announcement', (message) => {
            handleIncomingMessage('cross_node_announcement', message);
        });

    } catch (e) {
        console.warn('[BROKER] Could not connect to Redis. Running without cluster pub/sub (single process).');
        isConnected = false;
    }
}

function handleIncomingMessage(channel, message) {
    try {
        const data = JSON.parse(message);
        const handlers = subscribers.get(channel);
        if (handlers) {
            for (const handler of handlers) {
                handler(data);
            }
        }
    } catch (e) {
        console.error(`[BROKER] Failed to parse message on ${channel}:`, e);
    }
}

function subscribe(channel, callback) {
    if (!subscribers.has(channel)) {
        subscribers.set(channel, []);
    }
    subscribers.get(channel).push(callback);
}

async function publish(channel, data) {
    if (isConnected && publisher) {
        await publisher.publish(channel, JSON.stringify(data));
    } else {
        // Monolithic fallback: just route it directly to our own handlers
        handleIncomingMessage(channel, JSON.stringify(data));
    }
}

// Global State Management Helpers
async function setGlobalState(key, value) {
    if (isConnected) {
        await publisher.set(key, JSON.stringify(value));
    }
}

async function getGlobalState(key) {
    if (isConnected) {
        const val = await publisher.get(key);
        return val ? JSON.parse(val) : null;
    }
    return null;
}

async function deleteGlobalState(key) {
    if (isConnected) {
        try {
          await publisher.del(key);
        } catch(e) {}
    }
}

// ── Player Registry ─────────────────────────────────────────────────
// Tracks every online player across all nodes so /who all, cross-node
// whispers, and group invites can find anyone on the cluster.

const PLAYER_REGISTRY_KEY = 'eqmud:players:online';

/**
 * Register a player in the global directory.
 * Called on createSession / handleManualLogin.
 */
async function registerPlayer(charName, info) {
    const key = String(charName).toLowerCase();
    const payload = JSON.stringify(info);
    if (isConnected && publisher) {
        try {
            await publisher.hSet(PLAYER_REGISTRY_KEY, key, payload);
        } catch (e) {
            console.error('[BROKER] registerPlayer error:', e.message);
        }
    } else {
        localPlayerRegistry.set(key, payload);
    }
}

/**
 * Remove a player from the global directory.
 * Called on removeSession / disconnect.
 */
async function unregisterPlayer(charName) {
    const key = String(charName).toLowerCase();
    if (isConnected && publisher) {
        try {
            await publisher.hDel(PLAYER_REGISTRY_KEY, key);
        } catch (e) {
            console.error('[BROKER] unregisterPlayer error:', e.message);
        }
    } else {
        localPlayerRegistry.delete(key);
    }
}

/**
 * Look up a single player across the entire cluster.
 * Returns the info object or null.
 */
async function findPlayer(charName) {
    const key = String(charName).toLowerCase();
    if (isConnected && publisher) {
        try {
            const raw = await publisher.hGet(PLAYER_REGISTRY_KEY, key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    } else {
        const raw = localPlayerRegistry.get(key);
        return raw ? JSON.parse(raw) : null;
    }
}

/**
 * Get ALL online players across the cluster.
 * Returns an array of info objects.
 */
async function getAllPlayers() {
    if (isConnected && publisher) {
        try {
            const all = await publisher.hGetAll(PLAYER_REGISTRY_KEY);
            return Object.values(all).map(v => {
                try { return JSON.parse(v); } catch (_) { return null; }
            }).filter(Boolean);
        } catch (e) {
            return [];
        }
    } else {
        return Array.from(localPlayerRegistry.values()).map(v => {
            try { return JSON.parse(v); } catch (_) { return null; }
        }).filter(Boolean);
    }
}

/**
 * Update a single field for a registered player (e.g. zoneId after zoning).
 */
async function updatePlayerField(charName, field, value) {
    const existing = await findPlayer(charName);
    if (!existing) return;
    existing[field] = value;
    await registerPlayer(charName, existing);
}

module.exports = {
    init,
    subscribe,
    publish,
    setGlobalState,
    getGlobalState,
    deleteGlobalState,
    // Player registry
    registerPlayer,
    unregisterPlayer,
    findPlayer,
    getAllPlayers,
    updatePlayerField,
    get isConnected() { return isConnected; }
};
