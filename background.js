// The service worker: signs in, publishes, and opens the result. The popup (or the
// move page) reads and builds the files and stashes them (lib/stash.js), because the
// popup closes the moment the sign-in window takes focus — the work has to outlive it.
import { signIn, signOut, isConnected, serverOrigin, AuthError } from "./lib/auth.js";
import { Mcp } from "./lib/mcp.js";
import { stashGet, stashDrop, stashSweep } from "./lib/stash.js";
import { fitToPlan } from "./lib/plan.js";

const INLINE_BYTES = 1.5 * 1024 * 1024; // above this, files go through staged uploads
const MOVED_KEEP = 300;                  // remembered pages, for "update" instead of a duplicate

let job = null; // the move in flight: { id, step, … }, mirrored to storage.session

async function setJob(patch) {
  job = patch === null ? null : { ...(job || {}), ...patch, at: Date.now() };
  await chrome.storage.session.set({ job });
  chrome.runtime.sendMessage({ type: "job", job }).catch(() => {}); // no popup open: fine
}

function badge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

async function account() {
  const { account } = await chrome.storage.local.get("account");
  return account || null;
}

/** Who this connection publishes as: the @handle in the address of what it published. */
async function learnAccount(url) {
  const handle = (String(url || "").match(/\/@([a-z0-9][a-z0-9_-]*)\//i) || [])[1];
  if (!handle) return;
  await chrome.storage.local.set({ account: { handle } });
}

async function moved() {
  const { moved } = await chrome.storage.local.get("moved");
  return moved || {};
}

async function remember(sourceUrl, entry) {
  const all = await moved();
  all[sourceUrl] = entry;
  const keys = Object.keys(all);
  if (keys.length > MOVED_KEEP) {
    keys.sort((a, b) => (all[a].at || 0) - (all[b].at || 0)).slice(0, keys.length - MOVED_KEEP).forEach((k) => delete all[k]);
  }
  await chrome.storage.local.set({ moved: all });
}

function toB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** HTML goes inline as text when it is UTF-8 (the deploy reads it either way). */
async function inlineFile(f) {
  const bytes = new Uint8Array(await f.blob.arrayBuffer());
  if (f.html) {
    try {
      return { path: f.path, content: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
    } catch {}
  }
  return { path: f.path, content: toB64(bytes), encoding: "base64" };
}

async function stage(begin, files) {
  if (!begin || !begin.upload_url) throw new Error("spacesheep didn't open an upload");
  const out = new Array(files.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      const f = files[i];
      const r = await fetch(`${begin.upload_url}?path=${encodeURIComponent(f.path)}`, {
        method: "PUT", body: f.blob, headers: { "Content-Type": "application/octet-stream" },
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body.sha) throw new Error(`upload of ${f.path} failed: ${body.error || `HTTP ${r.status}`}`);
      out[i] = { path: f.path, staged_sha: body.sha };
      await setJob({ step: "uploading", done: ++done, of: files.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, files.length) }, worker));
  return out;
}

/** Publish what a page stashed (lib/stash.js); open the space when it's up. */
async function move(req) {
  const id = crypto.randomUUID();
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20_000);
  badge("…", "#5a5ae6");
  await setJob({ id, step: "connecting", title: req.title, sourceUrl: req.sourceUrl, update: !!req.uuid, error: null, url: null, done: 0, of: 0, dropped: [] });
  try {
    const all = await stashGet(req.jobId);
    if (!all || !all.length) throw new Error("the files to move went missing; try again");
    await setJob({ of: all.length });
    if (!(await isConnected())) await signIn();
    const mcp = new Mcp();

    const total = all.reduce((n, f) => n + f.blob.size, 0);
    let files;
    let dropped = [];
    if (total <= INLINE_BYTES) {
      files = await Promise.all(all.map(inlineFile));
    } else {
      const begin = await mcp.call("stage_begin", req.uuid ? { space: req.uuid, title: req.title } : { title: req.title });
      const fit = fitToPlan(all, begin && begin.limits, begin && begin.plan);
      dropped = fit.dropped;
      await setJob({ step: "uploading", done: 0, of: fit.keep.length, dropped });
      files = await stage(begin, fit.keep);
    }

    await setJob({ step: "publishing" });
    const args = { files, version_name: req.uuid ? "Updated from Chrome" : "Moved from Chrome" };
    if (req.uuid) args.uuid = req.uuid;
    else Object.assign(args, { title: req.title, emoji: EMOJI[req.kind] || "📄" });
    const result = await mcp.call("deploy", args);
    const uuid = result && (result.uuid || result.id || result.space_id);
    if (!uuid || !result.url) throw new Error("spacesheep answered without a link — check your dashboard before trying again");

    if (req.remember !== false && req.sourceUrl) await remember(req.sourceUrl, { uuid, url: result.url, title: req.title, at: Date.now() });
    await learnAccount(result.url);
    await setJob({ step: "done", url: result.url, visibility: result.visibility || null, unchanged: !!result.unchanged, dropped });
    badge("✓", "#2d8f5e");
    setTimeout(() => badge(""), 4000);
    await chrome.tabs.create({ url: result.url, ...(req.tab ? { index: req.tab.index + 1, openerTabId: req.tab.id, windowId: req.tab.windowId } : {}) });
  } catch (e) {
    const code = e instanceof AuthError ? e.code : e.code || "failed";
    await setJob({ step: "error", error: { code, message: String(e.message || e) } });
    badge("!", "#cc4444");
  } finally {
    clearInterval(keepAlive);
    stashDrop(req.jobId).catch(() => {});
  }
}

/** The dashboard icon a new space gets, by what was moved. */
const EMOJI = { page: "📄", image: "🖼️", pdf: "📕", video: "🎬", audio: "🎧", text: "📝", file: "📦", site: "🌐", collection: "🗂️" };

// Files a stopped worker never published.
stashSweep().catch(() => {});

// Right-click the sheep: move files from the computer (what a tab can't hold).
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "move-files", title: "Move files or a folder from your computer…", contexts: ["action"] });
});
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "move-files") chrome.tabs.create({ url: chrome.runtime.getURL("move.html") });
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    switch (msg && msg.type) {
      case "state": {
        const { job: stored } = await chrome.storage.session.get("job");
        const all = await moved();
        reply({
          connected: await isConnected(),
          account: await account(),
          job: job || stored || null,
          moved: msg.sourceUrl ? all[msg.sourceUrl] || null : null,
          server: await serverOrigin(),
        });
        break;
      }
      case "move":
        if (job && !["done", "error"].includes(job.step)) { reply({ ok: false, busy: true }); break; }
        move(msg.req); // runs on after the popup closes
        reply({ ok: true });
        break;
      case "connect":
        try {
          await signIn();
          reply({ ok: true });
        } catch (e) {
          reply({ ok: false, error: { code: e.code || "failed", message: String(e.message || e) } });
        }
        break;
      case "disconnect":
        await signOut();
        reply({ ok: true });
        break;
      case "seen":
        // The popup showed the outcome: clear the badge and the finished job.
        if (job && ["done", "error"].includes(job.step)) await setJob(null);
        else if (!job) await chrome.storage.session.remove("job");
        badge("");
        reply({ ok: true });
        break;
      default:
        reply({ ok: false });
    }
  })();
  return true; // reply comes asynchronously
});
