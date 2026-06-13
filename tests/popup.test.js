import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  flushMicrotasks,
  installBrowserMock,
  loadScript,
  readPopupHtml,
} from "./helpers.js";

const TAB_ID = 7;

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

  it("queries the active tab's state on open", async () => {
    browser.tabs.sendMessage.mockClear();
    loadScript("popup/popup.js");
    await flushMicrotasks();

    const sent = browser.tabs.sendMessage.mock.calls;
    expect(sent).toContainEqual([TAB_ID, "IS_ELEMENT_SELECTED"]);
    expect(sent).toContainEqual([TAB_ID, "GET_CLICK_INTERVAL"]);
    expect(sent).toContainEqual([TAB_ID, "GET_IS_CLICKSTER_ENABLED"]);
    expect(sent).toContainEqual([TAB_ID, "GET_CLICKSTER_CACHED_QUERY"]);
  });

  it("shows the selected-target panel when the tab reports a selection", () => {
    browser.emit("ELEMENT_IS_SELECTED");
    expect(document.getElementById("element-selected-msg").hidden).toBe(false);
    expect(document.getElementById("no-element-selected-msg").hidden).toBe(
      true
    );

    browser.emit("NO_ELEMENT_IS_SELECTED");
    expect(document.getElementById("element-selected-msg").hidden).toBe(true);
    expect(document.getElementById("no-element-selected-msg").hidden).toBe(
      false
    );
  });

  it("toggles Start/Stop buttons based on reported enabled state", () => {
    browser.emit({ clicksterEnabled: true });
    expect(
      document.getElementById("clickster-start-button").style.display
    ).toBe("none");
    expect(
      document.getElementById("clickster-stop-button").style.display
    ).toBe("block");

    browser.emit({ clicksterEnabled: false });
    expect(
      document.getElementById("clickster-start-button").style.display
    ).toBe("block");
    expect(
      document.getElementById("clickster-stop-button").style.display
    ).toBe("none");
  });

  it("sends START_CLICKING when Start is pressed", async () => {
    document.getElementById("clickster-start-button").click();
    await flushMicrotasks();
    expect(browser.tabs.sendMessage.mock.calls).toContainEqual([
      TAB_ID,
      "START_CLICKING",
    ]);
  });

  it("sends STOP_CLICKING when Stop is pressed", async () => {
    document.getElementById("clickster-stop-button").click();
    await flushMicrotasks();
    expect(browser.tabs.sendMessage.mock.calls).toContainEqual([
      TAB_ID,
      "STOP_CLICKING",
    ]);
  });

  it("enters selection mode and closes when Select a target is pressed", async () => {
    document.getElementById("select-element-btn").click();
    await flushMicrotasks();
    expect(browser.tabs.sendMessage.mock.calls).toContainEqual([
      TAB_ID,
      "SELECT_ELEMENT_CLICKED",
    ]);
    expect(window.close).toHaveBeenCalled();
  });

  it("sends the new interval as the frequency field changes", async () => {
    const field = document.getElementById("click-interval-fld");
    field.value = "5";
    field.dispatchEvent(new Event("input"));
    await flushMicrotasks();
    expect(browser.tabs.sendMessage.mock.calls).toContainEqual([
      TAB_ID,
      { newClickInterval: "5" },
    ]);
  });

  it("sends CLEAR_SELECTED_ELEMENT and resets the panel on Remove target", async () => {
    browser.emit("ELEMENT_IS_SELECTED");
    document.getElementById("clear-selection-btn").click();
    await flushMicrotasks();

    expect(browser.tabs.sendMessage.mock.calls).toContainEqual([
      TAB_ID,
      "CLEAR_SELECTED_ELEMENT",
    ]);
    expect(document.getElementById("no-element-selected-msg").hidden).toBe(
      false
    );
    expect(document.getElementById("element-selected-msg").hidden).toBe(true);
  });

  it("populates the interval field and countdown from tab responses", () => {
    browser.emit({ clickInterval: 4 });
    expect(document.getElementById("click-interval-fld").value).toBe("4");

    browser.emit({ timeUntilClick: 2400 });
    expect(document.getElementById("time-until-click-lbl").innerText).toBe(2);
  });

  it("reveals the advanced section with the cached query", () => {
    browser.emit({ clicksterCachedQuery: ".bulk" });
    expect(document.getElementById("advanced-options-sctn").hidden).toBe(
      false
    );
    expect(
      document.getElementById("advanced-elements-query-txtarea").value
    ).toBe(".bulk");
  });

  it("applies the advanced query to the active tab", async () => {
    document.getElementById("advanced-elements-query-txtarea").value =
      "#target";
    document.getElementById("apply-elements-query-btn").click();
    await flushMicrotasks();
    expect(browser.tabs.sendMessage.mock.calls).toContainEqual([
      TAB_ID,
      { advancedQuery: "#target" },
    ]);
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
        "IS_ELEMENT_SELECTED",
      ]);
    } finally {
      window.history.replaceState(null, "", "/popup.html");
    }
  });
});
