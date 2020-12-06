const isChrome = !window["browser"] && !!chrome;
// Prefer the more standard `browser` before Chrome API
const browser = isChrome ? chrome : window["browser"];
let clicksterEnabled = false;

let isSelectionModeEnabled = false;
let clickInterval = 3000;
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
      ref: element
    },
  };
  displayAsSelected(element);
}

function removeSelectedHighlight(element) {
  const { originalBorder, originalBorderImageSource, originalBorderImageSlice } = selectedElementsToClick[element.ref.clicksterId];
  element.ref.style.border = originalBorder;
  element.ref.style["border-image"] = originalBorderImageSource;
  element.ref.style["border-image-slice"] = originalBorderImageSlice;
}

function setSelectedElement(event) {
  if (shouldNextClickSelectAnElement) {
    event.preventDefault();

    elementsThatWereDisabledOnPageLoad.forEach((elem) => {
      elem.disabled = true;
    });

    removeHoverHighlight(lastHoveredElement);
    Object.entries(selectedElementsToClick).forEach(([key, { ref }]) => {
      removeSelectedHighlight(ref);
      delete selectedElementsToClick[key];
    });

    const selectedElement = document.elementFromPoint(clientX, clientY);
    targetElement(selectedElement);

    timeLastClicked = new Date();
    startClicking();

    isSelectionModeEnabled = false;
    shouldNextClickSelectAnElement = false;
  }
}

function startClicking() {
  if(clicksterEnabled) {
    clickerId = setInterval(clickSelectedElements, clickInterval);
  }
}

function stopClicking() {
  if(!!clickerId) {
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
    Object.values(selectedElementsToClick).length > 0 ? "ELEMENT_IS_SELECTED" : "NO_ELEMENT_IS_SELECTED"
  );
}

function sendClickIntervalResponse() {
  browser.runtime.sendMessage({
    clickInterval: Math.floor(clickInterval / 1000),
  });
}

function sendIsEnabled() {
  console.log('sending ', clicksterEnabled);
  browser.runtime.sendMessage({
    clicksterEnabled: clicksterEnabled,
  });
}

function updateClickInterval(newClickInterval) {
  clickInterval = newClickInterval * 1000;
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
  stopClicking()
  timeLastClicked = null;
  Object.entries(selectedElementsToClick).forEach(([key, value]) => {
    removeSelectedHighlight(value);
    delete selectedElementsToClick[key];
  })
  // selectedElementsToClick = null;
}

function applyQuery(query) {
  lastQuery = query;
  const elementSelectors = query.split("\n");
  const selectedElements = elementSelectors
    .map((selector) => [...document.body.querySelectorAll(selector)]);
  const flattened = selectedElements.flat();
  flattened.forEach((element) => {
    targetElement(element);
  });
  stopClicking();
  startClicking();
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
  } else if(message === "STOP_CLICKING") {
    clicksterEnabled = false;
    console.log('got stop clicking message');
    stopClicking();
  } else if (message === "START_CLICKING") {
    console.log('got start clicking message');
    clicksterEnabled = true;
    startClicking();
  } else if (message === "GET_IS_CLICKSTER_ENABLED") {
    console.log('GOT IS ENABLED MESSAGE');
    sendIsEnabled();
  }
});
