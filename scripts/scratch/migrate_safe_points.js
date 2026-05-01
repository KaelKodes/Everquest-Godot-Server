// Migration script: Update zone safe points from P99 wiki evacuate locations
// Wiki format is /loc (Y, X) → DB format: safe_x = X (second), safe_y = Y (first)
require('dotenv').config();
const mysql = require('mysql2/promise');

// Wiki data: [zone_long_name_pattern, loc_y, loc_x]
// /loc format is (Y, X) so safe_x = X (second), safe_y = Y (first)
const wikiData = [
  // Antonica
  ['befallen', -75, 35],
  ['blackburrow', -158, 38],
  ['cazicthule', 80, -80],
  ['ecommons', 9, -1485],
  ['eastkarana', 0, 0],
  ['everfrost', 3139, 629],
  ['freporte', -1097, -648],
  ['freportn', -296, 211],
  ['freportw', 335, 181],
  ['beholder', -513, -22],  // Gorge of King Xorbb
  ['grobb', -100, 0],
  ['halas', 0, 0],
  ['highkeep', -16, 88],
  ['highpass', -14, -104],
  ['innothule', -2192, -588],
  ['kithicor', 1889, 3828],
  ['lakerathe', 4183, 1213],
  ['lavastorm', -1843, 153],
  ['gukbottom', 1197, -217],  // Lower Guk
  ['misty', 0, 0],
  ['soldungb', -424, -263],  // Nagafen's Lair
  ['najena', -13, 856],
  ['nektulos', 2055, -701],
  ['neriakc', 3, -500],     // Neriak Commons
  ['neriaka', -3, 157],     // Neriak Foreign Quarter
  ['neriakb', 892, -969],   // Neriak Third Gate
  ['nro', 3537, 299],       // North Ro
  ['northkarana', -284, -382],
  ['oasis', 490, 903],
  ['oot', 390, -9200],      // Ocean of Tears
  ['oggok', -345, -99],
  ['permafrost', 0, 0],
  ['qcat', 214, -315],      // Qeynos Catacombs
  ['qey2hh1', 508, 83],     // Qeynos Hills
  ['qeynos', 678, 114],     // North Qeynos
  ['qeynos2', 14, 186],     // South Qeynos
  ['rathemtn', 3825, 1831], // Rathe Mountains
  ['rivervale', 2, 45],
  ['runnyeye', -109, -22],
  ['soldunga', -476, -486], // Solusek's Eye
  ['sro', 1265, 286],       // South Ro
  ['southkarana', 2348, 1294],
  ['splitpaw', -79, -7],
  ['qrg', -66, 137],        // Surefall Glade
  ['soltemple', 269, 8],     // Temple of Solusek Ro
  ['arena', -41, 461],       // The Arena
  ['feerrott', 1091, 902],
  ['guktop', -36, 7],        // Upper Guk
  ['commons', 209, -1335],   // West Commonlands
  ['qeytoqrg', 12, -638],   // Western Plains of Karana (try westkarana too)

  // Faydwer
  ['akanon', 47, -35],
  ['butcher', 2550, -700],
  ['crushbone', -644, 158],
  ['cauldron', 2815, 320],
  ['felwithea', -25, 94],
  ['felwitheb', 320, -790],
  ['gfaydark', -20, 10],
  ['kaladima', 414, -267],
  ['kaladimb', -18, -2],
  ['kedge', 14, 100],
  ['lfaydark', -108, -1770],
  ['mistmoore', -295, 123],
  ['steamfont', 159, -273],
  ['unrest', -38, 52],

  // Kunark
  ['burningwood', -4942, -821],
  ['cabeast', 1362, -417],
  ['cabwest', -783, 767],
  ['charasis', 0, 0],        // Howling Stones
  ['chardok', 119, 859],
  ['citymist', 28, -734],
  ['dalnir', 8, 90],
  ['dreadlands', 2806, 9565],
  ['emeraldjungle', -1223, 4648],
  ['fieldofbone', -1684, 1617],
  ['firiona', -2392, 1440],
  ['frontiermtns', -633, -4262],
  ['kaesora', 370, 40],
  ['karnor', 18, 302],
  ['kurn', -265, 20],
  ['lakeofillomen', 5747, -5383],
  ['nurga', -2000, -1762],
  ['sebilis', 250, 0],
  ['skyfire', -1140, -4290],
  ['swampofnohope', 2761, 2945],
  ['droga', 1375, 290],
  ['overthere', -3500, 1450],
  ['timorous', -5392, 2194],
  ['trakanon', 3868, 1486],
  ['veeshan', -5, 1783],
  ['warslikswood', -1429, -468],

  // Odus
  ['erudnext', -1767, 795],  // Erud's Crossing (try erudsxing too)
  ['erudin', 109, -309],
  ['erudnint', 712, 808],    // Erudin Palace
  ['kerraridge', 474, -860],
  ['paineel', 800, 200],
  ['stonebrunt', -3427, -1643],
  ['hole', 640, -1050],
  ['warrens', 748, -930],
  ['tox', 2295, 203],        // Toxxulia Forest

  // Planes
  ['fearplane', -1139, 1282],
  ['hateplane', -375, -354],
  // Plane of Sky - does not work
  ['growthplane', -2507, 2915],
  ['mischiefplane', -1400, -400],

  // Velious
  ['cobaltscar', -939, 895],
  ['crystal', 487, 303],      // Crystal Caverns
  ['necropolis', -100, 2000],
  ['eastwastes', -5049, -4296],
  ['greatdivide', -7720, -965],
  ['iceclad', 5330, 340],
  ['thurgadina', 250, 0],     // Icewell Keep (try icewellkeep too)
  ['kael', -250, -500],
  ['sirens', 200, -25],       // Siren's Grotto
  ['skyshrine', -100, -730],
  ['thurgadinb', -1222, 0],   // Thurgadin city (try thurgadin too)
  ['frozenshadow', 120, 200],
  ['wakening', -673, -5000],
  ['westwastes', -4100, -3500],
  ['templeveeshan', -2086, -499],
  ['velketor', 581, -65],
];

(async () => {
  const p = mysql.createPool({
    host: process.env.EQEMU_HOST || '127.0.0.1',
    port: process.env.EQEMU_PORT || 3307,
    user: process.env.EQEMU_USER || 'eqemu',
    password: process.env.EQEMU_PASSWORD || '',
    database: process.env.EQEMU_DATABASE || 'peq',
  });

  let updated = 0;
  let notFound = [];

  for (const [shortName, locY, locX] of wikiData) {
    // Wiki /loc format: (Y, X) → DB: safe_x = X (second), safe_y = Y (first), safe_z = 0
    const safe_x = locX;
    const safe_y = locY;
    const safe_z = 0; // Height — client raycast will find the actual terrain

    const [result] = await p.query(
      'UPDATE zone SET safe_x = ?, safe_y = ?, safe_z = ? WHERE short_name = ?',
      [safe_x, safe_y, safe_z, shortName]
    );

    if (result.affectedRows > 0) {
      updated++;
      console.log(`✓ ${shortName.padEnd(18)} safe_x=${String(safe_x).padStart(6)} safe_y=${String(safe_y).padStart(6)}`);
    } else {
      notFound.push(shortName);
    }
  }

  console.log(`\nUpdated ${updated} zones.`);
  if (notFound.length > 0) {
    console.log(`Not found (${notFound.length}): ${notFound.join(', ')}`);
    
    // Try to find similar zone names for unmatched entries
    for (const name of notFound) {
      const [rows] = await p.query("SELECT short_name FROM zone WHERE short_name LIKE ?", [`%${name.replace(/[ab]$/, '')}%`]);
      if (rows.length > 0) {
        console.log(`  ${name} → possible matches: ${rows.map(r => r.short_name).join(', ')}`);
      }
    }
  }

  // Verify arena specifically
  const [arena] = await p.query("SELECT safe_x, safe_y, safe_z FROM zone WHERE short_name = 'arena'");
  console.log(`\nArena verification: safe_x=${arena[0].safe_x}, safe_y=${arena[0].safe_y}, safe_z=${arena[0].safe_z}`);

  await p.end();
  process.exit(0);
})();
