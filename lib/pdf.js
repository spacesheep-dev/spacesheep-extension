// A PDF's pages as pictures, with each page's words. Chrome won't show a PDF inside
// the sandboxed frame a space is served in (and phones were never good at it), so a
// moved PDF is published as its pages drawn at a reading width, the PDF itself kept
// as the download. Runs in an extension page (the popup, the move page): pdf.js needs
// a DOM and its worker.

import { extension } from "./browser.js";
const BASE = (p) => extension.runtime.getURL(`vendor/pdfjs/${p}`);
let lib = null;

async function pdfjs() {
  if (!lib) {
    lib = await import("../vendor/pdfjs/pdf.min.mjs");
    lib.GlobalWorkerOptions.workerSrc = BASE("pdf.worker.min.mjs");
  }
  return lib;
}

export const PDF_LIMITS = {
  pages: 40,      // drawn; the rest stay in the PDF, and the page says so
  width: 1400,    // pixels across a drawn page: sharp on a laptop, light on a phone
  quality: 0.82,
};

/**
 * → { pageCount, pages: [{ blob, width, height, text }] } for the first
 * PDF_LIMITS.pages pages. `onPage(n, total)` reports progress. Throws on a PDF it
 * can't open (encrypted, broken); the caller then publishes it as a plain file.
 */
export async function drawPdf(bytes, onPage = () => {}) {
  const { getDocument } = await pdfjs();
  const task = getDocument({
    data: bytes,
    wasmUrl: BASE("wasm/"),
    cMapUrl: BASE("cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: BASE("standard_fonts/"),
    iccUrl: BASE("iccs/"),
    enableXfa: false,
  });
  const doc = await task.promise;
  try {
    const pageCount = doc.numPages;
    const n = Math.min(pageCount, PDF_LIMITS.pages);
    const pages = [];
    for (let i = 1; i <= n; i++) {
      onPage(i, n);
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: PDF_LIMITS.width / base.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; // a page with no background of its own is paper, not transparent
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, viewport }).promise;
      const blob = await new Promise((r) => canvas.toBlob(r, "image/webp", PDF_LIMITS.quality));
      let text = "";
      try {
        const content = await page.getTextContent();
        text = content.items.map((it) => (it.str || "") + (it.hasEOL ? "\n" : " ")).join("").replace(/[ \t]+/g, " ").trim();
      } catch {}
      pages.push({ blob, width: canvas.width, height: canvas.height, text });
      page.cleanup();
    }
    return { pageCount, pages };
  } finally {
    task.destroy(); // pdf.js 6: the loading task owns the document and its worker
  }
}

/**
 * A lighter copy of a big picture for the page to show (the original stays the
 * download): at most `side` pixels on the long edge, WebP. null when the picture is
 * already small enough, or can't be decoded here (the page then shows the original).
 */
export async function displayCopy(blob, side = 2400, minBytes = 1.5 * 1024 * 1024) {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const out = { width: bmp.width, height: bmp.height, blob: null };
    if (blob.size < minBytes && scale === 1) { bmp.close(); return out; }
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const copy = await canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
    return { width: w, height: h, blob: copy.size < blob.size ? copy : null };
  } catch {
    return null;
  }
}
