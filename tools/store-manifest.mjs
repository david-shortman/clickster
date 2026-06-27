// Manifest transforms + staging shared by the build scripts. The shipped
// JS/HTML is identical across browsers and variants; only the manifest and
// which files get bundled differ.
//
//   broad   — auto-injects the content script via `content_scripts` + a granted
//             host permission. Used ONLY for the unpacked dev/E2E builds, where
//             deterministic auto-injection keeps the Selenium suite simple.
//   narrow  — installs with `activeTab` only and an OPTIONAL all-sites host
//             permission; background.js injects/registers the content script
//             after the user grants access. This is what ships to the stores,
//             and is what avoids the "broad host permissions" review penalty.
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Files copied into each build. The narrow (store) builds also ship the
// background worker; the broad builds don't need it.
export const DEV_FILES = ["clickster.js", "popup", "icons", "LICENSE"];
export const STORE_FILES = [...DEV_FILES, "background.js"];

// A match pattern (host permission) vs an API permission like "storage".
const isHostPermission = (p) => p.includes("://") || p === "<all_urls>";

// Chrome MV3, broad (unpacked E2E build only).
export function chromeBroad(mv2) {
  return {
    manifest_version: 3,
    name: mv2.name,
    version: mv2.version,
    description: mv2.description,
    icons: mv2.icons,
    content_scripts: mv2.content_scripts,
    // browser_action -> action; MV2 `permissions` split into API permissions
    // and host_permissions.
    action: mv2.browser_action,
    permissions: mv2.permissions.filter((p) => !isHostPermission(p)),
    host_permissions: mv2.permissions.filter(isHostPermission),
  };
}

// Chrome MV3, narrowed (store upload).
export function chromeNarrow(mv2) {
  return {
    manifest_version: 3,
    name: mv2.name,
    version: mv2.version,
    description: mv2.description,
    icons: mv2.icons,
    action: mv2.browser_action,
    permissions: ["activeTab", "scripting", "storage"],
    optional_host_permissions: ["*://*/*"],
    background: { service_worker: "background.js" },
  };
}

// Firefox MV2, narrowed (AMO upload). Keeps gecko id/browser_action; swaps the
// required <all_urls> for activeTab + an optional all-sites grant and adds the
// persistent background page that injects/registers on demand.
export function firefoxNarrow(mv2) {
  const manifest = {
    ...mv2,
    permissions: ["activeTab", "storage"],
    optional_permissions: ["*://*/*"],
    background: { scripts: ["background.js"], persistent: true },
    browser_specific_settings: {
      ...mv2.browser_specific_settings,
      gecko: {
        ...(mv2.browser_specific_settings &&
          mv2.browser_specific_settings.gecko),
        // Clickster collects nothing; declare it (soon-required by AMO).
        data_collection_permissions: { required: ["none"] },
      },
    },
  };
  delete manifest.content_scripts;
  return manifest;
}

export function stageDir(root, dir, manifest, files) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n"
  );
  for (const item of files) {
    cpSync(join(root, item), join(dir, item), { recursive: true });
  }
}
