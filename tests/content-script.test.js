import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserMock, loadScript } from "./helpers.js";

// DEFAULT_INTERVAL_MS in the content script.
const INTERVAL_MS = 1000;

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
    // jsdom doesn't implement scrollIntoView.
    Element.prototype.scrollIntoView = () => {};
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

  // Ask the content script for its current state and return the latest one.
  function state() {
    browser.emit("GET_STATE");
    const calls = browser.runtime.sendMessage.mock.calls;
    for (let i = calls.length - 1; i >= 0; i -= 1) {
      if (calls[i][0] && calls[i][0].clicksterState) {
        return calls[i][0].clicksterState;
      }
    }
    return null;
  }

  describe("target selection", () => {
    it("reports no targets before anything is selected", () => {
      expect(state().targets).toHaveLength(0);
    });

    it("adds the hovered element as a target on click", () => {
      hoverAndSelect(document.getElementById("target"));
      const s = state();
      expect(s.targets).toHaveLength(1);
      expect(s.targets[0].label).toBe("Squash and Merge");
      expect(document.getElementById("target").style.border).toContain(
        "thick solid"
      );
    });

    it("adds the hovered element on Enter", () => {
      browser.emit("SELECT_ELEMENT_CLICKED");
      elementUnderCursor = document.getElementById("target");
      document.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 10, clientY: 10 })
      );
      document.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter" }));
      expect(state().targets).toHaveLength(1);
    });

    it("adds further selections instead of replacing (additive)", () => {
      hoverAndSelect(document.getElementById("target"));
      hoverAndSelect(document.getElementById("other"));
      const labels = state().targets.map((t) => t.label);
      expect(labels).toEqual(["Squash and Merge", "One"]);
    });

    it("clears the hover highlight when the cursor crosses the background", () => {
      const a = document.getElementById("target");
      browser.emit("SELECT_ELEMENT_CLICKED");

      elementUnderCursor = a;
      document.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 10, clientY: 10 })
      );
      expect(a.style.border).toContain("red");

      // Move onto the page background (a gap between elements).
      elementUnderCursor = document.body;
      document.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 11, clientY: 11 })
      );
      expect(a.style.border).not.toContain("red");
    });

    it("removes a target and restores its highlight", () => {
      const target = document.getElementById("target");
      hoverAndSelect(target);
      expect(target.style.border).toContain("thick solid");

      browser.emit({ removeTargetId: state().targets[0].id });
      expect(state().targets).toHaveLength(0);
      expect(target.style.border).not.toContain("thick solid");
    });
  });

  describe("clicking engine", () => {
    it("does not click before Start is pressed", () => {
      const target = document.getElementById("target");
      const clicks = countClicks(target);
      hoverAndSelect(target);

      vi.advanceTimersByTime(INTERVAL_MS * 3);
      expect(clicks).not.toHaveBeenCalled();
    });

    it("clicks the target repeatedly at the interval after Start", () => {
      const target = document.getElementById("target");
      const clicks = countClicks(target);
      hoverAndSelect(target);
      browser.emit("START_CLICKING");

      vi.advanceTimersByTime(INTERVAL_MS);
      expect(clicks).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(INTERVAL_MS * 4);
      expect(clicks).toHaveBeenCalledTimes(5);
    });

    it("stops clicking on STOP_CLICKING", () => {
      const target = document.getElementById("target");
      const clicks = countClicks(target);
      hoverAndSelect(target);
      browser.emit("START_CLICKING");
      vi.advanceTimersByTime(INTERVAL_MS);
      expect(clicks).toHaveBeenCalledTimes(1);

      browser.emit("STOP_CLICKING");
      vi.advanceTimersByTime(INTERVAL_MS * 5);
      expect(clicks).toHaveBeenCalledTimes(1);
    });

    it("respects a per-target interval", () => {
      const target = document.getElementById("target");
      const clicks = countClicks(target);
      hoverAndSelect(target);
      browser.emit({
        setTargetInterval: { id: state().targets[0].id, seconds: 2 },
      });
      browser.emit("START_CLICKING");

      vi.advanceTimersByTime(2000);
      expect(clicks).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2000);
      expect(clicks).toHaveBeenCalledTimes(2);
    });

    it("clicks each target at its own rate", () => {
      const fast = document.getElementById("target");
      const slow = document.getElementById("other");
      const fastClicks = countClicks(fast);
      const slowClicks = countClicks(slow);
      hoverAndSelect(fast);
      hoverAndSelect(slow);
      const [fastId, slowId] = state().targets.map((t) => t.id);
      browser.emit({ setTargetInterval: { id: fastId, seconds: 1 } });
      browser.emit({ setTargetInterval: { id: slowId, seconds: 3 } });
      browser.emit("START_CLICKING");

      vi.advanceTimersByTime(3000);
      expect(fastClicks).toHaveBeenCalledTimes(3);
      expect(slowClicks).toHaveBeenCalledTimes(1);
    });

    it("re-resolves a re-rendered target and keeps clicking the live node (#12)", () => {
      const original = document.getElementById("target");
      hoverAndSelect(original);
      browser.emit("START_CLICKING");
      vi.advanceTimersByTime(INTERVAL_MS);

      // Simulate a re-render: the node is detached and replaced by a fresh one
      // matching the same selector.
      original.remove();
      const fresh = document.createElement("button");
      fresh.id = "target";
      document.body.appendChild(fresh);
      const freshClicks = countClicks(fresh);

      vi.advanceTimersByTime(INTERVAL_MS * 2);
      expect(freshClicks).toHaveBeenCalledTimes(2);
      expect(fresh.style.border).toContain("thick solid"); // highlight followed
    });

    it("pauses and resumes an individual target", () => {
      const target = document.getElementById("target");
      const other = document.getElementById("other");
      const targetClicks = countClicks(target);
      const otherClicks = countClicks(other);
      hoverAndSelect(target);
      hoverAndSelect(other);
      const targetId = state().targets[0].id;

      browser.emit({ pauseTarget: { id: targetId, paused: true } });
      browser.emit("START_CLICKING");
      vi.advanceTimersByTime(INTERVAL_MS);
      expect(targetClicks).not.toHaveBeenCalled();
      expect(otherClicks).toHaveBeenCalledTimes(1);

      browser.emit({ pauseTarget: { id: targetId, paused: false } });
      vi.advanceTimersByTime(INTERVAL_MS);
      expect(targetClicks).toHaveBeenCalledTimes(1);
    });
  });

  describe("state reporting", () => {
    it("reports enabled state and per-target click counts", () => {
      const target = document.getElementById("target");
      hoverAndSelect(target);
      expect(state().enabled).toBe(false);

      browser.emit("START_CLICKING");
      vi.advanceTimersByTime(INTERVAL_MS);
      const s = state();
      expect(s.enabled).toBe(true);
      expect(s.targets[0].clickCount).toBe(1);
      expect(s.targets[0].intervalSeconds).toBe(1);
    });

    it("reports a countdown to the next click", () => {
      hoverAndSelect(document.getElementById("target"));
      browser.emit("START_CLICKING");
      vi.advanceTimersByTime(400);
      const next = state().targets[0].nextClickMs;
      expect(next).toBeGreaterThan(0);
      expect(next).toBeLessThanOrEqual(INTERVAL_MS);
    });

    it("flashes an outline on the element for showTarget", () => {
      const target = document.getElementById("target");
      hoverAndSelect(target);
      browser.emit({ showTargetId: state().targets[0].id });
      expect(target.style.outline).toContain("solid");
    });
  });

  describe("persistence across reload (#11)", () => {
    // A fresh script run against the same DOM + localStorage is what a real
    // page reload looks like. Clear timers first, since navigating away tears
    // down the old page's intervals.
    function reload() {
      vi.clearAllTimers();
      browser = installBrowserMock();
      loadScript("clickster.js");
    }

    it("resumes clicking after reload when it was running", () => {
      const target = document.getElementById("target");
      hoverAndSelect(target);
      browser.emit("START_CLICKING");

      reload();

      const clicks = countClicks(target);
      vi.advanceTimersByTime(INTERVAL_MS * 2);
      expect(clicks).toHaveBeenCalledTimes(2);
    });

    it("stays stopped after reload when it was not running", () => {
      const target = document.getElementById("target");
      hoverAndSelect(target);
      browser.emit("START_CLICKING");
      browser.emit("STOP_CLICKING");

      reload();

      const clicks = countClicks(target);
      vi.advanceTimersByTime(INTERVAL_MS * 2);
      expect(clicks).not.toHaveBeenCalled();
    });

    it("restores targets (with their interval) after reload", () => {
      hoverAndSelect(document.getElementById("target"));
      browser.emit({
        setTargetInterval: { id: state().targets[0].id, seconds: 4 },
      });

      reload();

      const s = state();
      expect(s.targets).toHaveLength(1);
      expect(s.targets[0].intervalSeconds).toBe(4);
    });

    it("does not resume after the last target is removed and reloaded", () => {
      const target = document.getElementById("target");
      hoverAndSelect(target);
      browser.emit("START_CLICKING");
      browser.emit({ removeTargetId: state().targets[0].id });

      reload();

      const clicks = countClicks(target);
      vi.advanceTimersByTime(INTERVAL_MS * 2);
      expect(clicks).not.toHaveBeenCalled();
    });
  });

  describe("resume toast", () => {
    function reload() {
      vi.clearAllTimers();
      browser = installBrowserMock();
      loadScript("clickster.js");
    }
    const toast = () => document.getElementById("clickster-resume-toast");

    it("shows a sticky toast when clicking resumes after reload", () => {
      hoverAndSelect(document.getElementById("target"));
      browser.emit("START_CLICKING");
      expect(toast()).toBeNull();

      reload();
      expect(toast()).not.toBeNull();
      expect(toast().textContent).toContain("still auto-clicking");
    });

    it("does not show a toast when clicking did not resume", () => {
      hoverAndSelect(document.getElementById("target"));
      browser.emit("START_CLICKING");
      browser.emit("STOP_CLICKING");

      reload();
      expect(toast()).toBeNull();
    });

    it("its Stop button halts clicking and removes the toast", () => {
      const target = document.getElementById("target");
      hoverAndSelect(target);
      browser.emit("START_CLICKING");
      reload();

      document.getElementById("clickster-resume-toast-stop").click();
      expect(toast()).toBeNull();

      const clicks = countClicks(target);
      vi.advanceTimersByTime(INTERVAL_MS * 2);
      expect(clicks).not.toHaveBeenCalled();
      reload();
      expect(toast()).toBeNull();
    });

    it("suppresses the toast permanently after 'Don't show again'", () => {
      hoverAndSelect(document.getElementById("target"));
      browser.emit("START_CLICKING");
      reload();

      const link = [...toast().querySelectorAll("a")].find((a) =>
        a.textContent.includes("Don't show again")
      );
      link.click();
      expect(localStorage.getItem("clicksterHideResumeToast")).toBe("true");

      reload();
      expect(toast()).toBeNull();
    });
  });
});
