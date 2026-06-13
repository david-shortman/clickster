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
   dialogs, course-ware Next buttons) shows up repeatedly. Clicks-per-second
   speed only matters to the gaming persona, which is a different product.

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

## Non-goals

- **High-CPS gaming clicks** (Roblox/Minecraft/Cookie Clicker speed-clicking).
  That persona wants OS-level input simulation and hotkey-at-cursor behavior —
  a different product with different risks.
- **Coordinate-based clicking.** Element targeting is the differentiator;
  screen coordinates break on every layout change.
- **Anything that isn't a plain, build-free web extension.** Shipped code
  stays unprocessed source (our AMO submissions declare no build tooling).
