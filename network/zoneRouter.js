function safeJsonParse(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch (e) { return fallback; }
}

/**
 * DB-backed routing.
 *
 * Env format:
 *  NODE_URLS='{"tunare":"ws://localhost:3010","innoruuk":"ws://localhost:3011"}'
 *  ZONE_URL_DEFAULT='ws://localhost:3010'
 *
 * The actual zone->node mapping comes from DB:
 *  eqmud_zone_routing(zone_short, node, continent, notes, updated_at)
 */
function getContinentForZoneShortName(zoneShortName) {
  return null;
}

function normalizeZoneShort(zoneShortName) {
  return zoneShortName ? String(zoneShortName).toLowerCase() : '';
}

async function getRouteForZone(zoneShortName, DB) {
  const z = normalizeZoneShort(zoneShortName);
  if (!z || !DB || !DB.getZoneRoute) {
    return { zone: z, node: null, continent: null };
  }
  const route = await DB.getZoneRoute(z);
  if (!route) return { zone: z, node: null, continent: null };
  return { zone: z, node: route.node || null, continent: route.continent || null };
}

async function getUrlForZone(zoneShortName, DB, env = process.env) {
  const { node, continent } = await getRouteForZone(zoneShortName, DB);
  const nodeUrls = safeJsonParse(env.NODE_URLS, {});

  // Default: prefer tunare, then first available url
  const defaultUrl = env.ZONE_URL_DEFAULT || nodeUrls.tunare || Object.values(nodeUrls)[0] || null;
  const url = (node && nodeUrls && nodeUrls[node]) ? nodeUrls[node] : defaultUrl;

  return { url, node, continent };
}

module.exports = {
  getContinentForZoneShortName,
  getRouteForZone,
  getUrlForZone,
};

