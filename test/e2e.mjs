// End to end: the real extension in Playwright's Chromium, publishing to a local
// spacesheep MCP worker. Sign-in goes through a stand-in OAuth server here that
// keeps the real one's contract (registration, PKCE S256, single-use rotating
// refresh tokens) and forwards /mcp to the worker with an API key, because the
// worker's own OAuth always bounces through spacesheep.dev's consent page.
//
//   SS_MCP=http://localhost:8963 SS_KEY=ss_… npm run e2e
//
// SS_KEY is the worker's API_KEY_1 (wrangler dev --var API_KEY_1:… --var OWNER_EMAIL_1:…).
import { chromium } from "playwright";
import http from "node:http";
import crypto from "node:crypto";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MCP = (process.env.SS_MCP || "http://localhost:8963").replace(/\/$/, "");
const KEY = process.env.SS_KEY;
if (!KEY) throw new Error("SS_KEY is the local MCP worker's API_KEY_1");
const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const WORK = path.join(ROOT, ".e2e");
const SHOTS = path.join(WORK, "shots");
const AS_PORT = 8965, SITE_PORT = 8964;
const AS = `http://localhost:${AS_PORT}`;

let failures = 0;
const ok = (cond, what) => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${what}`);
  if (!cond) failures++;
};

// --- Fixtures -----------------------------------------------------------------------
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const FIX = path.join(WORK, "files");
const RUN = path.join(FIX, "run 1");
const png = fs.readFileSync(path.join(ROOT, "icons/icon-16.png"));
const write = (p, data) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };
const REPORT = `<!doctype html>
<html><head><meta charset="utf-8"><title>Thermal files — run 1</title>
<link rel="stylesheet" href="css/style.css">
<link rel="stylesheet" href="../shared/outside.css">
<link rel="stylesheet" href="https://fonts.example.com/inter.css">
<link rel="icon" href="img/icon.png"></head>
<body><h1>Thermal files</h1><p>Ünïcödé ✓ — the chart:</p>
<img src="img/chart.png" alt="chart"> <img src="img/missing.png" alt="">
<img srcset="img/chart.png 1x, img/chart%402x.png 2x" alt="">
<script>document.body.insertAdjacentHTML("beforeend", '<p id="added-by-script">added</p>')</script>
</body></html>`;
write(path.join(RUN, "report.html"), REPORT);
write(path.join(RUN, "css/style.css"), `@import "more.css";\nbody { background: url(../img/bg.png); }\n`);
write(path.join(RUN, "css/more.css"), "h1 { color: #5a5ae6; }\n");
write(path.join(RUN, "img/chart.png"), png);
write(path.join(RUN, "img/chart@2x.png"), png);
write(path.join(RUN, "img/bg.png"), png);
write(path.join(RUN, "img/icon.png"), png);
write(path.join(FIX, "shared/outside.css"), "p { color: gray; }\n");

// Not pages: a photo too big for the free plan's 10 MB a file (noise doesn't
// compress), a two-page PDF, Markdown, a CSV, something with no viewer at all.
function noisePng(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const raw = crypto.randomBytes((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 1 })), chunk("IEND", Buffer.alloc(0))]);
}
function makePdf(pages) {
  const objs = [];
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  const font = 3 + pages.length * 2;
  pages.forEach((text, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
    const stream = `BT /F1 36 Tf 72 680 Td (${text}) Tj ET`;
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let out = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
const BIG_PHOTO = noisePng(2600, 1700); // ~13 MB
write(path.join(FIX, "photo.png"), BIG_PHOTO);
write(path.join(FIX, "deck.pdf"), makePdf(["Quarterly numbers", "Second page here"]));
write(path.join(FIX, "notes.md"), "# Launch notes\n\nShip **Friday**.\n\n- one\n- two\n\n<script>alert(1)</script>\n");
write(path.join(FIX, "data.csv"), "city,people\nLisbon,545000\nPorto,232000\n");
write(path.join(FIX, "archive.zip"), crypto.randomBytes(4000));
write(path.join(FIX, "mysite/index.html"), `<!doctype html><title>My site</title><link rel="stylesheet" href="style.css"><h1>Hello from a folder</h1>`);
write(path.join(FIX, "mysite/style.css"), "h1{color:#5a5ae6}");
write(path.join(FIX, "mysite/.DS_Store"), "junk");
// Served over http: a page with a 2 MB picture (goes through staged uploads), and an
// app whose words are all drawn by its script (copied as the tab shows it).
const SITE = path.join(WORK, "site");
write(path.join(SITE, "docs/index.html"), `<!doctype html><html><head><title>Big picture</title></head><body><h1>Big</h1><img src="big.png"></body></html>`);
write(path.join(SITE, "docs/big.png"), crypto.randomBytes(2 * 1024 * 1024));
write(path.join(SITE, "app/index.html"), `<!doctype html><html><head><title>An app</title></head><body><div id="app"></div>
<script>document.getElementById("app").innerHTML = "<p>" + "Rendered by a script. ".repeat(60) + "</p>";</script>
<script type="application/json" id="data">{"keep": true}</script></body></html>`);

// --- The test build: the extension, allowed to reach localhost and read files -------
const EXT = path.join(WORK, "ext");
for (const f of ["manifest.json", "background.js", "popup.html", "popup.css", "popup.js", "move.html", "move.css", "move.js", "lib", "icons", "vendor"]) {
  fs.cpSync(path.join(ROOT, f), path.join(EXT, f), { recursive: true });
}
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));
// http://mcp.spacesheep.dev: the local worker names its staged-upload links after
// its route's host; the browser maps that host to the worker (below).
manifest.host_permissions.push("http://localhost/*", "http://mcp.spacesheep.dev/*", "file:///*");
fs.writeFileSync(path.join(EXT, "manifest.json"), JSON.stringify(manifest, null, 2));

// --- A static server for the http pages ---------------------------------------------
const site = http.createServer((req, res) => {
  const file = path.join(SITE, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": file.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" });
  res.end(fs.readFileSync(file));
}).listen(SITE_PORT);

// --- The stand-in OAuth server --------------------------------------------------------
const clients = new Map(), codes = new Map(), access = new Set(), refresh = new Map();
const as = { registered: 0, authorized: 0, refreshed: 0, fail401Once: false, seen401: 0 };
const b64url = (buf) => Buffer.from(buf).toString("base64url");
const readBody = (req) => new Promise((r) => { const parts = []; req.on("data", (d) => parts.push(d)); req.on("end", () => r(Buffer.concat(parts))); });
const sendJson = (res, status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
function issue(res, clientId) {
  const at = `ssat_${b64url(crypto.randomBytes(16))}`, rt = `ssrt_${b64url(crypto.randomBytes(16))}`;
  access.add(at); refresh.set(rt, clientId);
  sendJson(res, 200, { access_token: at, token_type: "Bearer", expires_in: 3600, refresh_token: rt, scope: "spacesheep:read spacesheep:write" });
}
const authServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, AS);
  const body = await readBody(req);
  if (url.pathname === "/oauth/register" && req.method === "POST") {
    const meta = JSON.parse(body.toString());
    const id = crypto.randomUUID();
    clients.set(id, meta);
    as.registered++;
    return sendJson(res, 201, { client_id: id, redirect_uris: meta.redirect_uris });
  }
  if (url.pathname === "/oauth/authorize") {
    const q = url.searchParams, c = clients.get(q.get("client_id"));
    if (!c || !c.redirect_uris.includes(q.get("redirect_uri"))) { res.writeHead(400); return res.end("Unknown client_id"); }
    if (q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) { res.writeHead(400); return res.end("PKCE required"); }
    const code = b64url(crypto.randomBytes(16));
    codes.set(code, { challenge: q.get("code_challenge"), redirect_uri: q.get("redirect_uri"), client_id: q.get("client_id") });
    as.authorized++;
    const back = new URL(q.get("redirect_uri"));
    back.searchParams.set("code", code);
    back.searchParams.set("state", q.get("state"));
    res.writeHead(302, { Location: back.href });
    return res.end();
  }
  if (url.pathname === "/oauth/token" && req.method === "POST") {
    const f = Object.fromEntries(new URLSearchParams(body.toString()));
    if (f.grant_type === "authorization_code") {
      const c = codes.get(f.code);
      codes.delete(f.code);
      if (!c || c.redirect_uri !== f.redirect_uri || c.client_id !== f.client_id) return sendJson(res, 400, { error: "invalid_grant" });
      if (crypto.createHash("sha256").update(f.code_verifier || "").digest("base64url") !== c.challenge) return sendJson(res, 400, { error: "invalid_grant", error_description: "code_verifier mismatch" });
      return issue(res, f.client_id);
    }
    if (f.grant_type === "refresh_token") {
      if (refresh.get(f.refresh_token) !== f.client_id) return sendJson(res, 400, { error: "invalid_grant" });
      refresh.delete(f.refresh_token); // single use
      as.refreshed++;
      return issue(res, f.client_id);
    }
    return sendJson(res, 400, { error: "unsupported_grant_type" });
  }
  if (url.pathname === "/oauth/revoke") { refresh.delete(new URLSearchParams(body.toString()).get("token")); res.writeHead(200); return res.end(); }
  if (url.pathname === "/mcp") {
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    if (!access.has(token) || as.fail401Once) {
      if (as.fail401Once) { as.fail401Once = false; access.delete(token); }
      as.seen401++;
      res.writeHead(401, { "WWW-Authenticate": 'Bearer resource_metadata="x"' });
      return res.end();
    }
    const headers = { "Content-Type": "application/json", Accept: req.headers.accept, Authorization: `Bearer ${KEY}` };
    if (req.headers["mcp-session-id"]) headers["Mcp-Session-Id"] = req.headers["mcp-session-id"];
    if (req.headers["mcp-protocol-version"]) headers["MCP-Protocol-Version"] = req.headers["mcp-protocol-version"];
    const r = await fetch(`${MCP}/mcp`, { method: "POST", headers, body });
    const out = { "Content-Type": r.headers.get("content-type") || "application/json" };
    if (r.headers.get("mcp-session-id")) out["Mcp-Session-Id"] = r.headers.get("mcp-session-id");
    res.writeHead(r.status, out);
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  res.writeHead(404); res.end();
}).listen(AS_PORT);

// --- Talking to the worker directly, to check what landed ------------------------------
async function mcpCall(name, args) {
  const post = (body, sid) => fetch(`${MCP}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${KEY}`, ...(sid ? { "Mcp-Session-Id": sid } : {}) },
    body: JSON.stringify(body),
  });
  const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "0" } } });
  const sid = init.headers.get("mcp-session-id");
  await init.text();
  const r = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }, sid);
  const text = await r.text();
  const line = text.split("\n").find((l) => l.startsWith("data:")) || text;
  const msg = JSON.parse(line.replace(/^data:\s*/, ""));
  const t = (msg.result.content || []).map((c) => c.text).join("\n");
  try { return JSON.parse(t); } catch { return t; }
}

// --- The browser ------------------------------------------------------------------------
const ctx = await chromium.launchPersistentContext(path.join(WORK, "profile"), {
  channel: "chromium",
  headless: process.env.HEADED ? false : true,
  args: [
    `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
    `--host-resolver-rules=MAP mcp.spacesheep.dev ${new URL(MCP).host}`,
  ],
});
// The space opens on spacesheep.dev after a move; keep the test off the internet.
await ctx.route("https://spacesheep.dev/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>space</title>opened" }));

let id = null;
// The extension's service worker. A reload (the file-access switch) stops it, and an
// MV3 worker starts only for an event: opening the popup sends one.
async function worker() {
  const live = ctx.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${id || ""}`));
  if (live) return live;
  if (!id) return ctx.waitForEvent("serviceworker");
  const waiting = ctx.waitForEvent("serviceworker");
  const wake = await ctx.newPage();
  for (let i = 0; ; i++) {
    try {
      await wake.goto(`chrome-extension://${id}/popup.html`);
      break;
    } catch (e) {
      if (i > 20) throw e; // still reloading
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  const w = await waiting;
  await wake.close();
  return w;
}
let sw = await worker();
id = new URL(sw.url()).host;
console.log(`extension ${id}`);

async function tabIdFor(page) {
  const url = page.url();
  return sw.evaluate((u) => chrome.tabs.query({}).then((ts) => (ts.find((t) => t.url === u) || {}).id), url);
}

async function openPopup(target, name) {
  const tabId = await tabIdFor(target);
  const pop = await ctx.newPage();
  await pop.setViewportSize({ width: 340, height: 360 });
  await pop.goto(`chrome-extension://${id}/popup.html?tab=${tabId}`);
  await pop.waitForFunction(() => {
    const step = document.querySelector(".step");
    return !document.getElementById("reading") && !(step && /Reading/.test(step.textContent));
  }, null, { timeout: 15000 });
  if (name) await pop.locator("body").screenshot({ path: path.join(SHOTS, `${name}.png`) });
  return pop;
}

async function moveAndWait(pop, button = "#go") {
  await pop.click(button);
  await pop.waitForSelector("#open, .problem", { timeout: 60000 });
  const problem = await pop.$(".problem");
  if (problem) throw new Error(`move failed: ${(await problem.innerText()).replace(/\s+/g, " ")}`);
  return pop.getAttribute("#open", "href");
}

const reportUrl = pathToFileURL(path.join(RUN, "report.html")).href;
const report = await ctx.newPage();
await report.goto(reportUrl);

// "Allow access to file URLs" the way chrome://extensions flips it; it reloads the extension.
async function setFileAccess(on) {
  // The switch reloads the extension: its old worker dies and a new one starts on
  // the next event, so wait for that one rather than holding on to the old.
  const next = ctx.waitForEvent("serviceworker", { timeout: 30000 }).catch(() => null);
  const page = await ctx.newPage();
  await page.goto("chrome://extensions");
  // A reload outside developer mode disables an unpacked extension.
  await page.evaluate(() => new Promise((r) => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, r)));
  await page.evaluate(([extId, fileAccess]) => new Promise((r) => chrome.developerPrivate.updateExtensionConfiguration({ extensionId: extId, fileAccess }, r)), [id, on]);
  await page.waitForFunction((extId) => new Promise((r) => chrome.developerPrivate.getExtensionInfo(extId, (i) => r(i.state === "ENABLED"))), id, { timeout: 15000, polling: 200 });
  await page.close();
  const wake = await ctx.newPage();
  for (let i = 0; ; i++) {
    try { await wake.goto(`chrome-extension://${id}/popup.html`); break; }
    catch (e) { if (i > 20) throw e; await new Promise((r) => setTimeout(r, 250)); }
  }
  sw = (await next) || (await worker());
  await wake.close();
}

try {
  await setFileAccess(false);
  console.log("file:// before Chrome allows file access");
  {
    const pop = await openPopup(report, "1-file-access");
    ok(/Chrome needs your OK/.test(await pop.innerText(".title")), "asks for the file-access switch");
    ok(/Open the setting/.test(await pop.innerText("#fix")), "offers to open the setting");
    await pop.close();
  }

  await setFileAccess(true);
  await sw.evaluate((server) => chrome.storage.local.set({ server }), AS);

  console.log("file:// page, not connected yet → sign in → publish");
  let first;
  {
    const pop = await openPopup(report, "2-ready");
    ok((await pop.innerText(".title")) === "Thermal files — run 1", "shows the page's title");
    const meta = await pop.innerText(".meta");
    ok(/report\.html/.test(meta) && /with 6 files from its folder/.test(meta), `names the file and what comes along (${meta})`);
    const notes = await pop.innerText(".notes");
    ok(/1 file outside its folder/.test(notes) && /1 file it loads is missing/.test(notes), `says what stays behind (${notes})`);
    ok(await pop.isVisible(".first"), "says the first move asks to connect");
    ok(/Not connected yet/.test(await pop.innerText("#who")), "footer: not connected");
    const url = await moveAndWait(pop);
    await pop.locator("body").screenshot({ path: path.join(SHOTS, "3-done.png") });
    ok(as.registered === 1 && as.authorized === 1, "registered once and signed in through OAuth (PKCE checked)");
    ok(/^https:\/\/spacesheep\.dev\/(@[^/]+\/|space\/)/.test(url), `published: ${url}`);
    const stored = await sw.evaluate(() => chrome.storage.local.get(["auth", "account", "moved"]));
    ok(stored.auth && stored.auth.kind === "oauth" && stored.auth.refresh_token, "kept the tokens");
    // A fresh local account has no @handle yet, so its links are /space/<uuid>.
    if (/\/@/.test(url)) ok(stored.account && stored.account.handle, `learned the handle @${stored.account && stored.account.handle}`);
    first = stored.moved[reportUrl];
    ok(first && first.uuid, "remembered the page → space");
    ok(/Publishing as @|Connected to spacesheep/.test(await pop.innerText("#who")), "footer: says it's connected");
    await new Promise((r) => setTimeout(r, 500));
    // spacesheep.dev may answer a signed-out test browser with its sign-in page.
    const path_ = new URL(url).pathname;
    const opened = ctx.pages().some((p) => p.url() === url || p.url().endsWith(`next=${encodeURIComponent(path_)}`));
    ok(opened, `opened the space in a new tab (${ctx.pages().map((p) => p.url()).join(" | ")})`);
    await pop.close();
  }

  console.log("what landed on spacesheep");
  {
    const index = await mcpCall("read_space", { uuid: first.uuid });
    const html = typeof index === "string" ? index : JSON.stringify(index);
    ok(html.includes("Ünïcödé ✓") && html.includes("css/style.css"), "index.html is the file, accents intact");
    ok(html.includes("insertAdjacentHTML"), "the file as written, its script included");
    const versions = await mcpCall("list_versions", { uuid: first.uuid });
    const vtext = JSON.stringify(versions);
    ok(/Moved from Chrome/.test(vtext), "version named 'Moved from Chrome'");
    for (const f of ["css/style.css", "css/more.css", "img/chart.png", "img/chart@2x.png", "img/bg.png", "img/icon.png"]) {
      const got = await mcpCall("read_space", { uuid: first.uuid, path: f });
      const text = typeof got === "string" ? got : JSON.stringify(got);
      ok(!/not found|no such|doesn't exist|does not exist/i.test(text), `${f} is in the space`);
    }
  }

  console.log("same file again → update it, refreshing an expired token on the way");
  {
    let pop = await openPopup(report, "4-update");
    ok((await pop.innerText("#go")) === "Update it on spacesheep", "offers to update the same space");
    ok(await pop.isVisible("#as-new"), "and to publish a new page instead");
    await moveAndWait(pop);
    ok(/^Already up to date/.test(await pop.innerText(".meta")), "nothing changed → says it's already up to date");
    await pop.close();

    fs.writeFileSync(path.join(RUN, "report.html"), REPORT.replace("the chart:", "the chart, revised:"));
    pop = await openPopup(report);
    as.fail401Once = true;
    const url = await moveAndWait(pop);
    await pop.locator("body").screenshot({ path: path.join(SHOTS, "5-updated.png") });
    ok(/^Updated/.test(await pop.innerText(".meta")), "says it updated");
    ok(as.refreshed === 1 && as.seen401 === 1, "refreshed once after a 401, then carried on");
    const again = (await sw.evaluate(() => chrome.storage.local.get("moved"))).moved[reportUrl];
    ok(again.uuid === first.uuid, "same space");
    ok(url === first.url, "same address");
    const versions = JSON.stringify(await mcpCall("list_versions", { uuid: first.uuid }));
    ok(/Updated from Chrome/.test(versions), "a new version 'Updated from Chrome'");
    await pop.close();
  }

  console.log("http page with a 2 MB picture → staged upload");
  {
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${SITE_PORT}/docs/index.html`);
    const pop = await openPopup(page);
    ok(/with 1 file from its folder/.test(await pop.innerText(".meta")), "found the picture");
    await moveAndWait(pop);
    const moved = (await sw.evaluate(() => chrome.storage.local.get("moved"))).moved[page.url()];
    const got = JSON.stringify(await mcpCall("read_space", { uuid: moved.uuid, path: "big.png" }));
    ok(!/not found|no such/i.test(got), "big.png is in the space");
    await pop.close();
  }

  console.log("a page its script draws → copied as shown, scripts left out");
  {
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${SITE_PORT}/app/index.html`);
    const pop = await openPopup(page);
    ok(/Copied as the tab shows it/.test(await pop.innerText(".notes")), "says it's a copy of what the tab shows");
    await moveAndWait(pop);
    const moved = (await sw.evaluate(() => chrome.storage.local.get("moved"))).moved[page.url()];
    const html = JSON.stringify(await mcpCall("read_space", { uuid: moved.uuid }));
    ok(html.includes("Rendered by a script."), "the drawn words are in the copy");
    ok(!html.includes("getElementById(\\\"app\\\").innerHTML"), "the drawing script isn't");
    ok(html.includes("application/json"), "the data block stays");
    await pop.close();
  }

  const spaceFiles = async (uuid) => {
    const r = await mcpCall("get_space", { uuid });
    return JSON.stringify(r);
  };
  const findSpace = async (title) => {
    const r = await mcpCall("list_spaces", {});
    const all = Array.isArray(r) ? r : (r && (r.spaces || r.results)) || [];
    return all.find((x) => (title instanceof RegExp ? title.test(x.title) : x.title === title));
  };
  const movedFor = async (url) => (await sw.evaluate(() => chrome.storage.local.get("moved"))).moved[url];

  console.log("a Markdown file → a page that sets it as a document");
  {
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(path.join(FIX, "notes.md")).href);
    const pop = await openPopup(page, "6-markdown");
    ok(/notes\.md · text file/.test(await pop.innerText(".meta")), `names it a text file (${await pop.innerText(".meta")})`);
    await moveAndWait(pop);
    const html = JSON.stringify(await mcpCall("read_space", { uuid: (await movedFor(page.url())).uuid, path: "index.html" }));
    ok(/<h2[^>]*>Launch notes<\/h2>/.test(html) && html.includes("<strong>Friday</strong>"), "Markdown set as headings and bold");
    ok(!html.includes("<script>alert(1)"), "a script in the Markdown stays text");
    await pop.close();
  }

  console.log("a photo over the plan's 10 MB → a lighter copy on the page, the original left out");
  {
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(path.join(FIX, "photo.png")).href);
    const pop = await openPopup(page, "7-photo");
    ok(/photo\.png · picture · 12\.\d MB|photo\.png · picture · 1\d\.\d MB/.test(await pop.innerText(".meta")), `names it a picture (${await pop.innerText(".meta")})`);
    await moveAndWait(pop);
    await pop.locator("body").screenshot({ path: path.join(SHOTS, "8-photo-done.png") });
    ok(/too big for your plan/.test(await pop.innerText(".notes")), "says the original was too big for the plan");
    const uuid = (await movedFor(page.url())).uuid;
    const html = JSON.stringify(await mcpCall("read_space", { uuid }));
    ok(html.includes("shown/photo.webp"), "the page shows the lighter copy");
    await pop.close();
  }

  console.log("a PDF tab → its pages as pictures, its text kept");
  {
    const page = await ctx.newPage();
    const opened = await page.goto(pathToFileURL(path.join(FIX, "deck.pdf")).href).then(() => true, () => false);
    if (!opened || !page.url().endsWith("deck.pdf")) {
      console.log("  – this Chromium downloads PDFs instead of showing them; the move page covers PDFs below");
    } else {
      const pop = await openPopup(page, "9-pdf");
      await moveAndWait(pop);
      const uuid = (await movedFor(page.url())).uuid;
      const html = JSON.stringify(await mcpCall("read_space", { uuid, path: "index.html" }));
      ok(html.includes("pages/page-1.webp") && html.includes("pages/page-2.webp"), "both pages drawn");
      ok(html.includes("Quarterly numbers"), "page 1's words are on the page");
      await pop.close();
    }
  }

  console.log("the move page: several files → a gallery and a list, each with its own page");
  {
    const mv = await ctx.newPage();
    await mv.goto(`chrome-extension://${id}/move.html`);
    await mv.setInputFiles("#pick-files", ["deck.pdf", "notes.md", "data.csv", "archive.zip"].map((f) => path.join(FIX, f)).concat(path.join(RUN, "img/chart.png")));
    ok(/5 files/.test(await mv.innerText("#picked-count")), "lists what was picked");
    await mv.fill("#title", "Launch pack");
    await mv.screenshot({ path: path.join(SHOTS, "10-move-picked.png"), fullPage: true });
    await mv.click("#go");
    await mv.waitForSelector("#result:not([hidden]), #problem:not([hidden])", { timeout: 90000 });
    const problem = await mv.$("#problem:not([hidden])");
    if (problem) throw new Error(`move page failed: ${await problem.innerText()}`);
    await mv.screenshot({ path: path.join(SHOTS, "11-move-done.png"), fullPage: true });
    const url = await mv.getAttribute("#open", "href");
    ok(/\/(@[^/]+\/launch-pack|space\/[0-9a-f-]{36})/.test(url), `published as one space: ${url}`);
    const space = await findSpace("Launch pack");
    const html = JSON.stringify(await mcpCall("read_space", { uuid: space.id, path: "index.html" }));
    ok(html.includes("view/deck.pdf.html") && html.includes("view/archive.zip.html"), "the list links each file's page");
    ok(/data-ss-id=\\"pictures/.test(html), "pictures in a grid");
    const pdfView = JSON.stringify(await mcpCall("read_space", { uuid: space.id, path: "view/deck.pdf.html" }));
    ok(pdfView.includes("deck.pdf.files/page-2.webp") && pdfView.includes("Second page here"), "the PDF's page: both pages drawn, words kept");
    const csvView = JSON.stringify(await mcpCall("read_space", { uuid: space.id, path: "view/data.csv.html" }));
    ok(csvView.includes("545000"), "the CSV as a table");
    await mv.close();
  }

  console.log("the move page: a folder with an index.html → a website, junk left out");
  {
    const mv = await ctx.newPage();
    await mv.goto(`chrome-extension://${id}/move.html`);
    await mv.setInputFiles("#pick-folder", path.join(FIX, "mysite"));
    const count = await mv.innerText("#picked-count");
    ok(/2 files|3 files/.test(count), `picked the folder (${count})`);
    await mv.click("#go");
    await mv.waitForSelector("#result:not([hidden]), #problem:not([hidden])", { timeout: 60000 });
    const space = await findSpace(/mysite/i);
    ok(!!space, "published under the folder's name");
    const html = JSON.stringify(await mcpCall("read_space", { uuid: space.id, path: "index.html" }));
    ok(html.includes("Hello from a folder"), "its own index.html is the front page");
    const files = await spaceFiles(space.id);
    ok(!files.includes("DS_Store"), "no .DS_Store");
    await mv.close();
  }

  console.log("disconnect");
  {
    const pop = await openPopup(report);
    await pop.click("#disconnect");
    await pop.waitForFunction(() => /Not connected/.test(document.getElementById("who").textContent));
    const stored = await sw.evaluate(() => chrome.storage.local.get("auth"));
    ok(!stored.auth, "forgot the tokens");
    ok(refresh.size === 0, "revoked the refresh token on the server");
    await pop.close();
  }
} catch (e) {
  failures++;
  console.error(e);
} finally {
  await ctx.close();
  site.close();
  authServer.close();
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
console.log(`screenshots: ${SHOTS}`);
process.exit(failures ? 1 : 0);
