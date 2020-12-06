const isChrome = !window['browser'] && !!chrome;
// Prefer the more standard `browser` before Chrome API
const browser = isChrome ? chrome : window['browser'];
clicksterEnabled = false;

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

function startButtonClicked() {
    createActiveTabMessenger("START_CLICKING").send();
    createActiveTabMessenger("GET_IS_CLICKSTER_ENABLED").send();
}

function stopButtonClicked() {
    createActiveTabMessenger("STOP_CLICKING").send();
    createActiveTabMessenger("GET_IS_CLICKSTER_ENABLED").send();
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

document.getElementById('clickster-start-button').addEventListener('click', startButtonClicked);
document.getElementById('clickster-stop-button').addEventListener('click', stopButtonClicked);

browser.runtime.onMessage.addListener(function (message) {
    console.log('got a message ', message);
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
    } else if (message.clicksterEnabled !== null && message.clicksterEnabled !== undefined) {
        console.log('got clickster enabled message ', message.clicksterEnabled);
        if(message.clicksterEnabled === true) {
            document.getElementById('clickster-start-button').style.display = 'none';
            document.getElementById('clickster-stop-button').style.display = 'block';
        } else {
            document.getElementById('clickster-start-button').style.display = 'block';
            document.getElementById('clickster-stop-button').style.display = 'none';
        }
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
    createActiveTabMessenger({ advancedQuery: value }).send();
});

createActiveTabMessenger("GET_IS_CLICKSTER_ENABLED").send();