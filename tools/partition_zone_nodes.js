#!/usr/bin/env node
/**
 * Build a two-way zone→node assignment from EQEmu zonelines (zone_points).
 *
 * Reads all zones from `zone`, undirected edges from `zone_points` → target zone,
 * runs a balanced partition (minimize cross-node zonelines, keep sizes ~50/50).
 *
 * Usage:
 *   node tools/partition_zone_nodes.js              # print stats only
 *   node tools/partition_zone_nodes.js --apply      # upsert eqmud_zone_routing
 *   node tools/partition_zone_nodes.js --json out.json
 *
 * Requires .env with EQEMU_* (same as server).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const NODE_A = 'tunare';
const NODE_B = 'innoruuk';

async function loadGraph(pool) {
  const [zrows] = await pool.query(
    'SELECT LOWER(TRIM(short_name)) AS s FROM zone WHERE short_name IS NOT NULL AND short_name != ""'
  );
  const zones = [...new Set(zrows.map((r) => r.s).filter(Boolean))];

  const [erows] = await pool.query(
    `SELECT DISTINCT LOWER(TRIM(z1.short_name)) AS a, LOWER(TRIM(z2.short_name)) AS b
     FROM zone_points zp
     JOIN zone z1 ON z1.short_name = zp.zone
     JOIN zone z2 ON z2.zoneidnumber = zp.target_zone_id
     WHERE zp.is_virtual = 0
       AND z1.short_name IS NOT NULL AND z2.short_name IS NOT NULL
       AND z1.short_name != '' AND z2.short_name != ''`
  );

  const adj = new Map();
  for (const z of zones) adj.set(z, new Set());

  for (const { a, b } of erows) {
    if (!a || !b || a === b) continue;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  }

  return { zones, adj };
}

function bfsDist(adj, start) {
  const dist = new Map([[start, 0]]);
  const q = [start];
  for (let i = 0; i < q.length; i++) {
    const u = q[i];
    const d = dist.get(u);
    for (const v of adj.get(u) || []) {
      if (!dist.has(v)) {
        dist.set(v, d + 1);
        q.push(v);
      }
    }
  }
  return dist;
}

function degree(adj, z) {
  return (adj.get(z) && adj.get(z).size) || 0;
}

/** Greedy balanced assignment: two seeds + fill by affinity, then local refinement. */
function partitionBalanced(zones, adj) {
  const assign = {};
  const n = zones.length;
  if (n === 0) return assign;

  // Seed A: max degree
  let seedA = zones[0];
  let maxDeg = -1;
  for (const z of zones) {
    const d = degree(adj, z);
    if (d > maxDeg) {
      maxDeg = d;
      seedA = z;
    }
  }

  const dist = bfsDist(adj, seedA);
  let seedB = seedA;
  let bestDist = -1;
  for (const z of zones) {
    const d = dist.get(z);
    if (d !== undefined && d > bestDist) {
      bestDist = d;
      seedB = z;
    }
  }
  if (seedB === seedA && zones.length > 1) {
    seedB = zones.find((z) => z !== seedA);
  }

  const setA = new Set([seedA]);
  const setB = new Set([seedB]);
  const unassigned = new Set(zones.filter((z) => z !== seedA && z !== seedB));

  function neighborsInSet(z, s) {
    let c = 0;
    for (const v of adj.get(z) || []) if (s.has(v)) c++;
    return c;
  }

  while (unassigned.size) {
    const useA = setA.size <= setB.size;
    const targetSet = useA ? setA : setB;
    let best = null;
    let bestScore = -1;
    for (const z of unassigned) {
      const score = neighborsInSet(z, targetSet);
      if (score > bestScore) {
        bestScore = score;
        best = z;
      } else if (score === bestScore && best !== null) {
        if (degree(adj, z) > degree(adj, best)) best = z;
      }
    }
    if (!best) best = [...unassigned][0];
    if (useA) setA.add(best);
    else setB.add(best);
    unassigned.delete(best);
  }

  for (const z of setA) assign[z] = NODE_A;
  for (const z of setB) assign[z] = NODE_B;

  // Refinement: single-node moves that reduce cut while keeping size imbalance small
  const maxImbalance = Math.max(8, Math.ceil(n * 0.06));
  function countCut() {
    let c = 0;
    for (const z of zones) {
      for (const v of adj.get(z) || []) {
        if (z < v && assign[z] !== assign[v]) c++;
      }
    }
    return c;
  }

  let cut = countCut();
  let improved = true;
  let passes = 0;
  while (improved && passes < 80) {
    improved = false;
    passes++;
    for (const z of zones) {
      const cur = assign[z];
      const other = cur === NODE_A ? NODE_B : NODE_A;
      let gain = 0;
      for (const v of adj.get(z) || []) {
        if (assign[v] === cur) gain++;
        else if (assign[v] === other) gain--;
      }
      if (gain <= 0) continue;

      const aCount = zones.filter((x) => assign[x] === NODE_A).length;
      const bCount = n - aCount;
      let newDiff;
      if (cur === NODE_A) newDiff = Math.abs(aCount - 1 - (bCount + 1));
      else newDiff = Math.abs(aCount + 1 - (bCount - 1));

      if (newDiff <= maxImbalance) {
        assign[z] = other;
        cut -= gain;
        improved = true;
      }
    }
  }

  return { assign, cutEdges: cut };
}

function summarize(assign, zones, adj) {
  let cut = 0;
  let a = 0,
    b = 0;
  for (const z of zones) {
    if (assign[z] === NODE_A) a++;
    else b++;
  }
  for (const z of zones) {
    for (const v of adj.get(z) || []) {
      if (z < v && assign[z] !== assign[v]) cut++;
    }
  }
  return { tunare: a, innoruuk: b, cutEdges: cut, totalZones: zones.length };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const jsonIdx = args.indexOf('--json');
  const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : null;

  if (!process.env.EQEMU_PASSWORD) {
    console.error('EQEMU_PASSWORD missing (.env)');
    process.exit(1);
  }

  const pool = mysql.createPool({
    host: process.env.EQEMU_HOST || '127.0.0.1',
    port: parseInt(process.env.EQEMU_PORT || '3307', 10),
    user: process.env.EQEMU_USER || 'eqemu',
    password: process.env.EQEMU_PASSWORD,
    database: process.env.EQEMU_DATABASE || 'peq',
    waitForConnections: true,
    connectionLimit: 4,
  });

  try {
    const { zones, adj } = await loadGraph(pool);
    const { assign, cutEdges } = partitionBalanced(zones, adj);
    const stats = summarize(assign, zones, adj);

    console.log('Zone graph partition (from zone_points)');
    console.log(`  Zones: ${stats.totalZones}`);
    console.log(`  Tunare: ${stats.tunare}  Innoruuk: ${stats.innoruuk}  (imbalance ${Math.abs(stats.tunare - stats.innoruuk)})`);
    console.log(`  Cross-node zonelines (undirected): ${stats.cutEdges}`);

    const payload = {
      generatedAt: new Date().toISOString(),
      nodeA: NODE_A,
      nodeB: NODE_B,
      stats,
      assign,
    };

    if (jsonOut) {
      fs.writeFileSync(path.resolve(jsonOut), JSON.stringify(payload, null, 0), 'utf8');
      console.log(`Wrote ${jsonOut}`);
    }

    if (apply) {
      const eqemu = require('../eqemu_db');
      await eqemu.init();
      const note = 'graph_partition tools/partition_zone_nodes.js';
      let n = 0;
      for (const z of zones) {
        const node = assign[z] || NODE_A;
        await eqemu.upsertZoneRoute(z, node, null, note);
        n++;
      }
      await eqemu.refreshZoneRoutingCache();
      console.log(`Applied ${n} rows to eqmud_zone_routing`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
