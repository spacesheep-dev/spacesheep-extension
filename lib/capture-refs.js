// Rewrite load-bearing URLs while discovering them. Navigation links aren't assets.
import { LOADS, LINK_RELS } from "./refs.js";

export function assetUrl(raw, base) {
  const value = (raw || "").trim();
  if (!value || value.startsWith("#")) return null;
  try {
    const url = new URL(value, base);
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch { return null; }
}

export function urlKey(url) {
  const key = new URL(url);
  key.hash = "";
  return key.href;
}

// A srcset URL may contain commas (especially data: images). Descriptors end at
// the next comma, whereas commas within a URL are part of that URL.
export function rewriteSrcset(value, rewrite) {
  let result = "", at = 0;
  while (at < value.length) {
    const start = at;
    while (at < value.length && /[\s,]/.test(value[at])) at++;
    result += value.slice(start, at);
    const urlStart = at;
    while (at < value.length && !/\s/.test(value[at])) at++;
    const token = value.slice(urlStart, at);
    if (!token) break;
    const commas = token.match(/,+$/)?.[0] || "";
    result += rewrite(commas ? token.slice(0, -commas.length) : token) + commas;
    if (commas) continue;
    const descriptorStart = at;
    let depth = 0;
    while (at < value.length) {
      const c = value[at++];
      if (c === "(") depth++;
      if (c === ")") depth--;
      if (c === "," && depth === 0) break;
    }
    result += value.slice(descriptorStart, at);
  }
  return result;
}

function unescapeCss(value) {
  return value.replace(/\\(?:([\da-f]{1,6})\s?|\r\n|[\n\r\f]|(.))/gi, (_, hex, char) => {
    if (!hex) return char || "";
    const n = parseInt(hex, 16);
    return n && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "\ufffd";
  });
}
const quotedCss = (value) => '"' + value.replace(/["\\\n\r\f]/g, (c) => `\\${c.codePointAt(0).toString(16)} `) + '"';

// Skip comments and unrelated strings, so content:"url(...)" isn't a download.
// Also recognize quoted image-set candidates, imports and escaped CSS URLs.
export function rewriteCss(text, rewrite) {
  const tokens = /\/\*[\s\S]*?\*\/|url\(\s*(?:"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)'|((?:\\[\s\S]|[^)\\])*))\s*\)|@import\s+(?:"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)')|(?:-webkit-)?image-set\(|[\w-]+\(|[()]|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/gi;
  const stack = [];
  return text.replace(tokens, (match, double, single, bare, impDouble, impSingle, offset) => {
    if (match.startsWith("/*")) return match;
    if (double !== undefined || single !== undefined || bare !== undefined) {
      const raw = unescapeCss(double ?? single ?? bare.trim());
      const next = rewrite(raw, /@import\s*$/i.test(text.slice(0, offset)) ? "stylesheet" : /\.(?:woff2?|ttf|otf|eot)(?:[?#]|$)/i.test(raw) ? "asset" : "image");
      return next === raw ? match : `url(${quotedCss(next)})`;
    }
    if (impDouble !== undefined || impSingle !== undefined) {
      const raw = unescapeCss(impDouble ?? impSingle);
      const next = rewrite(raw, "stylesheet");
      return next === raw ? match : `@import ${quotedCss(next)}`;
    }
    if (match.endsWith("(")) { stack.push(/^(?:-webkit-)?image-set\(/i.test(match)); return match; }
    if (match === ")") { stack.pop(); return match; }
    if (stack.at(-1) && /^["']/.test(match)) {
      const raw = unescapeCss(match.slice(1, -1));
      const next = rewrite(raw, "image");
      return next === raw ? match : quotedCss(next);
    }
    return match;
  });
}

export function documentBase(doc, url) {
  try { return new URL(doc.querySelector("base[href]")?.getAttribute("href") || url, url).href; }
  catch { return url; }
}

export function stripScripts(doc) {
  for (const el of doc.querySelectorAll("script")) {
    const type = (el.getAttribute("type") || "").trim().toLowerCase();
    if (!type || type === "module" || /(java|ecma)script/.test(type)) el.remove();
  }
  for (const el of doc.querySelectorAll('link[rel~="modulepreload" i], link[rel~="preload" i][as="script" i], link[rel~="preconnect" i], link[rel~="dns-prefetch" i]')) el.remove();
}

export function rewriteDocument(doc, rewrite) {
  const attribute = (el, name) => {
    const value = el.getAttribute(name);
    if (value === null) return;
    const tag = el.tagName.toLowerCase();
    const image = tag === "img" || tag === "image" || name === "poster" || name === "imagesrcset"
      || (tag === "source" && el.parentElement?.tagName.toLowerCase() === "picture")
      || (tag === "input" && el.getAttribute("type") === "image")
      || (tag === "link" && (/icon/i.test(el.getAttribute("rel") || "") || el.getAttribute("as") === "image"));
    const visit = (raw) => rewrite(raw, image ? "image" : "asset");
    const next = name === "srcset" || name === "imagesrcset" ? rewriteSrcset(value, visit) : visit(value);
    if (next !== value) {
      el.setAttribute(name, next);
      // CSS and nested documents can change bytes; old integrity would block them.
      el.removeAttribute("integrity");
      el.removeAttribute("crossorigin");
    }
  };
  for (const el of doc.querySelectorAll("link")) {
    if (LINK_RELS.test(el.getAttribute("rel") || "")) {
      attribute(el, "href");
      attribute(el, "imagesrcset");
    }
  }
  for (const [tag, name] of LOADS) {
    for (const el of doc.getElementsByTagName(tag)) attribute(el, name);
  }
  for (const el of doc.querySelectorAll("style")) el.textContent = rewriteCss(el.textContent || "", rewrite);
  for (const el of doc.querySelectorAll("[style]")) el.setAttribute("style", rewriteCss(el.getAttribute("style"), rewrite));
  for (const name of ["fill", "stroke", "filter", "clip-path", "mask", "marker-start", "marker-mid", "marker-end"]) {
    for (const el of doc.querySelectorAll(`[${name}]`)) el.setAttribute(name, rewriteCss(el.getAttribute(name), rewrite));
  }
}

// Removing <base> keeps local assets local. Resolve navigation first so links and
// forms retain their destination, while fragment links still target this copy.
export function prepareDocument(doc, base) {
  stripScripts(doc);
  for (const el of doc.querySelectorAll("a[href], area[href], form[action], [formaction]")) {
    const attr = el.hasAttribute("href") ? "href" : el.hasAttribute("action") ? "action" : "formaction";
    const raw = el.getAttribute(attr);
    if (raw && !raw.startsWith("#")) {
      try { el.setAttribute(attr, new URL(raw, base).href); } catch {}
    }
  }
  for (const el of doc.querySelectorAll("base[href]")) el.removeAttribute("href");
  for (const el of doc.querySelectorAll('meta[http-equiv="content-security-policy" i], meta[http-equiv="refresh" i]')) el.remove();
  for (const el of doc.querySelectorAll('meta[charset], meta[http-equiv="content-type" i]')) el.remove();
  if (doc.head) {
    const charset = doc.createElement("meta");
    charset.setAttribute("charset", "utf-8");
    doc.head.prepend(charset);
  }
}
