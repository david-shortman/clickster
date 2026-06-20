import { afterEach, describe, expect, it, vi } from "vitest";
import { flushMicrotasks, loadScript } from "./helpers.js";

const TAB = 99;

/**
 * Minimal Chrome MV3 API mock for background.js. `granted` controls whether the
 * all-sites host permission is held; `present` controls whether a content
 * script already answers PING in the active tab; `registered` seeds an existing
 * dynamic registration.
 */
function installChromeMock({ granted = true, present = false, registered = [] } = {}) {
  const chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
    },
    permissions: {
      contains: vi.fn((opts, cb) => cb(granted)),
      onAdded: { addListener: vi.fn() },
    },
    scripting: {
      getRegisteredContentScripts: vi.fn().mockResolvedValue(registered),
      registerContentScripts: vi.fn().mockResolvedValue(undefined),
      executeScript: vi.fn().mockResolvedValue(undefined),
    },
    tabs: {
      query: vi.fn((q, cb) => cb([{ id: TAB }])),
      sendMessage: vi.fn((tabId, msg, cb) => {
        chrome.runtime.lastError =
          msg === "PING" && !present ? { message: "no receiver" } : null;
        if (cb) cb();
        chrome.runtime.lastError = null;
      }),
    },
  };
  delete globalThis.browser;
  delete window.browser;
  globalThis.chrome = chrome;
  return chrome;
}

/** Load background.js and return the registered onMessage listener. */
function loadBackground() {
  loadScript("background.js");
  return globalThis.chrome.runtime.onMessage.addListener.mock.calls[0][0];
}

afterEach(() => {
  delete globalThis.chrome;
});

describe("clickster background worker (Chrome MV3)", () => {
  it("on arm: registers, injects, and arms the active tab", async () => {
    const chrome = installChromeMock({ granted: true, present: false });
    const onMessage = loadBackground();

    const sendResponse = vi.fn();
    const keepOpen = onMessage({ clicksterArm: true }, {}, sendResponse);
    expect(keepOpen).toBe(true); // async response channel stays open
    await flushMicrotasks();

    expect(chrome.scripting.registerContentScripts).toHaveBeenCalledTimes(1);
    expect(chrome.scripting.registerContentScripts.mock.calls[0][0][0]).toMatchObject(
      { id: "clickster", matches: ["*://*/*"], js: ["clickster.js"] }
    );
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: TAB },
      files: ["clickster.js"],
    });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      TAB,
      "SELECT_ELEMENT_CLICKED",
      expect.any(Function)
    );
    expect(sendResponse).toHaveBeenCalledWith(true);
  });

  it("does not re-inject when the content script already answers", async () => {
    const chrome = installChromeMock({ granted: true, present: true });
    const onMessage = loadBackground();

    onMessage({ clicksterArm: true }, {}, vi.fn());
    await flushMicrotasks();

    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      TAB,
      "SELECT_ELEMENT_CLICKED",
      expect.any(Function)
    );
  });

  it("does not register a duplicate content script", async () => {
    const chrome = installChromeMock({
      granted: true,
      registered: [{ id: "clickster" }],
    });
    const onMessage = loadBackground();

    onMessage({ clicksterArm: true }, {}, vi.fn());
    await flushMicrotasks();

    expect(chrome.scripting.registerContentScripts).not.toHaveBeenCalled();
  });

  it("honors an explicit target tab id (E2E hook)", async () => {
    const chrome = installChromeMock({ granted: true, present: false });
    const onMessage = loadBackground();

    onMessage({ clicksterArm: true, tabId: 5 }, {}, vi.fn());
    await flushMicrotasks();

    expect(chrome.tabs.query).not.toHaveBeenCalled(); // didn't fall back to active tab
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 5 },
      files: ["clickster.js"],
    });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      5,
      "SELECT_ELEMENT_CLICKED",
      expect.any(Function)
    );
  });

  it("skips registration when host access has not been granted", async () => {
    const chrome = installChromeMock({ granted: false, present: false });
    const onMessage = loadBackground();

    onMessage({ clicksterArm: true }, {}, vi.fn());
    await flushMicrotasks();

    // No broad access yet: don't register a persistent script, but still inject
    // the current tab (works under activeTab) so this page clicks.
    expect(chrome.scripting.registerContentScripts).not.toHaveBeenCalled();
    expect(chrome.scripting.executeScript).toHaveBeenCalled();
  });
});
