import { test } from "node:test";
import assert from "node:assert/strict";
import { manifestFor } from "../scripts/package.mjs";

test("Firefox package uses an event page, stable OAuth ID and data consent", () => {
  const ff = manifestFor("firefox");
  const chrome = manifestFor("chrome");
  assert.deepEqual(ff.background, { scripts: ["background.js"], type: "module" });
  assert.equal(ff.minimum_chrome_version, undefined);
  assert.equal(ff.browser_specific_settings.gecko.id, "spacesheep@spacesheep.dev");
  assert.equal(ff.browser_specific_settings.gecko.strict_min_version, "140.0");
  assert.deepEqual(ff.browser_specific_settings.gecko.data_collection_permissions.required,
    ["authenticationInfo", "websiteContent"]);
  assert.ok(ff.permissions.includes("clipboardWrite"));
  assert.deepEqual(ff.host_permissions, chrome.host_permissions);
  assert.equal(ff.version, chrome.version);
  assert.deepEqual(chrome.background, { service_worker: "background.js", type: "module" });
  assert.equal(chrome.browser_specific_settings, undefined);
  assert.equal(chrome.permissions.includes("clipboardWrite"), false);
  assert.throws(() => manifestFor("safari"), /Unknown browser/);
});

test("Android package declares mobile compatibility without desktop-only permissions", () => {
  const android = manifestFor("firefox-android");
  assert.deepEqual(android.browser_specific_settings.gecko_android, { strict_min_version: "142.0" });
  assert.equal(android.browser_specific_settings.gecko.strict_min_version, "142.0");
  assert.equal(android.commands, undefined);
  assert.equal(android.permissions.includes("identity"), false);
  assert.equal(android.permissions.includes("contextMenus"), false);
  assert.equal(android.permissions.includes("tabs"), false);
  assert.ok(android.permissions.includes("webRequestBlocking"));
  assert.ok(android.permissions.includes("webRequest"));
  assert.equal(android.host_permissions.length, 2);
  assert.match(android.host_permissions[1], /^https:\/\/[a-f0-9]{40}\.extensions\.allizom\.org\/\*$/);
  assert.equal(manifestFor("firefox").browser_specific_settings.gecko_android, undefined);
});

// Firefox also exposes chrome.*, but the shared code must use browser.* promises.
const calls = [];
globalThis.chrome = { runtime: { getURL: () => { throw new Error("Callback API selected"); } } };
globalThis.browser = {
  runtime: { getURL: (p) => `moz-extension://test/${p}` },
  extension: { isAllowedFileSchemeAccess: () => { throw new Error("Chrome file switch used in Firefox"); } },
  scripting: { executeScript: async () => { throw new Error("PDF viewer is protected"); } },
  storage: { local: { get: async () => ({}), set: async (v) => calls.push(v) } },
  identity: {
    getRedirectURL: (...args) => { assert.equal(args.length, 0); return "https://test.extensions.allizom.org/"; },
    launchWebAuthFlow: async ({ url }) => {
      const request = new URL(url);
      const answer = new URL(request.searchParams.get("redirect_uri"));
      answer.searchParams.set("code", "test-code");
      answer.searchParams.set("state", request.searchParams.get("state"));
      return answer.href;
    },
  },
};

test("Firefox local files and restricted pages offer the picker without Chrome settings", async () => {
  const { tabProblem, readTab } = await import("../lib/read.js");
  assert.equal((await tabProblem({ url: "file:///tmp/report.html" })).code, "file_picker");
  for (const url of [undefined, "about:addons", "moz-extension://other/page.html", "https://addons.mozilla.org/en-US/firefox/"]) {
    assert.equal((await tabProblem({ url })).code, "no_page");
  }
  assert.equal(await tabProblem({ url: "https://example.com/" }), null);
  await assert.rejects(readTab({ id: 1, url: "https://example.com/report.pdf" }), { code: "pdf_viewer" });
});

test("Firefox OAuth registers the native redirect, correct name and PKCE exchange", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    return Response.json(url.endsWith("/register") ? { client_id: "firefox-test" }
      : { access_token: "test-token", refresh_token: "test-refresh", expires_in: 3600 });
  });
  const { signIn, CLIENT_NAME } = await import("../lib/auth.js");
  await signIn();
  assert.equal(CLIENT_NAME, "spacesheep for Firefox");
  const registration = JSON.parse(requests[0].options.body);
  assert.deepEqual(registration.redirect_uris, ["https://test.extensions.allizom.org/"]);
  assert.equal(registration.client_name, CLIENT_NAME);
  const token = requests[1].options.body;
  assert.equal(token.get("code"), "test-code");
  assert.equal(token.get("redirect_uri"), registration.redirect_uris[0]);
  assert.equal(token.get("code_verifier").length, 43);
  assert.ok(calls.some((c) => c.auth?.access_token === "test-token"));
});
