const isChrome = !window["browser"] && !!chrome;
// Prefer the more standard `browser` before Chrome API
const browser = isChrome ? chrome : window["browser"];

let isSelectionModeEnabled = false;
let clickInterval = 3000;
let clickerId,
  timeLastClicked,
  lastHoveredElement,
  lastSelectedElement,
  lastHoveredElementBorder,
  lastSelectedElementBorder,
  shouldNextClickSelectAnElement,
  selectedElementToClick;

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
  selectedElementToClick.style.border = "thick solid";
  selectedElementToClick.style["border-image"] =
    "linear-gradient(to bottom right, #b827fc 0%, #2c90fc 25%, #b8fd33 50%, #fec837 75%, #fd1892 100%)";
  selectedElementToClick.style["border-image-slice"] = 1;
}

function clickElement() {
  selectedElementToClick.click();
  selectedElementToClick.style.border = "thick solid silver";
  setTimeout(() => displayAsSelected(selectedElementToClick), 500);
  timeLastClicked = new Date();
}

function displayElementAsSelected(element) {
  lastSelectedElementBorder = element.style.border;
  displayAsSelected(element);
}

function removeSelectedHighlight(element) {
  element.style.border = lastSelectedElementBorder;
}

function setSelectedElement(event) {
  if (shouldNextClickSelectAnElement) {
    event.preventDefault();

    elementsThatWereDisabledOnPageLoad.forEach((elem) => {
      elem.disabled = true;
    });

    removeHoverHighlight(lastHoveredElement);
    if (lastSelectedElement) {
      removeSelectedHighlight(lastSelectedElement);
    }

    selectedElementToClick = document.elementFromPoint(clientX, clientY);
    displayElementAsSelected(selectedElementToClick);

    timeLastClicked = new Date();
    clickerId = setInterval(clickElement, clickInterval);

    isSelectionModeEnabled = false;
    shouldNextClickSelectAnElement = false;
    lastSelectedElement = selectedElementToClick;
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
    !!selectedElementToClick ? "ELEMENT_IS_SELECTED" : "NO_ELEMENT_IS_SELECTED"
  );
}

function sendClickIntervalResponse() {
  browser.runtime.sendMessage({
    clickInterval: Math.floor(clickInterval / 1000),
  });
}

function updateClickInterval(newClickInterval) {
  clickInterval = newClickInterval * 1000;
  clearInterval(clickerId);
  clickerId = setInterval(clickElement, clickInterval);
}

function enableSelectionMode() {
  isSelectionModeEnabled = true;
  selectedElementToClick = null;
  clearInterval(clickerId);

  elementsThatWereDisabledOnPageLoad.forEach((elem) => {
    elem.disabled = false;
  });
}

function manuallyClearSelectedElement() {
  clearInterval(clickerId);
  timeLastClicked = null;
  selectedElementToClick.style.border = lastSelectedElementBorder;
  selectedElementToClick = null;
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
    manuallyClearSelectedElement();
  }
});
