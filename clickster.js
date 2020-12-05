const isChrome = !window['browser'] && !!chrome;
// Prefer the more standard `browser` before Chrome API
const browser = isChrome ? chrome : window['browser'];

let isSelectionModeEnabled = false;
let clickInterval = 3000;
let clickerId, timeLastClicked, lastHoveredElement, lastSelectedElement, lastTooltip, lastHoveredElementBorder, lastSelectedElementBorder, shouldNextClickSelectAnElement, selectedElementToClick;

function removeHighlight() {
  if (lastHoveredElement) {
    lastHoveredElement.style.border = lastHoveredElementBorder;
    if (lastTooltip) {
      lastTooltip.remove();
    }
  }
}

document.addEventListener('mousemove', event => {
  if (isSelectionModeEnabled) {

    removeHighlight();

    const { clientX, clientY } = event;
    const elementMouseIsOver = document.elementFromPoint(clientX, clientY);

    if (elementMouseIsOver !== document.body) {
      if (lastHoveredElement !== elementMouseIsOver) {
        shouldNextClickSelectAnElement = true;
      }
  
      lastHoveredElementBorder = elementMouseIsOver.style.border;
      elementMouseIsOver.style.border = "thin solid red";
  
      lastTooltip = document.createElement('div');
      lastTooltip.classList.add('clickster-tooltip');
      lastTooltip.innerHTML = '<span class="clickster-tooltip--text">Set target</span>';
      elementMouseIsOver.appendChild(lastTooltip);
    }

    lastHoveredElement = elementMouseIsOver;
  }
});

document.addEventListener('click', event => {
  if (shouldNextClickSelectAnElement) {
    event.preventDefault();

    if (lastSelectedElement) {
      lastSelectedElement.style.border = lastSelectedElementBorder;
    }

    const { clientX, clientY } = event;
    selectedElementToClick = document.elementFromPoint(clientX, clientY);
    removeHighlight();
    lastSelectedElementBorder = selectedElementToClick.style.border;
    selectedElementToClick.style.border = "thick solid green";

    timeLastClicked = new Date();
    clickerId = setInterval(() => {
      selectedElementToClick.click();
      timeLastClicked = new Date();
    }, clickInterval);

    isSelectionModeEnabled = false;
    shouldNextClickSelectAnElement = false;
    lastSelectedElement = selectedElementToClick;
  }
});

browser.runtime.onMessage.addListener((message) => {
  if (message === 'SELECT_ELEMENT_CLICKED') {
    isSelectionModeEnabled = true;
    selectedElementToClick = null;
    clearInterval(clickerId);
  }
});

browser.runtime.onMessage.addListener(function (message) {
  if (message === "GET_TIME_UNTIL_CLICK") {
      const now = new Date();
      const safeTimeLastClicked = !!timeLastClicked ? timeLastClicked : now;
      const timeSinceLastClick = now.getTime() - safeTimeLastClicked.getTime();
      const intervalDiff = clickInterval - timeSinceLastClick;
      browser.runtime.sendMessage({ timeUntilClick: intervalDiff <= 0 ? clickInterval : intervalDiff });
  } else if (message === "IS_ELEMENT_SELECTED") {
    browser.runtime.sendMessage(!!selectedElementToClick ? "ELEMENT_IS_SELECTED" : "NO_ELEMENT_IS_SELECTED");
  } else if (message === "GET_CLICK_INTERVAL") {
    browser.runtime.sendMessage({ clickInterval: Math.floor(clickInterval / 1000) });
  } else if (message.newClickInterval) {
    clickInterval = (message.newClickInterval * 1000);
    clearInterval(clickerId);
    clickerId = setInterval(() => {
      selectedElementToClick.click();
      timeLastClicked = new Date();
    }, clickInterval);
  } else if (message === 'CLEAR_SELECTED_ELEMENT') {
    clearInterval(clickerId);
    timeLastClicked = null;
    selectedElementToClick.style.border = lastSelectedElementBorder;
    selectedElementToClick = null;
  }
});