// Real Chromium extension capture against two local origins. No account or backend.
// The CDN deliberately sends no CORS headers. Render the result after both sources
// are stopped to prove copied HTML/CSS/media resolve from the saved file set.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";
import { build, root } from "../scripts/package.mjs";

fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const work = fs.mkdtempSync(path.join(root, "dist/capture-test-"));
const png = fs.readFileSync(path.join(root, "icons/icon-32.png"));
const requests = [];
const listen = async (handler) => {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
};
const close = async (server) => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); };
let cdnOrigin, siteOrigin;
const cdn = await listen((req, res) => {
  const url = new URL(req.url, cdnOrigin);
  requests.push(url.href);
  if (url.pathname === "/redirect.css") { res.writeHead(302, { Location: "/styles/main.css" }); return res.end(); }
  if (url.pathname === "/styles/main.css") {
    res.setHeader("Content-Type", "text/css");
    return res.end(`@import "nested/one.css"; body{background-image:url(../photo.png?v=bg)} @font-face{font-family:Test;src:url(../font.woff2)}`);
  }
  if (url.pathname === "/styles/nested/one.css") {
    res.setHeader("Content-Type", "text/css"); return res.end('@import "two.css"; h1 { color: rgb(7, 8, 9) }');
  }
  if (url.pathname === "/styles/nested/two.css") {
    res.setHeader("Content-Type", "text/css"); return res.end('@import "three.css";');
  }
  if (url.pathname === "/styles/nested/three.css") {
    res.setHeader("Content-Type", "text/css"); return res.end('@import "one.css"; h1 { border-top: 3px solid rgb(1, 2, 3) }');
  }
  if (url.pathname === "/font.woff2") { res.setHeader("Content-Type", "font/woff2"); return res.end("font bytes"); }
  if (url.pathname === "/frame.html") {
    res.setHeader("Content-Type", "text/html"); return res.end('<!doctype html><img id="nested" src="photo.png?v=frame"><script>throw Error("must not run")</script>');
  }
  if (url.pathname === "/sprite.svg") {
    res.setHeader("Content-Type", "image/svg+xml");
    return res.end('<svg xmlns="http://www.w3.org/2000/svg"><symbol id="icon"><image href="photo.png?v=svg" width="20" height="20"/></symbol></svg>');
  }
  if (url.pathname === "/photo.png") { res.setHeader("Content-Type", "image/png"); return res.end(png); }
  res.writeHead(404); res.end();
});
cdnOrigin = `http://127.0.0.1:${cdn.address().port}`;
const site = await listen((req, res) => {
  const url = new URL(req.url, siteOrigin);
  requests.push(url.href);
  if (url.pathname === "/photo.png") {
    assert.ok(req.headers.cookie?.includes("capture=yes"), "Same-origin asset keeps page authentication");
    res.setHeader("Content-Type", "image/png"); return res.end(png);
  }
  if (url.pathname === "/redirect.png") { res.writeHead(302, { Location: `${cdnOrigin}/photo.png?v=redirect` }); return res.end(); }
  if (url.pathname !== "/site") { res.writeHead(404); return res.end(); }
  res.setHeader("Set-Cookie", "capture=yes; Path=/; SameSite=Lax");
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html><html><head><title>Copied assets</title><base href="${cdnOrigin}/">
<link rel="stylesheet" href="${cdnOrigin}/redirect.css"><link rel="preconnect" href="${cdnOrigin}">
<link rel="preload" as="image" imagesrcset="${cdnOrigin}/photo.png?v=preload 1x, ${cdnOrigin}/photo.png?v=preload2 2x">
<style>.inline{background-image:image-set("${cdnOrigin}/photo.png?v=inline" 1x)}</style></head>
<body>${Array.from({length: 180}, (_, i) => `<img class="bulk" src="${cdnOrigin}/photo.png?bulk=${i}">`).join("")}<h1>Copied assets</h1><img id="own" src="${siteOrigin}/photo.png">
<img id="redirect" src="${siteOrigin}/redirect.png"><img id="cdn" src="//127.0.0.1:${cdn.address().port}/photo.png?v=1">
<img id="responsive" src="photo.png?v=1" srcset="photo.png?v=1 1x, photo.png?v=2 2x">
<div class="inline" style="background-image:url('${cdnOrigin}/photo.png?v=style')">inline</div>
<svg><use href="${cdnOrigin}/sprite.svg#icon"></use><rect fill="url(${cdnOrigin}/sprite.svg#paint)"/></svg>
<iframe id="frame" src="${cdnOrigin}/frame.html"></iframe>
<iframe id="srcdoc" srcdoc="&lt;img src='${cdnOrigin}/photo.png?v=srcdoc'&gt;"></iframe>
<a id="nav" href="/destination">Navigate</a><a id="fragment" href="#top">Top</a>
<script>document.body.dataset.rendered='yes'</script></body></html>`);
});
// Different hostname as well as port: this is genuinely cross-origin.
siteOrigin = `http://localhost:${site.address().port}`;
let context, savedServer;
try {
  const extensionPath = build("chrome", path.join(work, "extension")).directory;
  fs.writeFileSync(path.join(extensionPath, "capture-test.html"), '<!doctype html><meta charset="utf-8"><title>Capture test</title>');
  context = await chromium.launchPersistentContext(path.join(work, "profile"), {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).hostname;
  const source = await context.newPage();
  await source.goto(`${siteOrigin}/site`);
  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${id}/capture-test.html`);
  const captured = await extensionPage.evaluate(async (sourceUrl) => {
    const { readTab } = await import("./lib/read.js");
    const tabs = await chrome.tabs.query({});
    const result = await readTab(tabs.find((t) => t.url === sourceUrl));
    return { ...result, files: await Promise.all(result.files.map(async (file) => ({
      path: file.path, html: file.html, bytes: Array.from(new Uint8Array(await file.blob.arrayBuffer())),
    }))) };
  }, `${siteOrigin}/site`);
  assert.deepEqual(captured.skipped, { outside: 0, missing: 0, tooBig: 0, overLimit: 0 });
  const files = new Map(captured.files.map((file) => [file.path, Buffer.from(file.bytes)]));
  const asset = (url, ext) => `_assets/${createHash("sha256").update(url).digest("hex")}.${ext}`;
  const html = files.get("index.html").toString();
  for (let i = 0; i < 180; i++) assert.ok(files.has(asset(`${cdnOrigin}/photo.png?bulk=${i}`, "png")), `Copied asset beyond old cap: ${i}`);
  for (const [url, ext] of [
    [`${siteOrigin}/photo.png`, "png"], [`${siteOrigin}/redirect.png`, "png"],
    [`${cdnOrigin}/photo.png?v=1`, "png"], [`${cdnOrigin}/photo.png?v=2`, "png"],
    [`${cdnOrigin}/photo.png?v=svg`, "png"], [`${cdnOrigin}/photo.png?v=frame`, "png"],
    [`${cdnOrigin}/photo.png?v=srcdoc`, "png"], [`${cdnOrigin}/font.woff2`, "woff2"],
    [`${cdnOrigin}/photo.png?v=preload`, "png"], [`${cdnOrigin}/photo.png?v=preload2`, "png"],
    [`${cdnOrigin}/styles/nested/three.css`, "css"],
  ]) assert.ok(files.has(asset(url, ext)), `Copied ${url}`);
  assert.ok(html.includes(asset(`${cdnOrigin}/sprite.svg`, "svg") + "#icon"), "SVG fragment retained");
  assert.ok(!html.includes(`url(${cdnOrigin}`), "SVG presentation attributes rewritten");
  assert.ok(html.includes('data-rendered="yes"') && !html.includes("<script>"), "Rendered DOM preserved without rerunning scripts");
  assert.ok(!html.includes("<base href="), "Source base removed");
  console.log("✓ Actual extension captured authenticated and no-CORS CDN assets, redirects, CSS import cycles, srcset, SVG and frames");

  // Failed/oversized/unvisited assets must never silently become hotlinks.
  await extensionPage.evaluate(async () => {
    const { captureWeb } = await import("./lib/capture.js");
    const doc = new DOMParser().parseFromString('<img src="https://cdn.example/missing"><img src="https://cdn.example/big"><img src="https://cdn.example/over">', "text/html");
    const result = await captureWeb(doc, "https://site.example/page", async () => [{ error: "HTTP 404" }, { bytes: new Uint8Array(101) }],
      { files: 2, fileBytes: 100, totalBytes: 10000 });
    if (result.skipped.missing !== 1 || result.skipped.tooBig !== 1 || result.skipped.overLimit !== 1) throw Error(JSON.stringify(result.skipped));
    const html = await result.files[0].blob.text();
    if (html.includes("https://cdn.example") || (html.match(/src="data:,"/g) || []).length !== 2 || !html.includes("data:image/png;base64,")) throw Error(html);
    const integrityDoc = new DOMParser().parseFromString('<link rel="stylesheet" href="https://cdn.example/a.css" integrity="invalid" crossorigin="anonymous">', "text/html");
    const copied = await captureWeb(integrityDoc, "https://site.example/", async () => [{ bytes: new TextEncoder().encode('body{color:red}'), type: "text/css" }],
      { files: 2, fileBytes: 1000, totalBytes: 10000 });
    if ((await copied.files[0].blob.text()).includes("integrity=")) throw Error("Stale stylesheet integrity retained");
  });
  console.log("✓ Capture caps report skipped files and replace unavailable references; rewritten stylesheets drop stale integrity");

  await extensionPage.evaluate(async () => {
    const { captureWeb } = await import("./lib/capture.js");
    const { GREY_PNG } = await import("./lib/capture-plan.js");
    const bytes = new Uint8Array(await (await fetch(GREY_PNG)).arrayBuffer());
    for (const cap of [40, 150, 500]) {
      const doc = new DOMParser().parseFromString(Array.from({ length: 510 }, (_, i) => `<img src="https://cdn.example/image-${i}">`).join(""), "text/html");
      let fetched = 0;
      const result = await captureWeb(doc, "https://site.example/", async urls => {
        fetched += urls.length;
        return urls.map(() => ({ bytes, type: "image/png" }));
      }, { files: cap, fileBytes: 10000, totalBytes: 1000000 });
      if (fetched !== cap || result.files.length !== cap + 1 || result.skipped.overLimit !== 510 - cap) throw Error(`Wrong cap ${cap}`);
      const saved = new DOMParser().parseFromString(await result.files[0].blob.text(), "text/html");
      if ([...saved.images].filter(img => img.src === GREY_PNG).length !== 510 - cap) throw Error(`Missing placeholders ${cap}`);
    }
    const image = new Image(); image.src = GREY_PNG; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0, 1, 1);
    if (String(ctx.getImageData(0, 0, 1, 1).data) !== "204,204,204,255") throw Error("Placeholder isn't opaque grey PNG");
    const doc = new DOMParser().parseFromString('<picture><source srcset="https://cdn.example/a 1x, https://cdn.example/b 2x"><img src="https://cdn.example/c"></picture><link rel="stylesheet" href="https://cdn.example/style"><video poster="https://cdn.example/poster" src="https://cdn.example/video"></video><style>@import url("https://cdn.example/import");.x{background-image:url("https://cdn.example/bg")}</style>', "text/html");
    const result = await captureWeb(doc, "https://site.example/", async () => { throw Error("Must not fetch omitted assets"); }, { files: 0, fileBytes: 1000, totalBytes: 100000 });
    const html = await result.files[0].blob.text();
    if (html.includes("https://cdn.example") || !html.includes('href="data:,"') || !html.includes('src="data:,"') || !html.includes('@import url("data:,")')) throw Error(html);
  });
  console.log("✓ Free/Pro/Max caps, zero excess downloads, responsive/CSS PNG placeholders and non-image omissions");

  await source.close();
  await close(site); await close(cdn);
  const savedRequests = [];
  savedServer = await listen((req, res) => {
    const pathname = new URL(req.url, "http://saved").pathname.slice(1);
    const content = files.get(pathname || "index.html");
    if (!content) { res.writeHead(404); return res.end(); }
    const ext = path.extname(pathname || "index.html");
    res.setHeader("Content-Type", ({ ".html": "text/html", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" })[ext] || "application/octet-stream");
    res.end(content);
  });
  const savedOrigin = `http://127.0.0.1:${savedServer.address().port}`;
  const saved = await context.newPage();
  saved.on("request", (request) => savedRequests.push(request.url()));
  await saved.goto(savedOrigin, { waitUntil: "networkidle" });
  assert.equal(await saved.locator("h1").evaluate((el) => getComputedStyle(el).color), "rgb(7, 8, 9)");
  assert.equal(await saved.locator("h1").evaluate((el) => getComputedStyle(el).borderTopWidth), "3px");
  for (const selector of ["#own", "#redirect", "#cdn", "#responsive"]) {
    assert.ok(await saved.locator(selector).evaluate((el) => el.complete && el.naturalWidth > 0), `Saved ${selector} renders`);
  }
  assert.ok(await saved.frameLocator("#frame").locator("img").evaluate((el) => el.complete && el.naturalWidth > 0));
  assert.ok(await saved.frameLocator("#srcdoc").locator("img").evaluate((el) => el.complete && el.naturalWidth > 0));
  assert.equal(await saved.locator("#nav").getAttribute("href"), `${cdnOrigin}/destination`);
  assert.equal(await saved.locator("#fragment").getAttribute("href"), "#top");
  assert.ok(savedRequests.every((url) => url.startsWith(savedOrigin) || url.startsWith("data:")), JSON.stringify(savedRequests));
  console.log("✓ Saved page renders images, nested CSS and frames with both source servers stopped and no external asset requests");
} finally {
  await context?.close();
  if (site.listening) await close(site);
  if (cdn.listening) await close(cdn);
  if (savedServer?.listening) await close(savedServer);
  fs.rmSync(work, { recursive: true, force: true });
}
