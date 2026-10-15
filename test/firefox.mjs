// Real Firefox, a temporary profile, and local OAuth/MCP stand-ins. No account,
// credentials, or live publishing. Install the browser with playwright install firefox.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { firefox } from "playwright";
import webExt from "web-ext";
import { build, root } from "../scripts/package.mjs";

fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const work = fs.mkdtempSync(path.join(root, "dist/firefox-test-"));
let finish, fail;
const result = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
result.catch(() => {}); // An early browser failure can arrive before run() resolves.
const deployed = [], uploads = [], registrations = [];
let codeChallenge, redirectUri, refreshes = 0, revoked = false;
const png = fs.readFileSync(path.join(root, "icons/icon-32.png"));
// A small valid PDF exercises the bundled pdf.js worker, fonts and CSP.
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
  "<< /Length 42 >>\nstream\nBT /F1 20 Tf 20 300 Td (Firefox PDF) Tj ET\nendstream",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
];
let pdf = "%PDF-1.4\n";
const offsets = objects.map((o, i) => { const at = pdf.length; pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
const xref = pdf.length;
pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const json = (value) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); };
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, PUT", "Access-Control-Allow-Headers": "content-type, authorization, mcp-protocol-version, mcp-session-id" });
      res.end(); return;
    }
    if (process.env.DEBUG_FIREFOX_TEST) console.log(req.method, url.pathname, body.length);
    if (url.pathname === "/report") {
      const report = JSON.parse(body);
      if (report.error) fail(new Error(report.error));
      else console.log(`  ✓ ${report.ok}`);
      res.end("ok");
    } else if (url.pathname === "/oauth/register") {
      const registration = JSON.parse(body);
      assert.equal(registration.client_name, "spacesheep for Firefox");
      redirectUri = registration.redirect_uris[0];
      assert.match(redirectUri, /^https:\/\/[^/]+\.extensions\.(allizom|mozilla)\.org\//);
      registrations.push(registration);
      json({ client_id: "firefox-smoke" });
    } else if (url.pathname === "/oauth/authorize") {
      assert.equal(url.searchParams.get("redirect_uri"), redirectUri);
      assert.equal(url.searchParams.get("code_challenge_method"), "S256");
      codeChallenge = url.searchParams.get("code_challenge");
      const answer = new URL(redirectUri);
      answer.searchParams.set("state", url.searchParams.get("state"));
      answer.searchParams.set("code", "local-code");
      res.writeHead(302, { Location: answer.href }); res.end();
    } else if (url.pathname === "/oauth/token") {
      const token = new URLSearchParams(body.toString());
      if (token.get("grant_type") === "refresh_token") refreshes++;
      else {
        assert.equal(token.get("code"), "local-code");
        assert.equal(token.get("redirect_uri"), redirectUri);
        assert.equal(crypto.createHash("sha256").update(token.get("code_verifier")).digest("base64url"), codeChallenge);
      }
      json({ access_token: "local-access", refresh_token: `local-refresh-${refreshes}`, expires_in: 3600 });
    } else if (url.pathname === "/oauth/revoke") { revoked = true; res.end();
    } else if (url.pathname === "/upload") {
      uploads.push({ path: url.searchParams.get("path"), size: body.length });
      // With no extension views open, the background must survive the idle timeout.
      await new Promise((r) => setTimeout(r, 35_000));
      json({ sha: crypto.createHash("sha256").update(body).digest("hex") });
    } else if (url.pathname === "/mcp") {
      const rpc = JSON.parse(body);
      assert.equal(req.headers.authorization, "Bearer local-access");
      if (rpc.method === "initialize") {
        assert.equal(rpc.params.clientInfo.name, "spacesheep-firefox");
        json({ jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "test", version: "1" } } });
      } else if (rpc.method === "notifications/initialized") { res.writeHead(202); res.end();
      } else {
        const args = rpc.params.arguments;
        let value;
        if (rpc.params.name === "stage_begin") value = { upload_url: `${origin}/upload`, limits: {}, plan: "test" };
        else {
          assert.equal(rpc.params.name, "deploy");
          deployed.push(args);
          value = { uuid: "local-space", url: `${origin}/@tester/local-space`, visibility: "private" };
        }
        json({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify(value) }] } });
        if (rpc.params.name === "deploy" && args.title === "Detached upload") {
          assert.ok(uploads.some((u) => u.size === 2 * 1024 * 1024));
          assert.ok(args.files.every((f) => f.staged_sha));
          console.log("  ✓ 35-second staged upload survives closing all extension views");
          finish();
        }
      }
    } else if (url.pathname === "/site") {
      res.setHeader("Content-Type", "text/html");
      res.setHeader("Set-Cookie", "fixture=allowed; SameSite=Lax");
      res.end('<!doctype html><title>Firefox fixture</title><link rel="stylesheet" href="/style.css"><img src="/image.png"><script>document.body.insertAdjacentHTML("beforeend", "<h1>Rendered page</h1>")</script>');
    } else if (url.pathname === "/style.css") {
      assert.match(req.headers.cookie || "", /fixture=allowed/);
      res.setHeader("Content-Type", "text/css"); res.end("h1 { color: purple; }/*" + "x".repeat(70_000) + "*/");
    } else if (url.pathname === "/image.png") { res.setHeader("Content-Type", "image/png"); res.end(png);
    } else if (url.pathname === "/report.pdf") { res.setHeader("Content-Type", "application/pdf"); res.end(pdf);
    } else { res.setHeader("Content-Type", "text/html"); res.end("<title>Local space</title>Local space"); }
  } catch (e) {
    if (!res.headersSent) { res.writeHead(500); res.end(e.message); }
    fail(e);
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const { manifest } = build("firefox", path.join(work, "extension"));
const ext = path.join(work, "extension");
manifest.host_permissions.push("http://127.0.0.1/*"); // Test-only: automated clicks cannot grant activeTab; match patterns omit ports.
manifest.permissions.push("tabs"); // Test-only access to the PDF viewer's tab URL.
fs.writeFileSync(path.join(ext, "manifest.json"), JSON.stringify(manifest));
fs.appendFileSync(path.join(ext, "background.js"), '\nextension.runtime.onInstalled.addListener(() => extension.tabs.create({ url: extension.runtime.getURL("test.html") }));\n');
fs.writeFileSync(path.join(ext, "test.html"), '<!doctype html><title>Firefox tests</title><script type="module" src="test.js"></script>');
fs.writeFileSync(path.join(ext, "test.js"), `const origin = ${JSON.stringify(origin)};\n` + fs.readFileSync(new URL("./firefox-page.js", import.meta.url), "utf8"));
let runner;
const timeout = setTimeout(() => fail(new Error("Firefox test timed out")), 120_000);
try {
  runner = await webExt.cmd.run({ sourceDir: ext, artifactsDir: work, firefox: process.env.FIREFOX_BINARY || firefox.executablePath(),
    noReload: true, noInput: true, args: process.env.HEADED ? [] : ["-headless"] });
  await result;
  assert.equal(registrations.length, 1);
  assert.equal(refreshes, 1);
  assert.ok(revoked);
  assert.equal(deployed.length, 4);
  assert.equal(deployed[0].version_name, "Moved from Firefox");
  assert.equal(deployed[1].version_name, "Updated from Firefox");
  assert.equal(deployed[1].uuid, "local-space");
  console.log("Firefox integration passed (OAuth, refresh, capture, update, PDF, files, staged upload, disconnect).");
} finally {
  clearTimeout(timeout);
  if (runner) await runner.exit();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(work, { recursive: true, force: true });
}
