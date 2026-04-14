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
    const res = await fetch(url, { headers: { 'User-Agent': 'route-66-photo-map/1.0' } });
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

  let lat = null, lng = null, datetime = null, width = null, height = null;

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
      const dt = exif.DateTimeOriginal ?? exif.CreateDate ?? null;
      if (dt instanceof Date) {
        datetime = dt.toISOString().replace('Z', '');
      }
    }
  } catch {}

  // Last resort: use file modification time as datetime
  if (!datetime) {
    try {
      const s = await stat(filePath);
      datetime = s.mtime.toISOString().replace('Z', '').replace(/\.\d+$/, '');
    } catch {}
  }

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
    width,
    height,
  };
}

async function main() {
  if (!existsSync(DUMP_DIR)) {
    console.error(`Dump directory not found: ${DUMP_DIR}`);
    process.exit(1);
  }

  // Load existing photos.json as a full metadata cache keyed by filename.
  // This lets CI skip EXIF re-extraction for photos whose originals (HEIC) aren't committed.
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

    const cached = metaCache[file];
    // If we have a fully cached entry (has GPS or was confirmed no-GPS), skip EXIF extraction
    const hasCachedMeta = cached && (cached.lat != null || cached.datetime != null);

    let entry;
    if (hasCachedMeta) {
      entry = { ...cached };
    } else {
      entry = await processImage(file);
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
    const dtStr = entry.datetime ?? 'no datetime';
    const source = hasCachedMeta ? '(cached)' : '';
    console.log(`✓  (${gpsStr} | ${dtStr}) ${source}`.trimEnd());
    results.push(entry);
  }

  // Sort by datetime (nulls last)
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
