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

function displayAsSelected(element) {
  element.style.boxShadow = SELECTED_SHADOW;
}

function restoreHighlight(target) {
  if (!target.ref) return;
  target.ref.style.boxShadow = target.originalBoxShadow;
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
      }))
    )
  );
}

function addTarget(element, options) {
  options = options || {};
  if (!element || targets.some((t) => t.ref === element)) return;
  targets.push({
    id: getNextId(),
    selector: options.selector || cssPathFor(element),
    label: labelFor(element),
    ref: element,
    intervalMs: options.intervalMs || DEFAULT_INTERVAL_MS,
    clickCount: 0,
    lastClickedAt: Date.now(),
    paused: !!options.paused,
    originalBoxShadow: element.style.boxShadow,
  });
  displayAsSelected(element);
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

function flashClicked(target) {
  if (!target.ref) return;
  target.ref.style.boxShadow = "0 0 0 3px silver";
  setTimeout(() => {
    if (targets.indexOf(target) !== -1) displayAsSelected(target.ref);
  }, TICK_MS);
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
    displayAsSelected(found);
  }
  return found;
}

function tick() {
  if (!clicksterEnabled) return;
  const now = Date.now();
  targets.forEach((target) => {
    if (target.paused) return;
    const ref = resolveTarget(target);
    if (!ref || !ref.click) return;
    if (now - target.lastClickedAt >= target.intervalMs) {
      ref.click();
      target.clickCount += 1;
      target.lastClickedAt = now;
      flashClicked(target);
    }
  });
}

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
  // from the popup), rather than replacing the previous one.
  addTarget(document.elementFromPoint(clientX, clientY));
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
    try {
      document.body.querySelectorAll(selector).forEach((element) => {
        addTarget(element, { selector, intervalMs, paused });
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

browser.runtime.onMessage.addListener(function (message) {
  if (message === "GET_STATE") {
    sendState();
  } else if (message === "SELECT_ELEMENT_CLICKED") {
    enableSelectionMode();
  } else if (message === "START_CLICKING") {
    setClicksterEnabled(true);
    const now = Date.now();
    targets.forEach((target) => {
      target.lastClickedAt = now;
    });
    startClicking();
  } else if (message === "STOP_CLICKING") {
    setClicksterEnabled(false);
    stopClicking();
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
