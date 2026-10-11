// Any file, or many, into the files of a space. One file gets one page that shows it
// (lib/viewers.js) beside the original; a folder with an index.html is a site and goes
// as it is; anything else becomes a gallery of pictures and a list of the rest, each
// with a page of its own. Runs in an extension page: PDFs and big pictures are drawn
// here (lib/pdf.js).
import { kindOf, extOf, fileSlot, safeName, titleFromName } from "./kinds.js";
import { imagePage, pdfPage, videoPage, audioPage, textPage, filePage, listPage } from "./viewers.js";
import { drawPdf, displayCopy } from "./pdf.js";

const htmlBlob = (s) => new Blob([s], { type: "text/html;charset=utf-8" });
/** Files that are never worth moving out of a folder. */
const JUNK = /(^|\/)(\.[^/]*|Thumbs\.db|desktop\.ini|__MACOSX)(\/|$)/i;

/** A relative path a space can hold: each segment cleaned, nothing hidden. */
export function cleanPath(p) {
  const parts = String(p).split(/[\\/]+/).filter(Boolean).map((s) => safeName(s, ""));
  return parts.some((s) => !s) ? null : parts.join("/");
}

/**
 * The page for one file, and what it needs beside the original.
 *   up       prefix from the page to the space's root ("" or "../…")
 *   slot     where the original sits in the space
 *   assetDir where drawings (PDF pages, a picture's lighter copy) go
 * → { kind, title, html, assets: [{ path, blob }], originalOptional, note? }
 */
async function viewFor(item, { up, slot, assetDir, back, budget, onStep }) {
  let kind = kindOf(item.type, item.name);
  const title = item.title || titleFromName(item.name);
  const size = item.blob.size;
  const file = up + slot;
  const assets = [];

  if (kind === "image") {
    onStep("image", item.name);
    const copy = await displayCopy(item.blob);
    let display = null;
    if (copy && copy.blob) {
      const path = `${assetDir}/${slot.split("/").pop().replace(/\.[^.]+$/, "")}.webp`;
      assets.push({ path, blob: copy.blob });
      display = up + path;
    }
    // With a lighter copy on the page, the original is the download: worth keeping,
    // but a plan's per-file cap may drop it.
    return { kind, title, assets, originalOptional: !!display,
      html: imagePage({ title, file, display, size, width: copy && copy.width, height: copy && copy.height, back }) };
  }

  if (kind === "pdf" && budget.pages > 0) {
    try {
      const { pageCount, pages } = await drawPdf(new Uint8Array(await item.blob.arrayBuffer()),
        (n, total) => onStep("pdf", item.name, n, total));
      const shown = pages.slice(0, budget.pages).map((p, i) => {
        const path = `${assetDir}/page-${i + 1}.webp`;
        assets.push({ path, blob: p.blob });
        return { path: up + path, width: p.width, height: p.height, text: p.text };
      });
      budget.pages -= shown.length;
      return { kind, title, assets, originalOptional: false,
        html: pdfPage({ title, file, size, pageCount, pages: shown, back }) };
    } catch (e) {
      // Encrypted or broken: it still moves, as a file to download.
      kind = "file";
      item.note = "This PDF couldn’t be drawn (it may be password-protected), so it’s here to download.";
    }
  }

  if (kind === "video") return { kind, title, assets, originalOptional: false, html: videoPage({ title, file, size, back }) };
  if (kind === "audio") return { kind, title, assets, originalOptional: false, html: audioPage({ title, file, size, back }) };
  if (kind === "text") {
    const text = await item.blob.text();
    return { kind, title, assets, originalOptional: text.length <= 400_000,
      html: textPage({ title, file, size, text, name: item.name, back }) };
  }
  return { kind: kind === "pdf" ? "pdf" : "file", title, assets, originalOptional: false, note: item.note,
    html: filePage({ title, file, size, name: item.name, back }) };
}

/**
 * One file → { title, kind, files: [{ path, blob, html?, optional? }], note? }.
 * An HTML file is published as itself.
 */
export async function buildSingle(item, onStep = () => {}) {
  const kind = kindOf(item.type, item.name);
  if (kind === "page") {
    return { title: item.title || titleFromName(item.name), kind, files: [{ path: "index.html", blob: item.blob, html: true }] };
  }
  const slot = fileSlot(item.name, `file.${extOf(item.name) || "bin"}`);
  const v = await viewFor(item, { up: "", slot, assetDir: kind === "pdf" ? "pages" : "shown", back: null, budget: { pages: Infinity }, onStep });
  return {
    title: v.title,
    kind: v.kind,
    note: v.note,
    files: [
      { path: "index.html", blob: htmlBlob(v.html), html: true },
      { path: slot, blob: item.blob, optional: v.originalOptional },
      ...v.assets,
    ],
  };
}

/** The folder a dropped tree shares ("trip/a.jpg", "trip/b.jpg" → "trip"), or "". */
export function commonFolder(paths) {
  const firsts = new Set(paths.map((p) => (p.includes("/") ? p.split("/")[0] : "")));
  return firsts.size === 1 && !firsts.has("") ? [...firsts][0] : "";
}

/**
 * Many files (a selection, or a folder's tree as relative paths) → the same shape
 * as buildSingle. `items`: [{ path, name, type, blob }].
 */
export async function buildMany(items, title, onStep = () => {}) {
  let list = items.filter((i) => !JUNK.test(i.path));
  if (list.length === 1) return buildSingle({ ...list[0], title }, onStep);

  // A dropped folder arrives with its own name in front of every path.
  const top = commonFolder(list.map((i) => i.path));
  list = list.map((i) => ({ ...i, rel: cleanPath(top ? i.path.slice(top.length + 1) : i.path) })).filter((i) => i.rel);
  const name = title || (top ? titleFromName(top) : `${list.length} files`);

  // A site: it has its own front page, so it goes exactly as it is.
  if (list.some((i) => i.rel.toLowerCase() === "index.html")) {
    return { title: name, kind: "site", files: list.map((i) => ({ path: i.rel.toLowerCase() === "index.html" ? "index.html" : i.rel, blob: i.blob, html: /\.html?$/i.test(i.rel) })) };
  }

  const files = [];
  const entries = [];
  const budget = { pages: 120 }; // PDF pages drawn across the whole move
  for (const i of list) {
    const kind = kindOf(i.type, i.name);
    files.push({ path: i.rel, blob: i.blob });
    if (kind === "page") {
      // An HTML file in the folder is already a page: the list links to it.
      entries.push({ name: i.rel, kind, size: i.blob.size, view: i.rel });
      continue;
    }
    const view = `view/${i.rel}.html`;
    const up = "../".repeat(view.split("/").length - 1);
    const v = await viewFor(i, { up, slot: i.rel, assetDir: `view/${i.rel}.files`, back: `${up}index.html`, budget, onStep });
    files.push({ path: view, blob: htmlBlob(v.html), html: true }, ...v.assets);
    const thumb = v.kind === "image" ? (v.assets[0] ? v.assets[0].path : i.rel) : null;
    entries.push({ name: i.rel, kind: v.kind, size: i.blob.size, view, file: i.rel, thumb });
  }
  files.unshift({ path: "index.html", blob: htmlBlob(listPage({ title: name, items: entries })), html: true });
  return { title: name, kind: "collection", files };
}
