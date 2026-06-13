import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { By, until } from "selenium-webdriver";
import {
  buildDriver,
  findTabIdByUrl,
  navigateTo,
  popupUrl,
  waitForContentScript,
} from "./driver.js";
import { fixtureUrl, startFixtureServer } from "./server.js";

let server;
let driver;
let pageHandle;
let tabId;

/** Open the popup page in a new tab, pinned to the page-under-test's tab. */
async function openPopup(query = `?tabId=${tabId}`) {
  await driver.switchTo().newWindow("tab");
  await navigateTo(driver, popupUrl(query), By.id("select-element-btn"));
  return driver.getWindowHandle();
}

/** Close the current (popup) tab and switch back to the page under test. */
async function closePopup() {
  await driver.close();
  await driver.switchTo().window(pageHandle);
}

async function loadFixturePage() {
  await driver.switchTo().window(pageHandle);
  // Drop any persisted state from a previous test so each starts clean. (#11
  // makes the enabled flag and targets survive reloads — including into the
  // next test if not cleared.) The try/catch covers the first run on
  // about:blank, where localStorage isn't reachable.
  try {
    await driver.executeScript("localStorage.clear();");
  } catch (e) {
    // no page with localStorage yet
  }
  await navigateTo(driver, fixtureUrl("counter.html"), By.id("one"));
  await openPopup();
  if (tabId === undefined) {
    tabId = await findTabIdByUrl(driver, "counter.html");
    expect(tabId).not.toBeNull();
  }
  await waitForContentScript(driver, tabId);
  await closePopup();
}

/** Reload the page-under-test without clearing state or touching the popup. */
async function reloadFixturePage() {
  await driver.switchTo().window(pageHandle);
  await navigateTo(driver, fixtureUrl("counter.html"), By.id("one"));
}

async function readCount(spanId) {
  const span = await driver.findElement(By.id(spanId));
  return Number(await span.getText());
}

async function styleOf(elementId) {
  const el = await driver.findElement(By.id(elementId));
  return (await el.getAttribute("style")) ?? "";
}

/** The selected-target style is the rainbow border-image gradient. */
function isSelected(style) {
  return style.includes("border-image") && style.includes("linear-gradient");
}

/** Poll until an element is (or is not) showing the selected highlight. */
async function waitForSelected(elementId, selected = true, timeoutMs = 5000) {
  await driver.wait(
    async () => isSelected(await styleOf(elementId)) === selected,
    timeoutMs,
    `#${elementId} expected selected=${selected}`
  );
}

/** In the open popup tab: wait for state sync, then press a popup button. */
async function clickPopupButton(buttonId) {
  const button = await driver.wait(
    until.elementLocated(By.id(buttonId)),
    5000
  );
  await driver.wait(until.elementIsVisible(button), 5000);
  await button.click();
}


/**
 * Arm selection mode from the popup, then hover the target on the page and
 * click it with a real pointer (exercising the page's elementFromPoint).
 * Leaves the driver focused on the page-under-test.
 */
async function selectTargetByPointer(elementId) {
  await openPopup();
  await (await armSelectionButton()).click();
  await driver.switchTo().window(pageHandle);
  const target = await driver.findElement(By.id(elementId));
  // Nudge to a neutral spot first: Selenium emits no mousemove when the
  // pointer is already at the destination (e.g. re-selecting the element it
  // last sat on), and the content script arms selection on mousemove.
  await driver.actions().move({ x: 5, y: 5 }).perform();
  await driver.actions().move({ origin: target }).perform();
  await driver.actions().click().perform();
}

/**
 * Wait for the popup to render its current state, then return whichever
 * selection-arming button is visible: "Select an element" (empty) or "Add
 * another target" (when targets already exist).
 */
async function armSelectionButton() {
  return driver.wait(async () => {
    for (const id of ["add-target-btn", "select-element-btn"]) {
      const el = await driver.findElement(By.id(id));
      if (await el.isDisplayed()) return el;
    }
    return null;
  }, 5000);
}

/** Wait for the popup to render the expected number of target rows. */
async function waitForRows(count) {
  await driver.wait(
    async () => (await driver.findElements(By.css(".target"))).length === count,
    5000,
    `expected ${count} target rows`
  );
  return driver.findElements(By.css(".target"));
}

beforeAll(async () => {
  server = await startFixtureServer();
  driver = await buildDriver();
  pageHandle = await driver.getWindowHandle();
}, 180000);

afterAll(async () => {
  if (driver) await driver.quit();
  if (server) server.close();
});

describe("clickster in real Firefox", () => {
  it("selects an element, clicks it, and stops", async () => {
    await loadFixturePage();
    await selectTargetByPointer("one");
    await waitForSelected("one", true);

    // Default 1s rate; just press Start.
    await openPopup();
    await clickPopupButton("start-btn");
    await closePopup();
    await driver.wait(async () => (await readCount("count-one")) >= 2, 6000);

    // Stop halts clicking.
    await openPopup();
    await clickPopupButton("stop-btn");
    await closePopup();
    const afterStop = await readCount("count-one");
    await driver.sleep(2000);
    expect(await readCount("count-one")).toBe(afterStop);
  }, 90000);

  it("adds multiple targets and clicks each (additive selection)", async () => {
    await loadFixturePage();
    await selectTargetByPointer("one");
    await selectTargetByPointer("two");

    await openPopup();
    await waitForRows(2);
    await clickPopupButton("start-btn");
    await closePopup();

    await driver.wait(async () => (await readCount("count-one")) >= 2, 6000);
    await driver.wait(async () => (await readCount("count-two")) >= 2, 6000);
  }, 90000);

  it("pauses and resumes an individual target", async () => {
    await loadFixturePage();
    await selectTargetByPointer("one");
    await selectTargetByPointer("two");

    await openPopup();
    let rows = await waitForRows(2);
    await rows[0].findElement(By.css(".pause-btn")).click(); // pause "one"
    await clickPopupButton("start-btn");
    await closePopup();

    await driver.wait(async () => (await readCount("count-two")) >= 2, 6000);
    const onePaused = await readCount("count-one");
    await driver.sleep(1500);
    expect(await readCount("count-one")).toBe(onePaused); // stayed put

    await openPopup();
    rows = await waitForRows(2);
    await rows[0].findElement(By.css(".pause-btn")).click(); // resume "one"
    await closePopup();
    await driver.wait(
      async () => (await readCount("count-one")) > onePaused,
      6000
    );
  }, 90000);

  it("removes a target from the list", async () => {
    await loadFixturePage();
    await selectTargetByPointer("one");
    await selectTargetByPointer("two");

    await openPopup();
    const rows = await waitForRows(2);
    await rows[0].findElement(By.css(".remove-btn")).click(); // remove "one"
    await waitForRows(1);
    await clickPopupButton("start-btn");
    await closePopup();

    await driver.wait(async () => (await readCount("count-two")) >= 2, 6000);
    const oneCount = await readCount("count-one");
    await driver.sleep(1500);
    expect(await readCount("count-one")).toBe(oneCount); // no longer clicked
  }, 90000);

  it("highlights the target on the page from the show button", async () => {
    await loadFixturePage();
    await selectTargetByPointer("one");

    await openPopup();
    await waitForRows(1);
    await driver.findElement(By.css(".target .show-btn")).click();
    await closePopup();
    await driver.wait(
      async () => (await styleOf("one")).includes("outline"),
      3000,
      "show did not outline the element"
    );
  }, 90000);

  it("clicks at a per-target frequency set in the popup", async () => {
    await loadFixturePage();
    await selectTargetByPointer("one");

    await openPopup();
    await waitForRows(1);
    const freq = await driver.findElement(By.css(".target .freq-input"));
    await freq.clear();
    await freq.sendKeys("3");
    // Pressing Start blurs the field (firing change -> setTargetInterval) and
    // resets the countdown.
    await clickPopupButton("start-btn");
    await closePopup();

    const baseline = await readCount("count-one");
    await driver.sleep(2000);
    expect(await readCount("count-one")).toBe(baseline); // 3s rate: nothing yet
    await driver.wait(
      async () => (await readCount("count-one")) > baseline,
      4000
    );
  }, 90000);

  it("keeps clicking after reload and shows a resume toast (#11)", async () => {
    await loadFixturePage();
    await selectTargetByPointer("one");
    await openPopup();
    await clickPopupButton("start-btn");
    await closePopup();
    await driver.wait(async () => (await readCount("count-one")) >= 1, 5000);

    await reloadFixturePage();
    // Clicking resumes on its own, with no popup interaction.
    await driver.wait(
      async () => (await readCount("count-one")) >= 2,
      8000,
      "clicking did not resume after reload"
    );
    // The sticky resume toast appears; its Stop button halts clicking.
    const stop = await driver.wait(
      until.elementLocated(By.id("clickster-resume-toast-stop")),
      8000
    );
    await stop.click();
    await driver.wait(until.stalenessOf(stop), 5000);
    const afterStop = await readCount("count-one");
    await driver.sleep(2000);
    expect(await readCount("count-one")).toBe(afterStop);
  }, 90000);
});
