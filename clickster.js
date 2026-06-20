const isChrome = !window["browser"] && !!chrome;
// Prefer the more standard `browser` before Chrome API
const browser = isChrome ? chrome : window["browser"];

const TICK_MS = 200;
const DEFAULT_INTERVAL_MS = 1000;

// The selected highlight is a box-shadow ring rather than a border so it hugs
// the element's own border-radius (border-image ignores border-radius) and
// adds no layout shift. Concentric rings keep the rainbow identity.
const SELECTED_SHADOW =
  "0 0 0 1px #b827fc, 0 0 0 2px #2c90fc, 0 0 0 3px #b8fd33, " +
  "0 0 0 4px #fec837, 0 0 0 5px #fd1892";
// The mid-keyframe of the click pulse: the same rings, bulged outward a touch,
// so each click gives a subtle "pressed and springing back" feel.
const PRESSED_SHADOW =
  "0 0 0 1px #b827fc, 0 0 0 2px #2c90fc, 0 0 0 4px #b8fd33, " +
  "0 0 0 6px #fec837, 0 0 0 8px #fd1892";

// Persisted so clicking survives the navigations and reloads it often triggers
// (a click on a "next" button reloads the page). Restored on load below.
let clicksterEnabled = localStorage.getItem("clicksterEnabled") === "true";

function setClicksterEnabled(enabled) {
  clicksterEnabled = enabled;
  localStorage.setItem("clicksterEnabled", enabled ? "true" : "false");
}

// Each entry: { id, selector, label, ref, intervalMs, clickCount,
//               lastClickedAt, paused, originalBorder, ... }
let targets = [];
let tickerId = null;
let isSelectionModeEnabled = false;
let lastHoveredElement, lastHoveredElementBorder, shouldNextClickSelectAnElement;
let clientX, clientY;

const elementsThatWereDisabledOnPageLoad =
  document.body.querySelectorAll("*:disabled");

let idCounter = 0;
function getNextId() {
  idCounter += 1;
  return idCounter;
}

function removeHoverHighlight(element) {
  if (element) {
    element.style.border = lastHoveredElementBorder;
  }
}

document.addEventListener("mousemove", (event) => {
  clientX = event.clientX;
  clientY = event.clientY;

  if (isSelectionModeEnabled) {
    const elementMouseIsOver = document.elementFromPoint(clientX, clientY);
    if (lastHoveredElement !== elementMouseIsOver) {
      // Always clear the previously highlighted element first — including when
      // moving onto the page background — so red borders aren't left behind in
      // the gaps between elements.
      removeHoverHighlight(lastHoveredElement);
      if (elementMouseIsOver && elementMouseIsOver !== document.body) {
        shouldNextClickSelectAnElement = true;
        lastHoveredElementBorder = elementMouseIsOver.style.border;
        elementMouseIsOver.style.border = "thin solid red";
        lastHoveredElement = elementMouseIsOver;
      } else {
        shouldNextClickSelectAnElement = false;
        lastHoveredElement = null;
      }
    }
  }
});

const RAINBOW_GRADIENT =
  "linear-gradient(135deg, #b827fc, #2c90fc, #b8fd33, #fec837, #fd1892)";

// Canvas/SVG/video render their own content and read mouse coordinates, so a
// border ring around the whole element is meaningless — mark the exact point
// with a crosshair instead.
function isCrosshairTarget(element) {
  if (element.namespaceURI === "http://www.w3.org/2000/svg") return true;
  const tag = element.tagName ? element.tagName.toUpperCase() : "";
  return (
    tag === "CANVAS" || tag === "VIDEO" || tag === "OBJECT" || tag === "EMBED"
  );
}

function markerPointFor(target) {
  const ref = target.ref && target.ref.isConnected ? target.ref : null;
  if (!ref || !ref.getBoundingClientRect) return null;
  const rect = ref.getBoundingClientRect();
  return {
    x: rect.left + target.offsetX * rect.width,
    y: rect.top + target.offsetY * rect.height,
  };
}

function positionMarker(target) {
  if (!target.markerEl) return;
  const point = markerPointFor(target);
  if (!point) return;
  target.markerEl.style.left = point.x + "px";
  target.markerEl.style.top = point.y + "px";
}

// A rainbow crosshair overlay at the target point. pointer-events:none so it
// never intercepts the very clicks it marks (elementFromPoint skips it).
function createMarker(target) {
  const marker = document.createElement("div");
  marker.className = "clickster-crosshair";
  // The container is 0x0 (no hit area); its parts are pointer-events:none so
  // they never intercept the clicks they mark. Only the drag handle becomes
  // interactive, and only while clicking is stopped.
  marker.style.cssText =
    "position:fixed;left:0;top:0;width:0;height:0;z-index:2147483646;";
  const hbar = document.createElement("div");
  hbar.style.cssText =
    "position:absolute;left:-16px;top:-1.5px;width:32px;height:3px;border-radius:2px;pointer-events:none;background:" +
    RAINBOW_GRADIENT;
  const vbar = document.createElement("div");
  vbar.style.cssText =
    "position:absolute;left:-1.5px;top:-16px;width:3px;height:32px;border-radius:2px;pointer-events:none;background:" +
    RAINBOW_GRADIENT;
  // A fixed-size circle that flashes on each click (the click emphasis).
  const pulse = document.createElement("div");
  pulse.className = "clickster-crosshair-pulse";
  pulse.style.cssText =
    "position:absolute;left:-13px;top:-13px;width:26px;height:26px;border-radius:50%;opacity:0;pointer-events:none;box-shadow:" +
    SELECTED_SHADOW;
  // Transparent drag handle to nudge the exact pixel (only while stopped).
  const handle = document.createElement("div");
  handle.className = "clickster-crosshair-handle";
  handle.style.cssText =
    "position:absolute;left:-18px;top:-18px;width:36px;height:36px;border-radius:50%;cursor:move;pointer-events:" +
    (clicksterEnabled ? "none" : "auto");
  handle.addEventListener("mousedown", (event) => {
    if (clicksterEnabled) return;
    event.preventDefault();
    event.stopPropagation();
    draggingTarget = target;
  });
  marker.appendChild(pulse);
  marker.appendChild(hbar);
  marker.appendChild(vbar);
  marker.appendChild(handle);
  document.body.appendChild(marker);
  target.markerEl = marker;
  positionMarker(target);
}

// While a crosshair handle is grabbed, move the point with the cursor and
// recompute its offset within the anchor.
let draggingTarget = null;
document.addEventListener("mousemove", (event) => {
  if (!draggingTarget || !draggingTarget.ref) return;
  const rect = draggingTarget.ref.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  draggingTarget.offsetX = clamp01((event.clientX - rect.left) / rect.width);
  draggingTarget.offsetY = clamp01((event.clientY - rect.top) / rect.height);
  positionMarker(draggingTarget);
});
document.addEventListener("mouseup", () => {
  if (draggingTarget) {
    persistTargets();
    draggingTarget = null;
  }
});

function setMarkersInteractive(interactive) {
  targets.forEach((t) => {
    if (!t.markerEl) return;
    const handle = t.markerEl.querySelector(".clickster-crosshair-handle");
    if (handle) handle.style.pointerEvents = interactive ? "auto" : "none";
  });
}

function removeMarker(target) {
  if (target.markerEl) {
    target.markerEl.remove();
    target.markerEl = null;
  }
}

function displayAsSelected(target) {
  if (target.crosshair) {
    if (!target.markerEl) createMarker(target);
    else positionMarker(target);
    return;
  }
  if (target.ref) target.ref.style.boxShadow = SELECTED_SHADOW;
}

function restoreHighlight(target) {
  if (target.crosshair) {
    removeMarker(target);
    return;
  }
  if (target.ref) target.ref.style.boxShadow = target.originalBoxShadow;
}

function cssEscape(value) {
  if (typeof CSS !== "undefined" && CSS && CSS.escape) {
    return CSS.escape(value);
  }
  // Fallback for runtimes without CSS.escape (e.g. the jsdom test env).
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

// Build a reasonably unique selector for a clicked element: its id when it has
// one, otherwise an :nth-of-type path up to the nearest id-rooted ancestor.
function cssPathFor(element) {
  if (element.id) {
    return "#" + cssEscape(element.id);
  }
  const path = [];
  let node = element;
  while (node && node.nodeType === 1 && node !== document.body) {
    if (node.id) {
      path.unshift("#" + cssEscape(node.id));
      break;
    }
    let segment = node.tagName.toLowerCase();
    const parent = node.parentNode;
    if (parent) {
      const twins = Array.prototype.filter.call(
        parent.children,
        (child) => child.tagName === node.tagName
      );
      if (twins.length > 1) {
        segment += ":nth-of-type(" + (twins.indexOf(node) + 1) + ")";
      }
    }
    path.unshift(segment);
    node = parent;
  }
  return path.join(" > ");
}

// A human-friendly name for the target list — the user picked it visually, so
// show its text rather than a CSS selector.
function labelFor(element) {
  const text = (element.textContent || "").trim().replace(/\s+/g, " ");
  if (text) return text.length > 28 ? text.slice(0, 28) + "…" : text;
  if (element.id) return "#" + element.id;
  const aria = element.getAttribute && element.getAttribute("aria-label");
  if (aria) return aria;
  return element.tagName ? element.tagName.toLowerCase() : "element";
}

function persistTargets() {
  localStorage.setItem(
    "clicksterTargets",
    JSON.stringify(
      targets.map((t) => ({
        selector: t.selector,
        intervalMs: t.intervalMs,
        paused: t.paused,
        offsetX: t.offsetX,
        offsetY: t.offsetY,
      }))
    )
  );
}

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

// Where, within an element, a click point sits — as a 0..1 fraction of its box
// so it survives the element moving or resizing. Defaults to the center.
function offsetWithin(element, point) {
  const rect = element.getBoundingClientRect();
  if (!point || !rect.width || !rect.height) {
    return { x: 0.5, y: 0.5 };
  }
  return {
    x: clamp01((point.x - rect.left) / rect.width),
    y: clamp01((point.y - rect.top) / rect.height),
  };
}

function addTarget(element, options) {
  options = options || {};
  if (!element) return;

  let offsetX = 0.5;
  let offsetY = 0.5;
  if (typeof options.offsetX === "number") {
    offsetX = options.offsetX;
    offsetY = options.offsetY;
  } else if (options.point) {
    const offset = offsetWithin(element, options.point);
    offsetX = offset.x;
    offsetY = offset.y;
  }

  // Dedupe by element + point so the same button isn't added twice, while still
  // allowing several distinct points on one element (e.g. a <canvas>).
  if (
    targets.some(
      (t) =>
        t.ref === element &&
        Math.abs(t.offsetX - offsetX) < 0.02 &&
        Math.abs(t.offsetY - offsetY) < 0.02
    )
  ) {
    return;
  }

  const target = {
    id: getNextId(),
    selector: options.selector || cssPathFor(element),
    label: labelFor(element),
    ref: element,
    intervalMs: options.intervalMs || DEFAULT_INTERVAL_MS,
    clickCount: 0,
    lastClickedAt: Date.now(),
    paused: !!options.paused,
    offsetX,
    offsetY,
    crosshair: isCrosshairTarget(element),
    markerEl: null,
    originalBoxShadow: element.style.boxShadow,
  };
  targets.push(target);
  displayAsSelected(target);
}

function removeTarget(id) {
  const index = targets.findIndex((t) => t.id === id);
  if (index === -1) return;
  const [removed] = targets.splice(index, 1);
  restoreHighlight(removed);
  persistTargets();
  if (targets.length === 0) {
    setClicksterEnabled(false);
    stopClicking();
  }
}

function setTargetInterval(id, seconds) {
  const target = targets.find((t) => t.id === id);
  if (!target) return;
  const value = Number(seconds);
  if (!isFinite(value) || value <= 0) return;
  target.intervalMs = value * 1000;
  persistTargets();
}

function setTargetPaused(id, paused) {
  const target = targets.find((t) => t.id === id);
  if (!target) return;
  target.paused = !!paused;
  if (!target.paused) {
    target.lastClickedAt = Date.now();
  }
  persistTargets();
}

// Scroll the element into view and flash an outline so the user can locate the
// target on the page (the "show" / eyeball action in the popup).
function showTarget(id) {
  const target = targets.find((t) => t.id === id);
  if (!target || !target.ref) return;
  try {
    if (target.ref.scrollIntoView) {
      target.ref.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  } catch (e) {
    // scrollIntoView is unavailable in some environments; the flash still runs.
  }
  const previousOutline = target.ref.style.outline;
  const previousOffset = target.ref.style.outlineOffset;
  target.ref.style.outline = "4px solid #b8fd33";
  target.ref.style.outlineOffset = "2px";
  setTimeout(() => {
    if (!target.ref) return;
    target.ref.style.outline = previousOutline;
    target.ref.style.outlineOffset = previousOffset;
  }, 1200);
}

// A smooth "squish" on each click. For a crosshair target it's a fixed-size
// circle flashing around the crosshair; otherwise the box-shadow ring bulges.
// Uses the Web Animations API (a no-op where animate is unavailable).
function pulseClicked(target) {
  if (target.crosshair) {
    const pulse = target.markerEl
      ? target.markerEl.querySelector(".clickster-crosshair-pulse")
      : null;
    if (pulse && pulse.animate) {
      pulse.animate(
        [{ opacity: 0 }, { opacity: 0.95, offset: 0.15 }, { opacity: 0 }],
        { duration: 320, easing: "ease-out" }
      );
    }
    return;
  }
  const element = target.ref;
  if (!element || !element.animate) return;
  element.animate(
    [
      { boxShadow: SELECTED_SHADOW },
      { boxShadow: PRESSED_SHADOW, offset: 0.4 },
      { boxShadow: SELECTED_SHADOW },
    ],
    { duration: 260, easing: "ease-out" }
  );
}

// Keep the target pointing at the live element. When a page re-renders a node
// (SPA updates, the respawning-button case), the stored ref detaches; re-find
// it by selector and move the highlight to the live element (issue #12).
function resolveTarget(target) {
  if (target.ref && target.ref.isConnected) {
    return target.ref;
  }
  let found = null;
  try {
    found = document.querySelector(target.selector);
  } catch (e) {
    found = null;
  }
  if (found) {
    target.ref = found;
    target.originalBoxShadow = found.style.boxShadow;
    displayAsSelected(target);
  }
  return found;
}

// Click via real coordinate-bearing events at (clientX, clientY) — not
// element.click() — so it works for canvas/coordinate games and for sites that
// ignore synthetic clicks. Dispatches on whatever element is actually at the
// point. Events are isTrusted:false (not an anti-cheat bypass).
function dispatchClickAt(clientX, clientY, anchor) {
  const target = document.elementFromPoint(clientX, clientY);
  if (!target || typeof target.dispatchEvent !== "function") return false;
  // Skip if the anchor isn't actually at this point — scrolled off-screen, or
  // hidden behind a modal/overlay — so we never click the wrong element.
  if (anchor && anchor !== target && !anchor.contains(target)) return false;
  const base = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX,
    clientY,
    screenX: clientX,
    screenY: clientY,
    button: 0,
  };
  const hasPointer = typeof PointerEvent === "function";
  const pointer = (buttons) => ({
    ...base,
    buttons,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
  });
  if (hasPointer) target.dispatchEvent(new PointerEvent("pointerdown", pointer(1)));
  target.dispatchEvent(new MouseEvent("mousedown", { ...base, buttons: 1 }));
  if (hasPointer) target.dispatchEvent(new PointerEvent("pointerup", pointer(0)));
  target.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0 }));
  target.dispatchEvent(new MouseEvent("click", { ...base, buttons: 0 }));
  return true;
}

function tick() {
  if (!clicksterEnabled) return;
  const now = Date.now();
  targets.forEach((target) => {
    if (target.paused) return;
    const ref = resolveTarget(target);
    if (!ref || !ref.getBoundingClientRect) return;
    const rect = ref.getBoundingClientRect();
    const x = rect.left + target.offsetX * rect.width;
    const y = rect.top + target.offsetY * rect.height;
    // Keep the crosshair following the point (scroll, resize, re-render).
    if (target.crosshair && target.markerEl) {
      target.markerEl.style.left = x + "px";
      target.markerEl.style.top = y + "px";
    }
    if (now - target.lastClickedAt >= target.intervalMs) {
      // Only count it if the click actually reached the target; otherwise
      // (off-screen / occluded) leave it due and retry next tick.
      if (dispatchClickAt(x, y, ref)) {
        target.clickCount += 1;
        target.lastClickedAt = now;
        pulseClicked(target);
      }
    }
  });
}

// Crosshairs also follow scroll while clicking is stopped.
window.addEventListener(
  "scroll",
  () => {
    targets.forEach(positionMarker);
  },
  true
);

function startClicking() {
  if (clicksterEnabled && !tickerId) {
    tickerId = setInterval(tick, TICK_MS);
  }
}

function stopClicking() {
  if (tickerId) {
    clearInterval(tickerId);
    tickerId = null;
  }
}

function enableSelectionMode() {
  isSelectionModeEnabled = true;
  stopClicking();
  elementsThatWereDisabledOnPageLoad.forEach((elem) => {
    elem.disabled = false;
  });
}

function setSelectedElement(event) {
  if (!shouldNextClickSelectAnElement) return;
  event.preventDefault();

  elementsThatWereDisabledOnPageLoad.forEach((elem) => {
    elem.disabled = true;
  });
  removeHoverHighlight(lastHoveredElement);

  // Additive: each selection adds a target to the list (removed individually
  // from the popup), rather than replacing the previous one. The point the user
  // clicked becomes the target's offset within the element.
  addTarget(document.elementFromPoint(clientX, clientY), {
    point: { x: clientX, y: clientY },
  });
  persistTargets();

  isSelectionModeEnabled = false;
  shouldNextClickSelectAnElement = false;
  startClicking();
}

document.addEventListener("keyup", (event) => {
  if (event.key === "Enter") {
    setSelectedElement(event);
  }
});
document.addEventListener("click", (event) => {
  setSelectedElement(event);
});

function sendState() {
  const now = Date.now();
  browser.runtime.sendMessage({
    clicksterState: {
      enabled: clicksterEnabled,
      targets: targets.map((t) => ({
        id: t.id,
        label: t.label,
        intervalSeconds: t.intervalMs / 1000,
        clickCount: t.clickCount,
        paused: t.paused,
        nextClickMs: t.paused
          ? null
          : clicksterEnabled
          ? Math.max(0, t.intervalMs - (now - t.lastClickedAt))
          : t.intervalMs,
      })),
    },
  });
}

function dismissResumeToast() {
  const existing = document.getElementById("clickster-resume-toast");
  if (existing) {
    existing.remove();
  }
}

// Sticky on-page banner shown when clicking silently resumes after a reload,
// so it's never a mystery why a page is clicking itself. Stays until the user
// acts (it is not auto-dismissed).
function showResumeToast() {
  if (localStorage.getItem("clicksterHideResumeToast") === "true") return;
  if (!document.body || document.getElementById("clickster-resume-toast")) {
    return;
  }

  const toast = document.createElement("div");
  toast.id = "clickster-resume-toast";
  toast.setAttribute("role", "status");
  toast.style.cssText =
    "position:fixed;bottom:16px;right:16px;z-index:2147483647;max-width:320px;" +
    "padding:14px 16px;background:#160644;color:#f4f0ff;border:2px solid #b8fd33;" +
    "border-radius:10px;font-family:Helvetica,Arial,sans-serif;font-size:13px;" +
    "line-height:1.4;box-shadow:0 6px 24px rgba(0,0,0,0.4)";

  const message = document.createElement("div");
  message.textContent = "Clickster is still auto-clicking on this page.";
  message.style.cssText = "margin-bottom:10px;font-weight:bold";

  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:8px;align-items:center";

  const stopButton = document.createElement("button");
  stopButton.id = "clickster-resume-toast-stop";
  stopButton.textContent = "Stop";
  stopButton.style.cssText =
    "background:#bf16ab;color:#fff;border:none;border-radius:5px;" +
    "padding:6px 12px;font-size:13px;cursor:pointer";
  stopButton.addEventListener("click", () => {
    setClicksterEnabled(false);
    stopClicking();
    dismissResumeToast();
  });

  const keepButton = document.createElement("button");
  keepButton.textContent = "Keep clicking";
  keepButton.style.cssText =
    "background:transparent;color:#cfc8f5;border:1px solid rgba(255,255,255,0.3);" +
    "border-radius:5px;padding:6px 12px;font-size:13px;cursor:pointer";
  keepButton.addEventListener("click", dismissResumeToast);

  const hideLink = document.createElement("a");
  hideLink.textContent = "Don't show again";
  hideLink.href = "#";
  hideLink.style.cssText =
    "color:#9189c0;font-size:12px;margin-left:auto;text-decoration:underline;cursor:pointer";
  hideLink.addEventListener("click", (event) => {
    event.preventDefault();
    localStorage.setItem("clicksterHideResumeToast", "true");
    dismissResumeToast();
  });

  actions.appendChild(stopButton);
  actions.appendChild(keepButton);
  actions.appendChild(hideLink);
  toast.appendChild(message);
  toast.appendChild(actions);
  document.body.appendChild(toast);
}

// Re-resolve persisted target selectors after a page load and resume clicking
// if it was running. This is what makes clicking survive a reload (issue #11).
function restoreTargets() {
  let stored = [];
  const raw = localStorage.getItem("clicksterTargets");
  if (raw) {
    try {
      stored = JSON.parse(raw);
    } catch (e) {
      stored = [];
    }
  }
  stored.forEach((entry) => {
    // Tolerate the older format, which stored bare selector strings.
    const selector = typeof entry === "string" ? entry : entry.selector;
    if (!selector) return;
    const intervalMs =
      typeof entry === "object" && entry.intervalMs
        ? entry.intervalMs
        : DEFAULT_INTERVAL_MS;
    const paused = typeof entry === "object" ? !!entry.paused : false;
    const offsetX = typeof entry === "object" ? entry.offsetX : undefined;
    const offsetY = typeof entry === "object" ? entry.offsetY : undefined;
    try {
      document.body.querySelectorAll(selector).forEach((element) => {
        addTarget(element, { selector, intervalMs, paused, offsetX, offsetY });
      });
    } catch (e) {
      // Ignore selectors that no longer parse or match on this page.
    }
  });
  // Fall back to the older query-only state so existing users keep their target.
  if (targets.length === 0) {
    const cachedQuery = localStorage.getItem("clicksterQuery");
    if (cachedQuery) {
      cachedQuery.split("\n").forEach((selector) => {
        try {
          document.body.querySelectorAll(selector).forEach((element) => {
            addTarget(element, { selector });
          });
        } catch (e) {
          // ignore
        }
      });
    }
  }
  if (targets.length > 0) {
    startClicking();
    if (clicksterEnabled) {
      showResumeToast();
    }
  }
}

browser.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message === "PING") {
    // Reachability probe (the background worker uses it to avoid injecting a
    // second copy of this script into a tab that already has one).
    if (sendResponse) sendResponse(true);
  } else if (message === "GET_STATE") {
    sendState();
  } else if (message === "SELECT_ELEMENT_CLICKED") {
    enableSelectionMode();
  } else if (message === "START_CLICKING") {
    setClicksterEnabled(true);
    const now = Date.now();
    targets.forEach((target) => {
      target.lastClickedAt = now;
    });
    setMarkersInteractive(false);
    startClicking();
  } else if (message === "STOP_CLICKING") {
    setClicksterEnabled(false);
    stopClicking();
    setMarkersInteractive(true);
  } else if (message && message.removeTargetId !== undefined) {
    removeTarget(message.removeTargetId);
  } else if (message && message.setTargetInterval) {
    setTargetInterval(
      message.setTargetInterval.id,
      message.setTargetInterval.seconds
    );
  } else if (message && message.pauseTarget) {
    setTargetPaused(message.pauseTarget.id, message.pauseTarget.paused);
  } else if (message && message.showTargetId !== undefined) {
    showTarget(message.showTargetId);
  }
});

restoreTargets();
