import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Execute one of the extension's scripts the way the browser does: as a
 * classic (sloppy-mode) script against the global jsdom document, not as an
 * ES module. The extension intentionally has no build step (its AMO
 * submissions declare no source processing), so tests load the shipped files
 * verbatim.
 */
export function loadScript(relativePath) {
  const code = readFileSync(resolve(repoRoot, relativePath), "utf8");
  new Function(code)();
}

/**
 * Mock of the WebExtension `browser` API surface Clickster uses.
 * `emit(message)` delivers a runtime message to the most recently loaded
 * script, like a message arriving from the popup/content script.
 */
export function installBrowserMock({ activeTabId = 7 } = {}) {
  const messageListeners = [];
  const mock = {
    runtime: {
      sendMessage: vi.fn(),
      onMessage: {
        addListener: (listener) => messageListeners.push(listener),
      },
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: activeTabId }]),
      sendMessage: vi.fn(),
    },
    emit: (message) => messageListeners.at(-1)(message),
  };
  globalThis.browser = mock;
  window.browser = mock;
  return mock;
}

/** Flush pending microtasks (promise callbacks) without advancing timers. */
export async function flushMicrotasks(turns = 10) {
  for (let i = 0; i < turns; i += 1) {
    await Promise.resolve();
  }
}

export function readPopupHtml() {
  const html = readFileSync(resolve(repoRoot, "popup/popup.html"), "utf8");
  // Strip the script tag; tests load popup.js explicitly via loadScript.
  return html.replace(/<script[\s\S]*?<\/script>/g, "");
}
