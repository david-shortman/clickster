const isChrome = !window['browser'] && !!chrome;
// Prefer the more standard `browser` before Chrome API
const browser = isChrome ? chrome : window['browser'];

function sendMessageToCurrentTab(currentTabId, message) {
    if (currentTabId >= 0) {
        browser.tabs.sendMessage(currentTabId, message);
    }
}

function createActiveTabMessenger(message) {
    return {
        send: function () {
            if (isChrome) {
                browser.tabs.getSelected(function ({ id }) { sendMessageToCurrentTab(id, message); });
            } else {
                browser.tabs.query({ active: true }).then(function (currentTabs) { sendMessageToCurrentTab(currentTabs[0].id, message); })
            }
        }
    };
}

function onSelectElementClicked() {
    const button =  document.getElementById('select-element-btn');
    button.innerText = 'Selecting...';
    button.disabled = true;
    createActiveTabMessenger("SELECT_ELEMENT_CLICKED").send();
    window.close();
}

document.getElementById('select-element-btn').addEventListener('click', onSelectElementClicked);

createActiveTabMessenger("IS_ELEMENT_SELECTED").send();
createActiveTabMessenger("GET_CLICK_INTERVAL").send();

document.getElementById('click-interval-fld').addEventListener('input', (e) => {
    createActiveTabMessenger({ newClickInterval: e.target.value }).send();
});

const clearSelectionMessenger = createActiveTabMessenger("CLEAR_SELECTED_ELEMENT");
document.getElementById('clear-selection-btn').addEventListener('click', () => {
    clearSelectionMessenger.send()
    document.getElementById('no-element-selected-msg').hidden = false;
    document.getElementById('element-selected-msg').hidden = true;
});

browser.runtime.onMessage.addListener(function (message) {
    if (message === "ELEMENT_IS_SELECTED") {
        document.getElementById('no-element-selected-msg').hidden = true;
        document.getElementById('element-selected-msg').hidden = false;
    } else if (message === "NO_ELEMENT_IS_SELECTED") {
        document.getElementById('no-element-selected-msg').hidden = false;
        document.getElementById('element-selected-msg').hidden = true;
    } else if (message.timeUntilClick) {
        document.getElementById('time-until-click-lbl').innerText = Math.floor(message.timeUntilClick / 1000);
    } else if (message.clickInterval) {
        document.getElementById('click-interval-fld').value = message.clickInterval;
    }
});

const getTimeUntilClickMessenger = createActiveTabMessenger("GET_TIME_UNTIL_CLICK");
setInterval(() => {
    getTimeUntilClickMessenger.send();
}, 1000);

document.getElementById('advanced-options-btn').addEventListener('click', () => {
    document.getElementById('advanced-options-btn').hidden = true;
    document.getElementById('advanced-options-sctn').hidden = false;
});

document.getElementById('apply-elements-query-btn').addEventListener('click', () => {
    const value = document.getElementById('advanced-elements-query-txtarea').value;
    console.log(value);
    createActiveTabMessenger({ advancedQuery: value }).send();
});