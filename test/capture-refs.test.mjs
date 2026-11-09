import { test } from "node:test";
import assert from "node:assert/strict";
import { assetUrl, urlKey, rewriteCss, rewriteSrcset } from "../lib/capture-refs.js";
import { fetchAsset } from "../lib/capture.js";

const base = "https://source.example/docs/page";
test("asset keys distinguish queries and origins but share fragments", () => {
  assert.equal(assetUrl("//cdn.example/a?v=1#icon", base).href, "https://cdn.example/a?v=1#icon");
  assert.equal(urlKey(assetUrl("//cdn.example/a?v=1#icon", base)), "https://cdn.example/a?v=1");
  assert.notEqual(urlKey(new URL("/a?v=1", base)), urlKey(new URL("/a?v=2", base)));
  for (const value of ["#local", "data:image/png;base64,abc", "blob:https://source.example/id", "file:///tmp/a", "javascript:alert(1)"]) {
    assert.equal(assetUrl(value, base), null);
  }
});

test("srcset retains descriptors, data URLs, and comma-containing image URLs", () => {
  const seen = [];
  const result = rewriteSrcset("a.png, b.png 2x, data:image/png;base64,AAAA 3x, https://cdn.example/a,b.png 400w", (url) => {
    seen.push(url); return url.startsWith("data:") ? url : `local/${seen.length}.png`;
  });
  assert.deepEqual(seen, ["a.png", "b.png", "data:image/png;base64,AAAA", "https://cdn.example/a,b.png"]);
  assert.equal(result, "local/1.png, local/2.png 2x, data:image/png;base64,AAAA 3x, local/4.png 400w");
});

test("srcset drops failed data:, candidates so high-DPI screens fall back to valid candidates or src", () => {
  const partial = rewriteSrcset("ok-15x.jpg 1.5x, missing-2x.jpg 2x", (url) =>
    url.startsWith("missing") ? "data:," : "./_assets/ok-15x.jpg"
  );
  assert.equal(partial, "./_assets/ok-15x.jpg 1.5x");
  const allFailed = rewriteSrcset("missing-15x.jpg 1.5x, missing-2x.jpg 2x", () => "data:,");
  assert.equal(allFailed, "");
});

test("CSS rewrites imports, escaped URLs and image-set without touching strings/comments", () => {
  const seen = [];
  const css = `/* url(ignore.png) */ @import 'theme.css' layer(theme) screen;
.a{content:"url(ignore-too.png)";background:url("https://cdn.example/a(1).png");mask:url(#mask)}
.b{background:url(a\\ b.png);background-image:image-set("one.png" 1x, url(two.png) 2x, "three.png" type("image/png") 3x)}
@font-face{src:url(\\66 ont.woff2) format('woff2')}`;
  const result = rewriteCss(css, (url) => { seen.push(url); return url.startsWith("#") ? url : `./${seen.length}.bin`; });
  assert.deepEqual(seen, ["theme.css", "https://cdn.example/a(1).png", "#mask", "a b.png", "one.png", "two.png", "three.png", "font.woff2"]);
  assert.ok(result.includes('@import "./1.bin" layer(theme) screen;'));
  assert.ok(result.includes('content:"url(ignore-too.png)"'));
  assert.ok(result.includes('type("image/png")'));
  assert.ok(result.includes('mask:url(#mask)'));
});

test("asset fetch stops oversized streams even without content-length", async (t) => {
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(10)); },
    cancel() { cancelled = true; },
  })));
  assert.equal((await fetchAsset("https://cdn.example/large", 15)).error, "too_big");
  assert.ok(cancelled);
});

test("asset fetch reports HTTP errors", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("no", { status: 404 }));
  assert.equal((await fetchAsset("https://cdn.example/missing", 15)).error, "HTTP 404");
});
