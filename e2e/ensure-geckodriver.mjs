import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// geckodriver 0.37.0 breaks navigation to moz-extension:// pages
// (mozilla/geckodriver#2248) — the document stays empty. Pin 0.36.0, the same
// workaround Ghostery's E2E suite uses, until a fixed release ships.
const GECKODRIVER_VERSION = "0.36.0";

const cacheDir = resolve(dirname(fileURLToPath(import.meta.url)), ".cache");

const PLATFORM_SUFFIX = {
  "darwin-arm64": "macos-aarch64",
  "darwin-x64": "macos",
  "linux-x64": "linux64",
  "linux-arm64": "linux-aarch64",
};

export function ensureGeckodriver() {
  if (process.env.GECKODRIVER_PATH) {
    return process.env.GECKODRIVER_PATH;
  }
  const suffix = PLATFORM_SUFFIX[`${process.platform}-${process.arch}`];
  if (!suffix) {
    throw new Error(
      `No pinned geckodriver build for ${process.platform}-${process.arch}; ` +
        `set GECKODRIVER_PATH to a geckodriver ${GECKODRIVER_VERSION} binary.`
    );
  }
  const binary = join(cacheDir, `geckodriver-${GECKODRIVER_VERSION}`);
  if (!existsSync(binary)) {
    mkdirSync(cacheDir, { recursive: true });
    const url =
      `https://github.com/mozilla/geckodriver/releases/download/` +
      `v${GECKODRIVER_VERSION}/geckodriver-v${GECKODRIVER_VERSION}-${suffix}.tar.gz`;
    execSync(`curl -sL '${url}' | tar xz -C '${cacheDir}'`, {
      stdio: "inherit",
    });
    execSync(`mv '${join(cacheDir, "geckodriver")}' '${binary}'`);
  }
  return binary;
}

/**
 * Firefox binary discovery. geckodriver finds system installs on its own;
 * this only fills the gap on machines without one, where a prior Selenium
 * Manager run left a managed Firefox in ~/.cache/selenium.
 */
export function detectFirefoxBinary() {
  if (process.env.FIREFOX_BIN) {
    return process.env.FIREFOX_BIN;
  }
  if (process.platform === "darwin") {
    const system = "/Applications/Firefox.app/Contents/MacOS/firefox";
    if (existsSync(system)) return system;
    const managedRoot = join(homedir(), ".cache", "selenium", "firefox");
    if (existsSync(managedRoot)) {
      for (const platformDir of readdirSync(managedRoot)) {
        const versions = readdirSync(join(managedRoot, platformDir)).sort();
        for (const version of versions.reverse()) {
          const bin = join(
            managedRoot,
            platformDir,
            version,
            "Firefox.app/Contents/MacOS/firefox"
          );
          if (existsSync(bin)) return bin;
        }
      }
    }
    throw new Error(
      "No Firefox found. Install Firefox or set FIREFOX_BIN to a binary."
    );
  }
  return null; // let geckodriver discover the system Firefox (CI: /usr/bin/firefox)
}
