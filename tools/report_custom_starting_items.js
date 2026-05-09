/**
 * Report start_zones + starting_items for EQMUD custom race/class/deity combos.
 *
 * Usage (from server/):
 *   node tools/report_custom_starting_items.js
 *
 * Uses ../.env for MySQL. Read-only.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { CLASSES, RACES, INV_CLASSES, INV_RACES } = require('../data/constants');

const UNIVERSAL_ITEM_IDS = new Set([9979, 9990, 9991, 32601]);

/** User-facing deity string -> EQEmu deity id (see eqemu_db CHAR_CREATE_DEITY_NAMES) */
const DEITY_ALIASES = {
  agnostic: 396,
  tribunal: 214,
  'the tribunal': 214,
  'mithaniel marr': 208,
  mithaniel: 208,
  bristlebane: 205,
  'rallos zek': 211,
  quellious: 210,
  karana: 207,
  // UI label "Dark Karana" — same deity id as Karana (207), not a separate PEQ deity.
  'dark karana': 207,
  tunare: 215,
  'erollisi marr': 204,
  innoruuk: 206,
  'the faceless': 203,
  'cazic-thule': 203,
  'cazic thule': 203,
  cazic: 203,
  bertoxxulous: 201,
  bertox: 201,
  'solusek ro': 213,
  'brell serilis': 202,
  brell: 202,
};

async function getStartZone(conn, raceId, classId, deityId) {
  let [rows] = await conn.query(
    `SELECT sz.x, sz.y, sz.z, sz.zone_id, z.short_name AS zone_short
     FROM start_zones sz
     JOIN zone z ON sz.zone_id = z.zoneidnumber
     WHERE sz.player_race = ? AND sz.player_class = ? AND sz.player_deity = ?
     LIMIT 1`,
    [raceId, classId, deityId]
  );
  if (rows.length === 0) {
    [rows] = await conn.query(
      `SELECT sz.x, sz.y, sz.z, sz.zone_id, z.short_name AS zone_short
       FROM start_zones sz
       JOIN zone z ON sz.zone_id = z.zoneidnumber
       WHERE sz.player_race = ? AND sz.player_class = ?
       LIMIT 1`,
      [raceId, classId]
    );
  }
  if (rows.length === 0) {
    return { zone_id: 4, zone_short: 'qeytoqrg_FALLBACK', fallback: true };
  }
  const r = rows[0];
  return { zone_id: r.zone_id, zone_short: r.zone_short, fallback: false };
}

async function startingItemsFor(conn, raceId, classId, deityId, zoneId) {
  const [rows] = await conn.query(
    `SELECT si.item_id, i.Name AS item_name, si.item_charges, si.inventory_slot,
            si.zone_id_list, si.class_list, si.race_list, si.deity_list
     FROM starting_items si
     LEFT JOIN items i ON i.id = si.item_id
     WHERE si.status = 0
       AND (si.class_list = '0' OR FIND_IN_SET(?, REPLACE(si.class_list, '|', ',')))
       AND (si.race_list = '0' OR FIND_IN_SET(?, REPLACE(si.race_list, '|', ',')))
       AND (si.deity_list = '0' OR FIND_IN_SET(?, REPLACE(si.deity_list, '|', ',')))
       AND (si.zone_id_list = '0' OR FIND_IN_SET(?, REPLACE(si.zone_id_list, '|', ',')))
     ORDER BY si.item_id, si.inventory_slot`,
    [String(classId), String(raceId), String(deityId), String(zoneId)]
  );
  return rows;
}

function isUniversalRow(r) {
  return (
    UNIVERSAL_ITEM_IDS.has(Number(r.item_id)) &&
    String(r.zone_id_list) === '0' &&
    String(r.class_list) === '0' &&
    String(r.race_list) === '0' &&
    String(r.deity_list) === '0'
  );
}

/** Lines: "RaceKey\tClassKey\tdeity alias, deity alias" */
const RAW_COMBOS = `
barbarian	bard	tribunal, mithaniel marr, bristlebane, rallos zek, agnostic
barbarian	monk	tribunal, quellious, rallos zek, agnostic
barbarian	druid	karana, tunare, the tribunal, erollisi marr, agnostic
dark_elf	monk	innoruuk, the faceless, agnostic
dark_elf	ranger	innoruuk, bertoxxulous, solusek ro, dark karana, agnostic
dwarf	beastlord	brell serilis, agnostic
dwarf	monk	brell serilis, the tribunal, agnostic
erudite	rogue	cazic-thule, innoruuk, agnostic
erudite	shaman	cazic-thule, innoruuk, agnostic
gnome	shaman	brell, bristlebane, agnostic
half_elf	beastlord	karana, mithaniel marr, tunare, agnostic
half_elf	monk	quellious, karana, the tribunal, agnostic
halfling	bard	bristlebane, karana, agnostic
halfling	shaman	bristlebane, karana, agnostic
high_elf	bard	tunare, mithaniel marr, erollisi marr, solusek ro, agnostic
high_elf	necromancer	bertoxxulous, agnostic
high_elf	necromancer	innoruuk
iksar	magician	cazic-thule, agnostic
iksar	rogue	cazic-thule, agnostic
ogre	bard	rallos zek, cazic-thule, agnostic
troll	necromancer	cazic-thule, innoruuk, agnostic
vah_shir	druid	agnostic
vah_shir	monk	agnostic
vah_shir	shadow_knight	bertox, cazic, agnostic
vah_shir	shadow_knight	innoruuk
wood_elf	monk	tunare, quellious, agnostic
wood_elf	shaman	tunare, agnostic
froglok	bard	mithaniel marr, agnostic
froglok	beastlord	mithaniel marr, the tribunal, agnostic
froglok	druid	mithaniel, tunare, agnostic
froglok	ranger	mithaniel, tunare, agnostic
`.trim();

function parseDeityAliases(s) {
  return s.split(',').map((x) => x.trim().toLowerCase());
}

function resolveDeityId(alias) {
  const key = alias.toLowerCase().replace(/\s+/g, ' ').trim();
  if (DEITY_ALIASES[key] != null) return DEITY_ALIASES[key];
  const compact = key.replace(/[^a-z]/g, '');
  for (const [k, v] of Object.entries(DEITY_ALIASES)) {
    if (k.replace(/[^a-z]/g, '') === compact) return v;
  }
  return null;
}

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.EQEMU_HOST || '127.0.0.1',
    port: Number(process.env.EQEMU_PORT || 3307),
    user: process.env.EQEMU_USER || 'eqemu',
    password: process.env.EQEMU_PASSWORD,
    database: process.env.EQEMU_DATABASE || 'peq',
  });

  let darkKaranaNote = '';
  try {
    const [dk] = await conn.query(
      "SELECT id, name FROM deity_list WHERE LOWER(name) LIKE '%dark%karana%' OR LOWER(name) LIKE '%karana%' LIMIT 15"
    );
    if (dk.length) {
      darkKaranaNote = `DB deity_list Karana-ish rows: ${dk.map((r) => `${r.id}=${r.name}`).join('; ')}`;
    }
  } catch {
    darkKaranaNote = '(no deity_list table or query failed)';
  }

  const lines = RAW_COMBOS.split('\n').filter(Boolean);
  const rows = [];

  for (const line of lines) {
    const parts = line.split('\t').map((x) => x.trim());
    if (parts.length < 3) continue;
    const [raceKey, classKey, deityStr] = parts;
    const raceId = RACES[raceKey];
    const classId = CLASSES[classKey];
    if (!raceId || !classId) {
      rows.push({ raceKey, classKey, error: `unknown race/class key (raceId=${raceId} classId=${classId})` });
      continue;
    }
    const aliases = parseDeityAliases(deityStr);
    const deityIds = [];
    for (const a of aliases) {
      const id = resolveDeityId(a);
      if (id == null) deityIds.push({ alias: a, id: null });
      else deityIds.push({ alias: a, id });
    }

    for (const { alias, id: deityId } of deityIds) {
      if (deityId == null) {
        rows.push({
          raceKey,
          classKey,
          raceId,
          classId,
          deityAlias: alias,
          deityId: null,
          error: 'UNKNOWN_DEITY_ALIAS',
        });
        continue;
      }
      const sz = await getStartZone(conn, raceId, classId, deityId);
      const items = await startingItemsFor(conn, raceId, classId, deityId, sz.zone_id);
      const conditional = items.filter((it) => !isUniversalRow(it));
      rows.push({
        raceKey,
        classKey,
        raceId,
        classId,
        deityAlias: alias,
        deityId,
        zoneId: sz.zone_id,
        zoneShort: sz.zone_short,
        startZoneFallback: !!sz.fallback,
        totalItems: items.length,
        conditionalCount: conditional.length,
        conditional: conditional.map((it) => ({
          item_id: it.item_id,
          name: it.item_name,
          slot: it.inventory_slot,
        })),
      });
    }
  }

  console.log('=== Custom combo report: start_zones + starting_items ===');
  if (darkKaranaNote) console.log(darkKaranaNote + '\n');
  console.log('Universal items (any race/class/zone/deity 0): 9979 lantern, 9990 milk, 9991 bread cakes, 32601 backpack*');
  console.log('"conditional" = rows that are NOT those four with all lists = 0.\n');

  for (const r of rows) {
    if (r.error) {
      console.log(`!! ${r.raceKey} / ${r.classKey} / ${r.deityAlias || ''} :: ${r.error}`);
      continue;
    }
    const flag = r.startZoneFallback
      ? ' <<< NO start_zones row (would default to qeytoqrg in createCharacter)'
      : r.conditionalCount === 0
        ? ' (only universal 4 — no zone/class/race/deity-specific rows in PEQ)'
        : '';
    console.log(
      `${r.raceKey} ${r.classKey} | deity ${r.deityAlias} [id=${r.deityId}] | zone ${r.zoneId} ${r.zoneShort}${r.startZoneFallback ? ' [FALLBACK]' : ''}`
    );
    console.log(`  items: ${r.totalItems} total, ${r.conditionalCount} conditional${flag}`);
    if (r.conditional.length) {
      for (const c of r.conditional) {
        console.log(`    - ${c.item_id} ${c.name} (slot ${c.slot})`);
      }
    }
    console.log('');
  }

  await conn.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
