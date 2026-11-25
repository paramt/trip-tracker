/**
 * process.js — Extract EXIF metadata from photos in public/photos/ and generate
 * src/data/photos.json. Also generates .thumb.webp thumbnails via sharp.
 *
 * Usage: npm run process
 */

import exifr from 'exifr';
import sharp from 'sharp';
import heicConvert from 'heic-convert';
import { readdir, readFile, writeFile, stat, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DUMP_DIR    = path.join(__dirname, '../public/photos');
const OUT_FILE    = path.join(__dirname, '../src/data/photos.json');
const THUMB_WIDTH = 400;
const THUMB_QUALITY = 70;

async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'trip-tracker-photo-map/1.0' } });
    const data = await res.json();
    const addr = data.address ?? {};
    const city = addr.city ?? addr.town ?? addr.village ?? addr.hamlet ?? addr.suburb ?? addr.neighbourhood ?? addr.county ?? null;
    const stateCode = addr['ISO3166-2-lvl4']?.split('-')[1] ?? null;
    if (city && stateCode) return `${city}, ${stateCode}`;
    if (city) return city;
    return null;
  } catch {
    return null;
  }
}

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.heic', '.png']);
const HEIC_EXTS  = new Set(['.heic']);

async function processImage(file) {
  const filePath = path.join(DUMP_DIR, file);
  const ext = path.extname(file).toLowerCase();
  const base = path.parse(file).name;

  // HEIC → JPG conversion (browsers can't display HEIC natively)
  let serveFile = file;
  let servePath = filePath;
  if (HEIC_EXTS.has(ext)) {
    const jpgName = `${base}.jpg`;
    const jpgPath = path.join(DUMP_DIR, jpgName);
    const jpgExists = existsSync(jpgPath);
    const jpgSize = jpgExists ? (await stat(jpgPath)).size : 0;
    if (!jpgExists || jpgSize < 1024) {
      if (jpgExists) await unlink(jpgPath); // remove stale stub
      try {
        const heicBuf = await readFile(filePath);
        const jpgBuf = await heicConvert({ buffer: heicBuf, format: 'JPEG', quality: 0.9 });
        await writeFile(jpgPath, Buffer.from(jpgBuf));
        process.stdout.write(`→ ${jpgName} `);
      } catch (e) {
        console.warn(`  HEIC→JPG failed for ${file}: ${e.message}`);
      }
    }
    if (existsSync(jpgPath)) {
      serveFile = jpgName;
      servePath = jpgPath;
    }
  }

  const thumbName = `${base}.thumb.webp`;
  const thumbPath = path.join(DUMP_DIR, thumbName);

  // datetime:      true UTC instant ("...Z"), used for ordering. Null if EXIF has no
  //                UTC info — main() estimates it from neighbouring photos.
  // localDatetime: camera wall-clock time ("YYYY-MM-DDTHH:MM:SS", no zone), used for
  //                display and for grouping photos into trip days.
  let lat = null, lng = null, datetime = null, localDatetime = null, width = null, height = null;

  // Extract EXIF from the original file
  try {
    const buf = await readFile(filePath);
    let exif = null;

    // First try exifr directly (works for standard JPEGs)
    try {
      exif = await exifr.parse(buf, { gps: true, ifd0: true, exif: true });
    } catch {}

    // HEIC fallback: exifr can't parse the HEIF container, but the EXIF/TIFF block
    // is embedded in the file — find its actual offset by scanning for the TIFF magic bytes.
    if (!exif && HEIC_EXTS.has(ext)) {
      const II = Buffer.from([0x49, 0x49, 0x2a, 0x00]); // little-endian TIFF
      const MM = Buffer.from([0x4d, 0x4d, 0x00, 0x2a]); // big-endian TIFF
      const offLE = buf.indexOf(II);
      const offBE = buf.indexOf(MM);
      const tiffOff = offLE !== -1 && (offBE === -1 || offLE < offBE) ? offLE : offBE;
      if (tiffOff !== -1) {
        try {
          exif = await exifr.parse(buf.slice(tiffOff), { gps: true, ifd0: true, exif: true });
        } catch {}
      }
    }

    if (exif) {
      lat = exif.latitude ?? null;
      lng = exif.longitude ?? null;
      ({ datetime, localDatetime } = exifTimes(exif));
    }
  } catch {}

  // Get dimensions and generate thumbnail from the serve path (sharp auto-rotates via .rotate())
  try {
    const meta = await sharp(servePath).rotate().metadata();
    const rotated = meta.orientation && meta.orientation >= 5;
    width = rotated ? meta.height : meta.width;
    height = rotated ? meta.width : meta.height;

    await sharp(servePath)
      .rotate()
      .resize({ width: THUMB_WIDTH })
      .webp({ quality: THUMB_QUALITY })
      .toFile(thumbPath);
  } catch (e) {
    console.warn(`  Thumbnail failed for ${file}: ${e.message}`);
  }

  return {
    file: `/photos/${serveFile}`,
    thumb: `/photos/${thumbName}`,
    lat,
    lng,
    datetime,
    localDatetime,
    width,
    height,
  };
}

const pad2 = n => String(Math.floor(n)).padStart(2, '0');
const isoSeconds = d => d.toISOString().slice(0, 19); // "YYYY-MM-DDTHH:MM:SS"

// Derive { datetime (UTC, "...Z"), localDatetime (camera wall clock) } from parsed EXIF.
function exifTimes(exif) {
  let datetime = null, localDatetime = null;

  // DateTimeOriginal is camera-local time with no zone. exifr returns it as a Date that
  // treats the local value as UTC, so its ISO string is the camera's wall-clock time.
  const dtOriginal = exif.DateTimeOriginal ?? exif.CreateDate ?? null;
  if (dtOriginal instanceof Date && !isNaN(dtOriginal)) localDatetime = isoSeconds(dtOriginal);

  // Prefer the GPS timestamp: true UTC from the GPS receiver, so ordering stays correct
  // across time zone boundaries.
  const gpsDate = exif.GPSDateStamp ?? exif.GPSDate ?? null;
  const gpsTime = exif.GPSTimeStamp ?? null;
  if (gpsDate && gpsTime) {
    const isoDate = (typeof gpsDate === 'string' ? gpsDate : new Date(gpsDate).toISOString())
      .replace(/:/g, '-').slice(0, 10);
    let timeStr;
    if (typeof gpsTime === 'string') {
      const [h, m, sec] = gpsTime.split(':');
      timeStr = `${pad2(h)}:${pad2(m)}:${pad2(parseFloat(sec))}`;
    } else if (Array.isArray(gpsTime)) {
      timeStr = gpsTime.map(pad2).join(':');
    }
    if (timeStr && /^\d{4}-\d{2}-\d{2}$/.test(isoDate)) datetime = `${isoDate}T${timeStr}Z`;
  }

  // Otherwise, OffsetTimeOriginal (if present) converts the local time to real UTC.
  if (!datetime && localDatetime) {
    const match = (exif.OffsetTimeOriginal ?? exif.OffsetTime ?? '').match?.(/([+-])(\d{2}):(\d{2})/);
    if (match) {
      const sign = match[1] === '+' ? 1 : -1;
      const offsetMs = sign * (parseInt(match[2], 10) * 60 + parseInt(match[3], 10)) * 60000;
      datetime = isoSeconds(new Date(dtOriginal.getTime() - offsetMs)) + 'Z';
    }
  }

  return { datetime, localDatetime };
}

// Offset (ms) of camera-local time relative to UTC, when both are known.
function utcOffsetMs(entry) {
  if (!entry.datetime || !entry.localDatetime) return null;
  return Date.parse(entry.localDatetime + 'Z') - Date.parse(entry.datetime);
}

// Fill in whichever of datetime / localDatetime is missing, so every photo has a UTC
// instant to sort by and a local time to display. The UTC offset is borrowed from the
// nearest photo (in time) whose offset is known — usually the same phone in the same
// time zone. With no such photo, fall back to a longitude-based guess (15° per hour).
function fillMissingTimes(entries) {
  const refs = entries
    .map(e => ({ e, off: utcOffsetMs(e) }))
    .filter(r => r.off != null);

  const nearestOffset = (t, key) => {
    let best = null, bestDiff = Infinity;
    for (const r of refs) {
      const diff = Math.abs(Date.parse(r.e[key] + (key === 'localDatetime' ? 'Z' : '')) - t);
      if (diff < bestDiff) { bestDiff = diff; best = r.off; }
    }
    return best;
  };
  const guessOffset = e => (e.lng != null ? Math.round(e.lng / 15) * 3600000 : 0);

  for (const e of entries) {
    if (!e.datetime && e.localDatetime) {
      const t = Date.parse(e.localDatetime + 'Z');
      const off = nearestOffset(t, 'localDatetime') ?? guessOffset(e);
      e.datetime = isoSeconds(new Date(t - off)) + 'Z';
    } else if (e.datetime && !e.localDatetime) {
      const t = Date.parse(e.datetime);
      const off = nearestOffset(t, 'datetime') ?? guessOffset(e);
      e.localDatetime = isoSeconds(new Date(t + off));
    }
  }
}

// Older photos.json entries stored camera-local time in `datetime` with no "Z".
function normalizeCached(entry) {
  if (!entry) return entry;
  const out = { ...entry };
  if (out.datetime && !out.datetime.endsWith('Z')) {
    out.localDatetime ??= out.datetime.slice(0, 19);
    out.datetime = null;
  }
  return out;
}

async function main() {
  if (!existsSync(DUMP_DIR)) {
    console.error(`Dump directory not found: ${DUMP_DIR}`);
    process.exit(1);
  }

  // Load existing photos.json as a metadata cache keyed by filename. Used to keep GPS,
  // times and reverse-geocode results that can't be re-derived from the file itself.
  const metaCache = {};
  if (existsSync(OUT_FILE)) {
    try {
      const existing = JSON.parse(await readFile(OUT_FILE, 'utf8'));
      for (const entry of existing) {
        if (entry.file) {
          // Key by bare filename so it's path-independent
          metaCache[path.basename(entry.file)] = entry;
        }
      }
    } catch {}
  }

  const allFiles = await readdir(DUMP_DIR);
  const imageFiles = allFiles.filter(f => {
    const ext = path.extname(f).toLowerCase();
    if (!IMAGE_EXTS.has(ext) || f.includes('.thumb')) return false;
    // Skip JPGs/JPEGs that are auto-converted from a HEIC of the same base name
    if (ext === '.jpg' || ext === '.jpeg') {
      const base = path.parse(f).name;
      if (allFiles.some(g => path.parse(g).name === base && HEIC_EXTS.has(path.extname(g).toLowerCase()))) return false;
    }
    return true;
  });

  if (imageFiles.length === 0) {
    console.log('No images found in public/photos/. Drop photos there and re-run.');
    await writeFile(OUT_FILE, JSON.stringify([], null, 2));
    return;
  }

  console.log(`Processing ${imageFiles.length} image(s)...`);

  const results = [];
  for (const file of imageFiles) {
    process.stdout.write(`  ${file} ... `);

    const cached = normalizeCached(metaCache[file]);

    // Always call processImage so thumbnails are regenerated with current orientation.
    // Fall back to cached GPS/times when EXIF can't supply them (e.g. a datetime that
    // came from file mtime on an earlier local run — in CI, mtime is checkout time).
    const entry = await processImage(file);
    if (cached) {
      if (entry.lat == null && cached.lat != null) { entry.lat = cached.lat; entry.lng = cached.lng; }
      if (!entry.datetime && !entry.localDatetime) {
        entry.datetime = cached.datetime ?? null;
        entry.localDatetime = cached.localDatetime ?? null;
      }
    }

    // Last resort: file modification time (a true UTC instant). iPhones set mtime to
    // the capture time, so this is usually accurate for local runs.
    if (!entry.datetime && !entry.localDatetime) {
      try {
        const s = await stat(path.join(DUMP_DIR, file));
        entry.datetime = isoSeconds(s.mtime) + 'Z';
      } catch {}
    }

    // Reverse geocode if GPS is available; use cache to skip re-fetching
    if (entry.lat != null) {
      if (cached?.location) {
        entry.location = cached.location;
      } else {
        entry.location = await reverseGeocode(entry.lat, entry.lng);
        // Nominatim rate limit: 1 req/s — wait regardless of result
        await new Promise(r => setTimeout(r, 1100));
      }
    } else {
      entry.location = null;
    }

    const gpsStr = entry.lat != null ? (entry.location ?? `${entry.lat.toFixed(4)}, ${entry.lng.toFixed(4)}`) : 'no GPS';
    const dtStr = entry.localDatetime ?? entry.datetime ?? 'no datetime';
    console.log(`✓  (${gpsStr} | ${dtStr})`);
    results.push(entry);
  }

  fillMissingTimes(results);

  // Sort by UTC datetime (nulls last)
  results.sort((a, b) => {
    if (!a.datetime && !b.datetime) return 0;
    if (!a.datetime) return 1;
    if (!b.datetime) return -1;
    return a.datetime.localeCompare(b.datetime);
  });

  await writeFile(OUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${results.length} entries → src/data/photos.json`);

}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err); process.exit(1); });
}
