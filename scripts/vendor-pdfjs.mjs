#!/usr/bin/env node
// Copy pdf.js (devDependency pdfjs-dist) into vendor/pdfjs/: the extension draws a
// PDF's pages to pictures with it before publishing, because Chrome won't show a PDF
// inside the sandboxed frame a space is served in. Run after bumping pdfjs-dist:
//   npm i -D pdfjs-dist@latest && node scripts/vendor-pdfjs.mjs
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = `${root}/node_modules/pdfjs-dist`;
const out = `${root}/vendor/pdfjs`;
const { version } = JSON.parse(readFileSync(`${src}/package.json`, "utf8"));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of ["build/pdf.min.mjs", "build/pdf.worker.min.mjs", "LICENSE"]) cpSync(`${src}/${f}`, `${out}/${f.split("/").pop()}`);
// Fonts and CMaps for PDFs that don't embed theirs; wasm decoders for JPEG 2000,
// JBIG2 and colour profiles. Not quickjs: it runs a PDF's own scripts, which we never do.
for (const d of ["standard_fonts", "cmaps", "iccs", "wasm"]) cpSync(`${src}/${d}`, `${out}/${d}`, { recursive: true });
rmSync(`${out}/wasm/quickjs-eval.js`, { force: true });
rmSync(`${out}/wasm/quickjs-eval.wasm`, { force: true });
writeFileSync(`${out}/VERSION`, `pdfjs-dist ${version}: https://github.com/mozilla/pdf.js (Apache-2.0). Copied by scripts/vendor-pdfjs.mjs; do not edit.\n`);
console.log(`vendor/pdfjs ← pdfjs-dist ${version}`);
