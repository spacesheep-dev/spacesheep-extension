#!/usr/bin/env node
// Draw the toolbar and store icons from spacesheep's pixel-art sheep: the favicon
// (16×14 cells, the mark the site's own tab shows) for the toolbar sizes, the full
// mark with its wool (22×13) for the store icon. Pixel art survives only
// whole-number scales, so each size is the art at an integer scale, centred on a
// transparent square. Re-run after editing an SVG:  node scripts/icons.mjs
import { deflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
function readArt(file) {
  const svg = readFileSync(here(`../icons/${file}`), "utf8");
  const [, vw, vh] = svg.match(/viewBox="0 0 (\d+) (\d+)"/).map(Number);
  const rects = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="#([0-9a-f]{3,6})"\/>/gi)]
  .map((m) => {
    const h = m[5].length === 3 ? m[5].split("").map((c) => c + c).join("") : m[5];
    return { x: +m[1], y: +m[2], w: +m[3], h: +m[4], rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) };
  });
  return { vw, vh, rects };
}

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
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png({ vw, vh, rects }, size, scale) {
  const px = new Uint8Array(size * size * 4); // transparent
  const ox = Math.floor((size - vw * scale) / 2);
  const oy = Math.floor((size - vh * scale) / 2);
  for (const r of rects) {
    for (let y = r.y * scale; y < (r.y + r.h) * scale; y++) {
      for (let x = r.x * scale; x < (r.x + r.w) * scale; x++) {
        const i = ((oy + y) * size + (ox + x)) * 4;
        px.set([...r.rgb, 255], i);
      }
    }
  }
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const favicon = readArt("sheep-favicon.svg");
const mark = readArt("sheep-mark.svg");
// The store icon keeps its art inside Chrome's 16 px margin (96 px).
for (const [art, size, scale] of [[favicon, 16, 1], [favicon, 32, 2], [favicon, 48, 3], [mark, 128, 4]]) {
  writeFileSync(here(`../icons/icon-${size}.png`), png(art, size, scale));
  console.log(`icons/icon-${size}.png  (${art.vw * scale}×${art.vh * scale} art)`);
}
