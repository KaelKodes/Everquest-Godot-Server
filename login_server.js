require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const DB = require('./db');
const broker = require('./network/broker');
const tokenManager = require('./network/tokenManager');

const PORT = process.env.PORT || 3005;

async function main() {
  await DB.initDatabase();
  await broker.init();

  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  const authSessions = new Map();

  wss.on('connection', (ws) => {
    console.log(`[LOGIN] Client connected.`);

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        await handleMessage(ws, msg);
      } catch (err) {
        console.error('[LOGIN] Error:', err.message);
      }
    });

    ws.on('close', () => {
      authSessions.delete(ws);
    });

    ws.send(JSON.stringify({ type: 'WELCOME', message: 'Connected to EQMUD Login Server' }));
  });

  async function handleMessage(ws, msg) {
    switch (msg.type) {
      case 'LOGIN':
      case 'LOGIN_ACCOUNT':
        await handleLogin(ws, msg);
        break;
      case 'CREATE_ACCOUNT':
        await handleCreateAccount(ws, msg);
        break;
      case 'GET_CHAR_CREATE_DATA':
        // Proxy to DB
        const data = await DB.getCharCreateData();
        ws.send(JSON.stringify({ type: 'CHAR_CREATE_DATA', ...data }));
        break;
      case 'CREATE_CHARACTER':
        await handleCreateCharacter(ws, msg);
        break;
      case 'DELETE_CHARACTER':
        await handleDeleteCharacter(ws, msg);
        break;
      case 'SELECT_CHARACTER':
        await handleSelectCharacter(ws, msg);
        break;
    }
  }

  async function handleLogin(ws, msg) {
    const result = await DB.loginAccount(msg.username, msg.password);
    if (!result || result.error) {
      return ws.send(JSON.stringify({ type: 'ERROR', message: result?.error || 'Account not found' }));
    }
    authSessions.set(ws, { accountId: result.id, accountName: result.name });
    const characters = await DB.getCharactersByAccount(result.id);
    ws.send(JSON.stringify({ type: 'ACCOUNT_OK', accountName: result.name, characters }));
  }

  async function handleCreateAccount(ws, msg) {
    const result = await DB.createAccount(msg.username, msg.password);
    if (result.error) return ws.send(JSON.stringify({ type: 'ERROR', message: result.error }));
    authSessions.set(ws, { accountId: result.id, accountName: result.name });
    ws.send(JSON.stringify({ type: 'ACCOUNT_OK', accountName: result.name, characters: [] }));
  }

  async function handleCreateCharacter(ws, msg) {
    const auth = authSessions.get(ws);
    if (!auth) return;
    const result = await DB.createCharacter({ ...msg, accountId: auth.accountId });
    if (result.error) return ws.send(JSON.stringify({ type: 'ERROR', message: result.error }));
    const characters = await DB.getCharactersByAccount(auth.accountId);
    ws.send(JSON.stringify({ type: 'ACCOUNT_OK', accountName: auth.accountName, characters }));
  }

  async function handleDeleteCharacter(ws, msg) {
      const auth = authSessions.get(ws);
      if (!auth) return;
      
      const charName = msg.name;
      if (!charName) return ws.send(JSON.stringify({ type: 'ERROR', message: 'No character name provided' }));

      // Verify ownership and get ID
      const characters = await DB.getCharactersByAccount(auth.accountId);
      const target = characters.find(c => c.name === charName);
      if (!target) return ws.send(JSON.stringify({ type: 'ERROR', message: 'Character not found' }));

      await DB.deleteCharacter(target.id);
      const updatedChars = await DB.getCharactersByAccount(auth.accountId);
      ws.send(JSON.stringify({ type: 'CHARACTER_DELETED', name: charName, characters: updatedChars }));
  }

  async function handleSelectCharacter(ws, msg) {
    const auth = authSessions.get(ws);
    if (!auth) return;
    
    // Verify character belongs to account
    const chars = await DB.getCharactersByAccount(auth.accountId);
    const character = chars.find(c => c.name === msg.name);
    if (!character) return ws.send(JSON.stringify({ type: 'ERROR', message: 'Character not found' }));

    // Generate handoff token
    const token = await tokenManager.generateToken({
        accountId: auth.accountId,
        accountName: auth.accountName,
        characterId: character.id,
        characterName: character.name
    });

    // Send handoff packet
    ws.send(JSON.stringify({
        type: 'HANDOFF',
        token: token,
        url: process.env.WORLD_URL || 'ws://localhost:3006'
    }));
    
    console.log(`[LOGIN] Handoff generated for ${character.name}`);
  }

  server.listen(PORT, () => {
    console.log(`[LOGIN] Login Server listening on port ${PORT}`);
  });
}

main().catch(console.error);
