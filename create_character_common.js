'use strict';

/**
 * Shared EQMUD character creation used by login_server and zone gameEngine.
 * Validates race/class/deity via DB, applies stat allocation, inserts character,
 * grants starter gear, spells, and racial skills.
 */

const DB = require('./db');
const eqemuDB = require('./eqemu_db');
const combat = require('./combat');
const InventorySystem = require('./systems/inventory');
const constants = require('./data/constants');
const { INV_CLASSES, INV_RACES } = constants;
const SpellDB = require('./data/spellDatabase');
const { RACIAL_STARTING_SKILLS } = require('./data/skills');
const { STARTER_GEAR } = require('./data/items');
const ItemDB = require('./data/itemDatabase');

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
		appearance,
		{}
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

	await grantCharacterCreationExtras(char.id, charClass, race);

	console.log(
		`[CREATE_CHAR] ${charClass} "${char.name}" (${race}) STR=${finalStats.str} STA=${finalStats.sta} AGI=${finalStats.agi} DEX=${finalStats.dex} WIS=${finalStats.wis} INT=${finalStats.intel} CHA=${finalStats.cha}`
	);

	const characters = await DB.getCharactersByAccount(accountId);
	return { name: char.name, characters };
}

/** Gear, starter spells, and racial skills for a newly inserted character row. */
async function grantCharacterCreationExtras(charId, charClass, race) {
	const starterItems = STARTER_GEAR[charClass] || STARTER_GEAR.warrior;
	for (const gear of starterItems) {
		await DB.addItem(charId, gear.itemId, 1, gear.slot);
	}

	const starterKeys = STARTER_SPELLS[charClass] || [];
	if (starterKeys.length > 0) {
		let slotIdx = 0;
		for (const key of starterKeys) {
			const spellDef = SpellDB.getByKey(key);
			if (spellDef) {
				await DB.memorizeSpell(charId, spellDef._key, slotIdx++);
			} else {
				console.warn(`[CREATE_CHAR] Starter spell '${key}' not found for ${charClass}`);
			}
		}
	}

	const racialSkills = RACIAL_STARTING_SKILLS[race];
	if (racialSkills) {
		await DB.saveCharacterSkills(charId, racialSkills);
	}

	// Basic drink + food (PEQ starting_items may omit these for some race/class rows).
	// Drink id must match your `items` table — resolve by name so a wrong hardcoded id
	// (e.g. 10739 pointing at another item in a custom DB) does not grant junk.
	await ItemDB.loadItems();
	const drinkNames = ['Flask of Water', 'Flask of Pure Water', 'Canteen of Murky Water'];
	let starterDrinkId = null;
	for (const nm of drinkNames) {
		const d = ItemDB.getByName(nm);
		if (d && d._id != null) {
			starterDrinkId = d._id;
			break;
		}
	}
	if (starterDrinkId == null) starterDrinkId = 13042;

	const foodNames = ['Iron Ration', "Brell's Blessed Stale Biscuits", "Baker's Loaf"];
	let starterFoodId = null;
	for (const nm of foodNames) {
		const f = ItemDB.getByName(nm);
		if (f && f._id != null) {
			starterFoodId = f._id;
			break;
		}
	}
	if (starterFoodId == null) starterFoodId = 5294;

	let inv = await DB.getInventory(charId);
	let slot = InventorySystem.getFirstEmptySlot(inv);
	if (slot >= 0) {
		await DB.addItem(charId, starterDrinkId, 0, slot, 1);
		inv = await DB.getInventory(charId);
		slot = InventorySystem.getFirstEmptySlot(inv);
		if (slot >= 0) {
			await DB.addItem(charId, starterFoodId, 0, slot, 1);
		}
	}
}

/**
 * Create a student character (full `character_data` row) owned by the mentor main.
 * @param {number} accountId
 * @param {{ char: object }} mentorSession — active world session whose `char` is the mentor main
 * @param {object} msg — HIRE_STUDENT payload (name, raceId, classId, level, stats, gender, face, deity/deityId)
 */
async function hireStudentFromMessage(accountId, mentorSession, msg) {
	const mentorChar = mentorSession.char;
	const rawName = String(msg.name || '').trim();
	if (rawName.length < 2) {
		return { error: 'Character name is too short.' };
	}

	const countSt = await DB.countStudentsForMentor(mentorChar.id);
	if (countSt >= 2) {
		return { error: 'You already have the maximum number of students (2).' };
	}

	const level = Math.max(1, Math.min(Number(msg.level) || 1, Number(mentorChar.level) || 1));
	const deity = msg.deity != null ? Number(msg.deity) : (msg.deityId != null ? Number(msg.deityId) : 396);
	const classId = Number(msg.classId) || 1;
	const raceId = Number(msg.raceId) || 1;

	const classKey = INV_CLASSES[classId] || 'warrior';
	const raceKey = INV_RACES[raceId] || 'human';

	const createData = await eqemuDB.getCharCreateData(raceId);
	const classEntry = createData.classes.find((c) => c.classId === classId);
	if (!classEntry) {
		return { error: 'That race cannot be that class.' };
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

	const startHp = combat.calcMaxHP(classKey, level, finalStats.sta);
	const startMana = combat.calcMaxMana(classKey, level, finalStats);

	const appearance = {
		gender: msg.gender ?? 0,
		face: msg.face ?? 0,
		hairStyle: msg.hairStyle ?? 0,
		hairColor: msg.hairColor ?? 0,
		beard: msg.beard ?? 0,
		beardColor: msg.beardColor ?? 0,
		eyeColor: msg.eyeColor ?? 0,
	};

	const zoneNum = eqemuDB.getZoneIdByShortName(mentorChar.zoneId);
	if (!zoneNum) {
		return { error: 'Could not resolve mentor zone for student placement.' };
	}

	const createResult = await DB.createCharacter(
		accountId,
		rawName,
		classKey,
		raceKey,
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
		appearance,
		{
			mentorCharacterId: mentorChar.id,
			initialLevel: level,
			spawnOverride: {
				zoneNumericId: zoneNum,
				x: mentorChar.x,
				y: mentorChar.y,
				z: mentorChar.z || 0,
				heading: mentorChar.heading || 0,
			},
		}
	);

	if (createResult && createResult.error) {
		return { error: createResult.error };
	}
	if (!createResult) {
		return { error: 'Database error while hiring student.' };
	}

	const char = await DB.getCharacter(createResult.name);
	if (!char) {
		return { error: 'Student was created but could not be loaded.' };
	}

	await grantCharacterCreationExtras(char.id, classKey, raceKey);

	console.log(
		`[HIRE_STUDENT] ${classKey} "${char.name}" (${raceKey}) mentor=${mentorChar.name} L${level}`
	);

	return { name: char.name, charId: char.id };
}

module.exports = { createCharacterFromClientMessage, hireStudentFromMessage, grantCharacterCreationExtras, STARTER_SPELLS };
