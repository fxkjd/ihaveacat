# ihaveacat

Source for https://ihavea.cat/ — a single-page ASCII-art scene: stars, a cat
("Sóc un gat"), a fence with a lawn, and a moon showing the **real current lunar
phase**, computed from the date on each page load.

With JavaScript on, the scene composes to fill the window at any size: the cat
and moon hold a constant proportion of the viewport while the sky and ground
fill whatever is left. With JavaScript off, the static art in `index.html`
shows instead.

## Commands

- `npm test` — `node --test`, nothing to install.
- `open index.html` — must always work over `file://`.
- CI runs the suite on PRs and pushes to `main` (`.github/workflows/ci.yml`).

## Hard constraints

- Pure HTML + vanilla JS, **zero dependencies** in runtime and tests. No build
  step, no dev server, no ES modules — classic scripts only.
- **No inline `<script>`, `<style>`, `style=` or `on*` in `index.html`.** The
  live site sends `Content-Security-Policy: default-src 'self'`, which blocks
  them *silently* — whatever they set up simply never happens. Load-time work
  goes in an external script, or `main.js` applies it through CSSOM
  (`el.style.x = …`, which CSP does allow).
- **The `<pre>` must declare an explicit monospace family.** Left to the UA
  default, Firefox resolves it to `-moz-fixed`, which `main.js` cannot copy onto
  its measuring probe — it then measures a *proportional* font and mis-sizes the
  entire grid.
- **Art fidelity**: the cat, star glyphs and fence pattern stay as in the
  original art; the moon keeps its silhouette and `moon-1/2/3` bands.
- **The static art in `index.html` is the no-JS fallback** — don't remove it.
- Owner decisions: no `?date=`/`?phase=` URL params, no phase-name label.

All of the above are enforced by tests.

## Architecture

- `js/moon.js` — phase math and moon cell generation. Pure, DOM-free, UMD-lite
  (`window.MoonPhase` / `module.exports`).
- `js/scene.js` — composes the whole scene for a grid size: sizing math
  (`fitFontSize`/`fitGrid`), `layout()`, sprite data, and seeded placement of
  stars, lawn, weathering and vines. **Pure**: no DOM, no `Date`, no
  `Math.random`, no timers. It does *not* require `moon.js` — callers pass
  `MoonPhase.renderMoonRows(phase)` in, so the two stay independently testable.
- `js/main.js` — browser wiring only. Measures character metrics with an
  offscreen probe, derives font and grid size from the viewport, and paints into
  `<pre id="scene">` with `createElement`/`textContent` (never `innerHTML`).
  Owns **all timing and randomness**. Each row is its own `<span>`, so an
  animation frame repaints only the rows that changed. If anything fails before
  the first paint, the static fallback is left alone.
- `css/style.css` — site styling, the monospace stack with ligatures and kerning
  disabled (a coding font ligating `/\`, `=\`, `===` would break the character
  grid), and the `.fence`/`.lawn`/`.vine`/`.meteor`/star classes. The bare `pre`
  rules are the no-JS fallback's layout; `main.js` overrides them inline.
- `test/moon.test.js` — pins the algorithm to published dates plus the moon's
  rendering invariants.
- `test/scene.test.js` — pins art fidelity byte-for-byte, sizing and layout
  sweeps, determinism and resize stability, placement, and the animations.
- `test/page.test.js` — fallback drift, `file://`/script-order/case safety, CSP
  cleanliness, CSS class coverage, and both UMD browser globals.

## Scene rules

- **The cat and moon hold a constant proportion of the window** at every size,
  and they and the fence are always fully visible. The always-visible core is
  45×29 cells; `BASE_COLS` (53) × `BASE_ROWS` (44) is the smallest grid it fits
  in, and `fitGrid` never returns less. There is deliberately **no font-size cap
  or floor**: a cap breaks "constant proportion", a floor breaks "always
  visible", and a 4K window rendering proportionally larger characters is the
  requirement working, not a bug. To make the art smaller relative to the
  window, raise `BASE_ROWS` (in practice `TOP_PAD_ROWS`) — the only intended knob.
- **The moon is anchored to the cat**, `MOON_CAT_GAP_ROWS` (8) above it, never to
  the top of the screen. The cat hangs off the bottom via the fence, so anchoring
  the moon to row 0 made the gap grow without bound on tall windows.
- **The fence spans the whole viewport**, running off both edges, so it has no
  visible end. A fixed-width fence ended in a full-height post that read as an
  ugly cut, and a tapered end still left a drop.
- **The fence stays subordinate to the cat and moon** — muted brown `.fence`,
  weathered with occasional sagging and missing pickets, and sparse `.vine`
  climbers. At the cat's white it outweighed the cat itself.
- **The pickets around the cat's tail (core cols 8–20) are never weathered or
  vined** — the tail weaves through them. Enforced in `picketState`/`vineRows`.
- **The cat's silhouette is entirely white.** It stands *in front of* the fence,
  so the rail is occluded across its base and the tail region takes the cat's
  colour. Otherwise the rail's brown butts into the leg tips and closes the gap
  between the legs, greying out the cat's base.
- Star density stays near the original ~1.1% (one per ~88 sky cells) at any size.
- `GROUND_EXTRA_ROWS` (2) is the lawn's thickness, drawn strictly below the
  fence; `LAWN_ROW_DENSITY` must have exactly that many entries. It is balanced
  against `TOP_PAD_ROWS` (13) to keep `BASE_ROWS` at 44 — change them as a pair
  unless you mean to resize the art.
- `CORE_COLS` (45) is the width reserved for the cat and moon, not the fence
  (which is unbounded).

## Animations

Scheduled from `main.js`; `scene.js` takes the current `tailFrame` and `meteor`
head as plain inputs and stays pure.

- **Tail wag** — every 5–10 s, a full sweep through `TAIL_WAG_SEQUENCE` at
  ~180 ms per frame, then back to rest.
- **Shooting star** — every 20–30 s on one of seven random `METEOR_PATHS`. It
  enters above the top edge and exits below the sky, so it never pops in or out.

Rules:

- **`buildScene` with no animation options renders exactly the resting page**, so
  the feature cannot drift the static scene.
- The tail is blitted **in front of** the fence and vines and erases what it
  covers; posts under it return on their own as it swings past. Boxing it in to
  protect those posts once limited it to a tiny rightward twitch.
- Fence row 0 never animates — it is the cat's rear (`CAT_BASE_ART`), where the
  tail attaches. Poses cover fence rows 1–3 only.
- The tail is a **pendulum** (attachment travels least, tip most) and its glyphs
  express **slope**: `/`, `\`, `|`, and the curved parens at rest. Using the same
  curves at every pose made it look like it was teleporting rather than rotating.
- Meteor trails are generated: `meteorCells` walks back along the flight line one
  cell at a time on the dominant axis, using **one stroke glyph** taken from the
  path's overall slope, fading to `.`. Stepping by raw `dx/dy` leaves gaps off
  45°, and per-cell glyphs produced a `- - \ - - \` staircase on shallow paths.
- **A meteor dies on contact with the cat's bounding box**, not its glyphs: the
  cat is an outline, so most of its box is blank and a glyph test let streaks
  draw straight through its body. The fence needs no such test — cells at or
  below the horizon are clipped, so meteors slide behind it.
- Both are skipped under `prefers-reduced-motion`, matching the CSS twinkle guard.

## Determinism

Stars, lawn, weathering and vines are placed by `hash2` over core-relative
coordinates with no randomness source, so the scene is identical on every load
and *translates* rather than reshuffles when the window resizes.

Two traps live here:

- `picketState` takes its hash bits with `>>> 12`. `hash2`'s low bits are
  measurably biased for post columns (all multiples of 3) and skewed the rates.
- `fenceChar` is the plain unweathered pattern and feeds `FENCE_ART`, and so the
  no-JS fallback; `fenceSceneChar` is the weathered one the live scene draws.
  Keep them separate.

## Moon algorithm

Days since the known new moon of 2000-01-06 18:14 UTC, mod the synodic month
(29.530588853 d), give the phase fraction; `phaseIndex = round(f * 8) % 8` puts
each phase in a window centred on the astronomical event (±1.85 d). Waxing
lights from the right, waning from the left (Northern Hemisphere). Cells are
shaded against the 13-column disc width, giving a straight vertical terminator;
the waning crescent exactly reproduces the original static art rows
(`MMM88&&&&&&&&`).
