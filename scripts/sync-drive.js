import { google } from 'googleapis';
import heicConvert from 'heic-convert';
import { createWriteStream } from 'fs';
import { mkdir, stat, readdir, unlink, writeFile } from 'fs/promises';
import { pipeline } from 'stream/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PHOTOS_DIR = path.join(__dirname, '../public/photos');

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/gif',
]);

const HEIC_MIME_TYPES = new Set(['image/heic', 'image/heif']);

async function listDriveFiles(drive, folderId) {
  const files = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, size, mimeType)',
      pageToken,
      pageSize: 1000,
    });
    files.push(...(res.data.files || []).filter(f => IMAGE_MIME_TYPES.has(f.mimeType)));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files;
}

async function downloadFile(drive, fileId, destPath) {
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
  await pipeline(res.data, createWriteStream(destPath));
}

// Reset the Orientation tag in a TIFF buffer to 1 (normal).
// heic-convert physically rotates pixels during decoding, so the orientation
// is already baked in — leaving the original tag causes a double rotation.
function resetOrientation(tiffBuf) {
  const isLE = tiffBuf[0] === 0x49; // 'II' = little-endian, 'MM' = big-endian
  const read16 = off => isLE ? tiffBuf.readUInt16LE(off) : tiffBuf.readUInt16BE(off);
  const read32 = off => isLE ? tiffBuf.readUInt32LE(off) : tiffBuf.readUInt32BE(off);
  const write16 = (off, val) => isLE ? tiffBuf.writeUInt16LE(val, off) : tiffBuf.writeUInt16BE(val, off);
  const ifd0Off = read32(4);
  const entryCount = read16(ifd0Off);
  for (let i = 0; i < entryCount; i++) {
    const e = ifd0Off + 2 + i * 12;
    if (read16(e) === 0x0112) { // Orientation tag
      write16(e + 8, 1); // value = 1 (normal/no rotation)
      write16(e + 10, 0);
      break;
    }
  }
}

// Inject the raw TIFF/EXIF block from a HEIC buffer into a JPEG as an APP1 segment.
// heic-convert strips metadata during conversion; this restores it so process.js
// can extract GPS and datetime from the resulting JPG as normal.
function injectExif(jpegBuf, heicBuf) {
  const II = Buffer.from([0x49, 0x49, 0x2a, 0x00]); // little-endian TIFF
  const MM = Buffer.from([0x4d, 0x4d, 0x00, 0x2a]); // big-endian TIFF
  const offLE = heicBuf.indexOf(II);
  const offBE = heicBuf.indexOf(MM);
  if (offLE === -1 && offBE === -1) return jpegBuf;
  const tiffOff = offLE !== -1 && (offBE === -1 || offLE < offBE) ? offLE : offBE;
  // APP1 length field is 2 bytes (max 65535), subtract 2 for the field itself and 6 for "Exif\0\0"
  const tiffData = Buffer.from(heicBuf.slice(tiffOff, tiffOff + 65527)); // copy before mutating
  resetOrientation(tiffData);
  const app1 = Buffer.alloc(2 + 2 + 6 + tiffData.length);
  app1[0] = 0xFF; app1[1] = 0xE1;                     // APP1 marker
  app1.writeUInt16BE(2 + 6 + tiffData.length, 2);      // segment length (includes itself)
  app1.write('Exif\x00\x00', 4, 'ascii');
  tiffData.copy(app1, 10);
  // Insert after SOI (first 2 bytes of JPEG)
  return Buffer.concat([jpegBuf.slice(0, 2), app1, jpegBuf.slice(2)]);
}

async function downloadHeicAsJpg(drive, fileId, destPath) {
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
  const chunks = [];
  for await (const chunk of res.data) chunks.push(chunk);
  const heicBuf = Buffer.concat(chunks);
  const jpgBuf = await heicConvert({ buffer: heicBuf, format: 'JPEG', quality: 0.9 });
  await writeFile(destPath, injectExif(Buffer.from(jpgBuf), heicBuf));
}

// Returns the local filename to use for a Drive file (HEIC → JPG rename)
function localName(file) {
  if (HEIC_MIME_TYPES.has(file.mimeType)) {
    return path.parse(file.name).name + '.jpg';
  }
  return file.name;
}

async function main() {
  const credJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!credJson) { console.error('Missing GOOGLE_SERVICE_ACCOUNT_JSON'); process.exit(1); }
  if (!folderId) { console.error('Missing GOOGLE_DRIVE_FOLDER_ID'); process.exit(1); }

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(credJson),
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  const drive = google.drive({ version: 'v3', auth });

  await mkdir(PHOTOS_DIR, { recursive: true });

  const driveFiles = await listDriveFiles(drive, folderId);
  console.log(`Found ${driveFiles.length} image(s) in Drive`);

  // Map of local filename → Drive file (accounts for HEIC → JPG rename)
  const driveLocalNames = new Set(driveFiles.map(localName));

  // Download new or changed files
  for (const file of driveFiles) {
    const isHeic = HEIC_MIME_TYPES.has(file.mimeType);
    const dest = path.join(PHOTOS_DIR, localName(file));
    let needsDownload = true;
    try {
      const s = await stat(dest);
      // For HEIC files converted to JPG we can't compare sizes, so just check existence
      if (isHeic ? s.size > 1024 : s.size === parseInt(file.size, 10)) needsDownload = false;
    } catch { /* file doesn't exist */ }
    if (needsDownload) {
      console.log(`Downloading: ${file.name}${isHeic ? ' (converting HEIC → JPG)' : ''}`);
      if (isHeic) {
        await downloadHeicAsJpg(drive, file.id, dest);
      } else {
        await downloadFile(drive, file.id, dest);
      }
    }
  }

  // Remove local files no longer in Drive (Drive is source of truth)
  const localFiles = await readdir(PHOTOS_DIR).catch(() => []);
  for (const name of localFiles) {
    if (name.endsWith('.thumb.webp')) continue; // generated by process.js
    if (driveLocalNames.has(name)) continue;
    await unlink(path.join(PHOTOS_DIR, name));
    console.log(`Removed: ${name}`);
    const base = name.slice(0, -path.extname(name).length);
    try {
      await unlink(path.join(PHOTOS_DIR, base + '.thumb.webp'));
      console.log(`Removed (generated): ${base}.thumb.webp`);
    } catch { /* doesn't exist */ }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
