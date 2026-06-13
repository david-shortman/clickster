const isChrome = !window["browser"] && !!chrome;
// Prefer the more standard `browser` before Chrome API
const browser = isChrome ? chrome : window["browser"];
// Persisted so clicking survives the navigations and reloads it often triggers
// (a click on a "next" button reloads the page). Restored on load below.
let clicksterEnabled = localStorage.getItem("clicksterEnabled") === "true";

function setClicksterEnabled(enabled) {
  clicksterEnabled = enabled;
  localStorage.setItem("clicksterEnabled", enabled ? "true" : "false");
}

let isSelectionModeEnabled = false;
let clickInterval = localStorage.getItem("clicksterClickInterval");
if (!clickInterval) {
  clickInterval = 3000;
}
localStorage.setItem("clicksterClickInterval", clickInterval);

let clickerId,
  timeLastClicked,
  lastHoveredElement,
  shouldNextClickSelectAnElement,
  selectedElementsToClick = {};

const elementsThatWereDisabledOnPageLoad = document.body.querySelectorAll(
  "*:disabled"
);

let clientX, clientY, lastX, lastY;

function removeHoverHighlight(element) {
  if (element) {
    element.style.border = lastHoveredElementBorder;
  }
}

document.addEventListener("mousemove", (event) => {
  lastX = clientX;
  lastY = clientY;
  clientX = event.clientX;
  clientY = event.clientY;

  if (isSelectionModeEnabled) {
    const elementMouseIsOver = document.elementFromPoint(clientX, clientY);
    if (
      elementMouseIsOver !== document.body &&
      lastHoveredElement !== elementMouseIsOver
    ) {
      removeHoverHighlight(lastHoveredElement);

      shouldNextClickSelectAnElement = true;

      lastHoveredElementBorder = elementMouseIsOver.style.border;
      elementMouseIsOver.style.border = "thin solid red";
    }

    lastHoveredElement = elementMouseIsOver;
  }
});

function displayAsSelected(element) {
  element.style.border = "thick solid";
  element.style["border-image-source"] =
    "linear-gradient(to bottom right, #b827fc 0%, #2c90fc 25%, #b8fd33 50%, #fec837 75%, #fd1892 100%)";
  element.style["border-image-slice"] = 1;
}

function clickSelectedElements() {
  Object.values(selectedElementsToClick).forEach((element) => {
    if (element.ref.click) {
      element.ref.click();
      element.ref.style.border = "thick solid silver";
      setTimeout(() => displayAsSelected(element.ref), 500);
    }
  });
  timeLastClicked = new Date();
}

let idCounter = 0;
function getNextId() {
  idCounter += 1;
  return idCounter;
}

function targetElement(element) {
  if (!element.clicksterId) {
    element.clicksterId = getNextId();
  }
  selectedElementsToClick = {
    ...selectedElementsToClick,
    [element.clicksterId]: {
      originalBorder: element.style.border,
      originalBorderImageSource: element.style["border-image-source"],
      originalBorderImageSlice: element.style["border-image-slice"],
      ref: element,
    },
  };
  displayAsSelected(element);
}

function removeSelectedHighlight(element) {
  const {
    originalBorder,
    originalBorderImageSource,
    originalBorderImageSlice,
  } = selectedElementsToClick[element.ref.clicksterId];
  element.ref.style.border = originalBorder;
  element.ref.style["border-image"] = originalBorderImageSource;
  element.ref.style["border-image-slice"] = originalBorderImageSlice;
}

// Persist the current targets as CSS selectors so they can be re-resolved
// after a reload. Single selections and advanced queries share this store.
function persistTargets(selectors) {
  localStorage.setItem("clicksterTargets", JSON.stringify(selectors));
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

function setSelectedElement(event) {
  if (shouldNextClickSelectAnElement) {
    event.preventDefault();

    elementsThatWereDisabledOnPageLoad.forEach((elem) => {
      elem.disabled = true;
    });

    removeHoverHighlight(lastHoveredElement);
    Object.entries(selectedElementsToClick).forEach(([key, value]) => {
      removeSelectedHighlight(value);
      delete selectedElementsToClick[key];
    });

    const selectedElement = document.elementFromPoint(clientX, clientY);
    targetElement(selectedElement);
    persistTargets([cssPathFor(selectedElement)]);

    timeLastClicked = new Date();
    startClicking();

    isSelectionModeEnabled = false;
    shouldNextClickSelectAnElement = false;
  }
}

function startClicking() {
  if (clicksterEnabled) {
    clickerId = setInterval(clickSelectedElements, clickInterval);
  }
}

function stopClicking() {
  if (!!clickerId) {
    clearInterval(clickerId);
  }
}

document.addEventListener("keyup", (event) => {
  if (event.key === "Enter") {
    setSelectedElement(event);
  }
});
document.addEventListener("click", (event) => {
  setSelectedElement(event);
});

function sendTimeUntilClickResponse() {
  const now = new Date();
  const safeTimeLastClicked = !!timeLastClicked ? timeLastClicked : now;
  const timeSinceLastClick = now.getTime() - safeTimeLastClicked.getTime();
  const intervalDiff = clickInterval - timeSinceLastClick;
  browser.runtime.sendMessage({
    timeUntilClick: intervalDiff <= 0 ? clickInterval : intervalDiff,
  });
}

function sendIsElementSelectedResponse() {
  browser.runtime.sendMessage(
    Object.values(selectedElementsToClick).length > 0
      ? "ELEMENT_IS_SELECTED"
      : "NO_ELEMENT_IS_SELECTED"
  );
}

function sendClickIntervalResponse() {
  browser.runtime.sendMessage({
    clickInterval: Math.floor(clickInterval / 1000),
  });
}

function sendIsEnabled() {
  browser.runtime.sendMessage({
    clicksterEnabled: clicksterEnabled,
  });
}

function sendCachedQueryInfo() {
  const cachedQuery = localStorage.getItem("clicksterQuery");
  if (!!cachedQuery) {
    browser.runtime.sendMessage({
      clicksterCachedQuery: cachedQuery,
    });
  }
}

function updateClickInterval(newClickInterval) {
  clickInterval = newClickInterval * 1000;
  localStorage.setItem("clicksterClickInterval", clickInterval);
  stopClicking();
  startClicking();
}

function enableSelectionMode() {
  isSelectionModeEnabled = true;
  // selectedElementsToClick = null;
  stopClicking();

  elementsThatWereDisabledOnPageLoad.forEach((elem) => {
    elem.disabled = false;
  });
}

function manuallyClearSelectedElements() {
  stopClicking();
  setClicksterEnabled(false);
  timeLastClicked = null;
  Object.entries(selectedElementsToClick).forEach(([key, value]) => {
    removeSelectedHighlight(value);
    delete selectedElementsToClick[key];
  });
  localStorage.removeItem("clicksterQuery");
  localStorage.removeItem("clicksterTargets");
}

function applyQuery(query) {
  localStorage.setItem("clicksterQuery", query);
  lastQuery = query;
  const elementSelectors = query.split("\n");
  persistTargets(elementSelectors);
  const selectedElements = elementSelectors.map((selector) => [
    ...document.body.querySelectorAll(selector),
  ]);
  const flattened = selectedElements.flat();
  flattened.forEach((element) => {
    targetElement(element);
  });
  stopClicking();
  startClicking();
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
  let selectors = [];
  const storedTargets = localStorage.getItem("clicksterTargets");
  if (storedTargets) {
    try {
      selectors = JSON.parse(storedTargets);
    } catch (e) {
      selectors = [];
    }
  }
  // Fall back to the older query-only state so existing users keep their target.
  if (selectors.length === 0) {
    const cachedQuery = localStorage.getItem("clicksterQuery");
    if (cachedQuery) {
      selectors = cachedQuery.split("\n");
    }
  }
  selectors.forEach((selector) => {
    try {
      document.body.querySelectorAll(selector).forEach((element) => {
        targetElement(element);
      });
    } catch (e) {
      // Ignore selectors that no longer parse or match on this page.
    }
  });
  if (Object.keys(selectedElementsToClick).length > 0) {
    startClicking();
    if (clicksterEnabled) {
      showResumeToast();
    }
  }
}

browser.runtime.onMessage.addListener(function (message) {
  if (message === "GET_TIME_UNTIL_CLICK") {
    sendTimeUntilClickResponse();
  } else if (message === "IS_ELEMENT_SELECTED") {
    sendIsElementSelectedResponse();
  } else if (message === "GET_CLICK_INTERVAL") {
    sendClickIntervalResponse();
  } else if (message.newClickInterval) {
    updateClickInterval(message.newClickInterval);
  } else if (message === "SELECT_ELEMENT_CLICKED") {
    enableSelectionMode();
  } else if (message === "CLEAR_SELECTED_ELEMENT") {
    manuallyClearSelectedElements();
  } else if (message.advancedQuery) {
    applyQuery(message.advancedQuery);
  } else if (message === "STOP_CLICKING") {
    setClicksterEnabled(false);
    stopClicking();
  } else if (message === "START_CLICKING") {
    setClicksterEnabled(true);
    startClicking();
  } else if (message === "GET_IS_CLICKSTER_ENABLED") {
    sendIsEnabled();
  } else if (message === "GET_CLICKSTER_CACHED_QUERY") {
    sendCachedQueryInfo();
  }
});

restoreTargets();
