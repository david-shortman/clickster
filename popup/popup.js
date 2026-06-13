const isChrome = !window["browser"] && !!chrome;
// Prefer the more standard `browser` before Chrome API
const browser = isChrome ? chrome : window["browser"];

// E2E test hook: WebDriver can't open the real browser-action popup, so tests
// load this page as a tab with ?tabId=<target> to pin which tab gets messaged.
const testTabId = new URLSearchParams(window.location.search).get("tabId");

function sendToTab(tabId, message) {
  if (tabId >= 0) {
    browser.tabs.sendMessage(tabId, message);
  }
}

function send(message) {
  if (testTabId !== null) {
    sendToTab(Number(testTabId), message);
  } else if (isChrome) {
    browser.tabs.query({ currentWindow: true, active: true }, function (tabs) {
      if (tabs[0]) sendToTab(tabs[0].id, message);
    });
  } else {
    browser.tabs
      .query({ currentWindow: true, active: true })
      .then(function (tabs) {
        if (tabs[0]) sendToTab(tabs[0].id, message);
      });
  }
}

function armSelection() {
  send("SELECT_ELEMENT_CLICKED");
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
  showBtn.textContent = "👁";
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
  removeBtn.textContent = "✕";
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
    : "next in " + Math.ceil((target.nextClickMs || 0) / 1000) + "s";
  const pauseBtn = row.querySelector(".pause-btn");
  pauseBtn.textContent = target.paused ? "▶" : "⏸";
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
setInterval(() => send("GET_STATE"), 400);
