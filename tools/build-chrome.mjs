#!/usr/bin/env node
// Build the Chrome (MV3) variants from the Firefox (MV2) manifest. Produces:
//   dist/chrome/               unpacked, BROAD + key (stable id for E2E)
//   dist/clickster-chrome.zip  store upload, NARROW + no key (activeTab +
//                              optional host access; the Web Store rejects key)
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEV_FILES,
  STORE_FILES,
  chromeBroad,
  chromeNarrow,
  stageDir,
} from "./store-manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// A fixed key so the Chrome extension ID is stable across machines/CI
// (→ mnabffamileocpjnkmhemkidnekhdlle). Used by the E2E popup URL. NOT included
// in the store upload — the Chrome Web Store assigns the id and rejects `key`.
const CHROME_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAt1QWoF1nd37NqqlDle6NLmfppRW5tl/q4GV+9H1NVG45DTAewIlXhXNxPmUiaY4a5N6fVPHlxoZio2uFcAJLcE4p3heVVFMxyiYEDR5AEQhSMbgZaxiAIMlnbFxrEPag7LF+aYUjsaVvR/rTWC4BcXWMMwsVbg4gJa7l2HqLTEGKNycvwZE0VG+sz6TadStqnE0hEcu8gOpA8wmBQqk+o5jseM8erS2j7pvJskgglJ21qL/IhHQEwYdkjWy/gg67Th+771vpnA+71p+S1AZ32vYgKnxr6eA+YfnGZwpmfVqRlMnJlsfr6Mb/ul5bAVfNk4dEJG/sc2iebteEkbcVfQIDAQAB";

const mv2 = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

// Unpacked BROAD build WITH key — loaded by the E2E for a deterministic id.
stageDir(
  root,
  join(root, "dist", "chrome"),
  { ...chromeBroad(mv2), key: CHROME_KEY },
  DEV_FILES
);

// Store NARROW build WITHOUT key — what you upload to the Chrome Web Store.
const storeDir = join(root, "dist", "chrome-store");
stageDir(root, storeDir, chromeNarrow(mv2), STORE_FILES);
execSync(
  `cd '${storeDir}' && rm -f ../clickster-chrome.zip && zip -rq ../clickster-chrome.zip .`
);

console.log(
  "built dist/chrome/ (broad, with key, for tests) and dist/clickster-chrome.zip (narrow, no key, for the store)"
);
