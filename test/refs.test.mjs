// node --test test/  — the pure path rules. (pageRefs needs a DOM; the e2e covers it.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirOf, fileName, relPath, cssRefs, isCss } from "../lib/refs.js";

test("dirOf keeps the folder, drops the file, query and hash", () => {
  assert.equal(dirOf("file:///Users/a/reports/run%201/report.html?x=1#top"), "file:///Users/a/reports/run%201/");
  assert.equal(dirOf("https://example.com/"), "https://example.com/");
  assert.equal(dirOf("https://example.com/docs/a.html"), "https://example.com/docs/");
});

test("fileName decodes", () => {
  assert.equal(fileName("file:///Users/a/my%20report.html"), "my report.html");
  assert.equal(fileName("https://example.com/"), "");
});

test("relPath: inside the folder, decoded, no query", () => {
  const dir = "file:///Users/a/run/";
  assert.equal(relPath("file:///Users/a/run/img/chart%201.png?v=2#x", dir), "img/chart 1.png");
  assert.equal(relPath("file:///Users/a/run/style.css", dir), "style.css");
});

test("relPath: outside, folders and hidden files are refused", () => {
  const dir = "file:///Users/a/run/";
  assert.equal(relPath("file:///Users/a/shared/style.css", dir), null);
  assert.equal(relPath("file:///Users/a/run/", dir), null);
  assert.equal(relPath("file:///Users/a/run/img/", dir), null);
  assert.equal(relPath("file:///Users/a/run/.env", dir), null);
  assert.equal(relPath("file:///Users/a/run/a/.git/config", dir), null);
  assert.equal(relPath("https://cdn.example.com/x.css", "https://example.com/"), null);
  assert.equal(relPath("not a url", dir), null);
});

test("relPath: an encoded slash or dot-dot can't climb out", () => {
  const dir = "file:///Users/a/run/";
  assert.equal(relPath("file:///Users/a/run/%2e%2e/secret.txt", dir), null);
  assert.equal(relPath("file:///Users/a/run/a%5Cb.png", dir), null);
});

test("cssRefs: url() in every quoting, @import, skips data: and fragments", () => {
  const css = `@import "base.css"; @import url('theme.css');
    .a{background:url(img/a.png)} .b{background:url( "img/b.png" )}
    .c{background:url(data:image/png;base64,AAAA)} .d{mask:url(#m)}
    @font-face{src:url('../fonts/x.woff2') format('woff2')}`;
  const got = cssRefs(css, "file:///s/css/main.css").sort();
  assert.deepEqual(got, [
    "file:///s/css/base.css", "file:///s/css/img/a.png", "file:///s/css/img/b.png",
    "file:///s/css/theme.css", "file:///s/fonts/x.woff2",
  ]);
});

test("isCss by name or type", () => {
  assert.ok(isCss("a/b.CSS", ""));
  assert.ok(isCss("style", "text/css; charset=utf-8"));
  assert.ok(!isCss("a.js", "text/javascript"));
});
