'use strict';

const State = require('../state');
const DB = require('../db');
const ItemDB = require('../data/itemDatabase');
const { send } = require('../utils');
const Inventory = require('./inventory');

const RANGE = 30;
const trades = new Map();

function sessionByPlayerId(id) {
  const want = String(id || '').replace(/^player_/, '');
  if (!want) return null;
  for (const session of State.sessions.values()) {
    if (session.char && String(session.char.id) === want) return session;
  }
  return null;
}

function sessionByName(name) {
  const want = String(name || '').trim().toLowerCase();
  for (const session of State.sessions.values()) {
    if (session.char && session.char.name.toLowerCase() === want) return session;
  }
  return null;
}

function inRange(a, b) {
  if (!a.char || !b.char || a.char.zoneId !== b.char.zoneId) return false;
  const dx = (Number(a.char.x) || 0) - (Number(b.char.x) || 0);
  const dy = (Number(a.char.y) || 0) - (Number(b.char.y) || 0);
  return dx * dx + dy * dy <= RANGE * RANGE;
}

function tradeFor(session) {
  if (!session || !session.char) return null;
  return trades.get(session.char.id) || null;
}

function otherSide(trade, session) {
  return trade.a === session ? trade.b : trade.a;
}

function sideKey(trade, session) {
  return trade.a === session ? 'a' : 'b';
}

function rowAt(session, slotId) {
  return (session.inventory || []).find((row) => row.equipped !== 1 && Number(row.slot) === Number(slotId));
}

function describe(session, slotIds) {
  const out = [];
  for (const slotId of slotIds) {
    const row = rowAt(session, slotId);
    if (!row) continue;
    const def = ItemDB.getById(row.item_key) || {};
    out.push({
      slotId: Number(row.slot),
      name: def.name || String(row.item_key),
      icon: def.icon || def.iconId || 0,
      qty: Number(row.quantity || row.charges) || 1,
    });
  }
  return out;
}

function tell(session, text) {
  send(session.ws, { type: 'COMBAT_LOG', events: [{ event: 'MESSAGE', text }] });
}

function publish(trade) {
  const pack = (session) => {
    const mine = sideKey(trade, session) === 'a' ? trade.offerA : trade.offerB;
    const theirs = sideKey(trade, session) === 'a' ? trade.offerB : trade.offerA;
    const partner = otherSide(trade, session);
    return {
      type: 'TRADE_UPDATE',
      partnerName: partner.char.name,
      yours: describe(session, mine),
      theirs: describe(partner, theirs),
      youAccepted: sideKey(trade, session) === 'a' ? trade.acceptA : trade.acceptB,
      theyAccepted: sideKey(trade, session) === 'a' ? trade.acceptB : trade.acceptA,
    };
  };
  send(trade.a.ws, pack(trade.a));
  send(trade.b.ws, pack(trade.b));
  for (const session of [trade.a, trade.b]) {
    if (!session.isCompanion) continue;
    const partner = otherSide(trade, session);
    const theirs = describe(partner, sideKey(trade, session) === 'a' ? trade.offerB : trade.offerA);
    const yours = describe(session, sideKey(trade, session) === 'a' ? trade.offerA : trade.offerB);
    const theirText = theirs.length ? theirs.map((it) => it.name).join(', ') : 'nothing';
    const yourText = yours.length ? yours.map((it) => it.name).join(', ') : 'nothing';
    session.tradeNote = `Open trade with ${partner.char.name}. They offer ${theirText}. You offer ${yourText}. ACT: offer "Item Name" to add from your bag. ACT: accept trade when you agree. ACT: decline trade to cancel.`;
  }
}

function close(trade, reason) {
  trades.delete(trade.a.char.id);
  trades.delete(trade.b.char.id);
  const packet = { type: 'TRADE_CLOSE', reason: reason || '' };
  send(trade.a.ws, packet);
  send(trade.b.ws, packet);
  trade.a.tradeNote = '';
  trade.b.tradeNote = '';
}

async function invite(session, msg) {
  if (!session || !session.char) return;
  const target = sessionByPlayerId(msg && msg.targetId) || sessionByName(msg && msg.targetName);
  if (!target || target === session) {
    tell(session, 'There is no one there to trade with.');
    return;
  }
  if (target.npcType && !target.char) {
    tell(session, 'Use the give window for NPCs.');
    return;
  }
  if (session.isCompanion && !isTrusted(target, session)) {
    tell(session, 'You stay with your own company.');
    return;
  }
  if (!inRange(session, target)) {
    tell(session, `${target.char.name} is too far away to trade.`);
    return;
  }
  if (tradeFor(session) || tradeFor(target)) {
    tell(session, 'Someone in that trade is already trading.');
    return;
  }
  if (target.isCompanion && !isTrusted(session, target)) {
    tell(session, `${target.char.name} does not open a trade.`);
    return;
  }
  if (!target.inventory) target.inventory = await DB.getInventory(target.char.id);
  if (!session.inventory) session.inventory = await DB.getInventory(session.char.id);
  const trade = {
    a: session,
    b: target,
    offerA: [],
    offerB: [],
    acceptA: false,
    acceptB: false,
  };
  trades.set(session.char.id, trade);
  trades.set(target.char.id, trade);
  tell(session, `You open a trade with ${target.char.name}.`);
  if (!target.isCompanion) tell(target, `${session.char.name} opens a trade with you.`);
  publish(trade);
  if (target.isCompanion) {
    require('./companionMind').notice(session, 'group', 'I open a trade with you. Read the Open trade line before you offer or accept.', null);
  }
}

function isTrusted(session, companion) {
  if (!companion.isCompanion) return true;
  if (Number(session.char.accountId) === 10000) return true;
  if (String(session.char.name || '').toLowerCase() === 'kuldaien') return true;
  return !!companion.mayGroupWithStrangers;
}

function setOffer(session, msg) {
  const trade = tradeFor(session);
  if (!trade) return;
  const slots = Array.isArray(msg && msg.slots) ? msg.slots.map(Number).filter((n) => n >= 0) : [];
  const unique = [];
  for (const slotId of slots) {
    if (unique.length >= 8) break;
    if (!rowAt(session, slotId)) continue;
    if (!unique.includes(slotId)) unique.push(slotId);
  }
  if (sideKey(trade, session) === 'a') trade.offerA = unique;
  else trade.offerB = unique;
  trade.acceptA = false;
  trade.acceptB = false;
  publish(trade);
}

async function offerNamed(session, itemName) {
  const trade = tradeFor(session);
  if (!trade) return false;
  if (!session.inventory) session.inventory = await DB.getInventory(session.char.id);
  const want = String(itemName || '').trim().toLowerCase();
  const row = (session.inventory || []).find((item) => {
    if (item.equipped === 1) return false;
    const def = ItemDB.getById(item.item_key) || {};
    return String(def.name || '').toLowerCase().includes(want);
  });
  if (!row) return false;
  const key = sideKey(trade, session) === 'a' ? 'offerA' : 'offerB';
  const next = trade[key].filter((slotId) => slotId !== Number(row.slot));
  if (next.length >= 8) return false;
  next.push(Number(row.slot));
  trade[key] = next;
  trade.acceptA = false;
  trade.acceptB = false;
  publish(trade);
  return true;
}

function emptySlots(session) {
  const used = new Set((session.inventory || []).map((row) => Number(row.slot)));
  const free = [];
  for (let slot = 22; slot <= 29; slot++) {
    if (!used.has(slot)) free.push(slot);
  }
  return free;
}

async function lock(session) {
  const trade = tradeFor(session);
  if (!trade) return false;
  if (sideKey(trade, session) === 'a') trade.acceptA = true;
  else trade.acceptB = true;
  if (!(trade.acceptA && trade.acceptB)) {
    publish(trade);
    return true;
  }
  await complete(trade);
  return true;
}

async function complete(trade) {
  const aItems = trade.offerA.map((slotId) => rowAt(trade.a, slotId)).filter(Boolean);
  const bItems = trade.offerB.map((slotId) => rowAt(trade.b, slotId)).filter(Boolean);
  const aFree = emptySlots(trade.a).length + aItems.length;
  const bFree = emptySlots(trade.b).length + bItems.length;
  if (bItems.length > aFree || aItems.length > bFree) {
    tell(trade.a, 'The trade does not fit. A bag is full.');
    tell(trade.b, 'The trade does not fit. A bag is full.');
    trade.acceptA = false;
    trade.acceptB = false;
    publish(trade);
    return;
  }
  for (const row of aItems) {
    await DB.deleteItem(trade.a.char.id, row.item_key, row.slot);
  }
  for (const row of bItems) {
    await DB.deleteItem(trade.b.char.id, row.item_key, row.slot);
  }
  trade.a.inventory = await DB.getInventory(trade.a.char.id);
  trade.b.inventory = await DB.getInventory(trade.b.char.id);
  for (const row of aItems) {
    const slot = emptySlots(trade.b).shift();
    const qty = Number(row.quantity || row.charges) || 1;
    await DB.addItem(trade.b.char.id, row.item_key, 0, slot, qty);
    trade.b.inventory.push({ item_key: row.item_key, slot, equipped: 0, quantity: qty });
  }
  for (const row of bItems) {
    const slot = emptySlots(trade.a).shift();
    const qty = Number(row.quantity || row.charges) || 1;
    await DB.addItem(trade.a.char.id, row.item_key, 0, slot, qty);
    trade.a.inventory.push({ item_key: row.item_key, slot, equipped: 0, quantity: qty });
  }
  trade.a.inventory = await DB.getInventory(trade.a.char.id);
  trade.b.inventory = await DB.getInventory(trade.b.char.id);
  Inventory.sendInventory(trade.a);
  Inventory.sendInventory(trade.b);
  tell(trade.a, `You complete the trade with ${trade.b.char.name}.`);
  tell(trade.b, `You complete the trade with ${trade.a.char.name}.`);
  close(trade, 'complete');
}

function cancel(session) {
  const trade = tradeFor(session);
  if (!trade) return false;
  const partner = otherSide(trade, session);
  tell(session, 'You cancel the trade.');
  if (!partner.isCompanion) tell(partner, `${session.char.name} cancels the trade.`);
  close(trade, 'cancel');
  return true;
}

module.exports = { invite, setOffer, offerNamed, lock, cancel, tradeFor };
