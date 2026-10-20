// The move page: files or a whole folder from the computer, dropped or picked, into
// one space. It builds the space's files here (lib/build.js draws PDFs and lightens
// big pictures), stashes them, and hands the job to the service worker, which signs
// in, uploads and opens the result — the same path a tab's move takes.
import { extension, isAndroidBuild } from "./lib/browser.js";
import { buildMany, commonFolder } from "./lib/build.js";
import { stashPut } from "./lib/stash.js";
import { humanSize, titleFromName } from "./lib/kinds.js";

const $ = (id) => document.getElementById(id);
if (isAndroidBuild) {
  document.body.classList.add("android");
  document.querySelector(".drop-big").textContent = "Choose files from your device";
}
const ask = (msg) => extension.runtime.sendMessage(msg);
let items = []; // [{ path, name, type, blob }]
let titleTouched = false;

// --- Picking --------------------------------------------------------------------

function fromFileList(list) {
  return [...list].map((f) => ({ path: f.webkitRelativePath || f.name, name: f.name, type: f.type, blob: f }));
}

/** Everything under a dropped folder, with paths from the folder's own name down. */
async function walk(entry, prefix = "") {
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    return [{ path: prefix + file.name, name: file.name, type: file.type, blob: file }];
  }
  if (!entry.isDirectory) return [];
  const reader = entry.createReader();
  const out = [];
  for (;;) {
    const batch = await new Promise((res, rej) => reader.readEntries(res, rej)); // ≤100 at a time
    if (!batch.length) break;
    for (const e of batch) out.push(...(await walk(e, `${prefix}${entry.name}/`)));
  }
  return out;
}

function add(more) {
  const seen = new Set(items.map((i) => i.path));
  items = items.concat(more.filter((i) => !seen.has(i.path)));
  render();
}

function render() {
  $("picked").hidden = !items.length;
  if (!items.length) return;
  const total = items.reduce((n, i) => n + i.blob.size, 0);
  $("picked-count").textContent = `${items.length} file${items.length === 1 ? "" : "s"} · ${humanSize(total)}`;
  const list = $("picked-list");
  list.replaceChildren(...items.slice(0, 200).map((i) => {
    const li = document.createElement("li");
    const p = document.createElement("span");
    p.className = "p";
    p.textContent = i.path;
    const s = document.createElement("span");
    s.className = "s";
    s.textContent = humanSize(i.blob.size);
    li.append(p, s);
    return li;
  }));
  if (items.length > 200) {
    const li = document.createElement("li");
    li.textContent = `and ${items.length - 200} more`;
    list.append(li);
  }
  if (!titleTouched) {
    const top = commonFolder(items.map((i) => i.path));
    $("title").value = items.length === 1 ? titleFromName(items[0].name) : top ? titleFromName(top) : "";
    $("title").placeholder = `${items.length} files`;
  }
  $("go").focus();
}

$("btn-files").addEventListener("click", () => $("pick-files").click());
$("btn-folder").addEventListener("click", () => $("pick-folder").click());
$("pick-files").addEventListener("change", (e) => { add(fromFileList(e.target.files)); e.target.value = ""; });
$("pick-folder").addEventListener("change", (e) => { add(fromFileList(e.target.files)); e.target.value = ""; });
$("title").addEventListener("input", () => { titleTouched = true; });
$("clear").addEventListener("click", () => { items = []; titleTouched = false; $("title").value = ""; render(); });

const drop = $("drop");
["dragenter", "dragover"].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((t) => document.addEventListener(t, (e) => {
  if (t === "dragleave" && e.relatedTarget) return;
  drop.classList.remove("over");
}));
document.addEventListener("drop", async (e) => {
  e.preventDefault();
  const entries = [...(e.dataTransfer.items || [])].map((it) => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
  if (entries.length) {
    const lists = await Promise.all(entries.map((en) => walk(en)));
    add(lists.flat());
  } else {
    add(fromFileList(e.dataTransfer.files));
  }
});

// --- Moving ----------------------------------------------------------------------

function status(text) {
  $("status").hidden = false;
  $("step").textContent = text;
}

function problem(title, why, fix) {
  $("bar").hidden = true;
  $("step").textContent = "";
  $("problem").hidden = false;
  $("problem-title").textContent = title;
  $("problem-why").textContent = why;
  const b = $("problem-fix");
  b.hidden = !fix;
  if (fix) { b.textContent = fix.label; b.onclick = fix.act; }
}

$("go").addEventListener("click", async () => {
  if (!items.length) return;
  $("go").disabled = true;
  $("drop").hidden = true;
  $("picked").hidden = true;
  $("problem").hidden = true;
  $("result").hidden = true;
  $("bar").hidden = false;
  status("Getting the files ready…");
  try {
    const built = await buildMany(items, $("title").value.trim() || null, (step, name, n, total) => {
      if (step === "pdf") status(`Drawing ${name}: page ${n} of ${total}…`);
      else if (step === "image") status(`Preparing ${name}…`);
    });
    const jobId = crypto.randomUUID();
    await stashPut(jobId, built.files.map((f) => ({ path: f.path, blob: f.blob, html: !!f.html, optional: !!f.optional })));
    const tab = await extension.tabs.getCurrent();
    status("Connecting to spacesheep…");
    const r = await ask({ type: "move", req: {
      jobId, kind: built.kind, title: built.title, sourceUrl: null, remember: false, uuid: null,
      tab: tab ? { id: tab.id, index: tab.index, windowId: tab.windowId } : null,
    } });
    if (!r || !r.ok) problem("It didn't move", r && r.busy ? "Another move is still running. Wait for it to finish." : "Something went wrong. Nothing was published.", { label: "Try again", act: reset });
  } catch (e) {
    problem("It didn't move", String((e && e.message) || e), { label: "Try again", act: reset });
  }
});

const WHO_CAN_OPEN = {
  private: "Only you can open it until you share it.",
  members: "Only people you invite can open it.",
  signed_in: "Anyone with the link can open it after signing in.",
  public: "Anyone with the link can open it.",
};

const STEP = {
  connecting: () => "Connecting to spacesheep…",
  uploading: (j) => (j.of > 1 ? `Uploading ${j.done || 0} of ${j.of} files…` : "Uploading…"),
  publishing: () => "Publishing…",
};

extension.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "job" || !msg.job || $("status").hidden) return;
  const job = msg.job;
  if (job.step === "done") {
    $("bar").hidden = true;
    $("step").textContent = "";
    $("result").hidden = false;
    $("done-what").textContent = job.unchanged ? "Already up to date" : "Moved";
    $("done-who").textContent = WHO_CAN_OPEN[job.visibility] || "";
    if (job.dropped && job.dropped.length) {
      $("done-notes").hidden = false;
      $("done-notes").textContent = `${job.dropped.length} full-size original${job.dropped.length === 1 ? " was" : "s were"} too big for your plan; the page shows lighter copies.`;
    }
    $("open").href = job.url;
    ask({ type: "seen" });
  } else if (job.step === "error") {
    const e = job.error || {};
    const plan = e.code === "too_big";
    problem(plan ? "Too big for your plan" : "It didn't move", e.message || "Nothing was published.",
      plan ? { label: "See plans", act: () => extension.tabs.create({ url: "https://spacesheep.dev/plans" }) } : { label: "Try again", act: reset });
    ask({ type: "seen" });
  } else {
    status(STEP[job.step] ? STEP[job.step](job) : "Working…");
    const bar = $("bar");
    if (job.step === "uploading" && job.of > 1) {
      bar.classList.add("known");
      bar.querySelector("span").style.width = `${Math.max(8, Math.round(((job.done || 0) / job.of) * 100))}%`;
    }
  }
});

$("copy").addEventListener("click", async (e) => {
  await navigator.clipboard.writeText($("open").href);
  e.target.textContent = "Copied";
});

function reset() {
  $("go").disabled = false;
  $("drop").hidden = false;
  $("status").hidden = true;
  $("problem").hidden = true;
  $("result").hidden = true;
  $("bar").classList.remove("known");
  render();
}
$("more").addEventListener("click", () => { items = []; titleTouched = false; $("title").value = ""; reset(); });

ask({ type: "state" }).then((s) => {
  $("who").textContent = s && s.connected
    ? (s.account && s.account.handle ? `Publishing as @${s.account.handle}` : "Connected to spacesheep")
    : "The first move asks you to approve the connection on spacesheep.dev, once.";
});
