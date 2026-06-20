import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserMock, loadScript } from "./helpers.js";

// Sandboxed iframes (SCORM course players, etc.) block storage: touching
// localStorage throws. Now that the content script runs in every frame (#13),
// it must survive that instead of crashing on load. Here getItem/setItem throw,
// exercising the lsGet/lsSet guards.
describe("clickster content script with storage blocked (#13)", () => {
  let browser;

  beforeEach(() => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: storage is blocked");
    });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("SecurityError: storage is blocked");
    });
    document.body.innerHTML = `<button id="go">Go</button>`;
    browser = installBrowserMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads without throwing", () => {
    expect(() => loadScript("clickster.js")).not.toThrow();
  });

  it("still answers GET_STATE (the frame is functional)", () => {
    loadScript("clickster.js");
    browser.emit("GET_STATE");
    const call = browser.runtime.sendMessage.mock.calls.find(
      (c) => c[0] && c[0].clicksterState
    );
    expect(call).toBeTruthy();
    expect(call[0].clicksterState.targets).toHaveLength(0);
  });
});
