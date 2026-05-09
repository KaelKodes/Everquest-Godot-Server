/**
 * Scan eqmud/Data for per-race face variant counts (textures + GLB naming conventions).
 * Used by login_server (char create UI) and zone gameEngine (same payload shape).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RACE_MODELS_PATH = path.join(__dirname, '..', 'eqmud', 'Data', 'race_models.json');
const CHARS_DIR = path.join(__dirname, '..', 'eqmud', 'Data', 'Characters');

function countFacesForModelCode(code, charsDir) {
  try {
    const texDir = path.join(charsDir, 'Textures');
    if (fs.existsSync(texDir)) {
      const files = fs.readdirSync(texDir);
      const pattern = new RegExp(`^${code}he00(\\d)1\\.png$`, 'i');
      let maxFace = 0;
      for (const f of files) {
        const match = f.match(pattern);
        if (match) {
          const faceIdx = parseInt(match[1], 10);
          if (faceIdx > maxFace) maxFace = faceIdx;
        }
      }
      if (maxFace > 0) return maxFace + 1;
    }

    const baseFiles = fs.readdirSync(charsDir);
    const facePattern = new RegExp(`^${code}_face(\\d+)\\.glb$`, 'i');
    const faceFiles = baseFiles.filter(f => facePattern.test(f));
    if (faceFiles.length > 0) return faceFiles.length + 1;

    if (code === 'frm' || code === 'frf') {
      const frogPattern = new RegExp(`^${code}_0(\\d)\\.glb$`, 'i');
      const frogFiles = baseFiles.filter(f => frogPattern.test(f));
      if (frogFiles.length > 0) return frogFiles.length;
    }

    return 1;
  } catch {
    return 1;
  }
}

/**
 * @param {number|string} raceId
 * @param {Map<number|string, { male: number, female: number }>} [cache] defaults to global.faceVariantCache
 * @returns {{ faceCountMale: number, faceCountFemale: number }}
 */
function getFaceCountsForRace(raceId, cache) {
  const rid = raceId;
  const map = cache || (global.faceVariantCache = global.faceVariantCache || new Map());

  if (map.has(rid)) {
    const c = map.get(rid);
    return { faceCountMale: c.male, faceCountFemale: c.female };
  }

  let faceCountMale = 1;
  let faceCountFemale = 1;

  try {
    const raceModels = JSON.parse(fs.readFileSync(RACE_MODELS_PATH, 'utf8'));
    const entry = raceModels[String(rid)];
    if (entry) {
      faceCountMale = countFacesForModelCode(entry.m, CHARS_DIR);
      faceCountFemale = countFacesForModelCode(entry.f, CHARS_DIR);
    }
  } catch (e) {
    console.log('[CHAR_CREATE_FACES] Could not scan face variants:', e.message);
  }

  map.set(rid, { male: faceCountMale, female: faceCountFemale });
  return { faceCountMale, faceCountFemale };
}

/**
 * Mutates data (CHAR_CREATE_DATA payload) with faceCountMale / faceCountFemale.
 * @param {object} data from getCharCreateData
 * @param {number|string} raceId
 */
function attachFaceCounts(data, raceId) {
  const { faceCountMale, faceCountFemale } = getFaceCountsForRace(raceId);
  data.faceCountMale = faceCountMale;
  data.faceCountFemale = faceCountFemale;
  return data;
}

module.exports = { getFaceCountsForRace, attachFaceCounts };
