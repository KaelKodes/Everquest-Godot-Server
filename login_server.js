require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const DB = require('./db');
const broker = require('./network/broker');
const tokenManager = require('./network/tokenManager');
const { attachFaceCounts } = require('./char_create_face_counts');
const { createCharacterFromClientMessage } = require('./create_character_common');

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
      case 'REQUEST_CHAR_CREATE_DATA': {
        const raceId = msg.raceId ?? msg.race_id ?? 1;
        const data = await DB.getCharCreateData(raceId);
        attachFaceCounts(data, raceId);
        ws.send(JSON.stringify({ type: 'CHAR_CREATE_DATA', ...data }));
        break;
      }
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
    authSessions.set(ws, { accountId: result.id, accountName: result.name, status: result.status || 0 });
    const characters = await DB.getCharactersByAccount(result.id);
    ws.send(JSON.stringify({ type: 'ACCOUNT_OK', accountName: result.name, characters }));
  }

  async function handleCreateAccount(ws, msg) {
    const result = await DB.createAccount(msg.username, msg.password);
    if (result.error) return ws.send(JSON.stringify({ type: 'ERROR', message: result.error }));
    authSessions.set(ws, { accountId: result.id, accountName: result.name, status: result.status || 0 });
    ws.send(JSON.stringify({ type: 'ACCOUNT_OK', accountName: result.name, characters: [] }));
  }

  async function handleCreateCharacter(ws, msg) {
    const auth = authSessions.get(ws);
    if (!auth) {
      return ws.send(JSON.stringify({ type: 'ERROR', message: 'Not authenticated. Please login first.' }));
    }
    const result = await createCharacterFromClientMessage(auth.accountId, msg);
    if (result.error) {
      return ws.send(JSON.stringify({ type: 'ERROR', message: result.error }));
    }
    ws.send(JSON.stringify({
      type: 'CHARACTER_CREATED',
      name: result.name,
      characters: result.characters
    }));
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
        status: auth.status || 0,
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
