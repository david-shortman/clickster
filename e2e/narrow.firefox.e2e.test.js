// E2E for the NARROWED store build (activeTab + optional all-sites host
// permission). Firefox only: geckodriver can auto-grant the runtime
// permission request via extensions.webextOptionalPermissionPrompts=false
// (see driver.js / e2e/README.md), so we can exercise the real flow:
//   no content script -> grant + arm -> injected & clicking -> survives reload.
//
// Chrome has no equivalent auto-grant for extension optional host permissions
// (w3c/webextensions#227 is open), so the Chrome worker path is covered by unit
// tests (tests/background.test.js) plus a one-time manual smoke test.
//
// Run with: npm run test:e2e:firefox:narrow
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { By, until } from "selenium-webdriver";
import { BROWSER, NARROW, buildDriver, navigateTo, popupUrl } from "./driver.js";
import { fixtureUrl, startFixtureServer } from "./server.js";

const run = NARROW && BROWSER !== "chrome";

describe.runIf(run)("clickster narrow build (firefox optional host access)", () => {
  let server;
  let driver;
  let pageHandle;
  let tabId;

  beforeAll(async () => {
    server = await startFixtureServer();
    driver = await buildDriver();
    pageHandle = await driver.getWindowHandle();
  }, 180000);

  afterAll(async () => {
    if (driver) await driver.quit();
    if (server) server.close();
  });

  async function openPopup(query) {
    await driver.switchTo().newWindow("tab");
    await navigateTo(driver, popupUrl(query), By.id("select-element-btn"));
    return driver.getWindowHandle();
  }

  async function closePopup() {
    await driver.close();
    await driver.switchTo().window(pageHandle);
  }

  async function readCount(id) {
    return Number(await driver.findElement(By.id(id)).getText());
  }

  // Ask the content script (via an extension page) whether it answers in a tab.
  async function contentScriptAlive(id) {
    return driver.executeAsyncScript(
      `const [tabId, done] = [arguments[0], arguments[arguments.length - 1]];
       browser.tabs.sendMessage(tabId, "PING").then(() => done(true), () => done(false));`,
      id
    );
  }

  // The narrow build has no host/tabs permission yet, so tab URLs are hidden
  // (that's the point) and findTabIdByUrl can't see them. Tab *ids* are always
  // visible, so identify the page tab as the non-popup tab in this window.
  async function findPageTabId() {
    return driver.executeAsyncScript(
      `const done = arguments[arguments.length - 1];
       browser.tabs
         .getCurrent()
         .then((cur) =>
           browser.tabs.query({ windowId: cur.windowId }).then((tabs) => {
             const other = tabs.find((t) => t.id !== cur.id);
             done(other ? other.id : null);
           })
         )
         .catch(() => done(null));`
    );
  }

  it("ships no content script until the user grants access and arms", async () => {
    await driver.switchTo().window(pageHandle);
    await navigateTo(driver, fixtureUrl("counter.html"), By.id("one"));

    // Identify the page tab from an extension page, and confirm nothing is
    // injected yet (a broad install would already be answering PING here).
    await openPopup("");
    tabId = await findPageTabId();
    expect(tabId).not.toBeNull();
    expect(await contentScriptAlive(tabId)).toBe(false);
    await closePopup();
  });

  it("grants on first use, injects, and clicks the selected target", async () => {
    // Arm from the popup (pinned to the page tab). permissions.request is
    // auto-granted by the pref; the background worker then injects + arms.
    await openPopup(`?tabId=${tabId}`);
    await driver.findElement(By.id("select-element-btn")).click();
    await driver.switchTo().window(pageHandle);

    // The content script is now present — select #one with a real pointer.
    const one = await driver.findElement(By.id("one"));
    await driver.actions().move({ x: 5, y: 5 }).perform();
    await driver.actions().move({ origin: one }).perform();
    await driver.actions().click().perform();

    // It carries the rainbow selection ring (proves injection happened).
    await driver.wait(
      async () =>
        (await driver.findElement(By.id("one")).getAttribute("style")).includes(
          "rgb(184, 39, 252)"
        ),
      6000,
      "target was not selected after grant + arm"
    );

    await openPopup(`?tabId=${tabId}`);
    const start = await driver.wait(
      until.elementLocated(By.id("start-btn")),
      5000
    );
    await driver.wait(until.elementIsVisible(start), 5000);
    await start.click();
    await closePopup();

    await driver.wait(async () => (await readCount("count-one")) >= 2, 8000);
  });

  it("re-injects and resumes after a reload (registered content script)", async () => {
    const before = await readCount("count-one");
    await navigateTo(driver, fixtureUrl("counter.html"), By.id("one"));
    // No popup interaction: the dynamically-registered content script must
    // auto-run on the fresh load and resume clicking on its own.
    await driver.wait(
      async () => (await readCount("count-one")) >= 1,
      8000,
      "clicking did not resume after reload on the narrow build"
    );
    expect(before).toBeGreaterThanOrEqual(2);

    // And the sticky resume toast appears, like the broad build.
    await driver.wait(
      until.elementLocated(By.id("clickster-resume-toast-stop")),
      8000
    );
  });
});
