// Writes a plain placeholder icon (solid square, no artwork) so tauri-build has an .ico to embed.
// Usage: node scripts/make-icon.mjs <out.ico>
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { deflateSync } from "node:zlib";

const size = 64;
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const rows = [];
for (let y = 0; y < size; y++) {
  const row = Buffer.alloc(1 + size * 4);
  for (let x = 0; x < size; x++) {
    const edge = x < 4 || y < 4 || x >= size - 4 || y >= size - 4;
    row.set(edge ? [40, 40, 40, 255] : [236, 228, 210, 255], 1 + x * 4);
  }
  rows.push(row);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(Buffer.concat(rows))),
  chunk("IEND", Buffer.alloc(0)),
]);
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header[6] = size;
header[7] = size;
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
const out = process.argv[2];
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([header, png]));
