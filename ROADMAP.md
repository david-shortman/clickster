# Clickster Roadmap

> What users actually need from a clicker extension, and the order we'll build it.
> Based on a June 2026 analysis of review text for Clickster and six competing
> auto-clicker extensions on addons.mozilla.org.

## What the review data says

The Firefox auto-clicker category is small and badly served: the largest
general-purpose clicker has ~4,600 users at 2.4★, and its reviews report it's a
funnel to a desktop app rather than a working extension. Across every
extension's reviews, the same needs repeat:

1. **It visibly, verifiably works.** Most 1-star reviews in the category are
   simply "does nothing." Auto-clickers fail silently — users can't tell
   whether the target wasn't found, clicking never armed, or the click hit a
   dead element. Observable state (highlight, countdown, badge, last-clicked
   time) is the single biggest differentiator.
2. **It keeps working over time.** People run clickers unattended for hours.
   The most-praised behavior in the corpus is persistence: surviving page
   reloads, navigation, and background tabs.
3. **It clicks only where it should.** The most vivid complaint is a clicker
   that fired on every website while the user typed. Per-tab scoping with an
   obvious on/off state is a hard requirement.
4. **Trust.** Reviewers assume clickers are scams until proven otherwise (with
   reason — see above). Open source, minimal permissions, and a privacy policy
   are persuasive listing copy in this category.
5. **Sequences are the real advanced feature.** "Click A, then B" (confirm
   dialogs, course-ware Next buttons) shows up repeatedly.
6. **There's a second, reachable audience: browser-game players.** "Speed
   control," "add more clicks per second," "muti click," and Cookie Clicker all
   appear in the corpus. Browser DOM games are squarely in reach — see the
   gamer track below. (Native games like Minecraft/Roblox are not; see
   Non-goals.)

Clickster's element-targeted, interval-based design is already the right
architecture for the underserved persona: the **task automator** (auto-advance
a course player, confirm a two-step dialog, keep collecting a bonus). The gap
is reliability, which is fixable.

## Priorities

### P0 — Make it never silently stop working

These four issues account for essentially every negative Clickster review:

- [#10](https://github.com/david-shortman/clickster/issues/10) — Selecting a
  new target throws when one is already selected (selection appears broken)
- [#11](https://github.com/david-shortman/clickster/issues/11) — Clicking
  stops permanently after page navigation/reload
- [#12](https://github.com/david-shortman/clickster/issues/12) — Stale DOM
  refs: dynamically re-rendered buttons stop being clicked
- [#13](https://github.com/david-shortman/clickster/issues/13) — Content
  script doesn't run in iframes (course players, embedded apps)

Each fix lands with a regression test (test harness: #16).

### P1 — Robustness and legibility

- [#14](https://github.com/david-shortman/clickster/issues/14) — Move settings
  to `browser.storage.local` (settings follow the user; script survives
  storage-blocked pages)
- [#15](https://github.com/david-shortman/clickster/issues/15) — Replace
  deprecated `tabs.getSelected`
- Toolbar badge showing armed/clicking state per tab, so "is it on?" never
  requires opening the popup
- Surface failure states in the popup ("target not found on this page") instead
  of silently doing nothing

### P2 — Earn the category

- Optional hotkey to start/stop clicking without opening the popup
- Click sequences: target multiple elements clicked in order per interval
  (the advanced-query path already supports multiple simultaneous targets;
  ordering is the missing piece)
- Listing copy refresh around concrete use cases ("auto-advance course
  players," "confirm two-step dialogs," "collect recurring bonuses") plus the
  trust story: open source, no build step, no data collection, minimal
  permissions

### P2 — Browser-game players (a reachable second audience)

The review corpus has clear gaming signal, but be precise about what's reachable:

- **In reach:** browser DOM games (Cookie Clicker, idle/incremental, button
  clickers, CPS-test sites). Clickster already clicks DOM elements; these
  players just need speed and ergonomics.
- **Partly in reach:** canvas/coordinate games — only if we dispatch real
  coordinate-bearing events (below).
- **Out of reach, permanently:** native desktop games (Minecraft, Roblox
  client). See Non-goals.

The crux is `clickSelectedElements`: it calls bare `element.ref.click()` (no
coordinates, click-only) and writes a border + 500ms `setTimeout` on *every*
click, which thrashes layout and caps throughput at speed.

- **Sub-second / CPS rate.** The popup only accepts whole seconds, though the
  internal interval is already milliseconds. Let users enter clicks-per-second.
  Practical ceiling is ~250 CPS (the HTML 4ms `setInterval` floor) — ample for
  idle games. Gate the per-click visual flash above a few CPS.
- **Dispatch real MouseEvents** — `mousedown`/`mouseup`/`click` carrying
  `clientX`/`clientY` at the element's center, instead of bare `.click()`. Helps
  games (canvas, hold mechanics) *and* the task automator (sites that ignore
  synthetic `.click()`), so it earns its keep twice.
- **Interval jitter (±N%).** Humanize timing where anti-bot exists — a rival's
  reviewer reported a Twitch ban for "booting."
- **Live CPS readout** in the popup (the playground HUD proves the idea).
- Hotkey toggle / hold-to-click overlaps the P2 hotkey item above; gamers want
  it most.

## Non-goals

- **Native desktop games** (Minecraft, Roblox client, any non-browser app). A
  browser extension cannot synthesize input outside the browser — full stop. The
  listing should say browser-games-only plainly, to set expectations and
  pre-empt "doesn't work in Minecraft" 1-stars. (Browser games like Cookie
  Clicker *are* in scope — see the gamer track.)
- **Always-on coordinate clicking detached from a target.** Element targeting is
  the differentiator and survives layout changes; clicking blind screen
  coordinates does not. (Dispatching coordinate-bearing events *at a targeted
  element* is fine and desirable — see the gamer track.)
- **Anything that isn't a plain, build-free web extension.** Shipped code
  stays unprocessed source (our AMO submissions declare no build tooling).
