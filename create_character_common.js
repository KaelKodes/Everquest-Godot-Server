'use strict';

/**
 * Shared EQMUD character creation used by login_server and zone gameEngine.
 * Validates race/class/deity via DB, applies stat allocation, inserts character,
 * grants starter gear, spells, and racial skills.
 */

const DB = require('./db');
const eqemuDB = require('./eqemu_db');
const combat = require('./combat');
const constants = require('./data/constants');
const SpellDB = require('./data/spellDatabase');
const { RACIAL_STARTING_SKILLS } = require('./data/skills');
const { STARTER_GEAR } = require('./data/items');

const STARTER_SPELLS = {
	cleric: ['minor_healing', 'strike'],
	wizard: ['frost_bolt', 'minor_shielding'],
	necromancer: ['lifetap', 'minor_shielding'],
	enchanter: ['lull', 'minor_shielding'],
	magician: ['flare', 'minor_shielding'],
	druid: ['minor_healing', 'snare'],
	shaman: ['minor_healing', 'inner_fire'],
	bard: ['chant_of_battle'],
	ranger: ['salve'],
	paladin: ['salve'],
	shadow_knight: ['spike_of_disease'],
	warrior: [],
	monk: [],
	rogue: [],
};

/**
 * @param {number} accountId
 * @param {object} msg - CREATE_CHARACTER WebSocket payload
 * @returns {Promise<{ error: string } | { name: string, characters: object[] }>}
 */
async function createCharacterFromClientMessage(accountId, msg) {
	const rawName = String(msg.name || '').trim();
	if (rawName.length < 2) {
		return { error: 'Character name is too short.' };
	}
	const name = rawName;
	const charClass = msg.class || 'warrior';
	const race = msg.race || 'human';
	const deity = msg.deity != null ? msg.deity : 396;

	const raceId = constants.RACES[race] || 1;
	const classId = constants.CLASSES[charClass] || 1;

	const createData = await eqemuDB.getCharCreateData(raceId);
	const classEntry = createData.classes.find((c) => c.classId === classId);
	if (!classEntry) {
		return { error: `${race} cannot be a ${charClass}.` };
	}
	if (!classEntry.deities.includes(deity)) {
		return { error: 'That deity is not available for this race/class combination.' };
	}

	const dbAlloc = classEntry.allocation;
	const totalPool =
		(dbAlloc.alloc_str || 0) +
		(dbAlloc.alloc_sta || 0) +
		(dbAlloc.alloc_dex || 0) +
		(dbAlloc.alloc_agi || 0) +
		(dbAlloc.alloc_int || 0) +
		(dbAlloc.alloc_wis || 0) +
		(dbAlloc.alloc_cha || 0);

	let allocStr;
	let allocSta;
	let allocDex;
	let allocAgi;
	let allocInt;
	let allocWis;
	let allocCha;

	if (msg.stats && typeof msg.stats === 'object') {
		allocStr = Math.max(0, Number(msg.stats.str) || 0);
		allocSta = Math.max(0, Number(msg.stats.sta) || 0);
		allocDex = Math.max(0, Number(msg.stats.dex) || 0);
		allocAgi = Math.max(0, Number(msg.stats.agi) || 0);
		allocInt = Math.max(0, Number(msg.stats.int ?? msg.stats.intel) || 0);
		allocWis = Math.max(0, Number(msg.stats.wis) || 0);
		allocCha = Math.max(0, Number(msg.stats.cha) || 0);
		const spent = allocStr + allocSta + allocDex + allocAgi + allocInt + allocWis + allocCha;
		if (spent > totalPool) {
			return { error: `You spent ${spent} stat points but only have ${totalPool}.` };
		}
	} else {
		allocStr = dbAlloc.alloc_str || 0;
		allocSta = dbAlloc.alloc_sta || 0;
		allocDex = dbAlloc.alloc_dex || 0;
		allocAgi = dbAlloc.alloc_agi || 0;
		allocInt = dbAlloc.alloc_int || 0;
		allocWis = dbAlloc.alloc_wis || 0;
		allocCha = dbAlloc.alloc_cha || 0;
	}

	const finalStats = {
		str: dbAlloc.base_str + allocStr,
		sta: dbAlloc.base_sta + allocSta,
		agi: dbAlloc.base_agi + allocAgi,
		dex: dbAlloc.base_dex + allocDex,
		wis: dbAlloc.base_wis + allocWis,
		intel: dbAlloc.base_int + allocInt,
		cha: dbAlloc.base_cha + allocCha,
	};

	const startHp = combat.calcMaxHP(charClass, 1, finalStats.sta);
	const startMana = combat.calcMaxMana(charClass, 1, finalStats);

	const appearance = {
		gender: msg.gender ?? 0,
		face: msg.face ?? 0,
		hairStyle: msg.hairStyle ?? 0,
		hairColor: msg.hairColor ?? 0,
		beard: msg.beard ?? 0,
		beardColor: msg.beardColor ?? 0,
		eyeColor: msg.eyeColor ?? 0,
	};

	const createResult = await DB.createCharacter(
		accountId,
		name,
		charClass,
		race,
		deity,
		finalStats.str,
		finalStats.sta,
		finalStats.agi,
		finalStats.dex,
		finalStats.wis,
		finalStats.intel,
		finalStats.cha,
		startHp,
		startMana,
		appearance
	);

	if (createResult && createResult.error) {
		return { error: createResult.error };
	}
	if (!createResult) {
		return { error: 'Database error while creating character.' };
	}

	const char = await DB.getCharacter(name);
	if (!char) {
		return { error: 'Character was created but could not be loaded.' };
	}

	const starterItems = STARTER_GEAR[charClass] || STARTER_GEAR.warrior;
	for (const gear of starterItems) {
		await DB.addItem(char.id, gear.itemId, 1, gear.slot);
	}

	const starterKeys = STARTER_SPELLS[charClass] || [];
	if (starterKeys.length > 0) {
		let slotIdx = 0;
		for (const key of starterKeys) {
			const spellDef = SpellDB.getByKey(key);
			if (spellDef) {
				await DB.memorizeSpell(char.id, spellDef._key, slotIdx++);
			} else {
				console.warn(`[CREATE_CHAR] Starter spell '${key}' not found for ${charClass}`);
			}
		}
	}

	const racialSkills = RACIAL_STARTING_SKILLS[race];
	if (racialSkills) {
		await DB.saveCharacterSkills(char.id, racialSkills);
	}

	console.log(
		`[CREATE_CHAR] ${charClass} "${char.name}" (${race}) STR=${finalStats.str} STA=${finalStats.sta} AGI=${finalStats.agi} DEX=${finalStats.dex} WIS=${finalStats.wis} INT=${finalStats.intel} CHA=${finalStats.cha}`
	);

	const characters = await DB.getCharactersByAccount(accountId);
	return { name: char.name, characters };
}

module.exports = { createCharacterFromClientMessage, STARTER_SPELLS };
