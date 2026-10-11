// What kind of thing a file is, from its type and its name. The kind decides the
// page a moved file gets: an HTML page is published as itself; a picture, a PDF, a
// video, a sound or a text gets a page that shows it; anything else gets a page
// that names it and offers it for download. Pure; unit-tested.

const EXT = {
  html: "page", htm: "page", xhtml: "page",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", avif: "image",
  svg: "image", bmp: "image", ico: "image",
  pdf: "pdf",
  mp4: "video", webm: "video", mov: "video", m4v: "video", ogv: "video",
  mp3: "audio", wav: "audio", m4a: "audio", ogg: "audio", oga: "audio", flac: "audio", aac: "audio", opus: "audio",
  txt: "text", md: "text", markdown: "text", csv: "text", tsv: "text", json: "text", xml: "text",
  yaml: "text", yml: "text", toml: "text", log: "text", ini: "text", conf: "text",
  js: "text", mjs: "text", ts: "text", tsx: "text", jsx: "text", css: "text", py: "text", rb: "text",
  go: "text", rs: "text", java: "text", kt: "text", swift: "text", c: "text", h: "text", cpp: "text",
  sh: "text", sql: "text", tex: "text", srt: "text", vtt: "text",
};

/** The file name's extension, lowercased ("report.PDF" → "pdf"), or "". */
export function extOf(name) {
  const m = /\.([a-z0-9]{1,10})$/i.exec(name || "");
  return m ? m[1].toLowerCase() : "";
}

/**
 * page | image | pdf | video | audio | text | file. The type Chrome reported wins
 * where it is specific; a name is the fallback (a local file is often served with
 * no type, or a generic one).
 */
export function kindOf(type, name) {
  const t = String(type || "").split(";")[0].trim().toLowerCase();
  if (t === "text/html" || t === "application/xhtml+xml") return "page";
  if (t === "application/pdf") return "pdf";
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("audio/")) return "audio";
  const byName = EXT[extOf(name)];
  if (byName) return byName;
  if (t.startsWith("text/") || /^(application\/(json|xml|javascript|x-yaml|yaml|toml|x-sh|sql))$/.test(t) || /\+(json|xml)$/.test(t)) return "text";
  return "file";
}

/** A short word for the kind, for the popup's line under the title. */
export const KIND_WORD = {
  page: "page", image: "picture", pdf: "PDF", video: "video", audio: "sound",
  text: "text file", file: "file",
};

/** A safe file name for a space: no folders, no leading dot, nothing a path can't hold. */
export function safeName(name, fallback = "file") {
  const base = String(name || "").split(/[\\/]/).pop().replace(/[\0-\x1f<>:"|?*]/g, "").replace(/^\.+/, "").trim();
  return base.slice(0, 120) || fallback;
}

/** "index.html" is the page the space opens on, so a moved file never takes that name. */
export function fileSlot(name, fallback) {
  const n = safeName(name, fallback);
  return n.toLowerCase() === "index.html" ? `file-${n}` : n;
}

export function humanSize(n) {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** A readable title from a file name: "q3_board-deck.final.pdf" → "q3 board-deck.final". */
export function titleFromName(name) {
  const base = safeName(name, "").replace(/\.[a-z0-9]{1,10}$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return base || "Untitled";
}
