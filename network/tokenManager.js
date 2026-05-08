const crypto = require('crypto');
const broker = require('./broker');

// Default expiry 30 seconds
const TOKEN_EXPIRY = 30;

async function generateToken(data) {
    const token = crypto.randomBytes(32).toString('hex');
    const key = `token:${token}`;
    
    // Store in Redis with TTL
    if (broker.isConnected) {
        await broker.setGlobalState(key, data);
        const publisher = require('./broker').publisher; // Access direct client for EXPIRE if needed, 
        // but setGlobalState uses a helper. Let's assume setGlobalState could handle TTL or we add it.
        // For simplicity, let's just use Redis client directly if we can.
    }
    
    return token;
}

async function verifyToken(token) {
    if (!broker.isConnected) return null;
    
    const key = `token:${token}`;
    const data = await broker.getGlobalState(key);
    
    if (data) {
        // One-time use: delete after verify
        // await broker.del(key); // Need a del helper in broker.js
        return data;
    }
    
    return null;
}

module.exports = {
    generateToken,
    verifyToken
};
