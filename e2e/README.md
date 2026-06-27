# E2E tests & the broad/narrow build split

Clickster ships two manifest shapes from the same JS/HTML (see
[`tools/store-manifest.mjs`](../tools/store-manifest.mjs)):

| Variant | Host access | Content script | Built for |
| --- | --- | --- | --- |
| **broad** | `<all_urls>` granted at install | static `content_scripts`, auto-injected | dev (`web-ext run`) + the main E2E suite |
| **narrow** | `activeTab` + **optional** `*://*/*` requested at runtime | injected/registered by `background.js` after the user grants | the store uploads (Chrome Web Store + AMO) |

The narrow build is what avoids the Chrome Web Store "broad host permissions"
in-depth-review penalty and the blanket "read & change data on all sites"
install warning.

## How each path is tested

| What | How |
| --- | --- |
| Clicking engine, selection, reload-resume, canvas crosshair, multi-target | `clickster.e2e.test.js` against the **broad** build, Firefox + Chrome (`npm run test:e2e`, `npm run test:e2e:chrome`) |
| `background.js` worker logic (register / inject / ping-guard / no-broad fallback) | unit tests in `tests/background.test.js` (mocked `chrome.*`) |
| popup permission handoff vs. direct-arm fallback | `tests/popup.test.js` |
| **Narrow build, real browser**: no script → grant → inject → click → survive reload | `narrow.firefox.e2e.test.js` against the **narrow** build, Firefox only (`npm run test:e2e:firefox:narrow`) |

### Why the narrow E2E is Firefox-only

The narrow flow hinges on the runtime optional-permission grant
(`permissions.request({origins:["*://*/*"]})`). To test it end-to-end a driver
has to get past that prompt:

- **Firefox — solved.** Set the pref `extensions.webextOptionalPermissionPrompts
  = false` and `permissions.request()` resolves **granted** with no door hanger.
  This isn't a hack: Firefox's own `ext-permissions.js` gates the prompt on that
  pref and, when it's off, skips straight to granting. `e2e/driver.js` sets it
  under `CLICKSTER_NARROW=1`.

- **Chrome — no clean mechanism (tracked).** There is no flag or WebDriver
  capability to auto-accept an extension's **optional host permission** bubble:
  - Selenium `setPermission` / Puppeteer `overridePermissions` / CDP
    `Browser.grantPermissions` only cover site `PermissionDescriptor`s
    (geolocation, notifications…), not extension host permissions.
  - The only workarounds are fragile: pre-seeding the profile's HMAC-signed
    `Secure Preferences`, or OS-driving the native bubble (not headless).
  - The ecosystem gap is acknowledged upstream and still open:
    https://github.com/w3c/webextensions/issues/227
    ("how will this interact with Selenium/Geckodriver/Chromedriver? Will
    browsers add command line flags to auto opt into all permissions?").

  So the Chrome worker path is covered by the unit tests above (the worker code
  is shared cross-browser; only the API name differs —
  `scripting.registerContentScripts` vs `contentScripts.register`) plus the
  manual smoke test below. **Revisit if w3c/webextensions#227 ships a flag.**

## Manual smoke test (do once per release on the narrow store builds)

`npm run build:stores`, then load the unpacked build and confirm:

- **Chrome** — load `dist/chrome-store/` at `chrome://extensions` (Developer
  mode):
  1. Fresh profile shows **no** host permission warning on install.
  2. On a normal page, click the icon → "Select an element" → a one-time
     "access all sites" prompt appears; **Allow**.
  3. Pick a target, Start → it clicks. Reload the page → clicking resumes.
  4. Decline the prompt on another fresh profile → the current tab still works
     (activeTab), but reload-resume does not. (Expected.)
- **Firefox** — load `dist/firefox-store/` at `about:debugging` → "Load
  Temporary Add-on"; repeat the same steps (the grant prompt is Firefox's
  door hanger).
