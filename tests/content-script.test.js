import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserMock, loadScript } from "./helpers.js";

const DEFAULT_INTERVAL_MS = 3000;

describe("clickster content script", () => {
  let browser;
  let elementUnderCursor;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = `
      <button id="target">Squash and Merge</button>
      <button id="other" class="bulk">One</button>
      <button id="another" class="bulk">Two</button>
    `;
    // jsdom has no layout, so elementFromPoint is stubbed; tests set
    // elementUnderCursor to whatever the simulated cursor is over.
    document.elementFromPoint = () => elementUnderCursor;
    elementUnderCursor = null;
    browser = installBrowserMock();
    loadScript("clickster.js");
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function hoverAndSelect(element) {
    browser.emit("SELECT_ELEMENT_CLICKED");
    elementUnderCursor = element;
    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 10, clientY: 10 })
    );
    document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  function countClicks(element) {
    const spy = vi.fn();
    element.addEventListener("click", spy);
    return spy;
  }

  describe("target selection", () => {
    it("reports no target before anything is selected", () => {
      browser.emit("IS_ELEMENT_SELECTED");
      expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
        "NO_ELEMENT_IS_SELECTED"
      );
    });

    it("selects the hovered element on click and reports it", () => {
      const target = document.getElementById("target");
      hoverAndSelect(target);

      browser.emit("IS_ELEMENT_SELECTED");
      expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
        "ELEMENT_IS_SELECTED"
      );
      expect(target.style.border).toContain("thick solid");
    });

    it("selects the hovered element on Enter as the popup instructs", () => {
      const target = document.getElementById("target");
      browser.emit("SELECT_ELEMENT_CLICKED");
      elementUnderCursor = target;
      document.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 10, clientY: 10 })
      );
      document.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter" }));

      browser.emit("IS_ELEMENT_SELECTED");
      expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
        "ELEMENT_IS_SELECTED"
      );
    });

    it("clears the target on CLEAR_SELECTED_ELEMENT", () => {
      hoverAndSelect(document.getElementById("target"));
      browser.emit("CLEAR_SELECTED_ELEMENT");

      browser.emit("IS_ELEMENT_SELECTED");
      expect(browser.runtime.sendMessage).toHaveBeenLastCalledWith(
        "NO_ELEMENT_IS_SELECTED"
      );
    });

    it("replaces the target when a new element is selected with one active", () => {
      const first = document.getElementById("target");
      const second = document.getElementById("other");
      hoverAndSelect(first);

      // Selecting again while a target is already active used to throw in
      // setSelectedElement (issue #10) — it passed the raw element to
      // removeSelectedHighlight, which dereferences element.ref — silently
      // aborting the new selection so the popup kept saying "no target".
      hoverAndSelect(second);

      const clicksFirst = countClicks(first);
      const clicksSecond = countClicks(second);
      browser.emit("START_CLICKING");
      vi.advanceTimersByTime(DEFAULT_INTERVAL_MS);

      expect(clicksSecond).toHaveBeenCalledTimes(1);
      expect(clicksFirst).not.toHaveBeenCalled();
    });
  });

  describe("interval clicking", () => {
    it("does not click before Start is pressed", () => {
      const target = document.getElementById("target");
      const clicks = countClicks(target);
      hoverAndSelect(target);

      vi.advanceTimersByTime(DEFAULT_INTERVAL_MS * 3);
      expect(clicks).not.toHaveBeenCalled();
    });

    it("clicks the target repeatedly at the configured interval", () => {
      const target = document.getElementById("target");
      const clicks = countClicks(target);
      hoverAndSelect(target);
      browser.emit("START_CLICKING");

      vi.advanceTimersByTime(DEFAULT_INTERVAL_MS);
      expect(clicks).toHaveBeenCalledTimes(1);

      // The core contract from the listing: "click every X seconds",
      // not just once (AMO review regression guard).
      vi.advanceTimersByTime(DEFAULT_INTERVAL_MS * 4);
      expect(clicks).toHaveBeenCalledTimes(5);
    });

    it("stops clicking on STOP_CLICKING", () => {
      const target = document.getElementById("target");
      const clicks = countClicks(target);
      hoverAndSelect(target);
      browser.emit("START_CLICKING");
      vi.advanceTimersByTime(DEFAULT_INTERVAL_MS);
      expect(clicks).toHaveBeenCalledTimes(1);

      browser.emit("STOP_CLICKING");
      vi.advanceTimersByTime(DEFAULT_INTERVAL_MS * 5);
      expect(clicks).toHaveBeenCalledTimes(1);
    });

    it("applies an updated click interval", () => {
      const target = document.getElementById("target");
      const clicks = countClicks(target);
      hoverAndSelect(target);
      browser.emit("START_CLICKING");
      browser.emit({ newClickInterval: "1" });

      vi.advanceTimersByTime(1000);
      expect(clicks).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2000);
      expect(clicks).toHaveBeenCalledTimes(3);
    });

    it("reports clickster enabled state to the popup", () => {
      browser.emit("GET_IS_CLICKSTER_ENABLED");
      expect(browser.runtime.sendMessage).toHaveBeenLastCalledWith({
        clicksterEnabled: false,
      });

      browser.emit("START_CLICKING");
      browser.emit("GET_IS_CLICKSTER_ENABLED");
      expect(browser.runtime.sendMessage).toHaveBeenLastCalledWith({
        clicksterEnabled: true,
      });
    });

    it("reports the click interval in seconds", () => {
      browser.emit("GET_CLICK_INTERVAL");
      expect(browser.runtime.sendMessage).toHaveBeenLastCalledWith({
        clickInterval: 3,
      });
    });

    it("reports time until the next click", () => {
      hoverAndSelect(document.getElementById("target"));
      browser.emit("START_CLICKING");
      vi.advanceTimersByTime(1000);

      browser.emit("GET_TIME_UNTIL_CLICK");
      expect(browser.runtime.sendMessage).toHaveBeenLastCalledWith({
        timeUntilClick: DEFAULT_INTERVAL_MS - 1000,
      });
    });
  });

  describe("advanced query", () => {
    it("targets every element matching the selector", () => {
      const one = document.getElementById("other");
      const two = document.getElementById("another");
      const clicksOne = countClicks(one);
      const clicksTwo = countClicks(two);

      browser.emit({ advancedQuery: ".bulk" });
      browser.emit("START_CLICKING");
      vi.advanceTimersByTime(DEFAULT_INTERVAL_MS);

      expect(clicksOne).toHaveBeenCalledTimes(1);
      expect(clicksTwo).toHaveBeenCalledTimes(1);
    });

    it("supports multiple newline-separated selectors", () => {
      const target = document.getElementById("target");
      const other = document.getElementById("other");
      const clicksTarget = countClicks(target);
      const clicksOther = countClicks(other);

      browser.emit({ advancedQuery: "#target\n#other" });
      browser.emit("START_CLICKING");
      vi.advanceTimersByTime(DEFAULT_INTERVAL_MS);

      expect(clicksTarget).toHaveBeenCalledTimes(1);
      expect(clicksOther).toHaveBeenCalledTimes(1);
    });

    it("persists the query and restores targets on the next page load", () => {
      browser.emit({ advancedQuery: ".bulk" });
      expect(localStorage.getItem("clicksterQuery")).toBe(".bulk");

      // Simulate a page reload: fresh script run against the same origin.
      browser = installBrowserMock();
      loadScript("clickster.js");

      browser.emit("IS_ELEMENT_SELECTED");
      expect(browser.runtime.sendMessage).toHaveBeenLastCalledWith(
        "ELEMENT_IS_SELECTED"
      );

      browser.emit("GET_CLICKSTER_CACHED_QUERY");
      expect(browser.runtime.sendMessage).toHaveBeenLastCalledWith({
        clicksterCachedQuery: ".bulk",
      });
    });

    it("forgets the cached query when the selection is cleared", () => {
      browser.emit({ advancedQuery: ".bulk" });
      browser.emit("CLEAR_SELECTED_ELEMENT");
      expect(localStorage.getItem("clicksterQuery")).toBeNull();
    });
  });
});
