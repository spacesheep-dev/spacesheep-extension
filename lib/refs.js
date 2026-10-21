// Which files a page needs: the references in its HTML and CSS, each resolved twice —
// against where it lives now (where to read it from) and against the space's front
// page (where the copy will look for it, so where to store it). Pure functions, no
// chrome.*, so they run in the popup and in tests alike.

// Elements whose attribute names a file the page loads (never <a href>: a link is
// somewhere to go, not part of the page).
export const LOADS = [
  ["img", "src"], ["img", "srcset"], ["source", "src"], ["source", "srcset"],
  ["script", "src"], ["video", "src"], ["video", "poster"], ["audio", "src"],
  ["track", "src"], ["embed", "src"], ["object", "data"], ["iframe", "src"],
  ["input", "src"], ["image", "href"], ["image", "xlink:href"], ["use", "href"],
  ["use", "xlink:href"], ["feImage", "href"],
];
export const LINK_RELS = /(^|\s)(stylesheet|icon|shortcut|apple-touch-icon|mask-icon|preload|modulepreload|prefetch|manifest)(\s|$)/i;
const CSS_URL = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
const CSS_IMPORT = /@import\s+(['"])([^'"]+)\1/gi;

/** The folder a page lives in, as a URL prefix ending in "/". */
export function dirOf(pageUrl) {
  const u = new URL(pageUrl);
  u.hash = "";
  u.search = "";
  return u.href.slice(0, u.href.lastIndexOf("/") + 1);
}

/** The file name at the end of a URL, decoded ("my report.html"), or "". */
export function fileName(pageUrl) {
  const u = new URL(pageUrl);
  const last = u.pathname.slice(u.pathname.lastIndexOf("/") + 1);
  try { return decodeURIComponent(last); } catch { return last; }
}

/**
 * The path a URL has inside `dir` ("images/chart 1.png"), or null when it lies
 * outside it, names a folder, or has a segment a space can't hold (".", "..",
 * a hidden file).
 */
export function relPath(abs, dir) {
  let u;
  try { u = new URL(abs); } catch { return null; }
  u.hash = "";
  u.search = "";
  if (!u.href.startsWith(dir)) return null;
  const rest = u.href.slice(dir.length);
  if (!rest || rest.endsWith("/")) return null;
  const parts = rest.split("/").map((p) => {
    try { return decodeURIComponent(p); } catch { return null; }
  });
  if (parts.some((p) => !p || p.startsWith(".") || /[\\\0]/.test(p))) return null;
  return parts.join("/");
}

function resolve(raw, base) {
  const v = (raw || "").trim();
  if (!v || v.startsWith("#") || /^(data|blob|javascript|mailto|about):/i.test(v)) return null;
  try { return new URL(v, base).href; } catch { return null; }
}

function srcsetUrls(value) {
  // "a.png 1x, b.png 2x". A relative file name with a comma in it is rare enough
  // to lose; a data: URL (which has one) is dropped by resolve() anyway.
  return value.split(/\s*,\s*/).map((part) => part.trim().split(/\s+/)[0]).filter(Boolean);
}

/** The address a space's front page has, for resolving references the way the copy will. */
export const SPACE_ROOT = "https://space.invalid/";

/**
 * Every file a stylesheet's text loads, url(…) and @import, as { abs, at }: `abs`
 * resolved against where the stylesheet is read from, `at` against where its copy
 * is stored (pass the same URL twice when there is no copy).
 */
export function cssRefPairs(cssText, cssUrl, cssAt = cssUrl) {
  const out = new Map();
  for (const re of [CSS_URL, CSS_IMPORT]) {
    re.lastIndex = 0;
    for (const m of cssText.matchAll(re)) {
      const abs = resolve(m[2], cssUrl);
      if (abs && !out.has(abs)) out.set(abs, { abs, at: resolve(m[2], cssAt), kind: "style" });
    }
  }
  return [...out.values()];
}

/** Every URL a stylesheet's text loads: url(…) and @import, resolved against it. */
export function cssRefs(cssText, cssUrl) {
  return cssRefPairs(cssText, cssUrl).map((r) => r.abs);
}

const SCRIPTY = /(^|\s)modulepreload(\s|$)/i;

/**
 * Every file a parsed page loads, as { abs, at, kind }: `abs` resolved against the
 * page's <base href> or its own address, `at` against the same <base> on `spaceUrl`
 * (where the published copy will look for it). `kind` is "style" (a stylesheet and
 * what CSS in the page loads), "script", or "other"; stylesheets come first.
 */
export function pageRefPairs(doc, pageUrl, spaceUrl = pageUrl) {
  const baseEl = doc.querySelector("base[href]");
  const baseRaw = baseEl && baseEl.getAttribute("href");
  const base = (baseRaw && resolve(baseRaw, pageUrl)) || pageUrl;
  const spaceBase = (baseRaw && resolve(baseRaw, spaceUrl)) || spaceUrl;
  const out = new Map();
  const add = (raw, kind) => {
    const abs = resolve(raw, base);
    if (abs && !out.has(abs)) out.set(abs, { abs, at: resolve(raw, spaceBase), kind });
  };
  const addCss = (text) => {
    for (const r of cssRefPairs(text, base, spaceBase)) if (!out.has(r.abs)) out.set(r.abs, r);
  };
  for (const el of doc.querySelectorAll("link[href]")) {
    const rel = el.getAttribute("rel") || "";
    if (!LINK_RELS.test(rel)) continue;
    const as = (el.getAttribute("as") || "").toLowerCase();
    const kind = /(^|\s)stylesheet(\s|$)/i.test(rel) || as === "style" ? "style"
      : SCRIPTY.test(rel) || as === "script" ? "script" : "other";
    add(el.getAttribute("href"), kind);
  }
  for (const el of doc.querySelectorAll("style")) addCss(el.textContent || "");
  for (const el of doc.querySelectorAll("[style]")) addCss(el.getAttribute("style") || "");
  for (const [tag, attr] of LOADS) {
    for (const el of doc.getElementsByTagName(tag)) {
      const v = el.getAttribute(attr);
      if (v == null) continue;
      const kind = tag === "script" ? "script" : "other";
      if (attr === "srcset") srcsetUrls(v).forEach((u) => add(u, kind));
      else add(v, kind);
    }
  }
  return [...out.values()];
}

/** Every URL a parsed page loads, resolved against its <base href> or its own address. */
export function pageRefs(doc, pageUrl) {
  return pageRefPairs(doc, pageUrl).map((r) => r.abs);
}

/** Whether a file is a stylesheet whose own url()s are worth following. */
export const isCss = (path, type) => /\.css$/i.test(path) || /text\/css/i.test(type || "");
