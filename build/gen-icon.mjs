// Generates build/icon.png and build/icon.ico for Deck.
// Pure Node (zlib for PNG deflate + hand-rolled CRC32/ICO container). No dependencies.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIZE = 256;

// ── Pixel buffer ────────────────────────────────────────────
const buf = new Uint8Array(SIZE * SIZE * 4); // RGBA, transparent by default

function setPx(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
}

function fillRect(x0, y0, w, h, [r, g, b, a = 255], radius = 0) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (radius > 0) {
        const cx = x < x0 + radius ? x0 + radius : x > x0 + w - radius ? x0 + w - radius : x;
        const cy = y < y0 + radius ? y0 + radius : y > y0 + h - radius ? y0 + h - radius : y;
        const dx = x - cx, dy = y - cy;
        if ((x < x0 + radius || x > x0 + w - radius) && (y < y0 + radius || y > y0 + h - radius)) {
          if (dx * dx + dy * dy > radius * radius) continue;
        }
      }
      setPx(x, y, r, g, b, a);
    }
  }
}

function strokeRect(x0, y0, w, h, thickness, [r, g, b, a = 255], radius = 0) {
  fillRect(x0, y0, w, thickness, [r, g, b, a], 0);
  fillRect(x0, y0 + h - thickness, w, thickness, [r, g, b, a], 0);
  fillRect(x0, y0, thickness, h, [r, g, b, a], 0);
  fillRect(x0 + w - thickness, y0, thickness, h, [r, g, b, a], 0);
}

// ── Palette (approx sRGB from the app's oklch tokens) ──────
const DESK_2  = [216, 205, 184];
const PAPER   = [248, 244, 236];
const RULE    = [178, 164, 138];
const ACCENT  = [138, 50, 38];   // oxblood
const INK_1   = [46, 38, 33];
const INK_2   = [130, 116, 100];

// ── Draw: back card (offset), front card, stamp bar, text lines ──
fillRect(66, 82, 152, 138, DESK_2, 14);
strokeRect(66, 82, 152, 138, 3, RULE, 14);

fillRect(38, 46, 180, 164, PAPER, 16);
strokeRect(38, 46, 180, 164, 4, RULE, 16);

fillRect(62, 74, 96, 30, ACCENT, 5);

fillRect(62, 128, 132, 10, INK_1);
fillRect(62, 150, 108, 10, INK_2);
fillRect(62, 172, 84, 10, INK_2);

// ── PNG encoder (RGBA, no filtering, zlib deflate) ──────────
function crc32(buf) {
  let c, table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(pixels, w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(w, 0);
  ihdrData.writeUInt32BE(h, 4);
  ihdrData[8] = 8;   // bit depth
  ihdrData[9] = 6;   // color type RGBA
  ihdrData[10] = 0;  // compression
  ihdrData[11] = 0;  // filter
  ihdrData[12] = 0;  // interlace
  const ihdr = chunk('IHDR', ihdrData);

  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (none)
    Buffer.from(pixels.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = chunk('IDAT', deflateSync(raw, { level: 9 }));
  const iend = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

const png = encodePNG(buf, SIZE, SIZE);
writeFileSync(path.join(__dirname, 'icon.png'), png);

// ── ICO container: single 256x256 PNG-compressed entry ──────
function encodeICO(pngBuf, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count

  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size; // width (0 = 256)
  entry[1] = size >= 256 ? 0 : size; // height (0 = 256)
  entry[2] = 0; // color count
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4);  // planes
  entry.writeUInt16LE(32, 6); // bit count
  entry.writeUInt32LE(pngBuf.length, 8);  // bytes in resource
  entry.writeUInt32LE(6 + 16, 12);        // offset to image data

  return Buffer.concat([header, entry, pngBuf]);
}

const ico = encodeICO(png, SIZE);
writeFileSync(path.join(__dirname, 'icon.ico'), ico);

console.log('Wrote build/icon.png and build/icon.ico');
