import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Browser, Builder, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import chrome from "selenium-webdriver/chrome.js";
import {
  detectFirefoxBinary,
  ensureGeckodriver,
} from "./ensure-geckodriver.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Which browser to drive: BROWSER=chrome | firefox (default firefox).
export const BROWSER = process.env.BROWSER || "firefox";

// Firefox: fixed UUID seeded via the extensions.webextensions.uuids pref so
// moz-extension:// URLs are deterministic (Privacy Badger/Ghostery technique).
const FIREFOX_EXTENSION_ID = "{d9a80c5d-e4ea-4d11-8437-aedf73f2028b}";
const FIREFOX_UUID = "8d3a5c1e-2f74-4b9a-9c0d-6e1b2a7f4d52";
// Chrome: fixed ID derived from the manifest `key` (see tools/build-chrome.mjs).
const CHROME_ID = "mnabffamileocpjnkmhemkidnekhdlle";

export function popupUrl(query = "") {
  return BROWSER === "chrome"
    ? `chrome-extension://${CHROME_ID}/popup/popup.html${query}`
    : `moz-extension://${FIREFOX_UUID}/popup/popup.html${query}`;
}

export async function buildDriver() {
  return BROWSER === "chrome" ? buildChromeDriver() : buildFirefoxDriver();
}

async function buildChromeDriver() {
  const options = new chrome.Options();
  if (!process.env.HEADFUL) {
    options.addArguments("--headless=new");
  }
  // Load the unpacked MV3 build (built by build:chrome). The manifest `key`
  // gives it the fixed CHROME_ID.
  options.addArguments("--load-extension=" + resolve(repoRoot, "dist/chrome"));
  options.addArguments(
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    // Consumer Chrome (129+) ignores --load-extension; this re-enables it.
    "--disable-features=DisableLoadExtensionCommandLineSwitch"
  );
  options.excludeSwitches("disable-extensions");
  // Use Chrome for Testing, which permits --load-extension (consumer Chrome —
  // local or on CI runners — blocks it outright).
  options.setBrowserVersion("stable");
  options.setPageLoadStrategy("none");
  return new Builder()
    .forBrowser(Browser.CHROME)
    .setChromeOptions(options)
    .build();
}

async function buildFirefoxDriver() {
  const options = new firefox.Options();
  if (!process.env.HEADFUL) {
    options.addArguments("-headless");
  }
  // Marionette's load tracking never completes for moz-extension:// pages
  // (geckodriver 0.37 regression, mozilla/geckodriver#2248), so don't wait
  // for loads at all — every navigation uses navigateTo()'s explicit waits.
  options.setPageLoadStrategy("none");
  options.setPreference(
    "extensions.webextensions.uuids",
    JSON.stringify({ [FIREFOX_EXTENSION_ID]: FIREFOX_UUID })
  );
  // The popup calls window.close() after "Select a target". Tabs the driver
  // opened aren't script-opened, so allow scripted close to keep that flow
  // deterministic in tests.
  options.setPreference("dom.allow_scripts_to_close_windows", true);

  const builder = new Builder()
    .forBrowser(Browser.FIREFOX)
    .setFirefoxOptions(options);
  const firefoxBinary = detectFirefoxBinary();
  if (firefoxBinary) {
    options.setBinary(firefoxBinary);
  }
  builder.setFirefoxService(new firefox.ServiceBuilder(ensureGeckodriver()));
  const driver = await builder.build();

  // Temporary install accepts our unsigned zip on stock Firefox — the same
  // mechanism as about:debugging's "Load Temporary Add-on".
  await driver.installAddon(resolve(repoRoot, "dist/clickster.zip"), true);
  return driver;
}

/**
 * Navigate under pageLoadStrategy "none": driver.get returns immediately, so
 * readiness is "an old element went stale (if the new page could share ids
 * with the old one) and the expected element exists".
 */
export async function navigateTo(driver, url, readyLocator, timeoutMs = 15000) {
  let sentinel = null;
  try {
    sentinel = await driver.findElement(By.css("body"));
  } catch {
    // about:blank in a fresh tab may have no body yet; nothing to go stale.
  }
  await driver.get(url);
  if (sentinel) {
    await driver.wait(until.stalenessOf(sentinel), timeoutMs);
  }
  await driver.wait(until.elementLocated(readyLocator), timeoutMs);
  // Classic scripts (popup.js / fixture scripts) have all executed once
  // readyState is complete — only then are click listeners attached.
  await driver.wait(
    () => driver.executeScript("return document.readyState === 'complete';"),
    timeoutMs
  );
}

/**
 * Find the tab id of the page under test. Runs tabs.query in the context of
 * an extension page (the popup), where the WebExtension API is available.
 */
export async function findTabIdByUrl(driver, urlSubstring) {
  return driver.executeAsyncScript(
    `const [substr, done] = [arguments[0], arguments[arguments.length - 1]];
     browser.tabs.query({}).then((tabs) => {
       const tab = tabs.find((t) => t.url && t.url.includes(substr));
       done(tab ? tab.id : null);
     }, () => done(null));`,
    urlSubstring
  );
}

/**
 * Resolve once the content script in the given tab answers messages.
 * tabs.sendMessage rejects with "receiving end does not exist" until the
 * content script's listener is registered (it injects at document_idle, which
 * lags WebDriver's page-load signal).
 */
export async function waitForContentScript(driver, tabId, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const alive = await driver.executeAsyncScript(
      `const [tabId, done] = [arguments[0], arguments[arguments.length - 1]];
       browser.tabs.sendMessage(tabId, "PING").then(
         () => done(true),
         () => done(false)
       );`,
      tabId
    );
    if (alive) return;
    if (Date.now() > deadline) {
      throw new Error(`content script in tab ${tabId} never became reachable`);
    }
    await driver.sleep(200);
  }
}
