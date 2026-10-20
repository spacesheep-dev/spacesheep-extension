import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";

export const root = fileURLToPath(new URL("..", import.meta.url));
export const files = [
  "manifest.json", "background.js", "popup.html", "popup.css", "popup.js", "move.html", "move.css", "move.js",
  "lib", "vendor", "icons/icon-16.png", "icons/icon-32.png", "icons/icon-48.png", "icons/icon-128.png",
];

export function manifestFor(browser) {
  if (!["chrome", "firefox", "firefox-android"].includes(browser)) throw new Error(`Unknown browser: ${browser}`);
  const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
  if (browser.startsWith("firefox")) {
    delete manifest.minimum_chrome_version;
    manifest.background = { scripts: ["background.js"], type: "module" };
    // Firefox ESR 140 supports the built-in data consent shown at installation.
    manifest.browser_specific_settings = { gecko: {
      id: "spacesheep@spacesheep.dev",
      strict_min_version: "140.0",
      data_collection_permissions: { required: ["authenticationInfo", "websiteContent"] },
    } };
    manifest.permissions.push("clipboardWrite");
    if (browser === "firefox-android") {
      // Android 142 supports data consent and correct directory-picker paths.
      manifest.browser_specific_settings.gecko.strict_min_version = "142.0";
      manifest.browser_specific_settings.gecko_android = { strict_min_version: "142.0" };
      manifest.permissions = manifest.permissions.filter((p) => !["identity", "contextMenus"].includes(p));
      manifest.permissions.push("webRequest", "webRequestBlocking");
      // Only the OAuth callback is intercepted, never ordinary browsing traffic.
      const hash = createHash("sha1").update(manifest.browser_specific_settings.gecko.id).digest("hex");
      manifest.host_permissions.push(`https://${hash}.extensions.allizom.org/*`);
      delete manifest.commands;
    }
  }
  return manifest;
}

/** Copy only runtime files, keeping each browser's manifest out of the other. */
export function build(browser, destination = path.join(root, "dist", browser)) {
  const manifest = manifestFor(browser);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  for (const file of files.filter((f) => f !== "manifest.json")) {
    const to = path.join(destination, file);
    mkdirSync(path.dirname(to), { recursive: true });
    cpSync(path.join(root, file), to, { recursive: true, filter: (src) => path.basename(src) !== ".DS_Store" });
  }
  writeFileSync(path.join(destination, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return { directory: destination, manifest };
}
