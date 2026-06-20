const isChrome = !window["browser"] && !!chrome;
// Prefer the more standard `browser` before Chrome API
const browser = isChrome ? chrome : window["browser"];

// E2E test hook: WebDriver can't open the real browser-action popup, so tests
// load this page as a tab with ?tabId=<target> to pin which tab gets messaged.
const testTabId = new URLSearchParams(window.location.search).get("tabId");

const HOST_ORIGINS = ["*://*/*"];

// The tab to message: the one pinned by ?tabId in tests, else the active tab.
function targetTabId() {
  if (testTabId !== null) return Promise.resolve(Number(testTabId));
  if (isChrome) {
    return new Promise(function (resolve) {
      browser.tabs.query({ currentWindow: true, active: true }, function (tabs) {
        resolve(tabs[0] && tabs[0].id);
      });
    });
  }
  return browser.tabs
    .query({ currentWindow: true, active: true })
    .then(function (tabs) {
      return tabs[0] && tabs[0].id;
    });
}

// Deliver a message to the page's content script. Rejects when no content
// script is there to receive it (e.g. before access is granted on this page);
// callers decide whether that matters.
function deliver(message) {
  return targetTabId().then(function (tabId) {
    if (tabId == null || tabId < 0) throw new Error("no target tab");
    if (isChrome) {
      return new Promise(function (resolve, reject) {
        browser.tabs.sendMessage(tabId, message, function () {
          const err = browser.runtime && browser.runtime.lastError;
          if (err) reject(err);
          else resolve();
        });
      });
    }
    return browser.tabs.sendMessage(tabId, message);
  });
}

// Fire-and-forget: state polling and control messages don't care if the
// content script isn't reachable yet.
function send(message) {
  deliver(message).catch(function () {});
}

function sendRuntime(message) {
  if (isChrome) {
    return new Promise(function (resolve, reject) {
      browser.runtime.sendMessage(message, function (response) {
        const err = browser.runtime && browser.runtime.lastError;
        if (err) reject(err);
        else resolve(response);
      });
    });
  }
  return browser.runtime.sendMessage(message);
}

// "Select an element" / "Add another target". Ask for host access (a one-time
// prompt that resolves instantly once granted), then let the background worker
// inject and arm the content script. Falls back to messaging the page directly
// for the broad dev/E2E build, which has no background worker and auto-injects
// the content script via the manifest.
async function armSelection() {
  if (browser.permissions && browser.permissions.request) {
    try {
      await browser.permissions.request({ origins: HOST_ORIGINS });
    } catch (e) {
      // Origin isn't optional in this build, or the prompt was dismissed.
    }
  }
  let armed = false;
  try {
    const message = { clicksterArm: true };
    // E2E: pin the worker to the page-under-test (WebDriver can't open the
    // real browser-action popup, so the popup tab is the "active" one).
    if (testTabId !== null) message.tabId = Number(testTabId);
    armed = await sendRuntime(message);
  } catch (e) {
    armed = false;
  }
  if (!armed) {
    send("SELECT_ELEMENT_CLICKED");
  }
  window.close();
}

document
  .getElementById("select-element-btn")
  .addEventListener("click", armSelection);
document
  .getElementById("add-target-btn")
  .addEventListener("click", armSelection);
document
  .getElementById("start-btn")
  .addEventListener("click", () => send("START_CLICKING"));
document
  .getElementById("stop-btn")
  .addEventListener("click", () => send("STOP_CLICKING"));

const settings = document.getElementById("settings");
document
  .getElementById("settings-btn")
  .addEventListener("click", () => settings.classList.toggle("hidden"));
const defaultInput = document.getElementById("default-interval");
defaultInput.addEventListener("change", () =>
  send({ setDefaultInterval: { seconds: defaultInput.value } })
);

const list = document.getElementById("targets-list");
let renderedIds = "";

function buildRow(target) {
  const row = document.createElement("div");
  row.className = "target";
  row.dataset.id = target.id;

  const head = document.createElement("div");
  head.className = "target-head";

  const label = document.createElement("span");
  label.className = "target-label";
  label.textContent = target.label;

  const showBtn = document.createElement("button");
  showBtn.className = "icon-btn show-btn";
  showBtn.textContent = "\u{1F441}";
  showBtn.title = "Show on page";
  showBtn.setAttribute("aria-label", "Show on page");
  showBtn.addEventListener("click", () => send({ showTargetId: target.id }));

  const pauseBtn = document.createElement("button");
  pauseBtn.className = "icon-btn pause-btn";
  pauseBtn.addEventListener("click", () =>
    send({
      pauseTarget: { id: target.id, paused: row.dataset.paused !== "true" },
    })
  );

  const removeBtn = document.createElement("button");
  removeBtn.className = "icon-btn remove-btn";
  removeBtn.textContent = "\u2715";
  removeBtn.title = "Remove";
  removeBtn.setAttribute("aria-label", "Remove target");
  removeBtn.addEventListener("click", () => send({ removeTargetId: target.id }));

  head.append(label, showBtn, pauseBtn, removeBtn);

  const stats = document.createElement("div");
  stats.className = "target-stats";
  const count = document.createElement("span");
  count.className = "count";
  const countdown = document.createElement("span");
  countdown.className = "countdown";
  stats.append(count, countdown);

  const freq = document.createElement("div");
  freq.className = "freq";
  const freqInput = document.createElement("input");
  freqInput.type = "number";
  freqInput.min = "1";
  freqInput.className = "freq-input";
  freqInput.addEventListener("change", () =>
    send({ setTargetInterval: { id: target.id, seconds: freqInput.value } })
  );
  freq.append(
    document.createTextNode("every "),
    freqInput,
    document.createTextNode(" s")
  );

  row.append(head, stats, freq);
  return row;
}

function updateRow(row, target) {
  row.dataset.paused = target.paused ? "true" : "false";
  row.querySelector(".count").textContent = target.clickCount + " clicks";
  row.querySelector(".countdown").textContent = target.paused
    ? "paused"
    : "next in " + ((target.nextClickMs || 0) / 1000).toFixed(1) + "s";
  const pauseBtn = row.querySelector(".pause-btn");
  pauseBtn.textContent = target.paused ? "\u25B6" : "\u23F8";
  pauseBtn.title = target.paused ? "Resume" : "Pause";
  pauseBtn.setAttribute("aria-label", target.paused ? "Resume" : "Pause");
  // Don't clobber the field while the user is editing it.
  const freqInput = row.querySelector(".freq-input");
  if (document.activeElement !== freqInput) {
    freqInput.value = target.intervalSeconds;
  }
}

function renderState(state) {
  const hasTargets = state.targets.length > 0;
  document.getElementById("empty-state").classList.toggle("hidden", hasTargets);
  document
    .getElementById("active-actions")
    .classList.toggle("hidden", !hasTargets);
  document
    .getElementById("running-badge")
    .classList.toggle("hidden", !state.enabled);
  document.getElementById("start-btn").classList.toggle("hidden", state.enabled);
  document.getElementById("stop-btn").classList.toggle("hidden", !state.enabled);

  // Reflect the stored default rate, but don't clobber the field mid-edit.
  if (
    state.defaultIntervalSeconds != null &&
    document.activeElement !== defaultInput
  ) {
    defaultInput.value = state.defaultIntervalSeconds;
  }

  const ids = state.targets.map((t) => t.id).join(",");
  if (ids !== renderedIds) {
    list.textContent = "";
    state.targets.forEach((t) => list.appendChild(buildRow(t)));
    renderedIds = ids;
  }
  state.targets.forEach((t) => {
    const row = list.querySelector('[data-id="' + t.id + '"]');
    if (row) updateRow(row, t);
  });
}

browser.runtime.onMessage.addListener(function (message) {
  if (message && message.clicksterState) {
    renderState(message.clicksterState);
  }
});

send("GET_STATE");
// Poll often enough that the tenths-of-a-second countdown moves smoothly.
setInterval(() => send("GET_STATE"), 250);
