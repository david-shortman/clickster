#!/usr/bin/env node
// Build the Chrome (MV3) variant from the Firefox (MV2) manifest — the JS/HTML
// are identical and cross-browser, so only the manifest differs. Produces an
// unpacked dist/chrome/ (for `--load-extension` in tests) and a store zip.
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist", "chrome");

// A fixed key so the Chrome extension ID is stable across machines/CI
// (→ mnabffamileocpjnkmhemkidnekhdlle). Used by the E2E popup URL.
const CHROME_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAt1QWoF1nd37NqqlDle6NLmfppRW5tl/q4GV+9H1NVG45DTAewIlXhXNxPmUiaY4a5N6fVPHlxoZio2uFcAJLcE4p3heVVFMxyiYEDR5AEQhSMbgZaxiAIMlnbFxrEPag7LF+aYUjsaVvR/rTWC4BcXWMMwsVbg4gJa7l2HqLTEGKNycvwZE0VG+sz6TadStqnE0hEcu8gOpA8wmBQqk+o5jseM8erS2j7pvJskgglJ21qL/IhHQEwYdkjWy/gg67Th+771vpnA+71p+S1AZ32vYgKnxr6eA+YfnGZwpmfVqRlMnJlsfr6Mb/ul5bAVfNk4dEJG/sc2iebteEkbcVfQIDAQAB";

const mv2 = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

const mv3 = {
  manifest_version: 3,
  name: mv2.name,
  version: mv2.version,
  key: CHROME_KEY,
  description: mv2.description,
  icons: mv2.icons,
  content_scripts: mv2.content_scripts,
  // browser_action -> action; permissions -> host_permissions (MV3 split).
  action: mv2.browser_action,
  host_permissions: mv2.permissions,
};

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "manifest.json"),
  JSON.stringify(mv3, null, 2) + "\n"
);
for (const item of ["clickster.js", "popup", "icons", "LICENSE"]) {
  cpSync(join(root, item), join(outDir, item), { recursive: true });
}
execSync(`cd '${outDir}' && rm -f ../clickster-chrome.zip && zip -rq ../clickster-chrome.zip .`);
console.log("built dist/chrome/ and dist/clickster-chrome.zip (MV3)");
