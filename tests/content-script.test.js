import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushMicrotasks, installBrowserMock, loadScript } from "./helpers.js";

// DEFAULT_INTERVAL_MS in the content script.
const INTERVAL_MS = 1000;
// The content script keys this origin's state under "site:<origin>" (#14).
const SITE_KEY = "site:" + location.origin;

// Load the content script and wait for its async init() (storage.local read) to
// settle, so module state is hydrated before the test runs.
async function loadAndInit() {
  loadScript("clickster.js");
  await flushMicrotasks();
}

// jsdom has no layout, so give elements fake rects and a hit-testing
// elementFromPoint — coordinate clicking is geometry, so the harness must model
// it. place() assigns a rect; hitTest() finds the topmost placed element.
function place(el, x, y, w, h) {
  el.__rect = { left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y };
  el.getBoundingClientRect = () => el.__rect;
  return el;
}
function hitTest(x, y) {
  const placed = [...document.querySelectorAll("*")].filter((e) => e.__rect);
  for (let i = placed.length - 1; i >= 0; i -= 1) {
    const r = placed[i].__rect;
    if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return placed[i];
  }
  return null;
}
function centerOf(el) {
  const r = el.__rect;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

describe("clickster content script", () => {
  let browser;

  beforeEach(async () => {
    vi.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = `
      <button id="target">Squash and Merge</button>
      <button id="other" class="bulk">One</button>
      <button id="another" class="bulk">Two</button>
    `;
    place(document.getElementById("target"), 0, 0, 100, 40);
    place(document.getElementById("other"), 0, 50, 100, 40);
    place(document.getElementById("another"), 0, 100, 100, 40);
    document.elementFromPoint = hitTest;
    // jsdom doesn't implement scrollIntoView.
    Element.prototype.scrollIntoView = () => {};
    browser = installBrowserMock();
    await loadAndInit();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function hoverAndSelect(element) {
    const c = centerOf(element);
    browser.emit("SELECT_ELEMENT_CLICKED");
    document.dispatchEvent(
      new MouseEvent("mousemove", { clientX: c.x, clientY: c.y })
    );
    document.dispatchEvent(
      new MouseEvent("click", { clientX: c.x, clientY: c.y, bubbles: true })
    );
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
      expect(document.getElementById("target").style.boxShadow).toContain(
        "#b827fc"
      );
    });

    it("adds the hovered element on Enter", () => {
      browser.emit("SELECT_ELEMENT_CLICKED");
      const c = centerOf(document.getElementById("target"));
      document.dispatchEvent(
        new MouseEvent("mousemove", { clientX: c.x, clientY: c.y })
      );
      document.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter" }));
      expect(state().targets).toHaveLength(1);
    });

    it("builds an :nth-of-type selector for a target with no id", () => {
      document.body.innerHTML =
        '<div id="panel"><button>Alpha</button><button>Beta</button></div>';
      const buttons = document.body.querySelectorAll("#panel button");
      place(buttons[0], 0, 0, 100, 40);
      place(buttons[1], 0, 50, 100, 40);
      const beta = buttons[1];

      browser.emit("SELECT_ELEMENT_CLICKED");
      const c = centerOf(beta);
      document.dispatchEvent(
        new MouseEvent("mousemove", { clientX: c.x, clientY: c.y })
      );
      document.dispatchEvent(
        new MouseEvent("click", { clientX: c.x, clientY: c.y, bubbles: true })
      );

      const stored = browser.__store[SITE_KEY].targets;
      expect(stored[0].selector).toContain(":nth-of-type(2)");
      // The generated selector must resolve uniquely back to the same element.
      expect(document.querySelectorAll(stored[0].selector)).toHaveLength(1);
      expect(document.querySelector(stored[0].selector)).toBe(beta);
    });

    it("adds further selections instead of replacing (additive)", () => {
      hoverAndSelect(document.getElementById("target"));
      hoverAndSelect(document.getElementById("other"));
      const labels = state().targets.map((t) => t.label);
      expect(labels).toEqual(["Squash and Merge", "One"]);
    });

    it("clears the hover highlight when the cursor crosses the background", () => {
      const a = document.getElementById("target");
      const c = centerOf(a);
      browser.emit("SELECT_ELEMENT_CLICKED");

      document.dispatchEvent(
        new MouseEvent("mousemove", { clientX: c.x, clientY: c.y })
      );
      expect(a.style.border).toContain("red");

      // Move onto the page background (a point over no element).
      document.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 500, clientY: 500 })
      );
      expect(a.style.border).not.toContain("red");

      // Complete a selection so this script doesn't stay armed in selection
      // mode — the jsdom document and its listeners persist across tests, so a
      // script left mid-selection would hijack the next test's click.
      document.dispatchEvent(
        new MouseEvent("mousemove", { clientX: c.x, clientY: c.y })
      );
      document.dispatchEvent(
        new MouseEvent("click", { clientX: c.x, clientY: c.y, bubbles: true })
      );
    });

    it("disarms selection when another frame selects (#13)", () => {
      const target = document.getElementById("target");
      browser.emit("SELECT_ELEMENT_CLICKED");
      const c = centerOf(target);
      document.dispatchEvent(
        new MouseEvent("mousemove", { clientX: c.x, clientY: c.y })
      );
      expect(target.style.border).toContain("red");

      // A sibling frame completed the selection — this frame disarms.
      browser.emit("STOP_SELECTION_MODE");
      expect(target.style.border).not.toContain("red");

      // A subsequent click must not select anything here.
      document.dispatchEvent(
        new MouseEvent("click", { clientX: c.x, clientY: c.y, bubbles: true })
      );
      expect(state().targets).toHaveLength(0);
    });

    it("removes a target and restores its highlight", () => {
      const target = document.getElementById("target");
      hoverAndSelect(target);
      expect(target.style.boxShadow).toContain("#b827fc");

      browser.emit({ removeTargetId: state().targets[0].id });
      expect(state().targets).toHaveLength(0);
      expect(target.style.boxShadow).toBe("");
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

    it("applies the configured default rate to new targets (#7)", () => {
      browser.emit({ setDefaultInterval: { seconds: 5 } });

      hoverAndSelect(document.getElementById("target"));
      expect(state().targets[0].intervalSeconds).toBe(5);
      // Persisted globally (so it follows the user), and reported back in state.
      expect(browser.__store.defaultIntervalMs).toBe(5000);
      expect(state().defaultIntervalSeconds).toBe(5);
    });

    it("ignores an invalid default rate (#7)", () => {
      browser.emit({ setDefaultInterval: { seconds: 0 } });
      hoverAndSelect(document.getElementById("target"));
      expect(state().targets[0].intervalSeconds).toBe(1); // unchanged default
    });

    it("clicks faster than the tick at a sub-second rate (#22)", () => {
      const target = document.getElementById("target");
      const clicks = countClicks(target);
      hoverAndSelect(target);
      browser.emit({
        setTargetInterval: { id: state().targets[0].id, seconds: 0.05 },
      }); // 50ms => 20 CPS, well below the tick cadence
      browser.emit("START_CLICKING");

      vi.advanceTimersByTime(500); // ~10 clicks at 50ms, via catch-up
      expect(clicks.mock.calls.length).toBeGreaterThanOrEqual(8);
    });

    it("suppresses the per-click flash above a few CPS (#22)", () => {
      const animate = vi.fn();
      const original = Element.prototype.animate;
      Element.prototype.animate = animate;
      try {
        const target = document.getElementById("target");
        hoverAndSelect(target);
        browser.emit({
          setTargetInterval: { id: state().targets[0].id, seconds: 0.05 },
        });
        browser.emit("START_CLICKING");
        vi.advanceTimersByTime(500);
        expect(animate).not.toHaveBeenCalled(); // gated at 50ms
      } finally {
        Element.prototype.animate = original;
      }
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
      place(fresh, 0, 0, 100, 40);
      const freshClicks = countClicks(fresh);

      vi.advanceTimersByTime(INTERVAL_MS * 2);
      expect(freshClicks).toHaveBeenCalledTimes(2);
      expect(fresh.style.boxShadow).toContain("#b827fc"); // highlight followed
    });

    it("plays a pulse animation on each click", () => {
      const animate = vi.fn();
      const original = Element.prototype.animate;
      Element.prototype.animate = animate;
      try {
        const target = document.getElementById("target");
        hoverAndSelect(target);
        browser.emit("START_CLICKING");
        vi.advanceTimersByTime(INTERVAL_MS * 2);
        expect(animate).toHaveBeenCalledTimes(2); // one per click
      } finally {
        Element.prototype.animate = original;
      }
    });

    it("does not click an element occluding the target's point (#35)", () => {
      const target = document.getElementById("target");
      hoverAndSelect(target);

      // An overlay covering the target's point wins the hit-test.
      const occluder = place(document.createElement("div"), 0, 0, 100, 40);
      document.body.appendChild(occluder);
      const occluderClicks = countClicks(occluder);

      browser.emit("START_CLICKING");
      vi.advanceTimersByTime(INTERVAL_MS * 2);

      expect(occluderClicks).not.toHaveBeenCalled();
      expect(state().targets[0].clickCount).toBe(0);
    });

    it("keeps clicking an element after it scrolls out of view (#5)", () => {
      const target = document.getElementById("target");
      const clicks = countClicks(target);
      hoverAndSelect(target);
      browser.emit("START_CLICKING");
      vi.advanceTimersByTime(INTERVAL_MS);
      expect(clicks).toHaveBeenCalledTimes(1);

      // Scroll the target far below the viewport — its click point is now
      // off-screen. Unlike an occluder (in viewport, blocked), an off-screen
      // element should keep being clicked directly.
      place(target, 0, window.innerHeight + 500, 100, 40);
      vi.advanceTimersByTime(INTERVAL_MS * 2);

      expect(clicks).toHaveBeenCalledTimes(3);
      expect(state().targets[0].clickCount).toBe(3);
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

  describe("crosshair targets (canvas/svg/video)", () => {
    function selectCanvas() {
      document.body.innerHTML = '<canvas id="game"></canvas>';
      const canvas = place(document.getElementById("game"), 20, 20, 200, 100);
      hoverAndSelect(canvas);
      return canvas;
    }

    it("marks a canvas with a crosshair, not a ring on the element", () => {
      const canvas = selectCanvas();
      expect(canvas.style.boxShadow).toBe("");
      const marker = document.querySelector(".clickster-crosshair");
      expect(marker).not.toBeNull();
      // Positioned at the picked point (the canvas centre).
      expect(marker.style.left).toBe("120px");
      expect(marker.style.top).toBe("70px");
    });

    it("drags the crosshair to reposition the point while stopped (#33)", () => {
      const canvas = selectCanvas(); // canvas at 20,20,200,100 → offset 0.5,0.5
      const handle = document.querySelector(".clickster-crosshair-handle");

      handle.dispatchEvent(
        new MouseEvent("mousedown", { clientX: 120, clientY: 70, bubbles: true })
      );
      // Drag to (60, 45): offset (60-20)/200=0.2, (45-20)/100=0.25.
      document.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 60, clientY: 45, bubbles: true })
      );
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

      const stored = browser.__store[SITE_KEY].targets;
      expect(stored[0].offsetX).toBeCloseTo(0.2);
      expect(stored[0].offsetY).toBeCloseTo(0.25);
      expect(canvas).toBeTruthy();
    });

    it("nudges the crosshair point with arrow keys while stopped (#33)", () => {
      selectCanvas(); // 200x100 canvas, offset 0.5,0.5, clicking stopped

      // 1px right: offsetX += 1/200.
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
      );
      expect(browser.__store[SITE_KEY].targets[0].offsetX).toBeCloseTo(0.5 + 1 / 200);

      // Shift+Down: 10px, offsetY += 10/100.
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          shiftKey: true,
          bubbles: true,
        })
      );
      expect(browser.__store[SITE_KEY].targets[0].offsetY).toBeCloseTo(0.5 + 10 / 100);
    });

    it("does not nudge while clicking is running (#33)", () => {
      selectCanvas();
      browser.emit("START_CLICKING");
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
      );
      expect(browser.__store[SITE_KEY].targets[0].offsetX).toBeCloseTo(0.5);
    });

    it("removes the crosshair when the target is removed", () => {
      selectCanvas();
      expect(document.querySelector(".clickster-crosshair")).not.toBeNull();
      browser.emit({ removeTargetId: state().targets[0].id });
      expect(document.querySelector(".clickster-crosshair")).toBeNull();
    });

    it("flashes the click-emphasis circle on each click", () => {
      const animate = vi.fn();
      const original = Element.prototype.animate;
      Element.prototype.animate = animate;
      try {
        selectCanvas();
        browser.emit("START_CLICKING");
        vi.advanceTimersByTime(INTERVAL_MS * 2);
        expect(animate).toHaveBeenCalledTimes(2);
      } finally {
        Element.prototype.animate = original;
      }
    });
  });

  describe("persistence across reload (#11)", () => {
    // A fresh script run against the same DOM is what a real reload looks like.
    // storage.local persists across it (carry the store, like real extension
    // storage), and the script's async init() must settle before we assert.
    async function reload() {
      vi.clearAllTimers();
      browser = installBrowserMock({ store: browser.__store });
      await loadAndInit();
    }

    it("resumes clicking after reload when it was running", async () => {
      const target = document.getElementById("target");
      hoverAndSelect(target);
      browser.emit("START_CLICKING");

      await reload();

      const clicks = countClicks(target);
      vi.advanceTimersByTime(INTERVAL_MS * 2);
      expect(clicks).toHaveBeenCalledTimes(2);
    });

    it("stays stopped after reload when it was not running", async () => {
      const target = document.getElementById("target");
      hoverAndSelect(target);
      browser.emit("START_CLICKING");
      browser.emit("STOP_CLICKING");

      await reload();

      const clicks = countClicks(target);
      vi.advanceTimersByTime(INTERVAL_MS * 2);
      expect(clicks).not.toHaveBeenCalled();
    });

    it("restores targets (with their interval) after reload", async () => {
      hoverAndSelect(document.getElementById("target"));
      browser.emit({
        setTargetInterval: { id: state().targets[0].id, seconds: 4 },
      });

      await reload();

      const s = state();
      expect(s.targets).toHaveLength(1);
      expect(s.targets[0].intervalSeconds).toBe(4);
    });

    it("does not resume after the last target is removed and reloaded", async () => {
      const target = document.getElementById("target");
      hoverAndSelect(target);
      browser.emit("START_CLICKING");
      browser.emit({ removeTargetId: state().targets[0].id });

      await reload();

      const clicks = countClicks(target);
      vi.advanceTimersByTime(INTERVAL_MS * 2);
      expect(clicks).not.toHaveBeenCalled();
    });
  });

  describe("resume toast", () => {
    async function reload() {
      vi.clearAllTimers();
      browser = installBrowserMock({ store: browser.__store });
      await loadAndInit();
    }
    const toast = () => document.getElementById("clickster-resume-toast");

    it("shows a sticky toast when clicking resumes after reload", async () => {
      hoverAndSelect(document.getElementById("target"));
      browser.emit("START_CLICKING");
      expect(toast()).toBeNull();

      await reload();
      expect(toast()).not.toBeNull();
      expect(toast().textContent).toContain("still auto-clicking");
    });

    it("does not show a toast when clicking did not resume", async () => {
      hoverAndSelect(document.getElementById("target"));
      browser.emit("START_CLICKING");
      browser.emit("STOP_CLICKING");

      await reload();
      expect(toast()).toBeNull();
    });

    it("its Stop button halts clicking and removes the toast", async () => {
      const target = document.getElementById("target");
      hoverAndSelect(target);
      browser.emit("START_CLICKING");
      await reload();

      document.getElementById("clickster-resume-toast-stop").click();
      expect(toast()).toBeNull();

      const clicks = countClicks(target);
      vi.advanceTimersByTime(INTERVAL_MS * 2);
      expect(clicks).not.toHaveBeenCalled();
      await reload();
      expect(toast()).toBeNull();
    });

    it("suppresses the toast permanently after 'Don't show again'", async () => {
      hoverAndSelect(document.getElementById("target"));
      browser.emit("START_CLICKING");
      await reload();

      const link = [...toast().querySelectorAll("a")].find((a) =>
        a.textContent.includes("Don't show again")
      );
      link.click();
      expect(browser.__store[SITE_KEY].hideResumeToast).toBe(true);

      await reload();
      expect(toast()).toBeNull();
    });
  });
});
