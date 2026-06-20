// Background worker for the narrowed (store) builds. The extension installs
// with NO host access — only `activeTab`. On first use the popup asks the user
// to grant access to all sites (one prompt); this worker then injects the
// content script into the current tab and, once broad access is granted,
// registers it to auto-inject on future page loads so clicking still survives
// reloads and navigations.
//
// The dev/E2E builds keep the old broad `content_scripts` model and DON'T ship
// this file, so everything here only runs in the store builds.
const isChrome = !globalThis.browser && !!globalThis.chrome;
// Prefer the standard `browser` namespace; fall back to `chrome`.
const api = isChrome ? chrome : browser;

const HOST_ORIGINS = ["*://*/*"];
const CS_ID = "clickster";
const CS_MATCHES = ["*://*/*"];
const CS_FILE = "clickster.js";

// Chrome MV3 exposes scripting.registerContentScripts; Firefox MV2 uses the
// older contentScripts.register. Branch on what's actually present.
const hasScripting = !!(api.scripting && api.scripting.registerContentScripts);

// Firefox's contentScripts.register handle lives only for the session and only
// while the registering context is alive — which is why this is a persistent
// background page there. Kept so we don't register twice.
let firefoxRegistration = null;

function hasHostAccess() {
  if (isChrome) {
    return new Promise((resolve) =>
      api.permissions.contains({ origins: HOST_ORIGINS }, resolve)
    );
  }
  return api.permissions.contains({ origins: HOST_ORIGINS }).catch(() => false);
}

// Register the content script to auto-inject on every page load, so a started
// session keeps clicking across reloads/navigations. Only meaningful once the
// user has granted broad host access; a no-op otherwise.
async function ensureRegistered() {
  if (!(await hasHostAccess())) return;
  if (hasScripting) {
    let existing = [];
    try {
      existing = await api.scripting.getRegisteredContentScripts({
        ids: [CS_ID],
      });
    } catch (e) {
      existing = [];
    }
    if (existing && existing.length) return;
    try {
      await api.scripting.registerContentScripts([
        {
          id: CS_ID,
          matches: CS_MATCHES,
          js: [CS_FILE],
          runAt: "document_idle",
          persistAcrossSessions: true,
        },
      ]);
    } catch (e) {
      // Already registered (race) — fine.
    }
  } else if (api.contentScripts && api.contentScripts.register) {
    if (firefoxRegistration) return;
    try {
      firefoxRegistration = await api.contentScripts.register({
        matches: CS_MATCHES,
        js: [{ file: CS_FILE }],
        runAt: "document_idle",
      });
    } catch (e) {
      firefoxRegistration = null;
    }
  }
}

function activeTabId() {
  if (isChrome) {
    return new Promise((resolve) =>
      api.tabs.query({ active: true, currentWindow: true }, (tabs) =>
        resolve(tabs[0] && tabs[0].id)
      )
    );
  }
  return api.tabs
    .query({ active: true, currentWindow: true })
    .then((tabs) => tabs[0] && tabs[0].id);
}

// True if a content script is already answering in this tab.
function ping(tabId) {
  return new Promise((resolve) => {
    try {
      if (isChrome) {
        api.tabs.sendMessage(tabId, "PING", () =>
          resolve(!api.runtime.lastError)
        );
      } else {
        api.tabs.sendMessage(tabId, "PING").then(
          () => resolve(true),
          () => resolve(false)
        );
      }
    } catch (e) {
      resolve(false);
    }
  });
}

// Inject the content script into one tab right now (the page the user is on),
// unless it's already there. Works under activeTab even without broad access,
// so the current tab still clicks if the user declines the all-sites prompt.
async function ensureInjected(tabId) {
  if (await ping(tabId)) return;
  try {
    if (hasScripting) {
      await api.scripting.executeScript({ target: { tabId }, files: [CS_FILE] });
    } else {
      await api.tabs.executeScript(tabId, { file: CS_FILE });
    }
  } catch (e) {
    // Restricted page (store, about:, etc.) — nothing we can do.
  }
}

function sendTab(tabId, message) {
  if (isChrome) {
    return new Promise((resolve) =>
      api.tabs.sendMessage(tabId, message, () => {
        void api.runtime.lastError;
        resolve();
      })
    );
  }
  return api.tabs.sendMessage(tabId, message).catch(() => {});
}

// The popup's "Select an element" handoff: make sure the content script is
// present (and registered for the future when access is broad), then arm it.
// `tabId` is normally the active tab; the popup passes an explicit id only in
// E2E, where the popup runs as its own tab.
async function arm(tabId) {
  await ensureRegistered();
  if (tabId == null) tabId = await activeTabId();
  if (tabId == null) return;
  await ensureInjected(tabId);
  await sendTab(tabId, "SELECT_ELEMENT_CLICKED");
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.clicksterArm) {
    arm(message.tabId).then(
      () => sendResponse(true),
      () => sendResponse(false)
    );
    return true; // keep the channel open for the async response
  }
});

// Re-establish the persistent registration when the browser/extension starts
// (required on Firefox, where registrations don't survive a restart; harmless
// on Chrome, where they do).
if (api.runtime.onStartup) api.runtime.onStartup.addListener(ensureRegistered);
if (api.runtime.onInstalled) api.runtime.onInstalled.addListener(ensureRegistered);
if (api.permissions.onAdded) api.permissions.onAdded.addListener(ensureRegistered);
