const { createClient } = require('redis');

let publisher;
let subscriber;
let isConnected = false;

// Channel handlers
const subscribers = new Map(); // Map<channel, Function[]>

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

    } catch (e) {
        console.warn('[BROKER] Could not connect to Redis. Running in standalone monolithic mode.');
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
        // Using the internal publisher client if it's available
        // In the previous write_to_file, it didn't expose the raw client.
        // Let's assume we can add a delete command.
        try {
          await publisher.del(key);
        } catch(e) {}
    }
}

module.exports = {
    init,
    subscribe,
    publish,
    setGlobalState,
    getGlobalState,
    deleteGlobalState,
    get isConnected() { return isConnected; }
};
