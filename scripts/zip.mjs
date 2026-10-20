#!/usr/bin/env node
// dist/spacesheep-extension-<version>.zip: exactly the files Chrome loads, for the
// Chrome Web Store upload. Nothing from test/, scripts/ or node_modules. Also the
// same bytes as dist/spacesheep-extension.zip, the name every release carries, so
// .../releases/latest/download/spacesheep-extension.zip (spacesheep.dev/extension
// links it) is always the newest; and as move-to-spacesheep.zip, the name 0.1.0 had,
// so links sent before the rename keep working.
import { execFileSync } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";
import { build, root } from "./package.mjs";

const browser = process.argv[2] || "chrome";
const { directory, manifest: { version } } = build(browser);
const name = browser.startsWith("firefox") ? `spacesheep-${browser}` : "spacesheep-extension";
const out = `dist/${name}-${version}.zip`;
rmSync(`${root}/${out}`, { force: true });
execFileSync("zip", ["-X", "-q", "-r", `${root}/${out}`, "."], { cwd: directory, stdio: "inherit" });
const aliases = browser.startsWith("firefox") ? [`${name}.zip`] : [`${name}.zip`, "move-to-spacesheep.zip"];
for (const alias of aliases) copyFileSync(`${root}/${out}`, `${root}/dist/${alias}`);
console.log([out, ...aliases.map((alias) => `dist/${alias}`)].join("\n"));
