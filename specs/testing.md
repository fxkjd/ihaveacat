# Testing

`npm test` runs `node --test` with nothing to install. Tests cover production
webpage code and assets only — keep development tooling out of the suite.

## Suites

- `test/moon.test.js` — pins the algorithm to published dates plus the moon's
  rendering invariants.
- `test/sky.test.js` — pins the astronomy to **published values** (Meeus
  examples 12.b and 13.b, Polaris-at-latitude geometry), never to our own
  output; plus catalog integrity, projection invariants, `parseView`, and
  sky.js purity. The star names are pinned the same way — index 0 is Sirius
  because the catalog is sorted brightest-first, not because we said so.
- `test/scene.test.js` — pins art fidelity byte-for-byte, sizing and layout
  sweeps, determinism and resize stability, placement, and the animations.
- `test/menu.test.js` — pins the panel's art byte-for-byte and its column
  alignment. Requiring the module in Node *is* the purity test: there is no
  `document`, so `install()` never runs and `rows()` has to stand alone.
- `test/page.test.js` — fallback drift, `file://`/script-order/case safety, CSP
  cleanliness, CSS class coverage for both the scene and the menu, and every
  UMD browser global.
- `test/browser.test.js` — **runs `main.js`** against a stub DOM and a stub
  frame clock, because the other suites only test the pure module and read
  `main.js` as text. Its clock deliberately starts at a large, page-load-relative
  value: a meteor loop that assumed the clock starts at zero passed every other
  test while the live page showed no shooting stars at all. The harness can
  also resize the window and flip `prefers-reduced-motion` mid-run, and can pin
  `Math.random` so a test can aim a flight exactly. `hover()` is a mouse
  `pointermove`; `tapAt()` replays a tap in a browser's order — pointer events,
  the finger's `pointerleave`, the compatibility `mousemove`, then a `click`
  with no `pointerType` — and sends the pointer events and the click to the
  window with a `target`, since the stub does not bubble and `main.js` hears
  taps there. Its `insertBefore` moves a fragment's children in, as
  `appendChild` does, so a patched row can be read back node for node — the
  lit-star test checks the row-mates are the *same* nodes, not equal ones.

## Harness traps

The browser stubs must behave like browsers do, or a regression passes green:

- The stub `hashchange` fires only when the fragment actually changes (see
  [settings-panel.md](settings-panel.md)); one that always fired would hide a
  panel that waits for its own event.
- The stub `matchMedia` used to ignore its argument, so `(hover: hover)`
  answered with the reduced-motion state. It answers only the reduced-motion
  query now; anything else is `false`.
- At the default 1400×900 the grid *exactly* fills the window, so `rect.top` is
  0 and code ignoring the wrapper's bottom anchoring passes. Hover tests run at
  1400×939 and assert `top > 0`.
