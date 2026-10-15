#!/usr/bin/env node
import { build } from "./package.mjs";

const browser = process.argv[2] || "firefox";
console.log(build(browser).directory);
