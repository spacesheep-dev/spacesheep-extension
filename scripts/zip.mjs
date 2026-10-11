#!/usr/bin/env node
// dist/move-to-spacesheep-<version>.zip: exactly the files Chrome loads, for the
// Chrome Web Store upload. Nothing from test/, scripts/ or node_modules.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const { version } = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const out = `dist/move-to-spacesheep-${version}.zip`;
const files = [
  "manifest.json", "background.js", "popup.html", "popup.css", "popup.js",
  "lib/auth.js", "lib/mcp.js", "lib/read.js", "lib/refs.js",
  "icons/icon-16.png", "icons/icon-32.png", "icons/icon-48.png", "icons/icon-128.png",
];
mkdirSync(`${root}/dist`, { recursive: true });
rmSync(`${root}/${out}`, { force: true });
execFileSync("zip", ["-X", "-q", out, ...files], { cwd: root, stdio: "inherit" });
console.log(out);
