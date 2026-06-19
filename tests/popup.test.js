import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  flushMicrotasks,
  installBrowserMock,
  loadScript,
  readPopupHtml,
} from "./helpers.js";

const TAB_ID = 7;

function makeTarget(overrides = {}) {
  return {
    id: 3,
    label: "Harvest",
    intervalSeconds: 1,
    clickCount: 0,
    paused: false,
    nextClickMs: 500,
    ...overrides,
  };
}

const hidden = (id) =>
  document.getElementById(id).classList.contains("hidden");

describe("clickster popup", () => {
  let browser;

  beforeEach(async () => {
    document.body.innerHTML = readPopupHtml();
    window.close = vi.fn();
    browser = installBrowserMock({ activeTabId: TAB_ID });
    loadScript("popup/popup.js");
    await flushMicrotasks();
    browser.tabs.sendMessage.mockClear();
  });

  function emitState(state) {
    browser.emit({ clicksterState: state });
  }

  it("requests state from the active tab on open", async () => {
    browser.tabs.sendMessage.mockClear();
    loadScript("popup/popup.js");
    await flushMicrotasks();
    expect(browser.tabs.sendMessage.mock.calls).toContainEqual([
      TAB_ID,
      "GET_STATE",
    ]);
  });

  it("shows only the Select button when there are no targets", () => {
    emitState({ enabled: false, targets: [] });
    expect(hidden("empty-state")).toBe(false);
    expect(hidden("active-actions")).toBe(true);
    expect(hidden("running-badge")).toBe(true);
    expect(document.getElementById("targets-list").children).toHaveLength(0);
  });

  it("renders a row per target with label, count and countdown", () => {
    emitState({
      enabled: true,
      targets: [makeTarget({ clickCount: 5, nextClickMs: 600 })],
    });
    const rows = document.getElementById("targets-list").children;
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector(".target-label").textContent).toBe("Harvest");
    expect(rows[0].querySelector(".count").textContent).toContain("5");
    expect(rows[0].querySelector(".countdown").textContent).toContain(
      "next in"
    );
    expect(rows[0].querySelector(".freq-input").value).toBe("1");
    expect(hidden("empty-state")).toBe(true);
  });

  it("does not render the CSS selector anywhere", () => {
    emitState({
      enabled: true,
      targets: [makeTarget({ label: "Harvest", selector: "#harvest" })],
    });
    expect(document.getElementById("targets-list").textContent).not.toContain(
      "#harvest"
    );
  });

  it("shows a paused target's state", () => {
    emitState({
      enabled: true,
      targets: [makeTarget({ paused: true, nextClickMs: null })],
    });
    const row = document.querySelector(".target");
    expect(row.querySelector(".countdown").textContent).toBe("paused");
    expect(row.querySelector(".pause-btn").getAttribute("aria-label")).toBe(
      "Resume"
    );
  });

  it("toggles the running badge and Start/Stop with enabled state", () => {
    emitState({ enabled: true, targets: [makeTarget()] });
    expect(hidden("running-badge")).toBe(false);
    expect(hidden("start-btn")).toBe(true);
    expect(hidden("stop-btn")).toBe(false);

    emitState({ enabled: false, targets: [makeTarget()] });
    expect(hidden("running-badge")).toBe(true);
    expect(hidden("start-btn")).toBe(false);
    expect(hidden("stop-btn")).toBe(true);
  });

  it("sends START_CLICKING on Start and STOP_CLICKING on Stop", async () => {
    emitState({ enabled: false, targets: [makeTarget()] });
    document.getElementById("start-btn").click();
    await flushMicrotasks();
    expect(browser.tabs.sendMessage.mock.calls).toContainEqual([
      TAB_ID,
      "START_CLICKING",
    ]);

    emitState({ enabled: true, targets: [makeTarget()] });
    document.getElementById("stop-btn").click();
    await flushMicrotasks();
    expect(browser.tabs.sendMessage.mock.calls).toContainEqual([
      TAB_ID,
      "STOP_CLICKING",
    ]);
  });

  it("arms selection and closes on Select an element", async () => {
    document.getElementById("select-element-btn").click();
    await flushMicrotasks();
    expect(browser.tabs.sendMessage.mock.calls).toContainEqual([
      TAB_ID,
      "SELECT_ELEMENT_CLICKED",
    ]);
    expect(window.close).toHaveBeenCalled();
  });

  it("arms selection on Add another target", async () => {
    emitState({ enabled: false, targets: [makeTarget()] });
    document.getElementById("add-target-btn").click();
    await flushMicrotasks();
    expect(browser.tabs.sendMessage.mock.calls).toContainEqual([
      TAB_ID,
      "SELECT_ELEMENT_CLICKED",
    ]);
  });

  it("sends removeTargetId when a row's remove button is clicked", async () => {
    emitState({ enabled: true, targets: [makeTarget({ id: 9 })] });
    document.querySelector(".remove-btn").click();
    await flushMicrotasks();
    expect(browser.tabs.sendMessage.mock.calls).toContainEqual([
      TAB_ID,
      { removeTargetId: 9 },
    ]);
  });

  it("sends pauseTarget when the pause button is clicked", async () => {
    emitState({ enabled: true, targets: [makeTarget({ id: 9, paused: false })] });
    document.querySelector(".pause-btn").click();
    await flushMicrotasks();
    expect(browser.tabs.sendMessage.mock.calls).toContainEqual([
      TAB_ID,
      { pauseTarget: { id: 9, paused: true } },
    ]);
  });

  it("sends showTargetId when the eye button is clicked", async () => {
    emitState({ enabled: true, targets: [makeTarget({ id: 9 })] });
    document.querySelector(".show-btn").click();
    await flushMicrotasks();
    expect(browser.tabs.sendMessage.mock.calls).toContainEqual([
      TAB_ID,
      { showTargetId: 9 },
    ]);
  });

  it("sends setTargetInterval when the frequency changes", async () => {
    emitState({ enabled: true, targets: [makeTarget({ id: 9 })] });
    const input = document.querySelector(".freq-input");
    input.value = "5";
    input.dispatchEvent(new Event("change"));
    await flushMicrotasks();
    expect(browser.tabs.sendMessage.mock.calls).toContainEqual([
      TAB_ID,
      { setTargetInterval: { id: 9, seconds: "5" } },
    ]);
  });

  it("rebuilds rows only when the target set changes", () => {
    emitState({ enabled: true, targets: [makeTarget({ id: 9 })] });
    const firstRow = document.querySelector(".target");
    emitState({
      enabled: true,
      targets: [makeTarget({ id: 9, clickCount: 12 })],
    });
    expect(document.querySelector(".target")).toBe(firstRow); // same node, updated
    expect(firstRow.querySelector(".count").textContent).toContain("12");
  });
});

describe("clickster popup e2e hook", () => {
  it("pins messaging to the tab named by ?tabId instead of querying", async () => {
    window.history.replaceState(null, "", "/popup.html?tabId=42");
    try {
      document.body.innerHTML = readPopupHtml();
      window.close = vi.fn();
      const browser = installBrowserMock({ activeTabId: TAB_ID });
      loadScript("popup/popup.js");
      await flushMicrotasks();

      expect(browser.tabs.query).not.toHaveBeenCalled();
      expect(browser.tabs.sendMessage.mock.calls).toContainEqual([
        42,
        "GET_STATE",
      ]);
    } finally {
      window.history.replaceState(null, "", "/popup.html");
    }
  });
});
