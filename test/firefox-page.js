// Copied only into the temporary test extension; origin is supplied by firefox.mjs.
import { extension, isFirefox, isAndroidBuild } from "./lib/browser.js";
import { readTab, tabProblem } from "./lib/read.js";
import { buildSingle } from "./lib/build.js";
import { stashPut } from "./lib/stash.js";

const assert = (value, message) => { if (!value) throw new Error(message); };
const ask = (message) => extension.runtime.sendMessage(message);
const report = (ok) => fetch(`${origin}/report`, { method: "POST", body: JSON.stringify({ ok }) });
const until = async (fn) => {
  const start = Date.now();
  while (Date.now() - start < 20_000) { const value = await fn(); if (value) return value; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("Timed out: " + fn.toString());
};
const frame = async (url) => {
  const el = document.createElement("iframe"); el.src = url;
  document.body.append(el);
  await new Promise((r) => el.onload = r);
  return el;
};

try {
  assert(isFirefox && extension === browser, "Firefox promise API selected");
  if (isAndroidBuild) {
    assert(!extension.identity, "Android package cannot use desktop identity");
    assert(!extension.contextMenus, "Android package cannot use desktop context menus");
  }
  await extension.storage.local.set({ server: origin });
  assert(!(await ask({ type: "state" })).connected, "Starts disconnected");
  const connected = await ask({ type: "connect" });
  assert(connected.ok, JSON.stringify(connected));
  assert((await ask({ type: "state" })).connected, "OAuth persisted");
  await report(`${isAndroidBuild ? "tab callback interception" : "real identity flow"}, registration, PKCE and promise messaging`);

  const tab = await extension.tabs.create({ url: `${origin}/site`, active: false });
  await until(async () => { const t = await extension.tabs.get(tab.id); return t.url === `${origin}/site` && t.status === "complete"; });
  const captured = await readTab(await extension.tabs.get(tab.id));
  const html = await captured.files[0].blob.text();
  assert(html.includes("Rendered page") && !html.includes("<script>"), "Rendered DOM snapshot");
  assert(captured.files.some((f) => f.path === "style.css"), "Authenticated stylesheet copied: " + JSON.stringify({ paths: captured.files.map((f) => f.path), skipped: captured.skipped }));
  assert((await captured.files.find((f) => f.path === "style.css").blob.text()) === "h1 { color: purple; }/*" + "x".repeat(70_000) + "*/", "All byte-conversion chunks preserved");
  assert(captured.files.some((f) => f.path === "image.png"), "Picture copied");
  await report("page capture, same-origin cookies, styles and pictures");

  let pop = await frame(`popup.html?tab=${tab.id}`);
  await until(() => pop.contentDocument.querySelector("#go"));
  if (isAndroidBuild) {
    for (const width of [320, 360, 412]) {
      pop.style.width = `${width}px`;
      const doc = pop.contentDocument;
      assert(doc.body.classList.contains("android"), "Mobile layout enabled");
      assert(doc.documentElement.scrollWidth <= doc.documentElement.clientWidth, "Popup fits phone width " + width);
      assert(doc.querySelector("#go").getBoundingClientRect().height >= 48, "Touch target is at least 48px");
    }
    await report("Android popup layout at 320, 360 and 412px");
  }
  pop.contentDocument.querySelector("#go").click();
  await until(() => pop.contentDocument.querySelector("#open"));
  assert((await extension.storage.local.get("moved")).moved[`${origin}/site`].uuid === "local-space", "Move remembered");
  pop.remove();
  const { auth } = await extension.storage.local.get("auth");
  await extension.storage.local.set({ auth: { ...auth, expires_at: 0 } });
  pop = await frame(`popup.html?tab=${tab.id}`);
  await until(() => pop.contentDocument.querySelector("#go"));
  assert(pop.contentDocument.querySelector("#go").textContent.includes("Update"), "Popup offers update");
  pop.contentDocument.querySelector("#go").click();
  await until(() => pop.contentDocument.querySelector("#open"));
  pop.remove();
  await report("popup publish, remembered update and refresh token exchange");

  assert((await tabProblem({ url: "file:///tmp/report.html" })).code === "file_picker", "Local file picker fallback");
  assert((await tabProblem({ url: "about:addons" })).code === "no_page", "Browser page rejected");
  const pdf = await (await fetch(`${origin}/report.pdf`)).blob();
  const built = await buildSingle({ name: "report.pdf", type: "application/pdf", blob: pdf });
  assert(built.files.some((f) => f.path.endsWith(".webp")), "PDF rendered by bundled worker");
  assert((await built.files[0].blob.text()).includes("Firefox PDF"), "PDF words retained");
  const pdfTab = await extension.tabs.create({ url: `${origin}/report.pdf`, active: false });
  await until(async () => { const t = await extension.tabs.get(pdfTab.id); return t.title?.includes("report.pdf") && t.status === "complete"; });
  // Headless Firefox may expose about:blank for its protected viewer. Supply the
  // source URL that a toolbar activeTab grant normally provides.
  try {
    await readTab({ ...pdfTab, url: `${origin}/report.pdf` });
    throw new Error("PDF viewer unexpectedly allowed capture");
  } catch (e) { assert(e.code === "pdf_viewer", "Protected PDF offers file picker: " + e.message); }
  await report("PDF rendering and protected-tab fallbacks");

  const mover = await frame("move.html");
  await until(() => mover.contentDocument.querySelector("#who").textContent);
  if (isAndroidBuild) {
    mover.style.width = "320px";
    const doc = mover.contentDocument;
    assert(doc.documentElement.scrollWidth <= doc.documentElement.clientWidth, "File picker fits phone width");
    assert(doc.querySelector(".drop-big").textContent === "Choose files from your device", "Phone picker instructions");
  }
  const dt = new mover.contentWindow.DataTransfer();
  dt.items.add(new File(["# Firefox file\nPicked from disk"], "note.md", { type: "text/markdown" }));
  const input = mover.contentDocument.querySelector("#pick-files"); input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  mover.contentDocument.querySelector("#go").click();
  await until(() => !mover.contentDocument.querySelector("#result").hidden);
  mover.remove();
  await ask({ type: "disconnect" });
  assert(!(await ask({ type: "state" })).connected, "Disconnected");
  await report("file picker publishing and disconnect/revocation");

  // Restore the test token, start a staged job and close every extension view.
  // The test server delays PUT for 35s and asserts deploy arrives afterwards.
  await extension.storage.local.set({ auth });
  const jobId = crypto.randomUUID();
  await stashPut(jobId, [{ path: "large.bin", blob: new Blob([new Uint8Array(2 * 1024 * 1024)]) }]);
  assert((await ask({ type: "move", req: { jobId, title: "Detached upload", kind: "file", remember: false } })).ok, "Staged job started");
  window.close();
} catch (error) {
  await fetch(`${origin}/report`, { method: "POST", body: JSON.stringify({ error: `${error.message}\n${error.stack || ""}` }) });
}
