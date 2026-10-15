#!/usr/bin/env node
// Rasterize the canonical spacesheep app mark, copied from
// spacesheep/assets/media/brand/logo-sheep-fnx.svg to icons/sheep-mark.svg.
// The source has opaque white body and eyes, with transparency outside the sheep.
// The 128px store icon has 16px transparent margins; toolbar sizes use the width.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

const require = createRequire(import.meta.url);
await initWasm(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
const source = readFileSync(new URL('../icons/sheep-mark.svg', import.meta.url), 'utf8');
const [, vw, vh] = source.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).map(Number);
const body = source.replace(/<\?xml[^>]*\?>/, '').replace(/<svg[^>]*>/, '').replace('</svg>', '');
for (const size of [16, 32, 48, 128]) {
  const width = size === 128 ? 96 : size;
  const height = width * vh / vw;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><svg x="${(size-width)/2}" y="${(size-height)/2}" width="${width}" height="${height}" viewBox="0 0 ${vw} ${vh}">${body}</svg></svg>`;
  const png = new Resvg(svg).render().asPng();
  writeFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url), png);
  console.log(`icons/icon-${size}.png`);
}
