/**
 * update-route.js — Fetch a road-snapped route from OpenRouteService and write src/data/route.json.
 *
 * Reads GPS waypoints from the already-computed src/data/photos.json.
 * Skips the ORS fetch if route.json already has a matching, non-empty route.
 * Exits 1 on ORS failure so route.json is left untouched (last known good route preserved).
 *
 * Usage: npm run update-route
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE   = path.join(__dirname, '../src/data/photos.json');
const ROUTE_FILE = path.join(__dirname, '../src/data/route.json');

async function fetchRoadRoute(waypoints, { retries = 3, timeoutMs = 300_000 } = {}) {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) throw new Error('ORS_API_KEY environment variable is not set');

  const url = 'https://api.openrouteservice.org/v2/directions/driving-car/geojson';
  const body = JSON.stringify({
    coordinates: waypoints.map(p => [p.lng, p.lat]),
    radiuses: waypoints.map(() => -1), // -1 = unlimited snapping radius
  });

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      process.stdout.write(` (retry ${attempt})`);
      await new Promise(r => setTimeout(r, 3000 * attempt));
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        const msg = data.error ? `${data.error.code}: ${data.error.message}` : res.status;
        throw new Error(`ORS error ${msg}`);
      }
      if (!data.features?.[0]?.geometry?.coordinates)
        throw new Error('ORS response missing geometry');
      return {
        coordinates: data.features[0].geometry.coordinates, // [[lng, lat], ...]
        distanceMeters: data.features[0].properties?.summary?.distance ?? 0,
      };
    } catch (err) {
      lastErr = err;
      process.stderr.write(`\n  attempt ${attempt + 1}/${retries + 1} failed: ${err.message}`);
    }
  }
  throw lastErr;
}

async function fetchRoadRouteBatched(waypoints) {
  const BATCH = 40; // ORS free tier: 50 waypoints max; 40 for safety
  if (waypoints.length <= BATCH) return fetchRoadRoute(waypoints);
  const segments = [];
  let totalDistance = 0;
  for (let i = 0; i < waypoints.length - 1; i += BATCH - 1) {
    const chunk = waypoints.slice(i, i + BATCH);
    const { coordinates, distanceMeters } = await fetchRoadRoute(chunk);
    if (segments.length > 0) coordinates.shift(); // remove duplicate junction point
    segments.push(...coordinates);
    totalDistance += distanceMeters;
    if (i + BATCH - 1 < waypoints.length - 1)
      await new Promise(r => setTimeout(r, 1000));
  }
  return { coordinates: segments, distanceMeters: totalDistance };
}

async function main() {
  if (!existsSync(OUT_FILE)) {
    console.error(`photos.json not found at ${OUT_FILE} — run npm run process first.`);
    process.exit(1);
  }

  const photos = JSON.parse(await readFile(OUT_FILE, 'utf8'));
  const gpsWaypoints = photos.filter(p => p.lat != null && p.lng != null);

  if (gpsWaypoints.length < 2) {
    if (existsSync(ROUTE_FILE)) {
      await writeFile(ROUTE_FILE, JSON.stringify({ coordinates: [] }, null, 2));
      console.log('Not enough GPS photos to route — cleared existing route.json.');
    } else {
      console.log('Not enough GPS photos to route.');
    }
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
  console.log(`Route stale (${reason}), fetching from ORS...`);
  console.log(`  ${gpsWaypoints.length} GPS waypoints`);

  // fetchRoadRouteBatched throws after built-in retries — we let it propagate so the
  // process exits 1 and route.json is left untouched (last known good route preserved).
  let coordinates, distanceMeters;
  try {
    ({ coordinates, distanceMeters } = await fetchRoadRouteBatched(gpsWaypoints));
  } catch (err) {
    console.error(`\nORS fetch failed after all retries — route.json not updated.`);
    console.error(`Last error: ${err.message}`);
    process.exit(1);
  }

  await writeFile(ROUTE_FILE, JSON.stringify({ waypointHash, distanceMeters, coordinates }, null, 2));
  const km = (distanceMeters / 1000).toFixed(0);
  console.log(`\n✓ ${coordinates.length} road-snapped points written → src/data/route.json (${km} km)`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
