#!/usr/bin/env node
// dist/spacesheep-extension-<version>.zip: exactly the files Chrome loads, for the
// Chrome Web Store upload. Nothing from test/, scripts/ or node_modules. Also the
// same bytes as dist/spacesheep-extension.zip, the name every release carries, so
// .../releases/latest/download/spacesheep-extension.zip (spacesheep.dev/extension
// links it) is always the newest; and as move-to-spacesheep.zip, the name 0.1.0 had,
// so links sent before the rename keep working.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const { version } = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const out = `dist/spacesheep-extension-${version}.zip`;
const files = [
  "manifest.json", "background.js", "popup.html", "popup.css", "popup.js", "move.html", "move.css", "move.js",
  "lib", "vendor", "icons/icon-16.png", "icons/icon-32.png", "icons/icon-48.png", "icons/icon-128.png",
];
mkdirSync(`${root}/dist`, { recursive: true });
rmSync(`${root}/${out}`, { force: true });
execFileSync("zip", ["-X", "-q", "-r", out, ...files, "-x", "*.DS_Store"], { cwd: root, stdio: "inherit" });
for (const name of ["spacesheep-extension.zip", "move-to-spacesheep.zip"]) copyFileSync(`${root}/${out}`, `${root}/dist/${name}`);
console.log(`${out}\ndist/spacesheep-extension.zip\ndist/move-to-spacesheep.zip`);
