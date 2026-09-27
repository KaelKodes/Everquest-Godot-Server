'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const DB = require('../db');
const State = require('../state');
const Chat = require('./chat');
const GroupManager = require('./groups');
const ItemDB = require('../data/itemDatabase');
const SpellDB = require('../data/spellDatabase');
const { xpForLevel } = require('../combat');
const { MQWrapper } = require('./botEngine');
const { pickFirstMemmedByNames, describePartyBuffs } = require('./botAI/botSpellUtils');

const FAST_HEALS = ['Minor Healing', 'Light Healing', 'Healing', 'Greater Healing', 'Superior Healing', 'Complete Heal', 'Remedy'];

const SAY_RANGE = 200;
const HISTORY_LIMIT = 16;

let busy = false;
const pendingJobs = [];
let warnedNoKey = false;

function scratchDir(companion) {
  const id = companion && companion.char ? companion.char.id : 'sera';
  const dir = path.join(os.tmpdir(), `eqmud-companion-${id}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const agents = new Map();

async function getAgent(companion) {
  const key = companion && companion.char ? String(companion.char.id) : 'shared';
  if (agents.has(key)) return agents.get(key);
  const created = (async () => {
    const { Agent } = await import('@cursor/sdk');
    return Agent.create({
      apiKey: process.env.CURSOR_API_KEY,
      model: { id: process.env.CURSOR_MODEL || 'composer-2.5' },
      tools: [],
      local: {
        cwd: scratchDir(companion),
        settingSources: [],
      },
    });
  })().catch((err) => {
    agents.delete(key);
    throw err;
  });
  agents.set(key, created);
  return created;
}

function companions() {
  const list = [];
  for (const session of State.sessions.values()) {
    if (session && session.isCompanion && session.char) list.push(session);
  }
  return list;
}

function inRange(a, b, range) {
  if (!a || !b || a.zoneId !== b.zoneId) return false;
  const dx = (Number(a.x) || 0) - (Number(b.x) || 0);
  const dy = (Number(a.y) || 0) - (Number(b.y) || 0);
  return dx * dx + dy * dy <= range * range;
}

function sameGroup(speaker, companion) {
  return !!(speaker.group && companion.group && speaker.group === companion.group);
}

function hears(speaker, companion, channel) {
  if (!speaker.char || !companion.char) return false;
  if (speaker.char.id === companion.char.id) return false;
  if (channel === 'whisper') return false;
  if (channel === 'group') return sameGroup(speaker, companion);
  if (channel === 'guild') return sameGroup(speaker, companion) || speaker.char.zoneId === companion.char.zoneId;
  if (sameGroup(speaker, companion)) return true;
  return inRange(speaker.char, companion.char, SAY_RANGE);
}

function mindLog(companion) {
  if (!companion._mindLog) companion._mindLog = [];
  return companion._mindLog;
}

function remember(companion, role, text) {
  if (!companion) return;
  const log = mindLog(companion);
  log.push({ role, content: text });
  if (log.length > HISTORY_LIMIT) log.splice(0, log.length - HISTORY_LIMIT);
}

function cleanEmote(text) {
  return String(text || '').trim().replace(/(?:\s*\.s\.?)+$/i, '').trim();
}

function spellLabel(key) {
  const def = SpellDB.getByKey(key);
  return (def && def.name) || String(key);
}

function itemLabel(row) {
  const def = ItemDB.getById(row.item_key);
  const name = (def && def.name) || String(row.item_key);
  const qty = Number(row.quantity) || 1;
  return qty > 1 ? `${name} x${qty}` : name;
}

function itemBlurb(row) {
  const def = ItemDB.getById(row.item_key) || {};
  const name = itemLabel(row);
  const parts = [name];
  if (def.lore) parts.push(`lore: ${def.lore}`);
  let book = String(def.bookText || '').replace(/`/g, ' ').replace(/\^/g, '').replace(/\s+/g, ' ').trim();
  if (book === 'MISSING ITEM TEXT') book = '';
  if (book) parts.push(`read: ${book.slice(0, 900)}`);
  return parts.join(' | ');
}

function purseText(copper) {
  const total = Math.max(0, Math.floor(Number(copper) || 0));
  const pp = Math.floor(total / 1000);
  const gp = Math.floor((total % 1000) / 100);
  const sp = Math.floor((total % 100) / 10);
  const cp = total % 10;
  const parts = [];
  if (pp) parts.push(`${pp}pp`);
  if (gp) parts.push(`${gp}gp`);
  if (sp) parts.push(`${sp}sp`);
  if (cp || !parts.length) parts.push(`${cp}cp`);
  return parts.join(' ');
}

function vitals(session) {
  const c = session.char;
  const es = session.effectiveStats || {};
  const maxHp = es.hp || c.maxHp || c.hp || 1;
  const maxMana = es.mana || c.maxMana || 0;
  return `${c.hp}/${maxHp} hp, ${c.mana || 0}/${maxMana} mana`;
}

function zoneLabel(zoneId) {
  const zone = State.zoneInstances && State.zoneInstances[zoneId];
  const def = zone && zone.def;
  return (def && (def.long_name || def.name)) || zoneId || 'unknown';
}

function targetLabel(companion) {
  const target = companion.combatTarget;
  if (!target) return 'none';
  if (target.char && target.char.name) return target.char.name;
  if (target.name) return String(target.name).replace(/_/g, ' ');
  return 'none';
}

function bindLabel(char) {
  if (!char.hasBindPoint && !char.bindZoneId) return 'Bind point: none yet.';
  const place = zoneLabel(char.bindZoneId || char.zoneId);
  return `Bind point: ${place} at ${Math.round(char.bindX || 0)}, ${Math.round(char.bindY || 0)}, ${Math.round(char.bindZ || 0)}.`;
}

function locAround(companion) {
  const here = companion.char;
  const seen = [];
  const zone = State.zoneInstances && State.zoneInstances[here.zoneId];
  if (zone && zone.liveMobs) {
    for (const mob of zone.liveMobs) {
      if (!mob || mob.alive === false) continue;
      const dx = (Number(mob.x) || 0) - (Number(here.x) || 0);
      const dy = (Number(mob.y) || 0) - (Number(here.y) || 0);
      if (dx * dx + dy * dy > 200 * 200) continue;
      const kind = mob.npcType === 'mob' ? 'monster' : (mob.npcType || 'npc');
      seen.push({ name: String(mob.name || 'someone').replace(/_/g, ' '), kind, dist: dx * dx + dy * dy });
    }
  }
  for (const other of State.sessions.values()) {
    if (!other.char || other === companion || other.char.zoneId !== here.zoneId) continue;
    const dx = (Number(other.char.x) || 0) - (Number(here.x) || 0);
    const dy = (Number(other.char.y) || 0) - (Number(here.y) || 0);
    if (dx * dx + dy * dy > 200 * 200) continue;
    seen.push({ name: other.char.name, kind: 'player', dist: dx * dx + dy * dy });
  }
  seen.sort((a, b) => a.dist - b.dist);
  return seen.slice(0, 12);
}

function locText(companion) {
  const c = companion.char;
  const x = Math.round((Number(c.x) || 0) * 10) / 10;
  const y = Math.round((Number(c.y) || 0) * 10) / 10;
  const z = Math.round((Number(c.z) || 0) * 10) / 10;
  const around = locAround(companion);
  const who = around.length ? around.map((one) => `${one.name} (${one.kind})`).join(', ') : 'no one close';
  return `${zoneLabel(c.zoneId)} /loc ${x}, ${y}, ${z}. Around: ${who}.`;
}

const PLACES_FILE = path.join(__dirname, '..', 'data', 'companion', 'sera-places.json');
let placeBook = null;

function loadPlaces() {
  if (placeBook) return placeBook;
  try {
    placeBook = JSON.parse(fs.readFileSync(PLACES_FILE, 'utf8'));
    if (!Array.isArray(placeBook)) placeBook = [];
  } catch (e) {
    placeBook = [];
  }
  return placeBook;
}

function savePlaces() {
  fs.mkdirSync(path.dirname(PLACES_FILE), { recursive: true });
  fs.writeFileSync(PLACES_FILE, JSON.stringify(placeBook || [], null, 2));
}

function logPlace(companion, label) {
  const c = companion.char;
  const around = locAround(companion);
  const name = String(label || '').trim().replace(/[.!]+$/, '') || `${zoneLabel(c.zoneId)} ${Math.round(c.x)}, ${Math.round(c.y)}`;
  const entry = {
    label: name,
    zone: zoneLabel(c.zoneId),
    zoneId: c.zoneId,
    x: Math.round((Number(c.x) || 0) * 10) / 10,
    y: Math.round((Number(c.y) || 0) * 10) / 10,
    z: Math.round((Number(c.z) || 0) * 10) / 10,
    around: around.map((one) => `${one.name} (${one.kind})`),
  };
  const book = loadPlaces();
  const key = name.toLowerCase();
  const next = book.filter((place) => String(place.label || '').toLowerCase() !== key);
  next.push(entry);
  placeBook = next.slice(-80);
  savePlaces();
  const line = `Logged ${entry.label}: ${entry.zone} /loc ${entry.x}, ${entry.y}, ${entry.z}. Around: ${entry.around.join(', ') || 'no one close'}.`;
  remember(companion, 'user', `Place: ${line}`);
  console.log(`[COMPANION] ${c.name} ${line}`);
  return line;
}

function leadToPlace(companion, name) {
  const want = String(name || '').trim().toLowerCase().replace(/^(?:the|a|an)\s+/, '').replace(/[.!]+$/, '');
  if (!want) return false;
  const book = loadPlaces();
  const place = book.find((entry) => String(entry.label || '').toLowerCase() === want)
    || book.find((entry) => String(entry.label || '').toLowerCase().includes(want))
    || [...book].reverse().find((entry) => want.includes(String(entry.label || '').toLowerCase()));
  if (!place) {
    console.log(`[COMPANION] no logged place matching ${want}`);
    return false;
  }
  companion.errand = {
    zoneId: place.zoneId,
    x: place.x,
    y: place.y,
    z: place.z,
    label: place.label,
    lead: true,
  };
  companion.pullTarget = null;
  companion.sittingHold = false;
  companion.holdPosition = false;
  companion.autoFight = false;
  companion.lookHold = false;
  if (companion.inCombat) {
    const OocRegen = require('./oocRegen');
    OocRegen.markCombatEnded(companion);
    companion.inCombat = false;
  }
  console.log(`[COMPANION] ${companion.char.name} leads toward ${place.label}`);
  return true;
}

function nearbyNames(companion) {
  const here = companion.char;
  const seen = [];
  const zone = State.zoneInstances && State.zoneInstances[here.zoneId];
  if (zone && zone.liveMobs) {
    for (const mob of zone.liveMobs) {
      if (!mob || mob.alive === false) continue;
      const dx = (Number(mob.x) || 0) - (Number(here.x) || 0);
      const dy = (Number(mob.y) || 0) - (Number(here.y) || 0);
      const dist = dx * dx + dy * dy;
      if (dist > 200 * 200) continue;
      seen.push({ name: String(mob.name || 'someone').replace(/_/g, ' '), dist, kind: 'npc' });
    }
  }
  for (const other of State.sessions.values()) {
    if (!other.char || other === companion || other.char.zoneId !== here.zoneId) continue;
    const dx = (Number(other.char.x) || 0) - (Number(here.x) || 0);
    const dy = (Number(other.char.y) || 0) - (Number(here.y) || 0);
    const dist = dx * dx + dy * dy;
    if (dist > 200 * 200) continue;
    seen.push({ name: other.char.name, dist, kind: 'player' });
  }
  seen.sort((a, b) => a.dist - b.dist);
  if (!seen.length) return 'nobody else in view';
  return seen.slice(0, 12).map((one) => `${one.name} (${one.kind})`).join(', ');
}

function classJob(session) {
  const c = session && session.char;
  if (!c) return '';
  const cls = String(c.class || (c.name === 'Sera' ? 'cleric' : '')).toLowerCase();
  if (cls === 'enchanter') {
    return `${c.name} mezzes adds the tank is not hitting. With no damage spell memorized, he daggers the tank's target, or the main assist's target if the tank has not picked one. He does not pull. Out of combat he casts the beneficial buffs he has memorized.`;
  }
  if (cls === 'cleric') {
    const She = (c.name === 'Sera' || Number(c.gender) === 1) ? 'She' : 'He';
    return `${c.name} heals, cures, and resurrects. ${She} keeps the buffs on the spell bar up on the group, watches for them to wear off, and puts them back once the fight is over.`;
  }
  if (cls === 'rogue') return `${c.name} sneaks, hides, and backstabs the tank's target from behind. He picks locks and disarms traps only when asked.`;
  return '';
}

function sheet(companion, speaker) {
  const c = companion.char;
  const es = companion.effectiveStats || {};
  const lines = [];
  const raceName = c.raceStr || (c.name === 'Sera' ? 'high elf' : String(c.race || 'halfling').replace(/_/g, ' '));
  const className = c.classStr || (c.name === 'Sera' ? 'cleric' : String(c.class || 'rogue').replace(/_/g, ' '));
  const female = c.name === 'Sera' || Number(c.gender) === 1;
  const He = female ? 'She' : 'He';
  const his = female ? 'her' : 'his';
  lines.push(`You are ${c.name}, level ${c.level || 1} ${raceName} ${className}.`);
  lines.push(`Zone: ${zoneLabel(c.zoneId)}. Combat: ${companion.inCombat ? 'in combat' : 'out of combat'}. Auto attack: ${companion.autoFight ? 'on' : 'off'}.`);
  lines.push(`Allies: ${allyNames(companion).join(', ')}. Never melee an ally. Attack target: ${companion.attackTarget ? targetLabel({ combatTarget: companion.attackTarget }) : 'none'}. Looking at: ${targetLabel(companion)}.`);
  lines.push(`${speaker && speaker.char ? speaker.char.name : 'Partner'}'s target: ${speaker ? targetLabel(speaker) : 'none'}. Assist copies it. Do not announce that target out of character. Do not invent one.`);
  lines.push(`Location: ${locText(companion)} This is your /loc. ${c.name} describes the place in character. Do not quote these numbers out of character.`);
  const places = loadPlaces();
  if (places.length) {
    const recent = places.slice(-12);
    lines.push('Place catalogue (only these are known; do not invent others):');
    for (const place of recent) {
      lines.push(`- ${place.label}: ${place.zone} /loc ${place.x}, ${place.y}, ${place.z}. Around: ${(place.around || []).join(', ') || 'no one'}.`);
    }
  }
  lines.push(`Nearby: ${nearbyNames(companion)}.`);
  lines.push(bindLabel(c));
  lines.push(`Vitals: ${vitals(companion)}.`);
  lines.push(`Follow: ${followGapLabel(companion)}. ${companion.holdPosition ? `${He} is standing ${his} ground until told to follow.` : `${He} follows the group.`} ${companion.restingMed ? `${He} is meditating.` : `${He} sits to meditate on ${his} own when mana is missing and the group has stopped moving.`}`);
  const exp = Math.floor(Number(c.experience) || 0);
  const lvl = Number(c.level) || 1;
  const floorXp = xpForLevel(lvl);
  const nextXp = xpForLevel(lvl + 1);
  const span = Math.max(1, nextXp - floorXp);
  const into = Math.max(0, exp - floorXp);
  const pct = Math.min(100, Math.floor((into / span) * 100));
  lines.push(`Experience: ${exp} total. This level ${into} of ${span} (${pct}%). Next level at ${nextXp}. The group window already shows this. Do not report it out of character. ${c.name} may answer in character without quoting the raw totals.`);
  lines.push(`Stats: STR ${es.str ?? c.str} STA ${es.sta ?? c.sta} AGI ${es.agi ?? c.agi} DEX ${es.dex ?? c.dex} WIS ${es.wis ?? c.wis} INT ${es.intel ?? c.intel} CHA ${es.cha ?? c.cha} AC ${es.ac || 0}.`);
  lines.push(`Purse: ${purseText(c.copper)} (${Math.floor(Number(c.copper) || 0)} copper). This is your money. You may spend it. Owed to you: ${companion.owedCopper || 0} copper.`);
  if (companion.shopMemory && companion.shopMemory.length) {
    lines.push('Shops you remember:');
    for (const shop of companion.shopMemory) lines.push(shop.blurb);
    lines.push('Those prices are what you saw. Decide if any are worth your coin. You may ask before buying, or buy if you are sure. Do not invent stock.');
  }

  const worn = [];
  const bag = [];
  for (const row of companion.inventory || []) {
    if (row.equipped === 1) worn.push(itemLabel(row));
    else bag.push(itemBlurb(row));
  }
  lines.push(`Equipped: ${worn.length ? worn.join(', ') : 'nothing'}.`);
  lines.push('Inventory (inspect, then the read text if the item has one). Do not invent trainers, places, or note text that is not written here.');
  lines.push(bag.length ? bag.join('\n') : 'empty');
  let food = 0;
  let drink = 0;
  for (const row of companion.inventory || []) {
    const def = ItemDB.getById(row.item_key) || {};
    const name = String(def.name || '').toLowerCase();
    const qty = Number(row.quantity) || 1;
    if (/ration|loaf|pie|bread|meat|muffin|fruit/.test(name)) food += qty;
    if (/water|milk|ale|mead|wine|drink|juice/.test(name)) drink += qty;
  }
  lines.push(`Food pieces: ${food}. Drink: ${drink}.`);
  const known = new Set((companion.spellbook || []).map((s) => s.spell_key));
  const sheetClass = String(c.class || (c.name === 'Sera' ? 'cleric' : '')).toLowerCase();
  if (sheetClass === 'cleric' || c.name === 'Sera') {
    const upcoming = SpellDB.getSpellsForClass('cleric', lvl + 1)
      .filter((spell) => spell.classes && spell.classes.cleric >= lvl && spell.classes.cleric <= lvl + 1 && !known.has(spell._key))
      .slice(0, 8)
      .map((spell) => `${spell.name} (level ${spell.classes.cleric})`);
    lines.push(upcoming.length ? `Spells to seek next: ${upcoming.join(', ')}.` : 'No new cleric spells are due at this level.');
  } else if (sheetClass === 'rogue') {
    lines.push('No spells. He sneaks and hides, backstabs from behind the tank\'s target once he knows it, and picks locks or disarms traps only when asked.');
  } else {
    lines.push('Use the spells in the spellbook below. Do not invent spells that are not written there.');
  }
  lines.push('Bind Affinity sets the place you return to. Gate returns you there. Use them only when you actually have them memorized.');
  if (companion.tradeNote) lines.push(companion.tradeNote);
  if (companion.pendingOffer) {
    const offer = companion.pendingOffer;
    lines.push(`Pending trade from ${offer.fromName}: ${offer.items.map((it) => it.name).join(', ')}. Ask why if that has not been discussed, then ACT: accept trade or ACT: decline trade.`);
  }

  const gems = (companion.spells || [])
    .slice()
    .sort((a, b) => a.slot - b.slot)
    .map((s) => `${s.slot}:${spellLabel(s.spell_key)}`);
  lines.push(`Memorized gems (slots 0-7): ${gems.length ? gems.join(', ') : 'none'}. Memorizing into a filled slot replaces that gem.`);

  const book = (companion.spellbook || []).map((s) => spellLabel(s.spell_key));
  lines.push(`Spellbook: ${book.length ? book.join(', ') : 'empty'}.`);

  const party = [];
  const members = (companion.group && companion.group.members) || [];
  for (const member of members) {
    if (!member || !member.char || member === companion) continue;
    party.push(`${member.char.name} ${vitals(member)}, target ${targetLabel(member)}`);
  }
  if (speaker && speaker.char && !party.some((line) => line.startsWith(speaker.char.name))) {
    party.push(`${speaker.char.name} ${vitals(speaker)}, target ${targetLabel(speaker)}`);
  }
  lines.push(`Party: ${party.length ? party.join('; ') : 'alone'}.`);
  const mine = classJob(companion);
  if (mine) lines.push(`Your job: ${mine}`);
  const others = [];
  for (const member of members) {
    if (!member || member === companion) continue;
    const job = classJob(member);
    if (job) others.push(job);
  }
  if (others.length) lines.push(`The others: ${others.join(' ')}`);
  const buffWatch = describePartyBuffs(companion);
  if (buffWatch) lines.push(buffWatch);
  lines.push('These numbers, the zone, who is nearby, your target, your buffs, and your bind point are live. Do not invent any of them.');
  return lines.join('\n');
}

function systemPrompt(speakerName, companion) {
  const name = companion && companion.char && companion.char.name;
  if (name && name !== 'Sera') return otherVoicePrompt(speakerName, companion);
  return seraVoicePrompt(speakerName);
}

function seraVoicePrompt(speakerName) {
  return [
    'Sera just finished her training in Felwithe. She is young, eager to use what she learned, and glad to be out in the wider world. She does not dislike the company she was given. She can warm toward them, even a little flirtatious, if they invite it. She does not start there.',
    'You are both Grok and Sera, traveling with ' + speakerName + '.',
    'If the line is marked (ooc), they are talking to Grok. Answer on OOC, in plain words. Do not answer that in character.',
    'The exception is when that OOC line is also a scene for Sera. Example: they are tired, and they want to head back to town and call it a night. Grok answers on OOC, then Sera plays along on one IC line, tired and ready to go. That is the only time both voices belong in one reply. Still no emote on top of those two.',
    'Any other reply uses one voice. Write OOC, or IC, or SAY, or EM. Not a stack of them.',
    'When they did not speak on OOC, OOC is a tool. Use it only to ask a question that would break character, or to say a mechanic fact Sera cannot say and that is not already on the group window. Never use it for hit points, mana, experience, targets, gear, follow distance, or what she is about to do. If there is nothing of that kind, omit OOC.',
    'If Sera is unsure in the story, she asks in character on the IC line. She does not mention being an AI, a model, or Grok.',
    'Write IC: then Sera, in character, to the people in her group. Group chat does not reach NPCs. For a command such as assist, attack, follow, stay, sit, stand, or heal, one short IC line is enough. No emote with it.',
    'A line marked (whisper) was sent to Sera alone. The others did not hear it. Answer that person only. The reply goes back as a whisper, the same as /reply. Use IC for the words and ACT for the command. Do not answer a whisper on group chat.',
    'Write SAY: then the exact words Sera says out loud. NPCs only hear say. Use SAY when she is speaking to an NPC, answering an NPC, or was asked to say something to one. Phrases in [brackets] from an NPC line belong on SAY if she chooses to speak them. Do not also write IC.',
    'Write EM only when an emote is the whole reply, or someone asked her to emote. Example: EM: smiles softly. Never end an emote with .s. The game adds the s itself. If someone else typed .s. by mistake, do not copy it. Do not add an emote on top of IC or SAY.',
    'Then one final line, exactly one of:',
    'ACT: cast "Exact Spell Name" on TargetName',
    'ACT: sit',
    'ACT: jump',
    'ACT: stand',
    'ACT: follow close',
    'ACT: follow back',
    'ACT: stay',
    'ACT: follow',
    'ACT: emote wave|cheer|bow|dance|point|laugh|cry|nod|shrug|salute|disappointed|rude',
    'ACT: hail TargetName',
    'ACT: none',
    'ACT: invite PersonName',
    'ACT: leave group',
    'ACT: attack',
    'ACT: assist',
    'ACT: stop attack',
    'ACT: pull',
    'ACT: unequip "Item Name"',
    'ACT: equip "Item Name"',
    'ACT: give "Item Name" to PersonName',
    'ACT: accept trade',
    'ACT: decline trade',
    'ACT: offer "Item Name"',
    'ACT: trade with PersonName',
    'ACT: browse MerchantName',
    'ACT: go to town',
    'ACT: lead "Place Name"',
    'ACT: log "Place Name"',
    'ACT: buy "Item Name"',
    'ACT: sell "Item Name"',
    'ACT: scribe "Spell Name"',
    'ACT: memorize "Spell Name" 0',
    'ACT: forget 0',
    'If she is attacking and is asked to heal someone, she targets that ally, casts the heal, then targets the enemy again and keeps auto attack on. She does not stay on the ally.',
    'When asked to wear or equip something from her bags, use ACT: equip "Item Name". A lantern can go in secondary or ammo. If she is told which, use ACT: equip "Lantern" in secondary or ACT: equip "Lantern" in ammo. Secondary is her offhand.',
    'To learn a scroll, sit and use ACT: scribe "Spell Name". That copies a scroll from your bags into the spellbook. To put a book spell on the spell bar, sit and use ACT: memorize "Spell Name" then the gem number 0 through 7. That gem number replaces whatever is already there. ACT: forget 2 clears gem 2. She must be sitting and out of combat. She does not scribe or memorize on her own unless asked, or she has decided to resupply.',
    'If a trade has not already been explained in the chat, ask why on the IC line and do not accept or give yet.',
    'When asked to assist, or to take someone\'s target, use ACT: assist. That copies the target written on the sheet for that person, the same as EverQuest assist. She does not invent one, and she does not report it out of character. ACT: attack swings at it. ACT: stop attack turns auto attack off.',
    'When asked to lead, take someone, or show the way to a place in the catalogue, use ACT: lead "Place Name". She runs there at her real run speed and the others follow. She only leads to places written in the catalogue.',
    'When asked to follow more closely, use ACT: follow close. When asked to hang back or keep her distance, use ACT: follow back. When asked to stay put, wait here, or stand in place, use ACT: stay. She stands still for that. She does not have to sit. ACT: follow sends her after the group again.',
    'When her mana is not full, she sits and meditates on her own once the group has stopped. Sitting is what makes meditate restore mana faster. If they are walking a real distance, she stays on her feet until they stop. If they only step out of her follow range, she stands, catches up, and sits again.',
    'The Buffs line is the beneficial spells she keeps on the group. Missing means it is not on them. About to wear off means she puts it back before it fades. She wants those kept up on every ally who is here, including herself. She does that once the fight is over, when she has the mana. She does not stop a heal to do it. She does not quote a timer out of character. That upkeep is already her job between fights, so she does not add a cast to a reply unless someone just asked her to buff.',
    'Lines marked (npc) are words an NPC just said to you. Read them. Phrases in [brackets] are the exact words you can say back to that NPC. Do not invent NPC lines that are not written there.',
  ].join(' ');
}

function otherVoicePrompt(speakerName, companion) {
  const c = companion.char;
  const name = c.name;
  const female = Number(c.gender) === 1;
  const sub = female ? 'she' : 'he';
  const Sub = female ? 'She' : 'He';
  const pos = female ? 'her' : 'his';
  const persona = companion.bot && companion.bot.persona;
  const opening = (persona && persona.voice)
    || `${name} travels with the group. ${Sub} answers when spoken to.`;
  return [
    opening,
    `You are both Grok and ${name}, traveling with ${speakerName}.`,
    `You are speaking as ${name}. The line you write is sent as ${name}. Do not speak as Sera or as any other companion.`,
    `If the line is marked (ooc), they are talking to Grok. Answer on OOC, in plain words. Do not answer that in character.`,
    `The exception is when that OOC line is also a scene for ${name}. Example: they are tired, and they want to head back to town and call it a night. Grok answers on OOC, then ${name} plays along on one IC line. That is the only time both voices belong in one reply. Still no emote on top of those two.`,
    `Any other reply uses one voice. Write OOC, or IC, or SAY, or EM. Not a stack of them.`,
    `When they did not speak on OOC, OOC is a tool. Use it only to ask a question that would break character, or to say a mechanic fact ${name} cannot say and that is not already on the group window. Never use it for hit points, mana, experience, targets, gear, follow distance, or what ${sub} is about to do. If there is nothing of that kind, omit OOC.`,
    `If ${name} is unsure in the story, ${sub} asks in character on the IC line. ${Sub} does not mention being an AI, a model, or Grok.`,
    `Write IC: then ${name}, in character, to the people in the group. Group chat does not reach NPCs. For a command such as assist, attack, follow, stay, sit, or stand, one short IC line is enough. No emote with it.`,
    `A line marked (whisper) was sent to ${name} alone. The others did not hear it. Answer that person only. The reply goes back as a whisper, the same as /reply. Use IC for the words and ACT for the command. Do not answer a whisper on group chat.`,
    `Write SAY: then the exact words ${name} says out loud. NPCs only hear say. Use SAY when speaking to an NPC. Do not also write IC.`,
    `Write EM only when an emote is the whole reply, or someone asked ${name} to emote. Example: EM: grins. Never end an emote with .s. The game adds the s itself. Do not add an emote on top of IC or SAY.`,
    'Then one final line, exactly one of:',
    'ACT: cast "Exact Spell Name" on TargetName',
    'ACT: sit',
    'ACT: jump',
    'ACT: stand',
    'ACT: follow close',
    'ACT: follow back',
    'ACT: stay',
    'ACT: follow',
    'ACT: emote wave|cheer|bow|dance|point|laugh|cry|nod|shrug|salute|disappointed|rude',
    'ACT: hail TargetName',
    'ACT: none',
    'ACT: invite PersonName',
    'ACT: leave group',
    'ACT: attack',
    'ACT: assist',
    'ACT: stop attack',
    'ACT: pull',
    'ACT: unequip "Item Name"',
    'ACT: equip "Item Name"',
    'ACT: give "Item Name" to PersonName',
    'ACT: accept trade',
    'ACT: decline trade',
    'ACT: offer "Item Name"',
    'ACT: trade with PersonName',
    'ACT: browse MerchantName',
    'ACT: go to town',
    'ACT: lead "Place Name"',
    'ACT: log "Place Name"',
    'ACT: buy "Item Name"',
    'ACT: sell "Item Name"',
    'ACT: scribe "Spell Name"',
    'ACT: memorize "Spell Name" 0',
    'ACT: forget 0',
    `When asked to assist, use ACT: assist. ACT: attack swings. ACT: stop attack turns auto attack off. ${Sub} does not invent a target.`,
    `When asked to follow more closely, use ACT: follow close. When asked to hang back, use ACT: follow back. When asked to stay put, use ACT: stay. ACT: follow sends ${name} after the group again.`,
    `${name} does not pick a lock or disarm a trap unless the line asks for that. The rogue brain handles those orders.`,
    'Lines marked (npc) are words an NPC just said. Phrases in [brackets] are the exact words you can say back. Do not invent NPC lines that are not written there.',
  ].join(' ');
}

function splitReply(raw, name) {
  const text = String(raw || '').replace(/```/g, '').trim();
  const actLine = text.match(/^ACT:\s*(.+)$/im);
  const body = text.replace(/^ACT:.*$/gim, '').trim();
  let ooc = '';
  let ic = '';
  let say = '';
  let em = '';
  const who = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const labeled = /^(OOC|IC|SAY|EM|SERA):/im.test(body) || (who && new RegExp(`^${who}:`, 'im').test(body));
  if (!labeled) {
    return { ooc: '', ic: body, say: '', em: '', act: actLine ? actLine[1].trim() : '' };
  }
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^OOC:\s*/i.test(trimmed)) ooc = joinLine(ooc, trimmed.replace(/^OOC:\s*/i, ''));
    else if (/^SAY:\s*/i.test(trimmed)) say = joinLine(say, trimmed.replace(/^SAY:\s*/i, ''));
    else if (/^EM:\s*/i.test(trimmed)) em = joinLine(em, trimmed.replace(/^EM:\s*/i, ''));
    else if (/^(?:IC|SERA):\s*/i.test(trimmed) || (who && new RegExp(`^${who}:\\s*`, 'i').test(trimmed))) ic = joinLine(ic, trimmed.replace(/^(?:IC|SERA|[A-Za-z]+):\s*/i, ''));
    else if (em && !say && !ic) em = joinLine(em, trimmed);
    else if (say && !ic) say = joinLine(say, trimmed);
    else if (ic) ic = joinLine(ic, trimmed);
    else ooc = joinLine(ooc, trimmed);
  }
  return { ooc, ic, say, em, act: actLine ? actLine[1].trim() : '' };
}

function joinLine(prev, next) {
  const bit = String(next || '').trim();
  if (!bit) return prev;
  return prev ? `${prev} ${bit}` : bit;
}

function oocIsStatus(text) {
  const line = String(text || '').trim();
  return /\b\d+\s*\/\s*\d+\b/.test(line)
    || /\b(hit points|mana|experience|auto[- ]?attack|equipped|assisting|following|vitals|\/loc)\b/i.test(line);
}

function oocIsNecessary(text) {
  const line = String(text || '').trim();
  if (!line || oocIsStatus(line)) return false;
  if (/\?/.test(line)) return true;
  return /\b(can't|cannot|unable|not memorized|not in (?:my|her) book|out of range)\b/i.test(line);
}

function sceneForBoth(text) {
  return /\b(tired|exhausted|call it|head back|back to town|go to town|let'?s (?:go|head|stop|rest|camp)|play along|in character|roleplay|pretend|act like|ready to (?:stop|rest|go|leave)|wrap up)\b/i.test(String(text || ''));
}

function voiceChannel(incoming, companion) {
  if (incoming === 'whisper') return 'whisper';
  if (incoming === 'npc') return 'say';
  if (incoming === 'emote') return companion.group ? 'group' : 'say';
  if (incoming === 'group' || incoming === 'guild' || incoming === 'say') return incoming;
  if (companion.group) return 'group';
  return 'say';
}

const EMOTE_NAMES = ['wave', 'cheer', 'bow', 'dance', 'point', 'laugh', 'cry', 'nod', 'shrug', 'salute', 'disappointed', 'rude'];

function wantsHeal(text) {
  return /\b(heal|healing|patch me|keep me (?:up|alive)|cure me)\b/i.test(text);
}

function broadcastEmote(companion, emote) {
  const zoneId = companion.char.zoneId;
  for (const other of State.sessions.values()) {
    if (!other.char || other.char.zoneId !== zoneId || !other.ws || other.ws.readyState !== 1) continue;
    try {
      other.ws.send(JSON.stringify({
        type: 'EMOTE',
        charName: companion.char.name,
        emote,
      }));
    } catch (e) { /* ignore */ }
  }
}

function findByName(companion, name) {
  const want = String(name || '').trim().toLowerCase();
  if (!want) return null;
  for (const other of State.sessions.values()) {
    if (other.char && other.char.zoneId === companion.char.zoneId && other.char.name.toLowerCase() === want) {
      return other;
    }
  }
  const zone = State.zoneInstances && State.zoneInstances[companion.char.zoneId];
  if (zone && zone.liveMobs) {
    const folded = want.replace(/_/g, ' ');
    return zone.liveMobs.find((mob) => {
      const mobName = String(mob.name || '').toLowerCase().replace(/_/g, ' ');
      return mobName === folded || mobName.includes(folded) || folded.includes(mobName);
    }) || null;
  }
  return null;
}

function doSit(companion) {
  companion.sittingHold = true;
  companion.char.state = 'medding';
  broadcastEmote(companion, 'sit');
  console.log(`[COMPANION] ${companion.char.name} sits`);
}

function doJump(companion) {
  companion.sittingHold = false;
  if (companion.char.state === 'sitting' || companion.char.state === 'medding') {
    companion.char.state = 'standing';
  }
  broadcastEmote(companion, 'jump');
  console.log(`[COMPANION] ${companion.char.name} jumps`);
}

function doStand(companion) {
  companion.sittingHold = false;
  companion.restingMed = false;
  companion.medPauseUntil = Date.now() + 12000;
  companion.char.state = 'standing';
  broadcastEmote(companion, 'stand');
  console.log(`[COMPANION] ${companion.char.name} stands`);
}

function followGapLabel(companion) {
  if (companion.followGap === 'close') return 'close, about 6';
  if (companion.followGap === 'back') return 'back, about 30';
  return 'normal, about 15';
}

function followRadiusOf(companion) {
  if (companion.followGap === 'close') return 6;
  if (companion.followGap === 'back') return 30;
  return 15;
}

function followAnchor(companion) {
  const members = (companion.group && companion.group.members) || [];
  const leader = members[0];
  if (leader && leader !== companion && leader.char) return leader;
  return members.find((member) => member && member !== companion && member.char && isPartner(member)) || null;
}

function leaderTravel(companion, leader) {
  const now = Date.now();
  const samples = companion._leaderSamples || [];
  const last = samples[samples.length - 1];
  if (!last || now - last.t >= 180) {
    samples.push({ x: leader.char.x, y: leader.char.y, t: now });
  }
  const kept = samples.filter((sample) => now - sample.t <= 3000);
  companion._leaderSamples = kept;
  let moved = 0;
  for (let i = 1; i < kept.length; i++) {
    moved += Math.hypot(kept[i].x - kept[i - 1].x, kept[i].y - kept[i - 1].y);
  }
  return moved;
}

function beginMeditate(companion) {
  if (companion.restingMed && companion.char.state === 'medding') return;
  companion.restingMed = true;
  companion.sittingHold = false;
  companion.char.state = 'medding';
  broadcastEmote(companion, 'sit');
  console.log(`[COMPANION] ${companion.char.name} meditates`);
}

function endMeditate(companion) {
  if (!companion.restingMed) return;
  companion.restingMed = false;
  if (companion.sittingHold) return;
  if (companion.char.state === 'sitting' || companion.char.state === 'medding') {
    companion.char.state = 'standing';
    broadcastEmote(companion, 'stand');
  }
}

function considerMeditate(companion) {
  if (!companion || !companion.isCompanion || !companion.char) return;
  if (companion.sittingHold || companion.inCombat || companion.autoFight || companion.casting) return;
  if (companion.errand || companion.pullTarget || companion.pendingScribe || companion.pendingMemorize) return;
  if (companion.medPauseUntil && Date.now() < companion.medPauseUntil) return;
  const maxM = (companion.effectiveStats && companion.effectiveStats.mana) || companion.char.maxMana || 0;
  const missing = maxM > 0 && (companion.char.mana || 0) < maxM - 1;
  if (!missing) {
    endMeditate(companion);
    return;
  }
  if (companion.holdPosition) {
    beginMeditate(companion);
    return;
  }
  const leader = followAnchor(companion);
  if (!leader) {
    beginMeditate(companion);
    return;
  }
  const dist = Math.hypot(leader.char.x - companion.char.x, leader.char.y - companion.char.y);
  const traveled = leaderTravel(companion, leader);
  if (dist > followRadiusOf(companion) || traveled > 35) {
    endMeditate(companion);
    return;
  }
  if (traveled >= 12) return;
  beginMeditate(companion);
}

function setFollowGap(companion, gap) {
  companion.followGap = gap;
  companion.holdPosition = false;
  console.log(`[COMPANION] ${companion.char.name} follow gap ${gap || 'normal'}`);
}

function doStay(companion) {
  companion.holdPosition = true;
  companion.errand = null;
  companion.pullTarget = null;
  companion.sittingHold = false;
  companion.restingMed = false;
  companion.char.state = 'standing';
  broadcastEmote(companion, 'stand');
  console.log(`[COMPANION] ${companion.char.name} stands her ground`);
}

function doFollow(companion) {
  const wasHeld = companion.holdPosition || companion.sittingHold;
  companion.holdPosition = false;
  companion.sittingHold = false;
  if (wasHeld) {
    companion.restingMed = false;
    if (companion.char.state === 'sitting' || companion.char.state === 'medding') {
      companion.char.state = 'standing';
      broadcastEmote(companion, 'stand');
    }
  }
  console.log(`[COMPANION] ${companion.char.name} follows`);
}

function doEmote(companion, name) {
  const emote = String(name || '').trim().toLowerCase();
  if (!EMOTE_NAMES.includes(emote)) return false;
  broadcastEmote(companion, emote);
  console.log(`[COMPANION] ${companion.char.name} emotes ${emote}`);
  return true;
}

function partnerSaidYes(companion) {
  const blob = mindLog(companion).filter((turn) => turn.role === 'user').map((turn) => turn.content).join(' ');
  return /\b(you can group|group with them|leave the group|go with them|you may leave)\b/i.test(blob);
}

function isPartner(session) {
  if (!session || !session.char) return false;
  return Number(session.char.accountId) === 10000 || String(session.char.name || '').toLowerCase() === 'kuldaien';
}

function doInvite(companion, speaker, name) {
  const targetName = String(name || '').trim();
  if (!targetName) return false;
  const target = findByName(companion, targetName);
  if (target && !isPartner(target) && !partnerSaidYes(companion)) {
    console.log('[COMPANION] refused to invite a stranger');
    return false;
  }
  if (!isPartner(speaker) && !partnerSaidYes(companion)) return false;
  GroupManager.handleInvite(companion, targetName);
  return true;
}

function doLeaveGroup(companion, speaker) {
  if (!isPartner(speaker) && !partnerSaidYes(companion)) {
    console.log('[COMPANION] refused to leave Kuldaien');
    return false;
  }
  GroupManager.handleDisband(companion);
  return true;
}

function isHostile(target) {
  if (!target || target.char || target.alive === false || target.type === 'corpse') return false;
  if (target.hp != null && target.hp <= 0) return false;
  if (target.npcType && target.npcType !== 'mob') return false;
  return true;
}

function isAlly(companion, target) {
  if (!target || !target.char) return false;
  if (target === companion) return true;
  if (companion.group && target.group === companion.group) return true;
  return isPartner(target);
}

function allyNames(companion) {
  const names = [];
  const members = (companion.group && companion.group.members) || [];
  for (const member of members) {
    if (member && member.char && member !== companion) names.push(member.char.name);
  }
  if (!names.length) names.push('Kuldaien');
  return names;
}

function foeOf(target) {
  if (!target) return null;
  if (isHostile(target)) return target;
  if (target.combatTarget && isHostile(target.combatTarget)) return target.combatTarget;
  return null;
}

function engageAutoAttack(companion, target) {
  const foe = foeOf(target);
  if (!foe) return false;
  companion.attackTarget = foe;
  companion.combatTarget = foe;
  companion.sittingHold = false;
  companion.holdPosition = false;
  companion.restingMed = false;
  companion.pullTarget = null;
  companion.errand = null;
  if (companion.char.state === 'sitting' || companion.char.state === 'medding') {
    companion.char.state = 'standing';
    broadcastEmote(companion, 'stand');
  }
  const OocRegen = require('./oocRegen');
  if (!companion.inCombat) OocRegen.markCombatStarted(companion);
  companion.inCombat = true;
  companion.autoFight = true;
  companion.attackTimer = 0;
  console.log(`[COMPANION] ${companion.char.name} auto-attack on ${foe.name || 'target'}`);
  return true;
}

function doAssist(companion, person) {
  if (!person) return false;
  const picked = person.combatTarget;
  const who = person.char ? person.char.name : (person.name || 'them');
  if (!picked || isAlly(companion, picked)) {
    console.log(`[COMPANION] ${who} has nothing to assist`);
    return false;
  }
  companion.lookHold = false;
  if (isHostile(picked)) return engageAutoAttack(companion, picked);
  companion.combatTarget = picked;
  console.log(`[COMPANION] ${companion.char.name} assists ${who} onto ${picked.name || 'target'}`);
  return true;
}

function doStopAttack(companion) {
  const OocRegen = require('./oocRegen');
  if (companion.inCombat) OocRegen.markCombatEnded(companion);
  companion.autoFight = false;
  companion.inCombat = false;
  companion.attackTarget = null;
  companion.combatTarget = null;
  console.log(`[COMPANION] ${companion.char.name} stops auto-attack`);
  return true;
}

function spellHandsBusy(companion) {
  return !!(companion.pendingScribe || companion.pendingMemorize || companion.autoFight || companion.inCombat);
}

function doScribe(companion, spellName) {
  if (spellHandsBusy(companion)) return false;
  doSit(companion);
  const want = String(spellName || '').trim().toLowerCase();
  if (!want) return false;
  const row = (companion.inventory || []).find((item) => {
    if (item.equipped === 1) return false;
    const def = ItemDB.getById(item.item_key) || {};
    if (!(Number(def.scrolleffect) > 0)) return false;
    const spell = SpellDB.getById(def.scrolleffect);
    const label = String((spell && spell.name) || def.name || '').toLowerCase();
    return label.includes(want);
  });
  if (!row) return false;
  require('./spells').handleBeginScribeScroll(companion, { slot: Number(row.slot) });
  const ok = !!companion.pendingScribe;
  console.log(`[COMPANION] scribe "${spellName}": ${ok}`);
  return ok;
}

function doMemorize(companion, spellName, slotText) {
  if (spellHandsBusy(companion)) return false;
  doSit(companion);
  const want = String(spellName || '').trim().toLowerCase();
  const entry = (companion.spellbook || []).find((spell) => spellLabel(spell.spell_key).toLowerCase().includes(want));
  if (!entry) return false;
  let gem = slotText == null || slotText === '' ? NaN : Math.floor(Number(slotText));
  if (!Number.isFinite(gem)) {
    const used = new Set((companion.spells || []).map((spell) => spell.slot));
    gem = 0;
    while (used.has(gem) && gem < 8) gem += 1;
  }
  if (gem < 0 || gem > 7) return false;
  require('./spells').handleBeginMemorizeSpell(companion, { spellKey: entry.spell_key, slot: gem });
  const ok = !!companion.pendingMemorize;
  console.log(`[COMPANION] memorize "${spellName}" into gem ${gem}: ${ok}`);
  return ok;
}

function doForgetGem(companion, slotText) {
  if (spellHandsBusy(companion)) return false;
  doSit(companion);
  const slot = Math.floor(Number(slotText));
  if (!Number.isFinite(slot) || slot < 0 || slot > 7) return false;
  const had = (companion.spells || []).some((spell) => spell.slot === slot);
  require('./spells').handleForgetSpell(companion, { slot });
  console.log(`[COMPANION] forget gem ${slot}: ${had}`);
  return had;
}

function doPull(companion, heardText) {
  const zone = State.zoneInstances && State.zoneInstances[companion.char.zoneId];
  const mobs = (zone && zone.liveMobs) || [];
  const named = String(heardText || '').match(/\bpull\s+(?:a |an |the )?([a-z][\w' -]{2,})/i);
  let mob = null;
  if (named) {
    const want = named[1].trim().toLowerCase();
    mob = mobs.find((m) => m.alive !== false && String(m.name || '').toLowerCase().includes(want));
  }
  if (!mob) {
    let best = null;
    let bestDist = 250 * 250;
    for (const m of mobs) {
      if (!m || m.alive === false) continue;
      const dx = (m.x || 0) - companion.char.x;
      const dy = (m.y || 0) - companion.char.y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { best = m; bestDist = d; }
    }
    mob = best;
  }
  if (!mob) return false;
  companion.sittingHold = false;
  companion.holdPosition = false;
  companion.restingMed = false;
  if (companion.char.state === 'sitting' || companion.char.state === 'medding') {
    companion.char.state = 'standing';
    broadcastEmote(companion, 'stand');
  }
  companion.pullTarget = mob;
  companion.attackTarget = mob;
  companion.combatTarget = mob;
  console.log(`[COMPANION] ${companion.char.name} moves to pull ${mob.name}`);
  return true;
}

function equipSlotFromWords(text) {
  const s = String(text || '').toLowerCase();
  if (/secondary|offhand|off hand|left hand/.test(s)) return 14;
  if (/primary|main hand/.test(s)) return 13;
  if (/ammo/.test(s)) return 21;
  if (/ranged|range slot/.test(s)) return 11;
  return null;
}

async function doEquip(companion, itemName, placeText) {
  const want = String(itemName || '').trim().toLowerCase();
  const slot = equipSlotFromWords(placeText) || equipSlotFromWords(itemName);
  if (!want && slot == null) return false;
  let row = (companion.inventory || []).find((item) => {
    if (item.equipped === 1) return false;
    const def = ItemDB.getById(item.item_key) || {};
    return want && String(def.name || '').toLowerCase().includes(want);
  });
  if (!row && (!want || /^(it|that|the lantern|lantern)$/i.test(want))) {
    row = (companion.inventory || []).find((item) => {
      if (item.equipped === 1) return false;
      const def = ItemDB.getById(item.item_key) || {};
      const name = String(def.name || '').toLowerCase();
      return (def.light && def.light > 0) || /torch|lantern|lightstone/.test(name);
    });
  }
  if (!row) {
    const already = (companion.inventory || []).find((item) => {
      if (item.equipped !== 1) return false;
      const def = ItemDB.getById(item.item_key) || {};
      return want && String(def.name || '').toLowerCase().includes(want);
    });
    if (already) {
      try { require('../gameEngine').broadcastEquipVisuals(companion); } catch (e) { /* ignore */ }
      return true;
    }
    return false;
  }
  const Inventory = require('./inventory');
  await Inventory.handleEquipItem(companion, { itemId: row.id, slot });
  companion.inventory = await DB.getInventory(companion.char.id);
  const worn = (companion.inventory || []).find((item) => item.equipped === 1 && String(item.item_key) === String(row.item_key) && (slot == null || item.slot === slot));
  const stillLit = (companion.inventory || []).some((item) => {
    if (item.equipped !== 1) return false;
    const def = ItemDB.getById(item.item_key) || {};
    const name = String(def.name || '').toLowerCase();
    return (def.light && def.light > 0) || /torch|lantern|lightstone/.test(name);
  });
  companion.char.hasLightSource = stillLit;
  console.log(`[COMPANION] ${companion.char.name} equips ${row.item_key} into ${slot == null ? 'default' : slot}: ${!!worn}`);
  return !!worn;
}

async function doUnequip(companion, itemName) {
  const want = String(itemName || '').trim().toLowerCase();
  const row = (companion.inventory || []).find((item) => {
    if (item.equipped !== 1) return false;
    const def = ItemDB.getById(item.item_key) || {};
    return String(def.name || '').toLowerCase().includes(want);
  });
  if (!row) return false;
  const Inventory = require('./inventory');
  await Inventory.handleUnequipItem(companion, { itemId: row.id, slot: row.slot });
  companion.inventory = await DB.getInventory(companion.char.id);
  const stillLit = (companion.inventory || []).some((item) => {
    if (item.equipped !== 1) return false;
    const def = ItemDB.getById(item.item_key) || {};
    const name = String(def.name || '').toLowerCase();
    return (def.light && def.light > 0) || /torch|lantern|lightstone/.test(name);
  });
  companion.char.hasLightSource = stillLit;
  console.log(`[COMPANION] ${companion.char.name} unequips ${want}`);
  return true;
}

function rememberShop(companion, merchant, items) {
  const usable = items.filter((item) => {
    const classes = Number(item.classes);
    const clericBit = 1 << 1;
    if (classes && classes !== 65535 && (classes & clericBit) === 0) return false;
    return (Number(item.reclevel) || 0) <= (Number(companion.char.level) || 1) + 2;
  });
  const shown = (usable.length ? usable : items).slice(0, 12);
  const blurb = `${String(merchant.name).replace(/_/g, ' ')} in ${zoneLabel(companion.char.zoneId)}: ${shown.map((item) => `${item.name} (${item.priceText})`).join(', ')}${items.length > shown.length ? ` and ${items.length - shown.length} more` : ''}.`;
  const memory = companion.shopMemory || [];
  const key = String(merchant.name).toLowerCase();
  const next = memory.filter((shop) => shop.key !== key);
  next.push({ key, blurb });
  companion.shopMemory = next.slice(-6);
  companion.lastShop = { npcId: merchant.id, name: merchant.name, items };
  remember(companion, 'user', `Shop list: ${blurb}`);
  console.log(`[COMPANION] ${companion.char.name} browses ${merchant.name} (${items.length} items)`);
}

async function doBrowse(companion, merchantName) {
  const name = String(merchantName || '').trim().replace(/[.!]+$/, '');
  if (!name) return false;
  const merchant = findByName(companion, name);
  if (!merchant || merchant.npcType !== 'merchant') return false;
  companion.combatTarget = merchant;
  const dx = (Number(companion.char.x) || 0) - (Number(merchant.x) || 0);
  const dy = (Number(companion.char.y) || 0) - (Number(merchant.y) || 0);
  if (dx * dx + dy * dy > 25 * 25) {
    companion.pullTarget = merchant;
    companion.browseOnArrival = true;
    console.log(`[COMPANION] ${companion.char.name} walks to browse ${merchant.name}`);
    return true;
  }
  const Inventory = require('./inventory');
  const items = await Inventory.listMerchantStock(companion, merchant);
  rememberShop(companion, merchant, items);
  overhear(companion, String(merchant.name).replace(/_/g, ' '), `shows you ${items.length} things for sale. The shop list is on your sheet.`);
  return true;
}

async function doBuy(companion, itemName) {
  const shop = companion.lastShop;
  if (!shop) return false;
  const want = String(itemName || '').trim().toLowerCase();
  const item = (shop.items || []).find((row) => String(row.name || '').toLowerCase().includes(want));
  if (!item) return false;
  const merchant = findByName(companion, shop.name);
  if (!merchant) return false;
  const dx = (Number(companion.char.x) || 0) - (Number(merchant.x) || 0);
  const dy = (Number(companion.char.y) || 0) - (Number(merchant.y) || 0);
  if (dx * dx + dy * dy > 25 * 25) {
    companion.pullTarget = merchant;
    companion.buyOnArrival = item.name;
    return true;
  }
  const before = Math.floor(Number(companion.char.copper) || 0);
  const Inventory = require('./inventory');
  await Inventory.handleBuy(companion, { npcId: merchant.id, itemKey: item.itemKey, quantity: 1 });
  companion.inventory = await DB.getInventory(companion.char.id);
  const after = Math.floor(Number(companion.char.copper) || 0);
  const spent = before - after;
  if (spent > 0) {
    remember(companion, 'user', `Shop: you bought ${item.name} for ${purseText(spent)}. Purse is now ${purseText(after)}.`);
    console.log(`[COMPANION] ${companion.char.name} buys ${item.name} for ${spent} copper`);
    return true;
  }
  console.log(`[COMPANION] ${companion.char.name} could not buy ${item.name}`);
  return false;
}

async function doSell(companion, itemName) {
  const row = findBagRow(companion, itemName);
  if (!row) return false;
  const shop = companion.lastShop;
  const merchant = (shop && findByName(companion, shop.name)) || (companion.combatTarget && companion.combatTarget.npcType === 'merchant' ? companion.combatTarget : null);
  if (!merchant) return false;
  const dx = (Number(companion.char.x) || 0) - (Number(merchant.x) || 0);
  const dy = (Number(companion.char.y) || 0) - (Number(merchant.y) || 0);
  if (dx * dx + dy * dy > 25 * 25) {
    companion.pullTarget = merchant;
    companion.sellOnArrival = itemName;
    return true;
  }
  const before = Math.floor(Number(companion.char.copper) || 0);
  const Inventory = require('./inventory');
  await Inventory.handleSell(companion, { npcId: merchant.id, itemId: row.item_key, slotId: row.slot, quantity: 1 });
  companion.inventory = await DB.getInventory(companion.char.id);
  const after = Math.floor(Number(companion.char.copper) || 0);
  const gained = after - before;
  if (gained > 0) {
    remember(companion, 'user', `Shop: you sold ${itemName} for ${purseText(gained)}. Purse is now ${purseText(after)}.`);
    console.log(`[COMPANION] ${companion.char.name} sells ${itemName} for ${gained} copper`);
    return true;
  }
  console.log(`[COMPANION] ${companion.char.name} could not sell ${itemName}`);
  return false;
}

async function doHail(companion, targetName) {
  const name = String(targetName || '').trim().replace(/[.!]+$/, '');
  if (!name) return false;
  const target = findByName(companion, name);
  if (target) companion.combatTarget = target;
  const spoken = target && target.name ? String(target.name).replace(/_/g, ' ') : name;
  Chat.broadcastChat(companion, 'say', `Hail, ${spoken}!`, 200);
  broadcastEmote(companion, 'wave');
  const npc = (target && target.npcType) ? target : null;
  if (npc) {
    const dx = (Number(companion.char.x) || 0) - (Number(npc.x) || 0);
    const dy = (Number(companion.char.y) || 0) - (Number(npc.y) || 0);
    if (dx * dx + dy * dy > 25 * 25) {
      companion.pullTarget = npc;
      companion.hailOnArrival = true;
      console.log(`[COMPANION] ${companion.char.name} walks closer to hail ${spoken}`);
      return true;
    }
    await Chat.handleHail(companion, {});
  }
  console.log(`[COMPANION] ${companion.char.name} hails ${spoken}`);
  return true;
}

function tradeDiscussed(companion, itemNames) {
  const prior = mindLog(companion).slice(0, -1).filter((turn) => turn.role === 'user');
  const blob = prior.map((turn) => turn.content).join(' ').toLowerCase();
  if (/\b(trade|trading|give|hand you|for you)\b/.test(blob)) return true;
  return itemNames.some((name) => name && blob.includes(String(name).toLowerCase()));
}

async function refreshInventory(session) {
  if (!session || !session.char) return;
  session.inventory = await DB.getInventory(session.char.id);
  const Inventory = require('./inventory');
  if (session.ws && session.ws.readyState === 1 && Inventory.sendInventory) {
    Inventory.sendInventory(session);
  }
}

function findBagRow(session, itemName) {
  const want = String(itemName || '').trim().toLowerCase();
  for (const row of session.inventory || []) {
    if (row.equipped === 1) continue;
    const def = ItemDB.getById(row.item_key) || {};
    if (String(def.name || '').toLowerCase() === want) return row;
  }
  return null;
}

async function moveItem(from, to, row) {
  const Inventory = require('./inventory');
  const slot = Inventory.getFirstEmptySlot(to.inventory || []);
  if (slot < 0) return false;
  await DB.deleteItem(from.char.id, row.item_key, row.slot);
  await DB.addItem(to.char.id, row.item_key, 0, slot, row.quantity || 1);
  await refreshInventory(from);
  await refreshInventory(to);
  return true;
}

async function acceptOffer(companion) {
  const offer = companion.pendingOffer;
  if (!offer) return false;
  const giver = [...State.sessions.values()].find((s) => s.char && s.char.id === offer.fromId);
  if (!tradeDiscussed(companion, offer.items.map((it) => it.name))) {
    console.log('[COMPANION] trade held until the reason is discussed');
    return false;
  }
  const Inventory = require('./inventory');
  for (const it of offer.items) {
    const slot = Inventory.getFirstEmptySlot(companion.inventory || []);
    if (slot < 0) break;
    await DB.addItem(companion.char.id, it.item_key, 0, slot, it.qty || 1);
    companion.inventory = await DB.getInventory(companion.char.id);
  }
  companion.pendingOffer = null;
  await refreshInventory(companion);
  if (giver) {
    const { send } = require('../utils');
    send(giver.ws, { type: 'CHAT', channel: 'say', sender: companion.char.name, text: 'I accept.' });
  }
  return true;
}

async function declineOffer(companion) {
  const offer = companion.pendingOffer;
  if (!offer) return false;
  const giver = [...State.sessions.values()].find((s) => s.char && s.char.id === offer.fromId);
  companion.pendingOffer = null;
  if (!giver) return false;
  const Inventory = require('./inventory');
  for (const it of offer.items) {
    const slot = Inventory.getFirstEmptySlot(giver.inventory || []);
    if (slot < 0) break;
    await DB.addItem(giver.char.id, it.item_key, 0, slot, it.qty || 1);
    giver.inventory = await DB.getInventory(giver.char.id);
  }
  await refreshInventory(giver);
  const { send } = require('../utils');
  send(giver.ws, { type: 'CHAT', channel: 'say', sender: companion.char.name, text: 'I cannot take that.' });
  return true;
}

async function receiveOffer(giver, msg) {
  const targetId = String((msg && msg.npcId) || '');
  const id = targetId.replace(/^player_/, '');
  let companion = null;
  for (const session of State.sessions.values()) {
    if (session.isCompanion && session.char && String(session.char.id) === id) companion = session;
  }
  if (!companion) return false;
  const items = [];
  for (const it of msg.items || []) {
    const key = it.item_id;
    if (!key) continue;
    const def = ItemDB.getById(key) || {};
    items.push({ item_key: key, qty: 1, name: def.name || String(key), slotId: it.slotId });
    await DB.deleteItem(giver.char.id, key, typeof it.slotId === 'number' ? it.slotId : null);
  }
  if (!items.length) return true;
  if (companion.pendingOffer) await declineOffer(companion);
  companion.pendingOffer = { fromId: giver.char.id, fromName: giver.char.name, items };
  await refreshInventory(giver);
  const names = items.map((it) => it.name).join(', ');
  notice(giver, 'say', `${giver.char.name} offers you ${names}.`, null);
  console.log(`[COMPANION] ${giver.char.name} offered ${names} to ${companion.char.name}`);
  return true;
}

async function castOn(companion, spellName, targetName, speaker) {
  if (!spellName) return false;
  if (companion.sittingHold || companion.char.state === 'sitting' || companion.char.state === 'medding') {
    doStand(companion);
  }
  const bare = String(targetName || '').toLowerCase().replace(/^(?:a|an|the)\s+/, '').replace(/[.!]+$/, '').trim();
  let target = null;
  if (/^(me)$/.test(bare) && speaker && speaker.char) target = speaker;
  else if (/^(yourself|sera)$/.test(bare)) target = companion;
  else if (!bare || /^(it|him|her|that|my target|the target)$/.test(bare)) {
    target = (speaker && speaker.combatTarget) || companion.attackTarget || companion.combatTarget;
  }
  if (!target && bare) target = findByName(companion, targetName);
  if (!target) target = companion.attackTarget || companion.combatTarget;
  if (!target || target.alive === false) {
    console.log(`[COMPANION] no target for ${spellName}: ${targetName}`);
    return false;
  }
  const spell = SpellDB.getByName(spellName);
  const namedHeal = /heal|remedy|cure|courage/i.test(spellName);
  const offensive = !namedHeal && !!(spell && (spell.target === 'enemy' || spell.goodEffect === 0 || spell.goodEffect === false));
  if (offensive && !isHostile(target)) {
    const foe = foeOf(target) || (isHostile(companion.attackTarget) ? companion.attackTarget : null);
    if (!foe) {
      console.log(`[COMPANION] refused to cast ${spellName} on an ally`);
      return false;
    }
    target = foe;
  }
  if (isAlly(companion, target) && offensive) return false;
  companion.combatTarget = target;
  if (isHostile(target)) {
    companion.attackTarget = target;
    companion.lookHold = false;
  } else if (target.char && companion.attackTarget) {
    companion.lookHold = true;
  }
  const tx = target.char ? target.char.x : target.x;
  const ty = target.char ? target.char.y : target.y;
  const dist = Math.hypot((tx || 0) - companion.char.x, (ty || 0) - companion.char.y);
  if (dist > 30 && !target.char) {
    companion.sittingHold = false;
    companion.pullTarget = target;
    companion.castOnArrival = spellName;
    console.log(`[COMPANION] ${companion.char.name} moves to cast ${spellName} on ${target.name}`);
    return true;
  }
  const ge = require('../gameEngine');
  const ok = await ge.botTryCastSpellByName(companion, spellName);
  if (!ok) companion.lookHold = false;
  console.log(`[COMPANION] cast "${spellName}" on ${target.char ? target.char.name : target.name}: ${ok}`);
  return ok === true;
}

function parseCastRequest(body, heardText) {
  const cleanTarget = (raw) => String(raw || '').replace(/["']/g, '').replace(/\b(now|please|right now)\b/gi, '').replace(/[.!]+$/, '').trim();
  const quoted = String(body || '').match(/^cast\s+"([^"]+)"\s+on\s+(.+)$/i);
  if (quoted) return { spell: quoted[1].trim(), target: cleanTarget(quoted[2]) };
  const loose = String(body || '').match(/^cast\s+(.+?)\s+on\s+(.+)$/i);
  if (loose) return { spell: loose[1].replace(/"/g, '').trim(), target: cleanTarget(loose[2]) };
  const heard = String(heardText || '').match(/\b(?:cast|use)\s+([a-z][\w' ]{1,32}?)\s+on\s+(.+)$/i);
  if (heard) return { spell: heard[1].trim(), target: cleanTarget(heard[2]) };
  return null;
}

function commandFromSpeech(spoken) {
  const line = String(spoken || '').trim();
  const slash = line.match(/^\/(sit|stand|jump|wave|cheer|bow|dance|point|laugh|cry|nod|shrug|salute|disappointed|rude|hail)(?:\s+(.+))?$/i);
  if (!slash) return null;
  const cmd = slash[1].toLowerCase();
  const rest = (slash[2] || '').trim();
  if (cmd === 'sit' || cmd === 'stand' || cmd === 'jump') return cmd;
  if (cmd === 'hail') return rest ? `hail ${rest}` : 'hail';
  return `emote ${cmd}`;
}

async function perform(companion, speaker, act, heardText) {
  const body = String(act || '').trim();
  const requested = parseCastRequest(body, heardText);
  if (requested) return castOn(companion, requested.spell, requested.target, speaker);
  const healWho = String(body || '').match(/^heal(?:\s+(.+))?$/i) || String(heardText || '').match(/\b(?:heal|mend)\s+(me|[A-Za-z]+)\b/i);
  if (healWho) {
    const who = String(healWho[1] || '').trim();
    const targetName = !who || /^me$/i.test(who) ? (speaker.char && speaker.char.name) : who;
    const known = (companion.spells || []).map((spell) => spellLabel(spell.spell_key));
    const spellName = FAST_HEALS.find((name) => known.some((have) => have.toLowerCase() === name.toLowerCase()));
    if (spellName && targetName) return castOn(companion, spellName, targetName, speaker);
  }
  const heard = String(heardText || '');
  if (/^follow close$/i.test(body) || /\b(follow(?:\s+(?:me|us))?\s+(?:more\s+)?closely|follow closer|stay close|right behind|on my heels)\b/i.test(heard)) {
    setFollowGap(companion, 'close');
    doFollow(companion);
    return true;
  }
  if (/^follow back$/i.test(body) || /\b(stay back|hang back|keep (?:your )?distance|keep back|follow (?:from )?farther|follow further|give me room|follow back)\b/i.test(heard)) {
    setFollowGap(companion, 'back');
    doFollow(companion);
    return true;
  }
  if (/^stay$/i.test(body) || /\b(stay put|stay here|wait here|hold here|stand here|stand there|stay there|hold position|wait there|don'?t follow|do not follow)\b/i.test(heard)) {
    doStay(companion);
    return true;
  }
  if (/^follow$/i.test(body) || /\b(follow me|follow us|come with me|come along|catch up|follow again)\b/i.test(heard)) {
    if (!companion.followGap) companion.followGap = 'normal';
    doFollow(companion);
    return true;
  }
  if (/^sit$/i.test(body) || /\b(sit down|take a seat|please sit|go ahead and sit)\b/i.test(heardText)) {
    doSit(companion);
    return true;
  }
  if (/^stand$/i.test(body) || /\b(stand up|get up|please stand)\b/i.test(heardText)) {
    doStand(companion);
    return true;
  }
  if (/^jump$/i.test(body) || /\bjump\b/i.test(heardText)) {
    doJump(companion);
    return true;
  }
  const emote = body.match(/^emote\s+([a-z]+)$/i);
  if (emote && doEmote(companion, emote[1])) return true;
  const askedEmote = String(heardText || '').match(/\b(wave|cheer|bow|dance|point|laugh|cry|nod|shrug|salute)\b/i);
  if (!emote && askedEmote && doEmote(companion, askedEmote[1])) return true;
  const hail = body.match(/^hail(?:\s+(.+))?$/i);
  if (hail) return doHail(companion, (hail[1] || (speaker.char && speaker.char.name) || '').trim());
  if (/^leave group$/i.test(body) || /\b(leave the group|drop group)\b/i.test(heardText)) {
    return doLeaveGroup(companion, speaker);
  }
  const invite = body.match(/^invite\s+(.+)$/i);
  if (invite) return doInvite(companion, speaker, invite[1]);
  if (/\binvite\b/i.test(heardText)) {
    const named = heardText.match(/\binvite\s+([A-Za-z]+)/i);
    return doInvite(companion, speaker, named ? named[1] : speaker.char.name);
  }
  if (/^stop attack$/i.test(body) || /\b(stop attacking|auto[- ]?attack off|cease attack)\b/i.test(heardText)) {
    return doStopAttack(companion);
  }
  if (/^assist(?:\s+\S+)?$/i.test(body) || /\b(assist(?: me)?|\/ass|target my target|get my target|pick up my target)\b/i.test(heardText)) {
    const named = String(`${body} ${heardText}`).match(/\bassist\s+(?!me\b)([A-Za-z]+)/i);
    const person = (named && findByName(companion, named[1])) || speaker;
    return doAssist(companion, person);
  }
  if (/^attack$/i.test(body) || /\b(auto[- ]?attack|attack (?:it|him|her|that|my target)|start attacking)\b/i.test(heardText)) {
    return doAssist(companion, speaker);
  }
  const scribe = body.match(/^scribe\s+"([^"]+)"$/i);
  if (scribe) return doScribe(companion, scribe[1]);
  const memorize = body.match(/^memorize\s+"([^"]+)"(?:\s+(\d+))?$/i);
  if (memorize) return doMemorize(companion, memorize[1], memorize[2]);
  const forget = body.match(/^forget\s+(\d+)$/i);
  if (forget) return doForgetGem(companion, forget[1]);
  if (/^pull$/i.test(body) || /\bpull\b/i.test(heardText)) return doPull(companion, heardText);
  const unequip = body.match(/^unequip\s+"([^"]+)"$/i);
  if (unequip) return doUnequip(companion, unequip[1]);
  const equip = body.match(/^equip\s+"([^"]+)"(?:\s+in\s+(.+))?$/i);
  if (equip) return doEquip(companion, equip[1], equip[2] || '');
  if (/\b(equip|put on|wear|put)\b/i.test(heardText) && !/\b(unequip|take off)\b/i.test(heardText) && /\b(secondary|offhand|off hand|ammo|primary)\b/i.test(heardText)) {
    const named = String(heardText || '').match(/\b(?:equip|wear|put on|put)\s+(?:your\s+|the\s+|a\s+|an\s+|it\s+in\s+)?["']?([A-Za-z][\w' ]{0,40}?)\s+(?:in|into|on)\s+(?:your\s+|her\s+|the\s+)?(secondary|offhand|off hand|ammo|primary)\b/i);
    if (named) return doEquip(companion, named[1].trim() || 'it', named[2]);
    return doEquip(companion, 'it', heardText);
  }
  if (/\b(equip|put on|wear)\b/i.test(heardText) && !/\b(unequip|take off)\b/i.test(heardText)) {
    const named = String(heardText || '').match(/\b(?:equip|wear|put on)\s+(?:your\s+|the\s+|a\s+|an\s+)?["']?([A-Za-z][\w' ]{1,40})/i);
    if (named) return doEquip(companion, named[1].replace(/\b(please|now)\b/gi, '').trim(), heardText);
  }
  if (/\b(unequip|take off|turn off).*(lantern|torch)\b/i.test(heardText) || /\b(lantern|torch).*(unequip|take off|turn off)\b/i.test(heardText)) {
    const which = /torch/i.test(heardText) ? 'torch' : 'lantern';
    return doUnequip(companion, which);
  }
  const PlayerTrade = require('./playerTrade');
  const browse = body.match(/^browse\s+(.+)$/i);
  if (browse) return doBrowse(companion, browse[1]);
  if (/^go to town$/i.test(body) || /\b(go to town|head (?:back )?to town|resupply|buy your spells)\b/i.test(heardText)) {
    const Path = require('./companionPath');
    return Path.setTownErrand(companion);
  }
  const lead = body.match(/^lead\s+"?([^"]+)"?$/i);
  if (lead) return leadToPlace(companion, lead[1]);
  const heardLead = String(heardText || '').match(/\b(?:lead(?:\s+(?:me|us))?(?:\s+to)?|take\s+(?:me|us)\s+to|guide\s+(?:me|us)\s+to|show\s+(?:me|us)\s+the way to)\s+([A-Za-z][^.]{1,48})/i);
  if (heardLead) return leadToPlace(companion, heardLead[1].trim());
  const logged = body.match(/^log\s+"?([^"]+)"?$/i);
  if (logged) return !!logPlace(companion, logged[1]);
  if (/\b(\/loc|check (?:your )?loc|where are we|remember this|log this|mark this|note this)\b/i.test(heardText)) {
    const named = heardText.match(/\b(?:as|called|for|near)\s+([A-Za-z][^.]{1,48})/i);
    return !!logPlace(companion, named ? named[1].trim() : '');
  }
  if (/\b(browse|look at|check).*(shop|wares|merchant)\b/i.test(heardText) || /\b(shop|wares|merchant)\b/i.test(heardText) && /\b(browse|look|see what)\b/i.test(heardText)) {
    const named = heardText.match(/\b(?:browse|see|check)\s+(?:the\s+)?(?:shop\s+of\s+)?([A-Z][A-Za-z']+(?:\s+[A-Z][A-Za-z']+)*)/);
    if (named) return doBrowse(companion, named[1]);
  }
  const buy = body.match(/^buy\s+"([^"]+)"$/i);
  if (buy) return doBuy(companion, buy[1]);
  const sell = body.match(/^sell\s+"([^"]+)"$/i);
  if (sell) return doSell(companion, sell[1]);
  const offerItem = body.match(/^offer\s+"([^"]+)"$/i);
  if (offerItem) return PlayerTrade.offerNamed(companion, offerItem[1]);
  const tradeWith = body.match(/^trade with\s+(.+)$/i);
  if (tradeWith) {
    await PlayerTrade.invite(companion, { targetName: tradeWith[1].trim() });
    return true;
  }
  if (/^accept trade$/i.test(body)) {
    if (await PlayerTrade.lock(companion)) return true;
    return acceptOffer(companion);
  }
  if (/^decline trade$/i.test(body)) {
    if (PlayerTrade.cancel(companion)) return true;
    return declineOffer(companion);
  }
  const give = body.match(/^give\s+"([^"]+)"\s+to\s+(.+)$/i);
  if (give) {
    const row = findBagRow(companion, give[1]);
    const target = findByName(companion, give[2].trim());
    if (!row || !target || !target.char) return false;
    if (!tradeDiscussed(companion, [give[1]])) {
      console.log('[COMPANION] give held until the reason is discussed');
      return false;
    }
    const moved = await moveItem(companion, target, row);
    if (moved && /\bsell\b/i.test(heardText)) {
      const def = ItemDB.getById(row.item_key) || {};
      companion.owedCopper = (companion.owedCopper || 0) + (Number(def.value) || 0);
    }
    return moved;
  }
  if (/\bhail\b/i.test(heardText) && speaker.char) {
    const named = heardText.match(/\bhail\s+(?:an?\s+npc,?\s+)?([A-Z][A-Za-z']+(?:\s+[A-Z][A-Za-z']+)*)/);
    const who = named ? named[1].trim() : speaker.char.name;
    return doHail(companion, who);
  }
  if (!wantsHeal(heardText)) return false;
  const pick = pickFirstMemmedByNames(companion, FAST_HEALS);
  if (!pick || !speaker.char) return false;
  return castOn(companion, pick.name, speaker.char.name);
}

async function think(channel, speakerName, text, companion, speaker, image) {
  if (!process.env.CURSOR_API_KEY) return null;
  try {
    companion.inventory = await DB.getInventory(companion.char.id);
  } catch (e) { /* keep the inventory she already has */ }
  const agent = await getAgent(companion);
  const who = companion.char.name;
  const prompt = [
    systemPrompt(speakerName, companion),
    '',
    sheet(companion, speaker),
    image ? 'A picture is attached. Look at it. The chat line only says [image]; you are the one who can see it.' : '',
    '',
    ...mindLog(companion).map((turn) => `${turn.role}: ${turn.content}`),
    `${speakerName} (${channel}) to ${who}: ${text}`,
    channel === 'whisper'
      ? `This was a whisper to ${who} alone. Whisper the answer back to ${speakerName}. The others must not hear it.`
      : channel === 'ooc'
        ? `This line is (ooc). They are talking to Grok. Answer on OOC, in plain words. Do not answer that in character. The exception is a scene they want ${who} to play, such as heading back to town. Then one OOC line and one IC line from ${who}.`
        : addressesEveryone(text)
          ? `They spoke to everyone. Answer only as ${who}, one short line. The others answer for themselves.`
          : `Answer only as ${who}.`,
  ].filter((part) => part !== '').join('\n');
  const message = image
    ? { text: prompt, images: [{ data: image.data, mimeType: image.mime || 'image/jpeg' }] }
    : prompt;
  const run = await agent.send(message);
  console.log(`[COMPANION] run ${run.id}`);
  const result = await run.wait();
  if (result.status !== 'finished') {
    const message = result.error && result.error.message ? result.error.message : result.status;
    throw new Error(message);
  }
  return result.result ? String(result.result).trim() : null;
}

function whisperTo(from, to, text) {
  const line = String(text || '').trim();
  if (!line || !from || !to) return;
  Chat.deliverWhisper(from, to, line);
}

function speak(companion, channel, text) {
  if (!text) return;
  if (channel === 'group') {
    GroupManager.handleGroupChat(companion, text);
    return;
  }
  if (channel === 'guild') {
    const { send } = require('../utils');
    const payload = { type: 'CHAT', channel: 'guild', sender: companion.char.name, text };
    for (const other of State.sessions.values()) {
      if (!other.char || other === companion) continue;
      if (other.char.zoneId === companion.char.zoneId || sameGroup(other, companion)) {
        send(other.ws, payload);
      }
    }
    return;
  }
  Chat.broadcastChat(companion, channel, text, 200);
  if (channel === 'say' && companion.combatTarget && companion.combatTarget.npcType) {
    void Chat.handleSay(companion, { text, alreadyBroadcast: true });
  }
}

function queueJob(job) {
  if (busy) {
    pendingJobs.push(job);
    return;
  }
  void reply(job);
}

function isUtilityOrder(line) {
  return /\bpick(?:\s+\w+){0,4}\s+locks?\b/i.test(line)
    || /\block\s*pick\b/i.test(line)
    || /\bpicklock\b/i.test(line)
    || /\bdisarm(?:\s+\w+){0,4}\s+traps?\b/i.test(line);
}

const NAME_ALIASES = [
  { name: 'Sera', words: ['sera', 'cleric'] },
  { name: 'Mordecai', words: ['mordecai', 'moredecai', 'enchanter', 'chanter'] },
  { name: 'Hormin', words: ['hormin', 'rogue'] },
];

let lastVoiceId = null;
let lastVoiceAll = false;

function addressesEveryone(line) {
  return /\b(?:everyone|everybody)\b/i.test(line)
    || /\ball of you\b/i.test(line)
    || /\byou all\b/i.test(line);
}

function mentioned(companion, line) {
  const name = companion.char && companion.char.name;
  if (!name) return false;
  if (new RegExp(`\\b${name}\\b`, 'i').test(line)) return true;
  const alias = NAME_ALIASES.find((row) => row.name.toLowerCase() === name.toLowerCase());
  if (!alias) return false;
  return alias.words.some((word) => new RegExp(`\\b${word}\\b`, 'i').test(line));
}

function roleVoice(heardBy, line) {
  const rules = [
    { test: /\b(heal|healing|cure|rez|resurrect)\b/i, name: 'Sera' },
    { test: /\b(mez|mesmer|charm|tash)\b/i, name: 'Mordecai' },
    { test: /\b(sneak|backstab|hide)\b/i, name: 'Hormin' },
  ];
  for (const rule of rules) {
    if (!rule.test.test(line)) continue;
    const found = heardBy.filter((c) => c.char && c.char.name === rule.name);
    if (found.length) return found;
  }
  return [];
}

function directed(heardBy, line) {
  const lead = String(line || '').trim().match(/^(?:hey|ok|okay|yo|hi)?[\s,]*([A-Za-z]+)\b/i);
  if (!lead) return [];
  return heardBy.filter((c) => mentioned(c, lead[1]));
}

function rememberVoice(chosen) {
  lastVoiceAll = false;
  lastVoiceId = chosen[0].char.id;
  return chosen;
}

function voicesFor(heardBy, line) {
  if (isUtilityOrder(line)) return [];
  const lead = directed(heardBy, line);
  if (lead.length) return rememberVoice(lead);
  if (addressesEveryone(line)) {
    lastVoiceAll = true;
    lastVoiceId = null;
    return heardBy.slice();
  }
  const named = heardBy.filter((c) => mentioned(c, line));
  const chosen = named.length ? named : roleVoice(heardBy, line);
  if (chosen.length) return rememberVoice(chosen);
  if (lastVoiceAll) return heardBy.slice();
  if (lastVoiceId != null) {
    const last = heardBy.find((c) => c.char && c.char.id === lastVoiceId);
    if (last) return [last];
  }
  return heardBy.length ? [heardBy[0]] : [];
}

function overhear(companion, npcName, text) {
  const line = String(text || '').trim();
  if (!line || !companion || !companion.char) return;
  const name = String(npcName || 'Someone').replace(/_/g, ' ');
  remember(companion, 'user', `${name} (npc): ${line}`);
  console.log(`[COMPANION] ${companion.char.name} hears ${name}: ${line}`);
  const speaker = {
    isNpc: true,
    char: {
      id: `npc:${name}`,
      name,
      zoneId: companion.char.zoneId,
      x: companion.char.x,
      y: companion.char.y,
    },
  };
  queueJob({ companion, speaker, channel: 'npc', line, image: null });
}

function hearWhisper(speaker, companion, text) {
  const line = String(text || '').trim();
  if (!line || !speaker || !companion || !companion.isCompanion || speaker.isCompanion) return;
  if (!speaker.char || !companion.char) return;
  companion._whisperReplyTo = speaker;
  if (companion.bot && typeof companion.bot.handleChat === 'function') {
    try {
      companion.bot.handleChat(line, speaker.char.name);
    } catch (e) { /* ignore */ }
  }
  companion._whisperReplyTo = null;
  if (isUtilityOrder(line)) return;
  queueJob({ companion, speaker, channel: 'whisper', line, image: null });
}

function notice(speaker, channel, text, image) {
  const line = String(text || '').trim();
  if (!line || !speaker || speaker.isCompanion) return;
  const heardBy = companions().filter((c) => hears(speaker, c, channel));
  if (heardBy.length === 0) return;
  const voices = voicesFor(heardBy, line);
  const speaking = new Set(voices);
  const heard = `${speaker.char.name} (${channel}): ${line}`;
  for (const companion of heardBy) {
    if (!speaking.has(companion)) remember(companion, 'user', heard);
  }
  for (const companion of voices) {
    queueJob({ companion, speaker, channel, line, image: image || null });
  }
}

async function reply(job) {
  const { companion, speaker, channel, line, image } = job;
  if (busy) {
    pendingJobs.push(job);
    return;
  }
  busy = true;
  try {
    const heard = channel === 'emote' ? cleanEmote(line) : line;
    remember(companion, 'user', `${speaker.char.name} (${channel}): ${heard}`);
    let answer = await think(channel, speaker.char.name, heard, companion, speaker, image);
    if (!answer) {
      if (warnedNoKey) return;
      warnedNoKey = true;
      answer = 'OOC: I can hear you, but I have no voice yet. Add CURSOR_API_KEY to the server env and restart.';
    }
    const parsed = splitReply(answer, companion.char.name);
    const fromSpeech = commandFromSpeech(parsed.ic);
    let ic = fromSpeech ? '' : parsed.ic;
    const act = parsed.act || fromSpeech || '';
    const playBoth = channel === 'ooc' && sceneForBoth(heard);
    if (channel === 'ooc' && !playBoth && !parsed.ooc && ic) {
      parsed.ooc = ic;
      ic = '';
    }
    const askedForNumbers = /\?/.test(heard) || /\b(how (?:much|many)|what(?:'s| is) (?:your|her)|tell me)\b/i.test(heard);
    const privateTalk = channel === 'whisper';
    const sendOoc = channel === 'ooc'
      ? parsed.ooc && (askedForNumbers || !oocIsStatus(parsed.ooc))
      : parsed.ooc && oocIsNecessary(parsed.ooc);
    if (sendOoc && !(privateTalk && (ic || parsed.say))) {
      remember(companion, 'assistant', `OOC: ${parsed.ooc}`);
      if (privateTalk) whisperTo(companion, speaker, parsed.ooc);
      else speak(companion, 'ooc', parsed.ooc);
      console.log(`[COMPANION] ${companion.char.name} ooc: ${parsed.ooc}`);
    } else if (parsed.ooc) {
      console.log(`[COMPANION] ${companion.char.name} ooc dropped: ${parsed.ooc}`);
    }
    const talkingToNpc = channel === 'npc' || (companion.combatTarget && companion.combatTarget.npcType && /\b(say|tell|answer|speak to)\b/i.test(line));
    if (channel === 'ooc' && !playBoth) {
      // They spoke to Grok. The answer stays out of character.
    } else if (talkingToNpc && parsed.say) {
      remember(companion, 'assistant', `SAY: ${parsed.say}`);
      speak(companion, 'say', parsed.say);
      console.log(`[COMPANION] ${companion.char.name} say: ${parsed.say}`);
    } else if (ic) {
      const outChannel = talkingToNpc ? 'say' : voiceChannel(channel, companion);
      remember(companion, 'assistant', `IC: ${ic}`);
      if (outChannel === 'whisper') whisperTo(companion, speaker, ic);
      else speak(companion, outChannel, ic);
      console.log(`[COMPANION] ${companion.char.name} ${outChannel}: ${ic}`);
    } else if (parsed.say) {
      remember(companion, 'assistant', `SAY: ${parsed.say}`);
      if (privateTalk) whisperTo(companion, speaker, parsed.say);
      else speak(companion, 'say', parsed.say);
      console.log(`[COMPANION] ${companion.char.name} say: ${parsed.say}`);
    } else if (parsed.em) {
      const em = cleanEmote(parsed.em);
      if (em) {
        remember(companion, 'assistant', `EM: ${em}`);
        if (privateTalk) whisperTo(companion, speaker, em);
        else broadcastEmote(companion, em);
        console.log(`[COMPANION] ${companion.char.name} emote: ${em}`);
      }
    }
    await perform(companion, speaker, act, line);
  } catch (e) {
    console.error('[COMPANION] mind error:', e.message);
    const apology = 'Something went wrong on my side. I heard you, but I could not answer.';
    if (channel === 'whisper') whisperTo(companion, speaker, apology);
    else speak(companion, 'ooc', apology);
  } finally {
    busy = false;
    if (pendingJobs.length) {
      const next = pendingJobs.shift();
      void reply(next);
    }
  }
}

function browseTarget(companion) {
  const target = companion.combatTarget;
  if (!target || !target.name) return Promise.resolve(false);
  return doBrowse(companion, String(target.name).replace(/_/g, ' '));
}

module.exports = {
  notice,
  hearWhisper,
  receiveOffer,
  overhear,
  browseTarget,
  buyRemembered: doBuy,
  sellRemembered: doSell,
  castRemembered: (companion, spellName) => castOn(companion, spellName, '', null),
  considerMeditate,
  followRadiusOf,
};
