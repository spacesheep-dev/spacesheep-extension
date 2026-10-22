import { GREY_PNG } from "./capture-plan.js";
// Package a web snapshot and its dependency graph. Files are named by source URL
// (including query, excluding fragment), so CDN paths and image variants can't collide.
import { isCss } from "./refs.js";
import { assetUrl, urlKey, documentBase, prepareDocument, rewriteCss, rewriteDocument } from "./capture-refs.js";

const encoder = new TextEncoder();
const mimeExtensions = {
  "text/css": "css", "text/html": "html", "application/xhtml+xml": "html", "image/svg+xml": "svg",
  "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/pjpeg": "jpg",
  "image/webp": "webp", "image/gif": "gif", "image/avif": "avif",
  "font/woff": "woff", "font/woff2": "woff2", "font/ttf": "ttf", "font/otf": "otf",
  "font/opentype": "otf", "font/sfnt": "ttf",
  "application/font-woff": "woff", "application/font-woff2": "woff2", "application/font-sfnt": "ttf",
  "application/x-font-woff": "woff", "application/x-font-woff2": "woff2",
  "application/x-font-ttf": "ttf", "application/x-font-truetype": "ttf", "application/x-font-opentype": "otf",
  "application/vnd.ms-fontobject": "eot",
  "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico", "image/bmp": "bmp",
  "video/mp4": "mp4", "video/webm": "webm", "video/ogg": "ogv",
  "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a",
  "audio/ogg": "ogg", "audio/wav": "wav", "audio/wave": "wav", "audio/x-wav": "wav",
  "text/vtt": "vtt", "application/pdf": "pdf",
};

function sniffExtension(bytes) {
  if (!bytes || bytes.length < 4) return null;
  if (bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x32) return "woff2";
  if (bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x46) return "woff";
  if (bytes[0] === 0x4f && bytes[1] === 0x54 && bytes[2] === 0x54 && bytes[3] === 0x4f) return "otf";
  if ((bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00)
    || (bytes[0] === 0x74 && bytes[1] === 0x72 && bytes[2] === 0x75 && bytes[3] === 0x65)) return "ttf";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "gif";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "webp";
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
    && bytes[8] === 0x61 && bytes[9] === 0x76 && bytes[10] === 0x69 && (bytes[11] === 0x66 || bytes[11] === 0x73)) return "avif";
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && (bytes[2] === 0x01 || bytes[2] === 0x02) && bytes[3] === 0x00) return "ico";
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
  return null;
}

function decode(bytes, type) {
  const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(type || "")?.[1] || "utf-8";
  try { return new TextDecoder(charset).decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}

async function assetPath(key, type, bytes) {
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(key))),
    (b) => b.toString(16).padStart(2, "0")).join("");
  const ext = mimeExtensions[type.split(";")[0].trim().toLowerCase()]
    || sniffExtension(bytes)
    || /\.([a-z0-9]{1,10})$/i.exec(new URL(key).pathname)?.[1] || "bin";
  return `_assets/${hash}.${ext.toLowerCase()}`;
}

function serialize(doc, svg = false) {
  if (svg) return new XMLSerializer().serializeToString(doc);
  const doctype = doc.doctype ? new XMLSerializer().serializeToString(doc.doctype) : "<!DOCTYPE html>";
  return `${doctype}\n${doc.documentElement.outerHTML}`;
}

/** Fetch outside the page's CORS restrictions using the extension's host access. */
export async function fetchAsset(url, maxBytes) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { credentials: "include", signal: controller.signal });
    if (!response.ok) return { url, error: `HTTP ${response.status}` };
    if (Number(response.headers.get("content-length")) > maxBytes) {
      await response.body?.cancel();
      return { url, error: "too_big" };
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); return { url, error: "too_big" }; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return { url, finalUrl: response.url, bytes, type: response.headers.get("content-type") || "" };
  } catch (error) {
    return { url, error: String(error.message || error) };
  } finally { clearTimeout(timeout); }
}

/** read(urls) returns bytes plus MIME type and final URL after redirects. */
export async function captureWeb(doc, pageUrl, read, limits, onStep = () => {}) {
  const resources = new Map();
  const skipped = { outside: 0, missing: 0, tooBig: 0, overLimit: 0 };
  const documents = [];
  const unavailableBlobs = new Set();
  let total = encoder.encode(serialize(doc)).length;
  const mainKey = urlKey(pageUrl);
  const main = { path: "index.html", doc, base: documentBase(doc, pageUrl) };
  resources.set(mainKey, main);

  function discover(raw, base) {
    const url = assetUrl(raw, base);
    if (!url) {
      if (/^blob:/i.test(raw.trim()) && !unavailableBlobs.has(raw)) { unavailableBlobs.add(raw); skipped.missing++; }
      return raw;
    }
    const key = urlKey(url);
    if (!resources.has(key)) {
      const record = { key };
      resources.set(key, record);
      if (queue.length >= limits.files) { record.overLimit = true; skipped.overLimit++; }
      else queue.push(record);
    }
    return raw;
  }
  function addDocument(record) {
    prepareDocument(record.doc, record.base);
    // Installation/prefetch hints aren't part of the displayed snapshot. A web
    // manifest is itself a dependency graph for an app we're not installing.
    for (const el of record.doc.querySelectorAll('link[rel~="manifest" i], link[rel~="prefetch" i]')) el.remove();
    documents.push(record);
    rewriteDocument(record.doc, (raw) => discover(raw, record.base));
    // srcdoc inherits its parent's base, but will live alongside its saved file.
    for (const frame of record.doc.querySelectorAll("iframe[srcdoc]")) {
      const child = { doc: new DOMParser().parseFromString(frame.getAttribute("srcdoc"), "text/html"), path: record.path, frame };
      child.base = documentBase(child.doc, record.base);
      addDocument(child);
    }
  }

  const queue = [];
  addDocument(main);
  // The file/byte caps bound the graph; visited URLs terminate CSS import cycles.
  for (let cursor = 0; cursor < queue.length;) {
    const batch = queue.slice(cursor, cursor + 6);
    cursor += batch.length;
    onStep("assets", batch.length);
    const results = await read(batch.map((r) => r.key));
    for (let i = 0; i < batch.length; i++) {
      const record = batch[i], result = results[i];
      if (result?.error === "too_big" || (result?.bytes && (result.bytes.length > limits.fileBytes || total + result.bytes.length > limits.totalBytes))) {
        skipped.tooBig++; continue;
      }
      if (!result?.bytes) { skipped.missing++; continue; }
      total += result.bytes.length;
      record.path = await assetPath(record.key, result.type || "", result.bytes);
      record.bytes = result.bytes;
      record.base = result.finalUrl || record.key;
      const type = (result.type || "").split(";")[0].trim().toLowerCase();
      if (isCss(record.path, result.type)) {
        record.css = decode(result.bytes, result.type);
        rewriteCss(record.css, (raw) => discover(raw, record.base));
      } else if (type === "text/html" || /\.(?:html?|svg)$/i.test(record.path)) {
        record.svg = type === "image/svg+xml" || record.path.endsWith(".svg");
        record.doc = new DOMParser().parseFromString(decode(result.bytes, result.type), record.svg ? "image/svg+xml" : "text/html");
        record.base = documentBase(record.doc, record.base);
        addDocument(record);
      }
    }
  }

  function localReference(raw, record, kind) {
    const url = assetUrl(raw, record.base);
    if (!url) {
      // Blob URLs belong to the live tab and can't be served in a saved page.
      return /^blob:/i.test(raw.trim()) ? "data:," : raw;
    }
    const asset = resources.get(urlKey(url));
    // Missing/oversize files stay visibly missing, as reported by the popup;
    // never silently hotlink them back to the source site.
    if (!asset?.path) return asset?.overLimit && kind === "image" ? GREY_PNG : "data:,";
    const prefix = record.path === "index.html" ? "./" : "../";
    return `${prefix}${asset.path}${url.hash}`;
  }
  // Children first: serialize srcdoc only after all its own URLs are rewritten.
  for (const record of [...documents].reverse()) {
    rewriteDocument(record.doc, (raw, kind) => localReference(raw, record, kind));
    if (record.frame) record.frame.setAttribute("srcdoc", serialize(record.doc));
  }
  const files = [];
  for (const record of resources.values()) {
    if (!record.path) continue;
    let bytes = record.bytes;
    if (record.doc) bytes = encoder.encode(serialize(record.doc, record.svg));
    else if (record.css !== undefined) {
      const css = rewriteCss(record.css.replace(/^\s*@charset\s+["'][^"']+["'];/i, ""), (raw, kind) => localReference(raw, record, kind));
      bytes = encoder.encode(css);
    }
    files.push({ path: record.path, blob: new Blob([bytes]), html: !!record.doc && !record.svg });
  }
  const bytes = files.reduce((n, f) => n + f.blob.size, 0);
  if (bytes > limits.totalBytes || files.slice(1).some((f) => f.blob.size > limits.fileBytes)) {
    throw new Error("The page and its rewritten assets exceed the capture size limits.");
  }
  return { files, skipped, bytes };
}
