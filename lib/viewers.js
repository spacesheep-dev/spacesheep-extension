// The page a moved file gets, so a picture, a PDF or a text opens in a space the way
// it opened in the tab: the thing itself first, its name and size under the title,
// and the original one click away. Strings in, HTML out; no DOM, so the service
// worker, the popup and tests all build the same pages. Everything a file or its
// name puts on the page is escaped here.
import { humanSize, KIND_WORD } from "./kinds.js";

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** A path as an href: each segment encoded, the slashes kept. */
export const href = (path) => String(path).split("/").map(encodeURIComponent).join("/");

const CSS = `
:root{--bg:#f6f6f4;--card:#fff;--line:#e3e3df;--ink:#1b1b1f;--muted:#55555f;--accent:#4a4ad6}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,Roboto,sans-serif}
.page{max-width:1100px;margin:0 auto;padding:clamp(20px,4vw,40px) clamp(16px,4vw,32px) 56px}
.page.narrow{max-width:820px}
h1{margin:0;font-size:clamp(24px,4.6vw,34px);line-height:1.2;text-wrap:balance;overflow-wrap:anywhere}
.meta{margin:8px 0 22px;color:var(--muted);font-size:15px;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}
.meta a{color:var(--accent);font-weight:600}
a{color:var(--accent)}
.back{display:inline-block;margin-bottom:14px;font-size:15px;text-decoration:none}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.pic{margin:0;display:grid;place-items:center;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:clamp(8px,2vw,16px)}
.pic img{display:block;max-width:100%;height:auto;max-height:85dvh;object-fit:contain}
.pdf-pages{display:grid;gap:18px}
.pdf-page{margin:0;background:var(--card);border:1px solid var(--line);border-radius:4px;overflow:hidden}
.pdf-page img{display:block;width:100%;height:auto}
.pdf-page figcaption{padding:6px 12px;font-size:13px;color:var(--muted);border-top:1px solid var(--line)}
.more{margin-top:18px;padding:14px 16px;background:var(--card);border:1px solid var(--line);border-radius:6px;color:var(--muted)}
.player{margin:0;background:#111;border-radius:6px;overflow:hidden}
.player video{display:block;width:100%;max-height:80dvh;background:#000}
.sound{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:18px}
.sound audio{width:100%}
.text{margin:0;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:clamp(14px,3vw,24px);overflow-x:auto;font:14.5px/1.6 'SF Mono',ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.md{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:clamp(16px,4vw,32px)}
.md>*:first-child{margin-top:0}
.md h1,.md h2,.md h3,.md h4{line-height:1.25;margin:1.4em 0 .5em}
.md h1{font-size:28px}.md h2{font-size:23px}.md h3{font-size:19px}
.md p,.md ul,.md ol,.md blockquote,.md pre,.md table{margin:0 0 1em}
.md blockquote{border:1px solid var(--line);background:var(--bg);padding:8px 14px;border-radius:4px;color:var(--muted)}
.md pre{background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:12px;overflow-x:auto;font:14px/1.5 'SF Mono',ui-monospace,Menlo,monospace}
.md code{font:.9em 'SF Mono',ui-monospace,Menlo,monospace;background:var(--bg);padding:.1em .35em;border-radius:3px}
.md pre code{background:none;padding:0}
.md img{max-width:100%}
.md hr{border:0;border-top:1px solid var(--line);margin:1.5em 0}
.tbl{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:6px}
.tbl table{border-collapse:collapse;width:100%;font-size:15px}
.tbl th,.tbl td{padding:8px 12px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
.tbl th{position:sticky;top:0;background:#fafaf8;font-size:13px;color:var(--muted)}
.tbl td.n{text-align:right;font-variant-numeric:tabular-nums}
.file-card{display:flex;gap:16px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:20px}
.file-ic{flex:none;width:56px;height:64px;border-radius:6px;background:var(--bg);border:1px solid var(--line);display:grid;place-items:center;font:700 12px/1 system-ui;color:var(--muted);text-transform:uppercase;overflow:hidden}
.file-card b{display:block;overflow-wrap:anywhere}
.file-card span{color:var(--muted);font-size:15px}
.btn{display:inline-flex;align-items:center;min-height:44px;padding:10px 18px;border-radius:6px;background:var(--accent);color:#fff;font-weight:600;text-decoration:none;margin-top:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:24px}
.tile{display:block;background:var(--card);border:1px solid var(--line);border-radius:6px;overflow:hidden;text-decoration:none;color:var(--ink)}
.tile img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:var(--bg)}
.tile span{display:block;padding:8px 10px;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.list{list-style:none;margin:0;padding:0;background:var(--card);border:1px solid var(--line);border-radius:6px}
.list li+li{border-top:1px solid var(--line)}
.list a{display:flex;gap:12px;align-items:center;padding:12px 14px;min-height:52px;text-decoration:none;color:var(--ink)}
.list .file-ic{width:36px;height:40px;font-size:10px}
.list b{flex:1;min-width:0;font-weight:600;overflow-wrap:anywhere}
.list small{color:var(--muted);font-size:14px;white-space:nowrap}
@media print{.meta a,.back{display:none}}
`;

function shell({ title, body, narrow = false, back = null }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main class="page${narrow ? " narrow" : ""}">
${back ? `<a class="back" href="${href(back)}" data-ss-react="off">← All files</a>\n` : ""}${body}
</main>
</body>
</html>
`;
}

function head({ title, kind, size, file, extra = "" }) {
  const dl = file ? `<a href="${href(file)}" download>Download</a>` : "";
  const parts = [KIND_WORD[kind] ? cap(KIND_WORD[kind]) : null, size != null ? humanSize(size) : null, extra || null].filter(Boolean);
  return `<header data-ss-id="file-head">
<h1 data-ss-id="file-title">${esc(title)}</h1>
<p class="meta" data-ss-id="file-meta" data-ss-react="off"><span>${esc(parts.join(" · "))}</span>${dl}</p>
</header>`;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** A picture: shown whole, never cropped, clickable to the original. */
export function imagePage({ title, file, display, size, width, height, back }) {
  const dims = width && height ? ` width="${width}" height="${height}"` : "";
  const body = `${head({ title, kind: "image", size, file, extra: width && height ? `${width} × ${height}` : "" })}
<figure class="pic" data-ss-id="picture" data-ss-thing="picture" data-ss-label="The picture">
<a href="${href(file)}"><img src="${href(display || file)}" alt="${esc(title)}"${dims}></a>
</figure>`;
  return shell({ title, body, back });
}

/**
 * A PDF as its pages, drawn to pictures (Chrome won't show a PDF inside the
 * sandboxed frame a space lives in), each page's words beside it for screen readers,
 * search and agents. `pages`: [{ path, width, height, text }].
 */
export function pdfPage({ title, file, size, pageCount, pages, back }) {
  const shown = pages.length;
  const figures = pages.map((p, i) => `<figure class="pdf-page" id="page-${i + 1}" data-ss-id="page-${i + 1}" data-ss-thing="page-${i + 1}" data-ss-label="Page ${i + 1}">
<img src="${href(p.path)}" width="${p.width}" height="${p.height}" alt="Page ${i + 1} of ${pageCount}"${i > 1 ? ' loading="lazy"' : ""}>
<figcaption data-ss-react="off">Page ${i + 1} of ${pageCount}</figcaption>
${p.text ? `<div class="sr">${esc(p.text)}</div>` : ""}
</figure>`).join("\n");
  const rest = pageCount > shown
    ? `<p class="more" data-ss-id="pdf-more">Pages ${shown + 1}–${pageCount} are in the PDF. <a href="${href(file)}" download>Download it</a> to read them.</p>`
    : "";
  const body = `${head({ title, kind: "pdf", size, file, extra: `${pageCount} page${pageCount === 1 ? "" : "s"}` })}
<section class="pdf-pages" data-ss-id="pdf-pages" data-ss-section>
${figures}
</section>
${rest}`;
  return shell({ title, body, narrow: true, back });
}

export function videoPage({ title, file, size, back }) {
  const body = `${head({ title, kind: "video", size, file })}
<figure class="player" data-ss-id="video"><video controls playsinline preload="metadata" src="${href(file)}"></video></figure>`;
  return shell({ title, body, back });
}

export function audioPage({ title, file, size, back }) {
  const body = `${head({ title, kind: "audio", size, file })}
<div class="sound" data-ss-id="audio"><audio controls preload="metadata" src="${href(file)}"></audio></div>`;
  return shell({ title, body, narrow: true, back });
}

/** Text shown in full. Markdown is set as a document, a CSV or TSV as a table,
 *  JSON indented; everything else as written. */
export function textPage({ title, file, size, text, name, back }) {
  const ext = (/\.([a-z0-9]+)$/i.exec(name || file) || [])[1]?.toLowerCase() || "";
  const MAX = 400_000;
  const clipped = text.length > MAX;
  const shown = clipped ? text.slice(0, MAX) : text;
  let view;
  if (ext === "md" || ext === "markdown") {
    view = `<article class="md" data-ss-id="text">${markdown(shown)}</article>`;
  } else if ((ext === "csv" || ext === "tsv") && !clipped) {
    view = csvTable(shown, ext === "tsv" ? "\t" : ",") || `<pre class="text" data-ss-id="text">${esc(shown)}</pre>`;
  } else {
    let t = shown;
    if (ext === "json" && !clipped) { try { t = JSON.stringify(JSON.parse(shown), null, 2); } catch {} }
    view = `<pre class="text" data-ss-id="text">${esc(t)}</pre>`;
  }
  const more = clipped ? `<p class="more" data-ss-id="text-more">The rest is in the file. <a href="${href(file)}" download>Download it</a>.</p>` : "";
  const body = `${head({ title, kind: "text", size, file })}\n${view}\n${more}`;
  return shell({ title, body, narrow: ext !== "csv" && ext !== "tsv", back });
}

/** Any other file: what it is, and the way to get it. */
export function filePage({ title, file, size, name, back }) {
  const ext = (/\.([a-z0-9]{1,6})$/i.exec(name || file) || [])[1] || "file";
  const body = `${head({ title, kind: "file", size, file })}
<div class="file-card" data-ss-id="file">
<span class="file-ic" aria-hidden="true">${esc(ext)}</span>
<div><b>${esc(name || file)}</b><span>${esc(humanSize(size || 0))}</span><br>
<a class="btn" href="${href(file)}" download>Download</a></div>
</div>`;
  return shell({ title, body, narrow: true, back });
}

/**
 * Many files: pictures as a grid, everything else as a list, each opening its own
 * page. `items`: [{ name, kind, size, view, thumb? }] (view = the item's page path).
 */
export function listPage({ title, items }) {
  const pics = items.filter((i) => i.kind === "image");
  const rest = items.filter((i) => i.kind !== "image");
  const total = items.reduce((n, i) => n + (i.size || 0), 0);
  const grid = pics.length ? `<div class="grid" data-ss-id="pictures">
${pics.map((i) => `<a class="tile" href="${href(i.view)}"><img src="${href(i.thumb || i.file)}" alt="" loading="lazy"><span>${esc(i.name)}</span></a>`).join("\n")}
</div>` : "";
  const list = rest.length ? `<ul class="list" data-ss-id="files">
${rest.map((i) => `<li><a href="${href(i.view)}"><span class="file-ic" aria-hidden="true">${esc((/\.([a-z0-9]{1,6})$/i.exec(i.name) || [])[1] || i.kind)}</span><b>${esc(i.name)}</b><small>${esc(humanSize(i.size || 0))}</small></a></li>`).join("\n")}
</ul>` : "";
  const body = `<header data-ss-id="file-head">
<h1 data-ss-id="file-title">${esc(title)}</h1>
<p class="meta" data-ss-id="file-meta" data-ss-react="off"><span>${items.length} file${items.length === 1 ? "" : "s"} · ${esc(humanSize(total))}</span></p>
</header>
${grid}
${list}`;
  return shell({ title, body });
}

// --- Markdown, the small safe subset ------------------------------------------
// Everything is escaped first; only these come back as markup: headings, lists,
// quotes, fenced code, rules, tables, emphasis, inline code, links and pictures with
// http(s) or relative addresses. No raw HTML passes through.

function inline(s) {
  const codes = [];
  let t = esc(s).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => safeUrl(url) ? `<img src="${url}" alt="${alt}">` : m);
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => safeUrl(url) ? `<a href="${url}">${label}</a>` : m);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>").replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, "$1<em>$2</em>");
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

function safeUrl(url) {
  const u = url.replace(/&amp;/g, "&");
  return /^(https?:\/\/|#|\.{0,2}\/|[a-z0-9_-]+(\/|\.|#|$))/i.test(u) && !/^(javascript|data|vbscript):/i.test(u);
}

export function markdown(src) {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  const para = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para.length = 0; } };
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^(```|~~~)/.exec(line);
    if (fence) {
      flush();
      const body = [];
      i++;
      while (i < lines.length && !lines[i].startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) { flush(); const n = Math.min(h[1].length + 1, 4); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push("<hr>"); i++; continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${markdown(q.join("\n"))}</blockquote>`);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      flush();
      const ordered = /^\s*\d+[.)]/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, "").replace(/^\[( |x|X)\]\s+/, (m, x) => (x === " " ? "☐ " : "☑ ")));
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) items[items.length - 1] += " " + lines[i++].trim();
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${tag}>`);
      continue;
    }
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      flush();
      const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const headCells = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(`<div class="tbl"><table><thead><tr>${headCells.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    para.push(line.trim());
    i++;
  }
  flush();
  return out.join("\n");
}

// --- CSV --------------------------------------------------------------------------

/** Rows of a CSV/TSV (quotes, doubled quotes, newlines inside quotes). Pure. */
export function parseDelimited(text, sep = ",") {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

function csvTable(text, sep) {
  const rows = parseDelimited(text, sep);
  if (rows.length < 2 || rows[0].length < 2) return null;
  const LIMIT = 2000;
  const [headRow, ...body] = rows;
  const numeric = headRow.map((_, c) => body.slice(0, 50).every((r) => r[c] === undefined || r[c] === "" || /^-?[\d,.]+%?$/.test(r[c].trim())));
  const shown = body.slice(0, LIMIT);
  return `<div class="tbl" data-ss-id="table"><table><thead><tr>${headRow.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>
${shown.map((r) => `<tr>${headRow.map((_, c) => `<td${numeric[c] ? ' class="n"' : ""}>${esc(r[c] ?? "")}</td>`).join("")}</tr>`).join("\n")}
</tbody></table></div>${body.length > LIMIT ? `<p class="more">${body.length - LIMIT} more rows are in the file.</p>` : ""}`;
}
