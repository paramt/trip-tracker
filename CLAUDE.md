# Route 66 — Project Notes

## What this is
React + Vite app that visualizes a road trip on a map. Drop photos into `public/photos/`, run `npm run process` to extract metadata and generate thumbnails, then run `npm run update-route` to fetch a road-snapped route. Every GPS-tagged photo is plotted on the map with the route connecting them.

## Git workflow
Automated workflows frequently push commits to `main` (photo processing, thumbnail updates). Always `git pull` before committing or pushing to avoid rejected pushes.

## Workflow
1. Drop photos (JPG, HEIC, PNG) into `public/photos/`
2. `npm run process` — extracts EXIF, converts HEIC → JPG, generates `.thumb.webp` thumbnails, reverse-geocodes GPS coords, writes `src/data/photos.json`
3. `npm run update-route` — reads GPS-tagged photos from `photos.json`, fetches a road-snapped route from OpenRouteService, writes `src/data/route.json`
4. `npm run dev` — view the map

## Architecture
- **Map UI**: `WorldMap.jsx` (MapLibre GL JS), `Polaroid.jsx`, `Tack.jsx`. `App.jsx` drives everything from `photos.json` and `route.json`.
- **Data flow**: `photos.json` is a flat array of photo objects (`file`, `thumb`, `lat`, `lng`, `datetime`, `width`, `height`, `location`). `route.json` stores `{ waypointHash, coordinates: [[lng, lat], ...] }` — the road-snapped route pre-computed by `update-route.js`. `App.jsx` filters to GPS-tagged photos, sorts chronologically, plots one marker per photo, and loads the route from `route.json` (falls back to straight lines if empty or missing).
- **Image serving**: Photos live in `public/photos/` and are served by Vite as static assets at `/photos/...`. Thumbnails are WebP format (`.thumb.webp`).

## Map rendering — MapLibre GL JS

The map uses **MapLibre GL JS** (WebGL, GPU-accelerated) with **OpenFreeMap bright tiles** (`https://tiles.openfreemap.org/styles/bright`). This replaced a custom canvas renderer that was CPU-bound and laggy on mobile.

- Style URL is set as `OFM_STYLE` constant in `WorldMap.jsx` — swap to another OpenFreeMap style if needed
- Route line and markers are our own layers/elements on top of the OpenFreeMap base
- `onBoundsChange` emits both geographic bounds from `map.getBounds()` and a `project(lng, lat)` helper backed by `map.project()`. `App.jsx` uses that projector to position the photo popup correctly in both globe and Mercator views
- `projX`/`projY` are still exported from `WorldMap.jsx`, but the popup no longer uses them
- Markers are `maplibregl.Marker` instances with custom DOM elements (`anchor: 'bottom'`). `.map-marker` CSS must NOT add its own centering transform to the marker root — MapLibre handles marker placement
- `map.dragRotate.disable()` and `map.touchZoomRotate.disableRotation()` keep the map north-up

### Globe projection — hiding the canvas until load

On initial load, MapLibre renders a frame or two in flat Mercator before the `load` event fires and `setProjection({ type: 'globe' })` is called. To prevent this flash, hide the map until it's ready:

```js
map.getCanvasContainer().style.opacity = '0';
map.on('load', () => {
  map.setProjection({ type: 'globe' });
  // ... setup ...
  const cc = map.getCanvasContainer();
  cc.style.transition = 'opacity 0.4s ease';
  cc.style.opacity = '1';
});
```

**Must use `getCanvasContainer()` (the wrapper div), not `getCanvas()` (the WebGL canvas).** Firefox's WebGL compositor can present the canvas to screen before CSS `opacity` on the canvas element itself propagates through the compositor pipeline, causing the flat-map flash to still appear in Firefox. A regular HTML div (`canvasContainer`) is composited consistently across all browsers.

**Do not use `styledata` to set globe projection early** — `styledata` fires before the Mercator→globe transition completes, causing a blank white globe flash before tiles render.

### MapLibre + React StrictMode gotcha
In dev, StrictMode mounts → unmounts → remounts. On the second mount, `markersRef.current` (a `Map<event, Marker>`) still has entries from the first mount (attached to the now-removed map), so the marker sync effect skips creating new ones. Fix: clear `markersRef.current` in the map init `useEffect` cleanup alongside `map.remove()`.

### Route layer — layout vs paint properties
`line-cap` and `line-join` are **layout** properties in MapLibre, not paint. Putting them in `paint` causes a silent validation error that prevents the layer from rendering at all. Always use:
```js
map.addLayer({ ..., layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ..., 'line-width': ... } });
```

### MapLibre style — glyphs field
If you include `glyphs: ""` in a custom style object, MapLibre throws `"glyphs" url must include a "{fontstack}" token`. Omit `glyphs` entirely when there are no symbol/label layers.

### Popup positioning
`App.jsx` positions the Polaroid popup using `boundsRef.current.project(photo.lng, photo.lat)`, where `project` is provided by `WorldMap.jsx` via `onBoundsChange`. This keeps the popup aligned during pan/zoom and works correctly with globe projection, including suppressing the popup when the marker is on the back side of the globe.

### Expanded Polaroid overlay
Clicking a marker opens a full-screen overlay (`polaroid-overlay`) with the photo centered and enlarged. Key design decisions:

- **Thumbnail-only popup**: The small hover popup passes `src={photo.thumb}` with no `thumb` prop — this prevents the full image from ever being fetched for the preview. The `thumb` prop on `<Polaroid>` is only for progressive loading (thumb → full crossfade), so omitting it when `src` is already the thumb avoids loading the full image unnecessarily.
- **Stable rotation angle**: `_rotate` is computed once at module level (in the `gpsPhotos.map()`) and passed as the `rotate` prop to both the hover popup and the expanded Polaroid. Without this, `Polaroid` picks a new random angle on each mount, so the popup and expanded views would tilt differently.
- **Overlay dismissal**: The backdrop `onClick` closes the overlay; `e.stopPropagation()` on the inner `div.polaroid-expanded` prevents clicks on the photo itself from bubbling up to the backdrop handler.
- **No hover popup while expanded**: `{activePhoto && popupPos && !expandedPhoto && ...}` hides the hover popup when the overlay is open.
- **Width override**: `.polaroid-expanded .polaroid { width: min(480px, 85vw, calc((90vh - 80px) * var(--photo-aspect, 1.5))) }` overrides the fixed `260px` set on `.polaroid` and also constrains portrait images by viewport height. Put this after the base `.polaroid` rule so specificity works.
- **Spring animation**: `cubic-bezier(0.34, 1.4, 0.64, 1)` gives the polaroid a slight overshoot for a snappy feel. The `@keyframes polaroidExpand` scales from `0.25` to `1` — keep `transform: scale(1)` in the `to` frame, not `transform: none`, or it may conflict with the rotation applied via `--polaroid-rotate`.

## Sidebar

A collapsible dark sidebar (`#1a1a1a`) sits left of the map. State lives in `App` (`sidebarOpen`, `selectedDay`) and is passed as props to `<Sidebar>`. Width transitions via CSS (`width: 44px` collapsed → `width: 300px` open); the inner `.sidebar-body` is fixed at 300px so content never reflows during animation.

### Day-by-day timeline

`dayGroups` is computed at module level by grouping `gpsPhotos` (already sorted chronologically) by `datetime.slice(0, 10)`. Each group stores `firstPhotoIdx` — the index of its first photo in `gpsPhotos`.

Clicking a day calls `setSelectedDay(i)`, which recomputes `highlightRoute` via `useMemo(() => highlightForDay(selectedDay), [selectedDay])`.

### Route segment highlighting

`photoRouteIndices` maps each GPS photo to its nearest point index in `routePts` (= `globalRoute[0]`), computed once at module level with a simple O(n·m) nearest-neighbour scan.

`highlightForDay(i)` slices `routePts` between:
- `r0 = photoRouteIndices[lastPhotoIdx(i - 1)]` for intermediate days, or the current day's first photo for day 0
- `r1 = photoRouteIndices[lastPhotoIdx(i)]`

This means selecting a day highlights the segment traveled during that day. Single-photo selections fall back to a one-point highlight so the map can still zoom to that location.

`WorldMap` accepts a `highlightRoute` prop and maintains a `route-highlight` GeoJSON source + line layer (yellow, 5px, opacity 0.9) added in `addRouteLayer` alongside the base `route` layer. The highlight effect uses a direct `map.getSource("route-highlight")` existence check rather than `map.isStyleLoaded()` — the latter can spuriously return `false` while tiles are loading, silently dropping the update.

## Road-snapped routing

The route follows actual roads via **OpenRouteService (ORS)**. Routing happens in `update-route.js`, not in the browser. Requires `ORS_API_KEY` env var (or GitHub Actions secret).

### How it works
1. `update-route.js` reads `src/data/photos.json`, filters to GPS-tagged photos, and computes `gpsWaypoints`
2. ORS endpoint: POST `https://api.openrouteservice.org/v2/directions/driving-car/geojson`
   - Headers: `Authorization: <ORS_API_KEY>`, `Content-Type: application/json`
   - Body: `{ "coordinates": [[lng, lat], ...], "radiuses": [-1, ...] }`
3. Returns `[[lng, lat], ...]` coordinates — a full-resolution road-following polyline
4. Written to `src/data/route.json` as `{ waypointHash, coordinates }`
5. `App.jsx` imports `route.json` and converts `[lng, lat]` pairs to `{ lat, lng }` objects for `WorldMap`

### Caching
`update-route.js` computes `waypointHash = JSON.stringify(gpsWaypoints.map(p => [p.lat, p.lng]))` and compares it to the stored hash. If unchanged and `coordinates` is non-empty, the ORS fetch is skipped.

### Batching
`fetchRoadRouteBatched` splits requests into chunks of 40 waypoints (ORS free tier limit is ~50; 40 used as a safety margin) with 1-waypoint overlap between chunks (to avoid gaps at joins). Each batch waits 1s between requests.

### Retries + timeout
`fetchRoadRoute` retries up to 3 times with 3s/6s/9s backoff. Timeout is 300s (5 minutes) per request. ORS returns structured error objects `{ error: { code, message } }` which are thrown directly.

### Fallback
If ORS fails after all retries (including a missing API key), `update-route.js` exits with code 1 and leaves the existing `route.json` untouched. `App.jsx` still falls back to straight lines when `route.json` is missing coordinates or contains an empty array.

### ORS 6,000 km per-request limit
ORS free tier rejects any route whose approximated distance exceeds 6,000 km (`error 2004`). The limit applies per batch (40 waypoints), not to the total trip, so trips longer than 6,000 km are fine as long as no 40 consecutive waypoints span more than that. In practice this is never an issue at normal photo density. It does bite with test data that mixes geographically distant trips — e.g. California photos from 2025 mixed with Ontario/New York photos from 2026 — which creates a chronologically-sorted route that zig-zags cross-continent within a single batch.

## HEIC support — what didn't work, what did

### Problem: `sharp` can't decode HEIC
`sharp`'s precompiled binaries don't include the HEVC codec (it's licensed). Attempting `sharp(file).jpeg()` on a HEIC file fails with:
```
heif: Error while loading plugin: No decoding plugin installed for this compression format
```
It also silently creates a 0-byte stub output file before throwing, which then blocks future conversion attempts (the file appears to exist but is invalid). Fixed by checking `stat().size < 1024` before deciding to skip re-conversion.

**Fix**: Use `heic-convert` instead for HEIC → JPG. It has its own bundled HEIC decoder and works without system dependencies.

### Problem: `exifr` can't parse HEIC containers
`exifr.parse(heicBuffer)` fails with `Unknown file format` because `exifr` doesn't understand the HEIF/ISOBMFF container format that wraps the EXIF data.

**What looked promising but didn't work**: The string `Exif` appears at byte ~2868 in HEIC files — but that's just the item-type label inside the IINF box (metadata index), not the actual EXIF/TIFF data. Parsing from that offset gives garbage.

**Fix**: Scan the raw HEIC buffer for the actual TIFF magic bytes (`MM\x00\x2a` for big-endian or `II\x2a\x00` for little-endian). The real EXIF block — with GPS, DateTimeOriginal, etc. — lives at that offset inside the MDAT/EXIF item. Slice from there and pass to `exifr`. Works reliably across all tested HEIC files.

```js
const MM = Buffer.from([0x4d, 0x4d, 0x00, 0x2a]);
const II = Buffer.from([0x49, 0x49, 0x2a, 0x00]);
const offBE = buf.indexOf(MM);
const offLE = buf.indexOf(II);
const tiffOff = offLE !== -1 && (offBE === -1 || offLE < offBE) ? offLE : offBE;
const exif = await exifr.parse(buf.slice(tiffOff), { gps: true, exif: true });
```

### Fallback: file mtime for missing datetime
If EXIF datetime extraction still fails, fall back to `fs.stat().mtime`. iPhone sets the file modification time to the capture time, so this is usually accurate.

### Auto-generated JPGs must be excluded from processing
When `process.js` converts `IMG_0845.heic` → `IMG_0845.jpg`, both files end up in `public/photos/`. On re-run, the script would pick up the generated `.jpg` as a new image to process (creating a duplicate entry). Fix: skip any `.jpg`/`.jpeg` file that has a same-name `.heic` sibling in the directory.

### Metadata cache for CI
`process.js` loads the existing `photos.json` as a cache keyed by filename. If a photo's metadata is already present (has GPS or a confirmed datetime), EXIF extraction is skipped — it reads from the cache instead. This lets CI re-run `process.js` even when the original HEIC files aren't committed, as long as `photos.json` is committed. Reverse geocode results are also cached this way to avoid redundant Nominatim API calls.


### CSS filter gotcha — ICC color profiles
Applying *any* CSS `filter` (even `filter: grayscale(0%)`, which is visually a no-op) forces the browser into GPU compositing mode, which bypasses ICC color profile handling. Images with Display P3 or HDR gain maps render as sRGB, causing highlights to appear blown out. Color polaroids must use `filter: none`, not `filter: grayscale(0%)`
