// The service worker: signs in, publishes, and opens the result. The popup reads
// the page (it holds the click's activeTab grant) and hands the files over here,
// because the popup closes the moment the sign-in window takes focus — the work
// has to outlive it.
import { signIn, signOut, isConnected, serverOrigin, AuthError } from "./lib/auth.js";
import { Mcp } from "./lib/mcp.js";

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

const sizeOf = (f) => Math.floor((f.b64.length * 3) / 4);

function decodeB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** HTML goes inline as text when it is UTF-8 (the deploy reads it either way). */
function inlineFile(f) {
  if (f.html) {
    try {
      return { path: f.path, content: new TextDecoder("utf-8", { fatal: true }).decode(decodeB64(f.b64)) };
    } catch {}
  }
  return { path: f.path, content: f.b64, encoding: "base64" };
}

async function stage(mcp, files, beginArgs) {
  const begin = await mcp.call("stage_begin", beginArgs);
  if (!begin || !begin.upload_url) throw new Error("spacesheep didn't open an upload");
  const out = new Array(files.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      const f = files[i];
      const r = await fetch(`${begin.upload_url}?path=${encodeURIComponent(f.path)}`, {
        method: "PUT", body: decodeB64(f.b64), headers: { "Content-Type": "application/octet-stream" },
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

/** Publish the files the popup read; open the space when it's up. */
async function move(req) {
  const id = crypto.randomUUID();
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20_000);
  badge("…", "#5a5ae6");
  await setJob({ id, step: "connecting", title: req.title, sourceUrl: req.sourceUrl, update: !!req.uuid, error: null, url: null, done: 0, of: req.files.length });
  try {
    if (!(await isConnected())) await signIn();
    const mcp = new Mcp();

    const total = req.files.reduce((n, f) => n + sizeOf(f), 0);
    let files;
    if (total <= INLINE_BYTES) {
      files = req.files.map(inlineFile);
    } else {
      await setJob({ step: "uploading", done: 0, of: req.files.length });
      files = await stage(mcp, req.files, req.uuid ? { space: req.uuid, title: req.title } : { title: req.title });
    }

    await setJob({ step: "publishing" });
    const args = { files, version_name: req.uuid ? "Updated from Chrome" : "Moved from Chrome" };
    if (req.uuid) args.uuid = req.uuid;
    else Object.assign(args, { title: req.title, emoji: "📄" });
    const result = await mcp.call("deploy", args);
    const uuid = result && (result.uuid || result.id || result.space_id);
    if (!uuid || !result.url) throw new Error("spacesheep answered without a link — check your dashboard before trying again");

    await remember(req.sourceUrl, { uuid, url: result.url, title: req.title, at: Date.now() });
    await learnAccount(result.url);
    await setJob({ step: "done", url: result.url, visibility: result.visibility || null, unchanged: !!result.unchanged });
    badge("✓", "#2d8f5e");
    setTimeout(() => badge(""), 4000);
    await chrome.tabs.create({ url: result.url, ...(req.tab ? { index: req.tab.index + 1, openerTabId: req.tab.id, windowId: req.tab.windowId } : {}) });
  } catch (e) {
    const code = e instanceof AuthError ? e.code : e.code || "failed";
    await setJob({ step: "error", error: { code, message: String(e.message || e) } });
    badge("!", "#cc4444");
  } finally {
    clearInterval(keepAlive);
  }
}

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
