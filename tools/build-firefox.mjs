#!/usr/bin/env node
// Build the narrowed Firefox (MV2) variant for AMO. Produces:
//   dist/clickster-firefox.zip  store upload (activeTab + optional host access)
//
// The broad dev/E2E Firefox zip is built separately by `npm run build`
// (dist/clickster.zip), which the Selenium suite installs as a temporary
// add-on. AMO should get THIS narrow zip instead.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { STORE_FILES, firefoxNarrow, stageDir } from "./store-manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mv2 = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

const storeDir = join(root, "dist", "firefox-store");
stageDir(root, storeDir, firefoxNarrow(mv2), STORE_FILES);
execSync(
  `cd '${storeDir}' && rm -f ../clickster-firefox.zip && zip -rq ../clickster-firefox.zip .`
);

console.log(
  "built dist/clickster-firefox.zip (narrow, for AMO upload)"
);
