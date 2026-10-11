// The popup: say what will move, move it on one press, show how it's going.
import { readTab, toB64, ReadError } from "./lib/read.js";

const view = document.getElementById("view");
const ask = (msg) => chrome.runtime.sendMessage(msg);
let tab = null;
let page = null;   // what readTab found
let state = null;  // the service worker's answer to "state"

const kb = (n) => (n < 1024 ? `${n} bytes` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function show(id) {
  view.replaceChildren(document.getElementById(id).content.cloneNode(true));
  return view;
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`.replace(/\/$/, "");
  } catch { return url; }
}

const WHO_CAN_OPEN = {
  private: "Only you can open it until you share it.",
  members: "Only people you invite can open it.",
  signed_in: "Anyone with the link can open it after signing in.",
  public: "Anyone with the link can open it.",
};

// --- Footer -------------------------------------------------------------------

function renderFoot() {
  const foot = document.getElementById("foot");
  const who = document.getElementById("who");
  const out = document.getElementById("disconnect");
  foot.hidden = false;
  if (state && state.connected) {
    who.textContent = state.account && state.account.handle ? `Publishing as @${state.account.handle}` : "Connected to spacesheep";
    out.hidden = false;
  } else {
    who.textContent = "Not connected yet";
    out.hidden = true;
  }
}

document.getElementById("disconnect").addEventListener("click", async () => {
  await ask({ type: "disconnect" });
  state = { ...state, connected: false, account: null };
  renderFoot();
  if (page) renderReady();
});

// --- Views ----------------------------------------------------------------------

function renderReady() {
  show("t-ready");
  view.querySelector(".title").textContent = page.title;
  const extra = page.files.length - 1;
  const where = page.isFile ? page.name : shortUrl(page.sourceUrl);
  view.querySelector(".meta").textContent =
    `${where} · ${kb(page.bytes)}${extra ? ` · with ${plural(extra, "file", "files")} from its folder` : ""}`;

  const notes = [];
  if (page.snapshot) notes.push("Copied as the tab shows it.");
  const { outside, missing, tooBig, overLimit } = page.skipped;
  if (outside) notes.push(`${plural(outside, "file", "files")} outside its folder won't come along.`);
  if (missing) notes.push(`${plural(missing, "file it loads is", "files it loads are")} missing.`);
  if (tooBig + overLimit) notes.push(`${plural(tooBig + overLimit, "file was", "files were")} too big to bring.`);
  if (notes.length) {
    const p = view.querySelector(".notes");
    p.textContent = notes.join(" ");
    p.hidden = false;
  }

  const go = view.querySelector("#go");
  const before = state && state.moved;
  go.textContent = before ? "Update it on spacesheep" : "Move to spacesheep";
  go.addEventListener("click", () => start(before ? before.uuid : null));
  if (before) {
    const asNew = view.querySelector("#as-new");
    asNew.hidden = false;
    asNew.addEventListener("click", () => start(null));
  }
  if (!(state && state.connected)) view.querySelector(".first").hidden = false;
  go.focus();
}

const STEP_WORDS = {
  connecting: () => "Connecting to spacesheep…",
  uploading: (j) => (j.of > 1 ? `Uploading ${j.done || 0} of ${j.of} files…` : "Uploading…"),
  publishing: () => "Publishing…",
};

function renderWorking(job) {
  if (!view.querySelector(".bar")) show("t-working");
  view.querySelector(".title").textContent = job.title || "This page";
  view.querySelector(".step").textContent = (STEP_WORDS[job.step] || (() => "Working…"))(job);
  const bar = view.querySelector(".bar");
  if (job.step === "uploading" && job.of > 1) {
    bar.classList.add("known");
    bar.querySelector("span").style.width = `${Math.max(8, Math.round(((job.done || 0) / job.of) * 100))}%`;
  }
}

function renderDone(job) {
  show("t-done");
  view.querySelector(".title").textContent = job.title || "Moved";
  const what = job.unchanged ? "Already up to date" : job.update ? "Updated" : "Moved";
  view.querySelector(".meta").textContent = `${what} · ${WHO_CAN_OPEN[job.visibility] || "Open it to share it."}`;
  const open = view.querySelector("#open");
  open.href = job.url;
  view.querySelector("#copy").addEventListener("click", async (e) => {
    await navigator.clipboard.writeText(job.url);
    e.target.textContent = "Copied";
  });
  view.querySelector("#again").addEventListener("click", () => begin(true));
  ask({ type: "seen" });
}

const PROBLEMS = {
  file_access: {
    title: "Chrome needs your OK to read files",
    why: "This page is a file on your computer. Turn on “Allow access to file URLs” for Move to spacesheep, then click the sheep again.",
    fix: "Open the setting",
    act: () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }),
  },
  file_access_maybe: {
    title: "Chrome needs your OK to read files",
    why: "If this tab is a file on your computer, turn on “Allow access to file URLs” for Move to spacesheep, then click the sheep again.",
    fix: "Open the setting",
    act: () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }),
  },
  no_page: {
    title: "Nothing to move here",
    why: "Open an HTML file or a web page, then click the sheep.",
  },
  not_html: {
    title: "This tab isn't an HTML page",
    why: "Move to spacesheep copies HTML pages and the files they load.",
  },
  no_access: {
    title: "Chrome didn't let the extension read this tab",
    why: "Some pages are off-limits to extensions. Reload the tab and try again.",
  },
  cancelled: {
    title: "Sign-in was closed before it finished",
    why: "Nothing was published. Move it again when you're ready to approve the connection.",
    fix: "Try again",
  },
  denied: {
    title: "The connection wasn't approved",
    why: "Nothing was published.",
    fix: "Try again",
  },
  signed_out: {
    title: "Your spacesheep connection ended",
    why: "It was disconnected or revoked. Move it again to reconnect.",
    fix: "Try again",
  },
  revoked: {
    title: "Your spacesheep connection ended",
    why: "It was disconnected or revoked. Move it again to reconnect.",
    fix: "Try again",
  },
  offline: {
    title: "Couldn't reach spacesheep",
    why: "Check your connection and try again.",
    fix: "Try again",
  },
  unreachable: {
    title: "Couldn't reach spacesheep",
    why: "The sign-in didn't get an answer. Try again in a moment.",
    fix: "Try again",
  },
};

function renderProblem(code, message, { retry } = {}) {
  show("t-problem");
  const p = PROBLEMS[code] || {
    title: "It didn't move",
    why: message || "Something went wrong. Nothing was published.",
    fix: "Try again",
  };
  const box = view.querySelector(".problem");
  box.classList.toggle("error", !PROBLEMS[code] || !!retry);
  view.querySelector(".title").textContent = p.title;
  view.querySelector(".why").textContent = p.why;
  if (PROBLEMS[code] && message && !["file_access", "file_access_maybe", "no_page", "cancelled"].includes(code)) {
    const d = view.querySelector(".detail");
    d.textContent = message;
    d.hidden = false;
  }
  const fix = view.querySelector("#fix");
  if (p.act || (p.fix && retry)) {
    fix.hidden = false;
    fix.textContent = p.fix;
    fix.addEventListener("click", p.act || retry);
    fix.focus();
  }
}

// --- Moving -------------------------------------------------------------------

async function start(uuid) {
  const req = {
    title: page.title,
    sourceUrl: page.sourceUrl,
    uuid: uuid || null,
    tab: { id: tab.id, index: tab.index, windowId: tab.windowId },
    files: page.files.map((f) => ({ path: f.path, b64: toB64(f.bytes), html: !!f.html })),
  };
  renderWorking({ step: "connecting", title: page.title });
  const r = await ask({ type: "move", req });
  if (!r || !r.ok) renderProblem("failed", r && r.busy ? "Another move is still running — wait for it to finish." : null);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "job" || !msg.job) return;
  const job = msg.job;
  if (job.step === "done") renderDone(job);
  else if (job.step === "error") {
    renderProblem(job.error && job.error.code, job.error && job.error.message, { retry: () => begin(true) });
    ask({ type: "seen" });
  } else renderWorking(job);
  if (job.step === "done" || job.step === "error") ask({ type: "state", sourceUrl: tab && tab.url }).then((s) => { state = s; renderFoot(); });
});

/** Read the tab and show what would move. `fresh` skips a finished move's outcome. */
async function begin(fresh = false) {
  // ?tab=<id> opens the popup on a given tab: how the end-to-end test drives it
  // (an automated browser can't press the toolbar button).
  const forced = Number(new URLSearchParams(location.search).get("tab"));
  [tab] = forced ? [await chrome.tabs.get(forced)] : await chrome.tabs.query({ active: true, currentWindow: true });
  state = await ask({ type: "state", sourceUrl: tab && tab.url });
  renderFoot();

  // A move still running is shown wherever the popup opens; a finished one only on
  // the page it moved (it may have ended while the popup was closed for sign-in).
  const job = state.job;
  const finished = job && ["done", "error"].includes(job.step);
  if (job && !finished && Date.now() - (job.at || 0) < 10 * 60 * 1000) return renderWorking(job);
  if (finished && !fresh && tab && job.sourceUrl === tab.url) {
    if (job.step === "done") return renderDone(job);
    renderProblem(job.error && job.error.code, job.error && job.error.message, { retry: () => begin(true) });
    return ask({ type: "seen" });
  }
  if (finished) ask({ type: "seen" });

  show("t-working");
  view.querySelector(".title").textContent = tab && tab.title ? tab.title : "This page";
  view.querySelector(".step").textContent = "Reading this page…";
  try {
    page = await readTab(tab, (step, n) => {
      const el = view.querySelector(".step");
      if (el) el.textContent = step === "assets" ? `Reading ${plural(n, "file", "files")} beside it…` : "Reading this page…";
    });
    // The pick of what to update is per address the page had when it was read.
    if (page.sourceUrl !== tab.url) state = await ask({ type: "state", sourceUrl: page.sourceUrl });
    renderReady();
  } catch (e) {
    if (e instanceof ReadError) renderProblem(e.code, e.code === "not_html" ? null : e.message);
    else renderProblem("failed", String((e && e.message) || e), { retry: () => begin(true) });
  }
}

begin();
