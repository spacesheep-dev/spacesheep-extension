// Which files a page needs from beside it: the relative references in its HTML
// and CSS that resolve inside the page's own folder. Pure functions, no chrome.*,
// so they run in the popup and in tests alike.

// Elements whose attribute names a file the page loads (never <a href>: a link is
// somewhere to go, not part of the page).
const LOADS = [
  ["img", "src"], ["img", "srcset"], ["source", "src"], ["source", "srcset"],
  ["script", "src"], ["video", "src"], ["video", "poster"], ["audio", "src"],
  ["track", "src"], ["embed", "src"], ["object", "data"], ["iframe", "src"],
  ["input", "src"], ["image", "href"], ["image", "xlink:href"], ["use", "href"],
  ["use", "xlink:href"], ["feImage", "href"],
];
const LINK_RELS = /(^|\s)(stylesheet|icon|shortcut|apple-touch-icon|mask-icon|preload|modulepreload|prefetch|manifest)(\s|$)/i;
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

/** Every URL a stylesheet's text loads: url(…) and @import, resolved against it. */
export function cssRefs(cssText, cssUrl) {
  const out = new Set();
  for (const re of [CSS_URL, CSS_IMPORT]) {
    re.lastIndex = 0;
    for (const m of cssText.matchAll(re)) {
      const abs = resolve(m[2], cssUrl);
      if (abs) out.add(abs);
    }
  }
  return [...out];
}

/** Every URL a parsed page loads, resolved against its <base href> or its own address. */
export function pageRefs(doc, pageUrl) {
  const baseEl = doc.querySelector("base[href]");
  const base = (baseEl && resolve(baseEl.getAttribute("href"), pageUrl)) || pageUrl;
  const out = new Set();
  const add = (raw) => {
    const abs = resolve(raw, base);
    if (abs) out.add(abs);
  };
  for (const [tag, attr] of LOADS) {
    for (const el of doc.getElementsByTagName(tag)) {
      const v = el.getAttribute(attr);
      if (v == null) continue;
      if (attr === "srcset") srcsetUrls(v).forEach(add);
      else add(v);
    }
  }
  for (const el of doc.querySelectorAll("link[href]")) {
    if (LINK_RELS.test(el.getAttribute("rel") || "")) add(el.getAttribute("href"));
  }
  for (const el of doc.querySelectorAll("style")) cssRefs(el.textContent || "", base).forEach((u) => out.add(u));
  for (const el of doc.querySelectorAll("[style]")) cssRefs(el.getAttribute("style") || "", base).forEach((u) => out.add(u));
  return [...out];
}

/** Whether a file is a stylesheet whose own url()s are worth following. */
export const isCss = (path, type) => /\.css$/i.test(path) || /text\/css/i.test(type || "");
