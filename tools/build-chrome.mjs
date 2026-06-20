#!/usr/bin/env node
// Build the Chrome (MV3) variant from the Firefox (MV2) manifest — the JS/HTML
// are identical and cross-browser, so only the manifest differs. Produces:
//   dist/chrome/             unpacked, WITH `key` (stable id for --load-extension E2E)
//   dist/clickster-chrome.zip  store upload, WITHOUT `key` (the Web Store rejects it)
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// A fixed key so the Chrome extension ID is stable across machines/CI
// (→ mnabffamileocpjnkmhemkidnekhdlle). Used by the E2E popup URL. NOT included
// in the store upload — the Chrome Web Store assigns the id and rejects `key`.
const CHROME_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAt1QWoF1nd37NqqlDle6NLmfppRW5tl/q4GV+9H1NVG45DTAewIlXhXNxPmUiaY4a5N6fVPHlxoZio2uFcAJLcE4p3heVVFMxyiYEDR5AEQhSMbgZaxiAIMlnbFxrEPag7LF+aYUjsaVvR/rTWC4BcXWMMwsVbg4gJa7l2HqLTEGKNycvwZE0VG+sz6TadStqnE0hEcu8gOpA8wmBQqk+o5jseM8erS2j7pvJskgglJ21qL/IhHQEwYdkjWy/gg67Th+771vpnA+71p+S1AZ32vYgKnxr6eA+YfnGZwpmfVqRlMnJlsfr6Mb/ul5bAVfNk4dEJG/sc2iebteEkbcVfQIDAQAB";

const mv2 = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

const baseMv3 = {
  manifest_version: 3,
  name: mv2.name,
  version: mv2.version,
  description: mv2.description,
  icons: mv2.icons,
  content_scripts: mv2.content_scripts,
  // browser_action -> action; permissions -> host_permissions (MV3 split).
  action: mv2.browser_action,
  host_permissions: mv2.permissions,
};

function stage(dir, manifest) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  for (const item of ["clickster.js", "popup", "icons", "LICENSE"]) {
    cpSync(join(root, item), join(dir, item), { recursive: true });
  }
}

// Unpacked build WITH key — loaded by the E2E for a deterministic id.
stage(join(root, "dist", "chrome"), { ...baseMv3, key: CHROME_KEY });

// Store build WITHOUT key — what you upload to the Chrome Web Store.
const storeDir = join(root, "dist", "chrome-store");
stage(storeDir, baseMv3);
execSync(`cd '${storeDir}' && rm -f ../clickster-chrome.zip && zip -rq ../clickster-chrome.zip .`);

console.log(
  "built dist/chrome/ (with key, for tests) and dist/clickster-chrome.zip (no key, for the store)"
);
