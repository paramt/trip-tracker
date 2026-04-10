# Route 66 — Project Notes

## What this is
React + Vite app that visualizes a road trip on a map. Drop photos into `public/photos/`, run `npm run process`, and every GPS-tagged photo is plotted on the map.

## Workflow
1. Drop photos (JPG, HEIC, PNG) into `public/photos/`
2. `npm run process` — extracts EXIF, converts HEIC → JPG, generates `.thumb.webp` thumbnails, reverse-geocodes GPS coords, writes `src/data/photos.json`
3. `npm run dev` — view the map

## Architecture
- **Map UI**: `WorldMap.jsx`, `Polaroid.jsx`, `Tack.jsx` adapted from `../paramt.github.io`. `App.jsx` drives everything from `photos.json`.
- **Data flow**: `photos.json` is a flat array of photo objects (`file`, `thumb`, `lat`, `lng`, `datetime`, `width`, `height`, `location`). `App.jsx` filters to GPS-tagged photos, sorts chronologically, and plots one marker per photo.
- **Image serving**: Photos live in `public/photos/` and are served by Vite as static assets at `/photos/...`. Thumbnails are WebP format (`.thumb.webp`).

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

## WorldMap rendering

### Projection: equirectangular with latitude correction
The map uses equirectangular projection — `projX = (lng - lngMin) / lngSpan`, `projY = 1 - (lat - latMin) / latSpan`. `adjustBoundsToAspect(b, w, h)` derives `latSpan` from `lngSpan` so the canvas fills correctly: `latSpan = lngSpan * h / w * cos(latMid)`. The `cos(latMid)` factor corrects for longitude convergence — at 40°N, 1° of longitude is only ~77% as wide as 1° of latitude, so without it the US appears horizontally stretched. All drawing AND marker DOM positioning must use the adjusted bounds `ab`, not raw `curBounds`.

### Marker alignment — two sources of truth
JSX inline styles (`style={{ left, top }}`) use `curBounds.current` (raw bounds) for initial render, but the canvas draws with `ab` (aspect-adjusted bounds). These give different `projY` values. Fix: a `useLayoutEffect` with no dependency array calls `renderFrame(curBounds.current)` after every React render, synchronously before paint, so the imperatively-set `ab`-correct styles always win before the user sees anything.

### Map resolution
- World countries: `world-atlas@2/countries-10m.json` (1:10M, highest available) — fetched from jsDelivr CDN
- US states: `us-atlas@3/states-10m.json` (1:10M) — fetched from jsDelivr CDN
- Canadian provinces: `public/canada-provinces.geojson` — bundled locally (GeoJSON, WGS84, 13 provinces/territories sourced from codeforamerica/click_that_hood)
- State/province polygons are always filled with the land color, overlaying the world atlas. This gives crisp US coastlines and Canadian province boundaries at all zoom levels. State/province border lines fade in separately starting at zoom 5×.

### Canadian provinces use GeoJSON, not TopoJSON
Unlike `us-atlas` (TopoJSON with quantized coordinates + `transform`), the Canada layer uses a plain GeoJSON FeatureCollection. It has its own renderer (`drawProvinces`) that directly projects `[lng, lat]` coordinate pairs via `projX`/`projY`, bypassing the `buildArcs`/`tracePath` TopoJSON pipeline.

### Route line
The route is straight canvas line segments connecting consecutive GPS photo coordinates in chronological order (`gpsPhotos.map(p => ({ lat, lng }))`), drawn with `lineTo` in `drawRoute`. No curve fitting, road snapping, or great-circle interpolation — straight lines between photo locations approximate the actual road well enough when photos are taken frequently. The route is drawn at 0.25 opacity when no active coords are selected, 1.0 when active. `lineCap/lineJoin: round` keeps corners and endpoints smooth.

### Pan & zoom interaction
All interaction updates `curBounds.current` directly and calls `renderFrame` immediately (cancelling any in-flight animation). Key math:
- **Zoom**: fix focal longitude, scale `lngSpan`, keep `latMid` fixed
- **Pan**: `dLng = -(dx/w) * lngSpan`, `dLat = (dy/h) * latSpan` (drag down = pan north)
- Mouse/wheel events on canvas; `mousemove`/`mouseup` on `window` to handle drag-out
- `touch-action: none` on canvas prevents browser scroll/zoom from intercepting touch events
