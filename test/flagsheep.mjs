// Same Flagsheep workflow in real Chromium and Firefox, against a local MCP fixture.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium, firefox } from "playwright";
import webExt from "web-ext";
import { build, root } from "../scripts/package.mjs";

const limits = { max_files: 12000, max_file_bytes: 100 * 1024 ** 2, max_total_bytes: 2048 * 1024 ** 2 };
const png = fs.readFileSync(path.join(root, "icons/icon-16.png"));
for (const target of process.argv.slice(2).length ? process.argv.slice(2) : ["chrome", "firefox"]) {
  console.log(`Testing Flagsheep in ${target}`);
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  const work = fs.mkdtempSync(path.join(root, "dist/flagsheep-test-"));
  let finish, fail, runner, context, timer, plan = "supermax";
  const result = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  result.catch(() => {});
  const deployed = [], uploads = [];
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const json = (value) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); };
      if (url.pathname === "/report") {
        const report = JSON.parse(body);
        if (report.error) fail(new Error(report.error));
        else console.log(`  ✓ ${report.ok}`);
        res.end();
      } else if (url.pathname === "/complete") { res.end(); finish();
      } else if (url.pathname === "/plan") { plan = body.toString(); res.end();
      } else if (url.pathname === "/upload") {
        const sha = crypto.createHash("sha256").update(body).digest("hex");
        uploads.push({ path: url.searchParams.get("path"), size: body.length, sha });
        json({ sha });
      } else if (url.pathname === "/mcp") {
        assert.equal(req.headers.authorization, "Bearer local-access");
        const rpc = JSON.parse(body);
        if (rpc.method === "initialize") json({ jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "test", version: "1" } } });
        else if (rpc.method === "notifications/initialized") { res.writeHead(202); res.end(); }
        else {
          let value;
          if (rpc.params.name === "get_capture_limits") value = { plan, max_assets: plan === "supermax" ? 1500 : 500, limits };
          else if (rpc.params.name === "stage_begin") value = { plan, limits, upload_url: `${origin}/upload` };
          else {
            assert.equal(rpc.params.name, "deploy");
            deployed.push(rpc.params.arguments);
            value = { uuid: "flagsheep-space", url: `${origin}/@tester/flagsheep-space`, visibility: "private" };
          }
          json({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify(value) }] } });
        }
      } else if (url.pathname === "/site") {
        res.setHeader("Content-Type", "text/html");
        res.end('<!doctype html><title>Flagsheep fixture</title>' + Array.from({ length: 1501 }, (_, i) => `<img src="/image.png?i=${i}">`).join(""));
      } else if (url.pathname === "/image.png") { res.setHeader("Content-Type", "image/png"); res.end(png);
      } else { res.setHeader("Content-Type", "text/html"); res.end("<title>Local space</title>"); }
    } catch (error) { if (!res.headersSent) res.writeHead(500); res.end(); fail(error); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const { directory: ext } = build(target, path.join(work, "extension"));
    fs.writeFileSync(path.join(ext, "test.html"), '<!doctype html><script type="module" src="test.js"></script>');
    fs.writeFileSync(path.join(ext, "test.js"), `const origin = ${JSON.stringify(origin)};\n` + fs.readFileSync(new URL("./flagsheep-page.js", import.meta.url), "utf8"));
    timer = setTimeout(() => fail(new Error(`${target} Flagsheep test timed out`)), 180_000);
    if (target === "chrome") {
      context = await chromium.launchPersistentContext(path.join(work, "profile"), {
        channel: "chromium", headless: true,
        args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
      });
      const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
      const page = await context.newPage();
      await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/test.html`);
    } else {
      fs.appendFileSync(path.join(ext, "background.js"), '\nextension.runtime.onInstalled.addListener(() => extension.tabs.create({ url: extension.runtime.getURL("test.html") }));\n');
      runner = await webExt.cmd.run({ sourceDir: ext, artifactsDir: work, firefox: process.env.FIREFOX_BINARY || firefox.executablePath(), noReload: true, noInput: true, args: ["-headless"] });
    }
    await result;
    assert.equal(deployed.length, 3, "Publish, update and staged upload only; plan changes do not deploy");
    for (const args of deployed.slice(0, 2)) {
      assert.equal(args.files.length, 1501, "HTML plus 1500 assets");
      assert.equal(args.files.filter((f) => f.encoding === "base64" && Buffer.from(f.content, "base64").equals(png)).length, 1500);
      assert.equal((args.files.find((f) => f.path === "index.html").content.match(/data:image\/png;base64,/g) || []).length, 1);
    }
    assert.equal(deployed[1].uuid, "flagsheep-space");
    const name = target === "chrome" ? "Chrome" : "Firefox";
    assert.equal(deployed[0].version_name, `Moved from ${name}`);
    assert.equal(deployed[1].version_name, `Updated from ${name}`);
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].size, 2 * 1024 ** 2);
    assert.equal(deployed[2].files[0].staged_sha, uploads[0].sha);
    console.log(`  ✓ ${target}: capture, labels, publish, update, plan changes and staged upload passed`);
  } finally {
    clearTimeout(timer);
    if (context) await context.close();
    if (runner) await runner.exit();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(work, { recursive: true, force: true });
  }
}
