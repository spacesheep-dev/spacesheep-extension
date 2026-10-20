import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { manifestFor } from "../scripts/package.mjs";

function event() {
  const listeners = new Set();
  return {
    listeners,
    addListener(fn) { listeners.add(fn); },
    removeListener(fn) { listeners.delete(fn); },
    emit(...args) { return [...listeners].map((fn) => fn(...args)); },
  };
}
const manifest = manifestFor("firefox-android");
let stored, opened, closed, navigations;
globalThis.browser = {
  runtime: {
    id: manifest.browser_specific_settings.gecko.id,
    getURL: (p) => `moz-extension://test/${p}`,
    getManifest: () => manifest,
    onInstalled: event(), onMessage: event(),
  },
  storage: {
    local: {
      get: async () => stored,
      set: async (value) => Object.assign(stored, value),
      remove: async (keys) => { for (const key of [keys].flat()) delete stored[key]; },
    },
    session: { get: async () => ({}) },
  },
  tabs: {
    onRemoved: event(),
    create: async (options) => { opened.push(options); return { id: 42 }; },
    update: async (id, options) => { navigations.push({ id, ...options }); },
    remove: async (id) => { closed.push(id); },
  },
  webRequest: { onBeforeRequest: event() },
};
const { firefoxRedirectURL, launchTabAuth } = await import("../lib/oauth-tab.js");
const { signIn } = await import("../lib/auth.js");
const { resultTabOptions } = await import("../lib/browser.js");
const callback = await firefoxRedirectURL();
const ready = async () => {
  for (let i = 0; i < 100; i++) {
    if (navigations.length) return new URL(navigations[0].url);
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Sign-in tab never navigated");
};
const intercept = (url, extras = {}) => browser.webRequest.onBeforeRequest.emit({ tabId: 42, frameId: 0, url, ...extras });
const cleaned = () => {
  assert.equal(browser.webRequest.onBeforeRequest.listeners.size, 0);
  assert.equal(browser.tabs.onRemoved.listeners.size, 0);
  assert.deepEqual(closed, [42]);
};

beforeEach(() => {
  stored = {}; opened = []; closed = []; navigations = [];
});

test("Android background starts with no identity or context-menu API", async () => {
  await import("../background.js");
  assert.equal(browser.runtime.onMessage.listeners.size, 1);
  const state = await new Promise((resolve) => browser.runtime.onMessage.emit({ type: "state" }, {}, resolve));
  assert.equal(state.connected, false);
  assert.equal(state.job, null);
  assert.deepEqual(resultTabOptions("https://example.com/result", { id: 1, index: 3, windowId: 2 }),
    { url: "https://example.com/result" });
});

test("Android redirect matches its narrow manifest permission", () => {
  const hash = createHash("sha1").update(browser.runtime.id).digest("hex");
  assert.equal(callback, `https://${hash}.extensions.allizom.org/`);
  assert.ok(manifest.host_permissions.includes(`${callback}*`));
});

test("tab OAuth accepts only its own top-level callback and cancels the request", async () => {
  const pending = launchTabAuth("https://mcp.spacesheep.dev/oauth/authorize", callback);
  await ready();
  const answer = `${callback}?code=code&state=state`;
  assert.deepEqual(intercept(answer, { tabId: 99 }), [undefined]);
  assert.deepEqual(intercept(answer, { frameId: 1 }), [undefined]);
  assert.deepEqual(intercept(`${callback}wrong?code=code`), [undefined]);
  assert.deepEqual(intercept("https://example.com/?code=code"), [undefined]);
  assert.deepEqual(intercept(answer), [{ cancel: true }]);
  assert.equal(await pending, answer);
  assert.deepEqual(opened, [{ url: "about:blank", active: false }]);
  assert.equal(navigations[0].active, true);
  cleaned();
});

test("closing the sign-in tab cancels and cleans up", async () => {
  const pending = launchTabAuth("https://example.com/auth", callback);
  const rejected = assert.rejects(pending, /tab was closed/);
  await ready();
  browser.tabs.onRemoved.emit(99);
  assert.equal(browser.webRequest.onBeforeRequest.listeners.size, 1);
  browser.tabs.onRemoved.emit(42);
  await rejected;
  cleaned();
});

test("tab OAuth times out and cleans up", async () => {
  await assert.rejects(launchTabAuth("https://example.com/auth", callback, 10), /timed out/);
  cleaned();
});

test("navigation failure cleans up the sign-in tab", async (t) => {
  t.mock.method(browser.tabs, "update", async () => { throw new Error("No tab"); });
  await assert.rejects(launchTabAuth("https://example.com/auth", callback), /No tab/);
  cleaned();
});

function mockServer(t) {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    return Response.json(url.endsWith("/register") ? { client_id: "android-test" }
      : { access_token: "access", refresh_token: "refresh", expires_in: 3600 });
  });
  return requests;
}

test("Android sign-in exchanges PKCE once, even with concurrent callers", async (t) => {
  const requests = mockServer(t);
  const pending = signIn();
  assert.equal(signIn(), pending);
  const authorization = await ready();
  const answer = new URL(callback);
  answer.search = new URLSearchParams({ code: "code", state: authorization.searchParams.get("state") });
  intercept(answer.href);
  await pending;
  const registration = JSON.parse(requests[0].options.body);
  assert.deepEqual(registration.redirect_uris, [callback]);
  const exchange = requests[1].options.body;
  assert.equal(exchange.get("redirect_uri"), callback);
  assert.equal(exchange.get("code"), "code");
  assert.equal(createHash("sha256").update(exchange.get("code_verifier")).digest("base64url"),
    authorization.searchParams.get("code_challenge"));
  assert.equal(stored.auth.access_token, "access");
  assert.equal(opened.length, 1);
  cleaned();
});

for (const scenario of ["wrong state", "denied", "missing code"]) {
  test(`Android sign-in rejects ${scenario} without exchanging a token`, async (t) => {
    const requests = mockServer(t);
    const pending = signIn();
    const rejected = assert.rejects(pending, { code: scenario === "denied" ? "denied" : "cancelled" });
    const authorization = await ready();
    const answer = new URL(callback);
    answer.searchParams.set("state", scenario === "wrong state" ? "wrong" : authorization.searchParams.get("state"));
    if (scenario === "denied") answer.searchParams.set("error", "access_denied");
    else if (scenario !== "missing code") answer.searchParams.set("code", "code");
    intercept(answer.href);
    await rejected;
    assert.equal(requests.length, 1);
    assert.equal(stored.auth, undefined);
    cleaned();
  });
}
