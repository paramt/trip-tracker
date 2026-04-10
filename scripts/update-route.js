/**
 * update-route.js — Fetch a road-snapped route from OSRM and write src/data/route.json.
 *
 * Reads GPS waypoints from the already-computed src/data/photos.json.
 * Skips the OSRM fetch if route.json already has a matching, non-empty route.
 * Exits 1 on OSRM failure so route.json is left untouched (last known good route preserved).
 *
 * Usage: npm run update-route
 */

import { fetchRoadRouteBatched } from './process.js';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE   = path.join(__dirname, '../src/data/photos.json');
const ROUTE_FILE = path.join(__dirname, '../src/data/route.json');

async function main() {
  if (!existsSync(OUT_FILE)) {
    console.error(`photos.json not found at ${OUT_FILE} — run npm run process first.`);
    process.exit(1);
  }

  const photos = JSON.parse(await readFile(OUT_FILE, 'utf8'));
  const gpsWaypoints = photos.filter(p => p.lat != null && p.lng != null);

  if (gpsWaypoints.length < 2) {
    console.log('Not enough GPS photos to route.');
    return;
  }

  const waypointHash = JSON.stringify(gpsWaypoints.map(p => [p.lat, p.lng]));

  let existing = null;
  try { existing = JSON.parse(await readFile(ROUTE_FILE, 'utf8')); } catch {}

  if (existing?.waypointHash === waypointHash && existing?.coordinates?.length > 0) {
    console.log('Route up to date, nothing to do.');
    return;
  }

  const reason = existing?.coordinates?.length === 0
    ? 'existing route has empty coordinates'
    : 'waypoints have changed';
  console.log(`Route stale (${reason}), fetching from OSRM...`);
  console.log(`  ${gpsWaypoints.length} GPS waypoints`);

  // fetchRoadRouteBatched throws after built-in retries — we let it propagate so the
  // process exits 1 and route.json is left untouched (last known good route preserved).
  let coordinates;
  try {
    coordinates = await fetchRoadRouteBatched(gpsWaypoints);
  } catch (err) {
    console.error(`\nOSRM fetch failed after all retries — route.json not updated.`);
    console.error(`Last error: ${err.message}`);
    process.exit(1);
  }

  await writeFile(ROUTE_FILE, JSON.stringify({ waypointHash, coordinates }, null, 2));
  console.log(`\n✓ ${coordinates.length} road-snapped points written → src/data/route.json`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
