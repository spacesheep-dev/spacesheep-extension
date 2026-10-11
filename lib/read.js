// Reading the page in the active tab, and the files beside it, into a file set the
// service worker can publish. Runs in the popup: it needs the activeTab grant the
// toolbar click gives, and XMLHttpRequest (a service worker has only fetch, and
// fetch can't read file://).
import { dirOf, fileName, relPath, pageRefs, cssRefs, isCss } from "./refs.js";

export const LIMITS = {
  files: 60,                 // files beside the page, besides the page itself
  fileBytes: 15 * 1024 * 1024,
  totalBytes: 25 * 1024 * 1024,
  cssDepth: 2,               // a stylesheet's @import of a stylesheet, and no deeper
};

/** A reading failure the popup has words for. */
export class ReadError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

// --- Readers: one per kind of address, same shape out ---------------------------

/** file:// through the extension's own access (the "Allow access to file URLs" switch). */
function readFileUrl(url) {
  return new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open("GET", url);
    x.responseType = "arraybuffer";
    // A file: read answers status 0 when it worked; a missing file fires onerror.
    x.onload = () => resolve(x.response && (x.status === 0 || x.status === 200)
      ? { url, bytes: new Uint8Array(x.response), type: "" }
      : { url, error: `HTTP ${x.status}` });
    x.onerror = () => resolve({ url, error: "missing" });
    x.send();
  });
}

/**
 * http(s) from inside the page itself: same origin, with the page's own cookies,
 * so a file behind the site's sign-in reads the way the tab did. Answers base64
 * (what executeScript can carry back).
 */
async function fetchInPage(urls, maxBytes) {
  const one = async (url) => {
    try {
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) return { url, error: `HTTP ${r.status}` };
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length > maxBytes) return { url, error: "too_big", size: buf.length };
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return { url, b64: btoa(s), type: r.headers.get("content-type") || "" };
    } catch (e) {
      return { url, error: String((e && e.message) || e) };
    }
  };
  return Promise.all(urls.map(one));
}

async function readHttp(tabId, urls) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId }, func: fetchInPage, args: [urls, LIMITS.fileBytes],
  });
  return (result || []).map((r) => (r.b64 != null ? { url: r.url, bytes: fromB64(r.b64), type: r.type } : r));
}

/**
 * What the tab shows, frozen: the fallback when the original can't be read, or is
 * only a shell its scripts fill in. Its scripts are left out — they already ran,
 * and running again on top of their own output draws everything twice. Data
 * blocks (JSON, templates) stay.
 */
function snapshotInPage() {
  const d = document.doctype;
  const doctype = d
    ? `<!DOCTYPE ${d.name}${d.publicId ? ` PUBLIC "${d.publicId}"` : ""}${d.systemId ? ` "${d.systemId}"` : ""}>`
    : "<!DOCTYPE html>";
  const root = document.documentElement.cloneNode(true);
  for (const s of root.querySelectorAll("script")) {
    const type = (s.getAttribute("type") || "").trim().toLowerCase();
    if (!type || type === "module" || /(java|ecma)script/.test(type)) s.remove();
  }
  return `${doctype}\n${root.outerHTML}`;
}

function probeInPage() {
  return {
    type: document.contentType, title: document.title, charset: document.characterSet, url: location.href,
    text: document.body ? document.body.innerText.trim().length : 0,
  };
}

// --- Bytes ----------------------------------------------------------------------

export function fromB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function toB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** How many words-worth of characters a reader would see in a parsed page. */
function textLength(doc) {
  const body = doc.body && doc.body.cloneNode(true);
  if (!body) return 0;
  for (const s of body.querySelectorAll("script, style, noscript, template")) s.remove();
  return body.textContent.replace(/\s+/g, " ").trim().length;
}

function sameSite(abs, pageUrl) {
  try {
    const a = new URL(abs), p = new URL(pageUrl);
    return a.protocol === p.protocol && a.host === p.host;
  } catch { return false; }
}

function decode(bytes, charset) {
  try { return new TextDecoder(charset || "utf-8").decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}

// --- The page ---------------------------------------------------------------------

/** Why this tab can't be read, before trying: a browser page, or a file Chrome won't hand over. */
export async function tabProblem(tab) {
  const url = tab && tab.url;
  // Chrome hides a file tab's address from an extension without file access, so
  // a tab with no address may well be a file: say how to allow it.
  if (!url) return new ReadError((await chrome.extension.isAllowedFileSchemeAccess()) ? "no_page" : "file_access_maybe");
  if (url.startsWith("file:")) {
    if (!(await chrome.extension.isAllowedFileSchemeAccess())) return new ReadError("file_access");
    return null;
  }
  if (!/^https?:/.test(url) || /^https:\/\/chrome(webstore)?\.google\.com\//.test(url)) return new ReadError("no_page");
  return null;
}

/**
 * The page in `tab` and the files it loads from its own folder.
 * → { title, sourceUrl, name, files: [{ path, bytes, html? }], skipped, snapshot, bytes }
 * The page itself is always `index.html` (the space's front page) and first.
 */
export async function readTab(tab, onStep = () => {}) {
  const problem = await tabProblem(tab);
  if (problem) throw problem;

  let probe;
  try {
    [{ result: probe }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: probeInPage });
  } catch (e) {
    throw new ReadError("no_access", String((e && e.message) || e));
  }
  if (!/^(text\/html|application\/xhtml\+xml)$/i.test(probe.type || "")) {
    throw new ReadError("not_html", probe.type);
  }

  const pageUrl = probe.url || tab.url;
  const isFile = pageUrl.startsWith("file:");
  const read = isFile ? (urls) => Promise.all(urls.map(readFileUrl)) : (urls) => readHttp(tab.id, urls);

  // The page as it was written. A file Chrome rendered from memory, a page that
  // refuses a second fetch, or one whose server now answers differently falls back
  // to what the tab shows.
  onStep("page");
  let snapshot = false;
  let pageBytes = null;
  try {
    const [main] = await read([pageUrl]);
    if (main && main.bytes && main.bytes.length) pageBytes = main.bytes;
  } catch {}
  if (!pageBytes) {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: snapshotInPage });
    pageBytes = new TextEncoder().encode(result);
    snapshot = true;
  }
  let html = decode(pageBytes, snapshot ? "utf-8" : probe.charset);
  let doc = new DOMParser().parseFromString(html, "text/html");

  // A web app's page is a shell its scripts fill from its own server, which a copy
  // can't reach: when the tab shows far more words than the file holds, keep what
  // the tab shows. (A local file's scripts come along with it, so it keeps its own.)
  if (!snapshot && !isFile && probe.text > 500 && textLength(doc) < probe.text * 0.2) {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: snapshotInPage });
    pageBytes = new TextEncoder().encode(result);
    html = result;
    doc = new DOMParser().parseFromString(html, "text/html");
    snapshot = true;
  }

  // What it loads from beside it.
  const dir = dirOf(pageUrl);
  const ownName = fileName(pageUrl);
  const files = [{ path: "index.html", bytes: pageBytes, html: true }];
  const taken = new Set(["index.html"]);
  const skipped = { outside: 0, missing: 0, tooBig: 0, overLimit: 0 };
  let total = pageBytes.length;

  let queue = pageRefs(doc, pageUrl);
  const seen = new Set();
  for (let depth = 0; queue.length && depth <= LIMITS.cssDepth; depth++) {
    const wanted = [];
    for (const abs of queue) {
      const path = relPath(abs, dir);
      // Another site's file (a font CDN) still loads from there; only this site's
      // own files above the page's folder are left behind.
      if (!path) { if (sameSite(abs, pageUrl)) skipped.outside++; continue; }
      if (seen.has(path) || path === ownName) continue;
      seen.add(path);
      if (taken.has(path)) continue; // a file called index.html beside the page
      if (taken.size > LIMITS.files) { skipped.overLimit++; continue; }
      taken.add(path);
      wanted.push({ abs, path });
    }
    if (!wanted.length) break;
    onStep("assets", wanted.length);
    const got = await read(wanted.map((w) => w.abs));
    const next = [];
    got.forEach((r, i) => {
      const { abs, path } = wanted[i];
      if (r.error === "too_big" || (r.bytes && r.bytes.length > LIMITS.fileBytes)) { skipped.tooBig++; return; }
      if (!r.bytes) { skipped.missing++; return; }
      if (total + r.bytes.length > LIMITS.totalBytes) { skipped.tooBig++; return; }
      total += r.bytes.length;
      files.push({ path, bytes: r.bytes });
      if (isCss(path, r.type)) next.push(...cssRefs(decode(r.bytes, "utf-8"), abs));
    });
    queue = next;
  }

  const name = ownName || new URL(pageUrl).hostname;
  const title = (probe.title || "").trim() || name.replace(/\.x?html?$/i, "") || "Untitled page";
  return { title, sourceUrl: pageUrl, name, files, skipped, snapshot, bytes: total, isFile };
}
