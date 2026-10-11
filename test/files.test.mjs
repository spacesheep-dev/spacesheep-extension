// node --test test/  — kinds, the viewer pages, plan limits, paths.
import { test } from "node:test";
import assert from "node:assert/strict";
import { kindOf, extOf, fileSlot, safeName, titleFromName, humanSize } from "../lib/kinds.js";
import { imagePage, pdfPage, textPage, filePage, listPage, markdown, parseDelimited, href } from "../lib/viewers.js";
import { fitToPlan } from "../lib/plan.js";
import { cleanPath, commonFolder } from "../lib/build.js";

test("kindOf: the type Chrome reports wins, the name is the fallback", () => {
  assert.equal(kindOf("image/png", "x.bin"), "image");
  assert.equal(kindOf("application/pdf", ""), "pdf");
  assert.equal(kindOf("text/html; charset=utf-8", "a.txt"), "page");
  assert.equal(kindOf("", "Report.PDF"), "pdf");
  assert.equal(kindOf("", "notes.md"), "text");
  assert.equal(kindOf("application/octet-stream", "clip.mov"), "video");
  assert.equal(kindOf("application/json", "data"), "text");
  assert.equal(kindOf("application/vnd.api+json", "x"), "text");
  assert.equal(kindOf("", "archive.zip"), "file");
  assert.equal(kindOf("", "slides.key"), "file");
  assert.equal(extOf("a.tar.GZ"), "gz");
});

test("names: safe, never index.html, readable titles", () => {
  assert.equal(safeName("../../etc/passwd"), "passwd");
  assert.equal(safeName(".env"), "env");
  assert.equal(safeName('a<b>:"c|?*.png'), "abc.png");
  assert.equal(fileSlot("index.html"), "file-index.html");
  assert.equal(fileSlot("INDEX.HTML"), "file-INDEX.HTML");
  assert.equal(titleFromName("q3_board-deck.final.pdf"), "q3 board-deck.final");
  assert.equal(titleFromName(""), "Untitled");
  assert.equal(humanSize(2_500_000), "2.4 MB");
});

test("every page escapes what the file and its name put on it", () => {
  const evil = '<img src=x onerror=alert(1)>"';
  for (const html of [
    imagePage({ title: evil, file: `${evil}.png`, size: 1 }),
    pdfPage({ title: evil, file: "a.pdf", size: 1, pageCount: 1, pages: [{ path: "p.webp", width: 10, height: 10, text: evil }] }),
    textPage({ title: evil, file: "a.txt", size: 1, text: evil, name: "a.txt" }),
    filePage({ title: evil, file: "a.zip", size: 1, name: evil }),
    listPage({ title: evil, items: [{ name: evil, kind: "file", size: 1, view: "view/x.html" }] }),
  ]) {
    assert.ok(!html.includes("<img src=x"), "raw markup leaked");
    assert.ok(html.includes('<meta name="viewport"'), "phone viewport");
    assert.ok(html.includes("data-ss-id="), "commentable blocks");
  }
});

test("pdfPage: pages in order, and says what's left in the PDF", () => {
  const html = pdfPage({ title: "Deck", file: "deck.pdf", size: 9, pageCount: 50, pages: [1, 2].map((i) => ({ path: `pages/page-${i}.webp`, width: 1400, height: 1800, text: `words ${i}` })) });
  assert.ok(html.indexOf("page-1.webp") < html.indexOf("page-2.webp"));
  assert.match(html, /Pages 3–50 are in the PDF/);
  assert.match(html, /data-ss-thing="page-2"/);
  assert.match(html, /<div class="sr">words 1<\/div>/);
});

test("markdown: the safe subset, and nothing that runs", () => {
  const html = markdown("# Title\n\nHello **bold** and `code` and [link](https://x.y) and [bad](javascript:alert(1)).\n\n- one\n- [x] done\n\n```\n<script>x</script>\n```\n\n<script>alert(1)</script>\n\n| a | b |\n|---|---|\n| 1 | 2 |");
  assert.match(html, /<h2>Title<\/h2>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<a href="https:\/\/x\.y">link<\/a>/);
  assert.ok(!/href="javascript/i.test(html));
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<li>☑ done<\/li>/);
  assert.match(html, /<table>.*<th>a<\/th>.*<td>2<\/td>/s);
});

test("markdown: a quote in a link can't leave the attribute", () => {
  const html = markdown('[x](a"onmouseover="alert(1))');
  assert.ok(!/onmouseover="/.test(html.replace(/&quot;/g, "")) || html.includes("&quot;"));
  assert.ok(!html.includes('" onmouseover'));
});

test("parseDelimited: quotes, doubled quotes, newlines in a cell", () => {
  assert.deepEqual(parseDelimited('a,b\n1,"x, y"\n2,"say ""hi"""\n3,"two\nlines"\n'), [
    ["a", "b"], ["1", "x, y"], ["2", 'say "hi"'], ["3", "two\nlines"],
  ]);
  assert.deepEqual(parseDelimited("a\tb\r\n1\t2", "\t"), [["a", "b"], ["1", "2"]]);
});

test("textPage: CSV as a table with numbers right-aligned, JSON indented", () => {
  const csv = textPage({ title: "t", file: "d.csv", size: 1, text: "name,count\nx,10\ny,2", name: "d.csv" });
  assert.match(csv, /<td class="n">10<\/td>/);
  const json = textPage({ title: "t", file: "d.json", size: 1, text: '{"a":1}', name: "d.json" });
  assert.match(json, /\{\n  &quot;a&quot;: 1\n\}/);
});

test("fitToPlan: drops what may go, refuses what can't", () => {
  const f = (path, size, optional = false) => ({ path, blob: { size }, optional });
  const limits = { max_file_bytes: 10, max_total_bytes: 25, max_files: 5 };
  const r = fitToPlan([f("index.html", 1), f("big.png", 20, true), f("shown/big.webp", 5)], limits, "free");
  assert.deepEqual(r.dropped, ["big.png"]);
  assert.deepEqual(r.keep.map((x) => x.path), ["index.html", "shown/big.webp"]);
  assert.throws(() => fitToPlan([f("video.mp4", 20)], limits, "free"), /video\.mp4 is .* the Free plan takes files up to/);
  const t = fitToPlan([f("a", 9, true), f("b", 9), f("c", 9, true)], limits);
  assert.equal(t.keep.reduce((n, x) => n + x.blob.size, 0) <= 25, true);
  assert.throws(() => fitToPlan([1, 2, 3, 4, 5, 6].map((i) => f(`f${i}`, 1)), limits), /6 files/);
  assert.equal(fitToPlan([f("a", 99)], {}).keep.length, 1); // no limits known: everything goes
});

test("paths from a dropped folder", () => {
  assert.equal(cleanPath("trip/day 1/IMG_1.jpg"), "trip/day 1/IMG_1.jpg");
  assert.equal(cleanPath("a//b\\c"), "a/b/c");
  assert.equal(commonFolder(["trip/a.jpg", "trip/sub/b.jpg"]), "trip");
  assert.equal(commonFolder(["a.jpg", "trip/b.jpg"]), "");
  assert.equal(href("view/day 1/a#b.jpg.html"), "view/day%201/a%23b.jpg.html");
});
