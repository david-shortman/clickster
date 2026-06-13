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
  await navigateTo(driver, fixtureUrl("counter.html"), By.id("one"));
  await openPopup();
  if (tabId === undefined) {
    tabId = await findTabIdByUrl(driver, "counter.html");
    expect(tabId).not.toBeNull();
  }
  await waitForContentScript(driver, tabId);
  await closePopup();
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
  await clickPopupButton("select-element-btn");
  await driver.switchTo().window(pageHandle);
  const target = await driver.findElement(By.id(elementId));
  // Nudge to a neutral spot first: Selenium emits no mousemove when the
  // pointer is already at the destination (e.g. re-selecting the element it
  // last sat on), and the content script arms selection on mousemove.
  await driver.actions().move({ x: 5, y: 5 }).perform();
  await driver.actions().move({ origin: target }).perform();
  await driver.actions().click().perform();
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
  it("selects a hovered element and repeatedly clicks it at the configured interval", async () => {
    await loadFixturePage();

    // Hover the target with a real pointer (real elementFromPoint) and click.
    await selectTargetByPointer("one");
    expect(isSelected(await styleOf("one"))).toBe(true);

    // The popup reflects the selection and can start clicking.
    await openPopup();
    await driver.wait(
      until.elementIsVisible(
        await driver.findElement(By.id("element-selected-msg"))
      ),
      5000
    );
    const intervalField = await driver.findElement(By.id("click-interval-fld"));
    await intervalField.clear();
    await intervalField.sendKeys("1");
    await clickPopupButton("clickster-start-button");
    await closePopup();

    // The contract from the listing: clicked every X seconds, not just once.
    await driver.sleep(3500);
    const clicks = await readCount("count-one");
    expect(clicks).toBeGreaterThanOrEqual(2);

    // And the selection click itself must not have inflated the count by
    // more than one — the selecting click is prevented or at most single.
    expect(clicks).toBeLessThanOrEqual(5);

    // Stop halts clicking.
    await openPopup();
    await clickPopupButton("clickster-stop-button");
    await closePopup();
    await driver.sleep(1200);
    const afterStop = await readCount("count-one");
    await driver.sleep(2200);
    expect(await readCount("count-one")).toBe(afterStop);
  }, 90000);

  it("targets all elements matching an advanced query and clicks them", async () => {
    await loadFixturePage();

    await openPopup();
    await clickPopupButton("advanced-options-btn");
    const textarea = await driver.findElement(
      By.id("advanced-elements-query-txtarea")
    );
    await textarea.sendKeys("#one\n#two");
    await clickPopupButton("apply-elements-query-btn");
    await driver.sleep(300);
    await clickPopupButton("clickster-start-button");
    await closePopup();

    expect(isSelected(await styleOf("one"))).toBe(true);
    expect(isSelected(await styleOf("two"))).toBe(true);

    await driver.sleep(2500);
    expect(await readCount("count-one")).toBeGreaterThanOrEqual(1);
    expect(await readCount("count-two")).toBeGreaterThanOrEqual(1);
  }, 90000);

  it("restores advanced-query targets after a page reload", async () => {
    // Depends on the cached query from the previous test (same origin).
    await driver.switchTo().window(pageHandle);
    await navigateTo(driver, fixtureUrl("counter.html"), By.id("one"));
    await openPopup();
    await waitForContentScript(driver, tabId);
    await closePopup();

    // Targets re-selected from the cached query, with no popup interaction.
    await driver.wait(async () => {
      return isSelected(await styleOf("one"));
    }, 5000);
    expect(isSelected(await styleOf("two"))).toBe(true);
  }, 90000);

  it("replaces the target when selecting a second element with one active", async () => {
    // Start clean so nothing is auto-restored from an earlier test's query.
    await driver.switchTo().window(pageHandle);
    await driver.executeScript("localStorage.clear();");
    await loadFixturePage();

    // First selection on an empty slate works in any version.
    await selectTargetByPointer("one");
    await waitForSelected("one", true);

    // Selecting a second element while "one" is active is the issue #10
    // repro: setSelectedElement threw clearing the prior highlight, so the
    // new selection silently failed and the popup kept saying "no target".
    await selectTargetByPointer("two");
    await waitForSelected("two", true);
    await waitForSelected("one", false);

    // "two" is now the sole live target: only its counter keeps climbing.
    const oneBefore = await readCount("count-one");
    await openPopup();
    const intervalField = await driver.findElement(By.id("click-interval-fld"));
    await intervalField.clear();
    await intervalField.sendKeys("1");
    await clickPopupButton("clickster-start-button");
    await closePopup();
    await driver.sleep(2500);
    expect(await readCount("count-two")).toBeGreaterThanOrEqual(2);
    expect(await readCount("count-one")).toBe(oneBefore);
  }, 90000);
});
