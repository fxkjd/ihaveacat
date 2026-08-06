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
- Owner decisions: no `?date=`/`?phase=` URL params, no phase-name label —
  **time is never configurable**. The sky's *vantage point* is, via the URL
  hash fragment: `#lat=<float>&lon=<float>&dir=<n|s|e|w>` (the fragment stays
  out of server logs and CDN cache keys, and retunes live on `hashchange`).

All of the above are enforced by tests.

## Architecture

- `js/moon.js` — phase math and moon cell generation. Pure, DOM-free, UMD-lite
  (`window.MoonPhase` / `module.exports`).
- `js/sky.js` — the real night sky. A vendored star catalog (HYG v4.1,
  CC BY-SA 4.0; 1,637 stars to magnitude 5.0, whole sphere, brightest-first)
  plus textbook sidereal-time and alt/az math (Meeus), a 1°-per-column /
  2°-per-row projection with the fence as the horizon, and `parseView` for the
  URL hash. Pure like moon.js: the **date is an argument** — no clock, no
  randomness, no DOM (enforced by a test). The catalog is the map, not the
  view: seasons and hours come from the sidereal formula, and the data itself
  is good for decades (proper motion ~900 yr/cell; precession ~0.36° since
  J2000, uncorrected on purpose).
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
- `test/sky.test.js` — pins the astronomy to **published values** (Meeus
  examples 12.b and 13.b, Polaris-at-latitude geometry), never to our own
  output; plus catalog integrity, projection invariants, `parseView`, and
  sky.js purity.
- `test/scene.test.js` — pins art fidelity byte-for-byte, sizing and layout
  sweeps, determinism and resize stability, placement, and the animations.
- `test/page.test.js` — fallback drift, `file://`/script-order/case safety, CSP
  cleanliness, CSS class coverage, and both UMD browser globals.
- `test/browser.test.js` — **runs `main.js`** against a stub DOM and a stub
  frame clock, because the other suites only test the pure module and read
  `main.js` as text. Its clock deliberately starts at a large, page-load-relative
  value: a meteor loop that assumed the clock starts at zero passed every other
  test while the live page showed no shooting stars at all. The harness can
  also resize the window and flip `prefers-reduced-motion` mid-run, and can pin
  `Math.random` so a test can aim a flight exactly.

Both traps above were the same testing mistake: **asserting only at the tidy
value**. A flying meteor is never on a whole row and a frame clock never starts
at zero, so anything checked only at row 40 or time 0 is checked at the one
point that cannot fail. Sweep the fractional row; start the clock late.

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
- **The stars are the real sky** — Barcelona looking south by default, any
  vantage via the hash fragment, frozen at the load instant (refreshing is how
  time advances; same contract as the moon phase). `SKY_MAG_LIMIT` (3.6) is
  the one density knob, calibrated to the original ~1.1%; brightness maps to
  the original glyphs (`*` ≤ 2.0, `'` ≤ 3.0, `.` fainter). **The moon stays
  anchored above the cat wherever the real moon is — the one unreal object,
  on purpose.** The seeded hash stars remain as scene.js's fallback whenever
  no `stars` input is supplied (tests, no-sky environments), still at ~1.1%.
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
  ~180 ms per frame, then back to rest. It steps between poses rather than
  moving anything continuously, so it stays on `setTimeout` deliberately;
  `requestAnimationFrame` would buy it nothing.
- **Shooting star** — every 20–30 s on one of the two `METEOR_PATHS`: the cell
  diagonal, down-left or down-right. The flight is aimed at a point in the open
  sky and extended outwards until the whole streak is off-screen at both ends,
  so it never pops in or out; on a narrow window it may leave through a side
  edge rather than the bottom.

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
- **The cell diagonal is the only slope, and this is settled.** `\` and `/` run
  corner to corner, so on a one-column-per-row diagonal every glyph touches the
  next and the streak is a single unbroken line. Nothing else in ASCII joins up:
  `-` connects only along a row, `|` only down a column, and the baseline glyphs
  `` ` `` `-` `.` only within a row. Shallow paths (drawn `---`, later `` `-. ``)
  and steep ones (drawn `|`) were each built out in full and each read as a
  staircase or a ladder of detached marks. Don't add them back.
- Because the slope is exactly one cell per row, a streak has **no sub-cell
  resolution**: it advances a whole cell at a time and the whole trail moves
  together. That is the floor on how smooth an ASCII meteor gets. It is not a
  defect awaiting cleverer glyphs — the cleverer glyphs were the staircase.
- The tail thins to `.` behind the stroke, so it does not end on a hard edge.
- **`METEOR_CELLS_PER_SEC` is the only speed knob** — grid cells per second
  along the flight, roughly one cell per frame at 60 Hz.
- **The flight runs on `requestAnimationFrame`, positioned from elapsed time.**
  Never a frame count on a timer: `setTimeout` lands between refreshes, so each
  step was held for one, two or three of them in an uneven pattern and every
  hiccup became a stumble. Time-based position also means a dropped frame costs
  nothing, and a backgrounded tab ends the flight cleanly instead of replaying it.
- **Never hand the loop a made-up first timestamp.** `rAF` counts from page
  load, not from zero, so kicking the loop off yourself with `frame(0)` made the
  first real callback look thousands of milliseconds late: every flight jumped
  straight past its own end and the page ran with no meteors at all, silently.
  Start it with `requestAnimationFrame(frame)` and let the first callback set
  the origin. Covered by `test/browser.test.js`.
- `main.js` carries the head at a fractional position because position comes
  from elapsed time; `meteorCells` and `meteorAlive` round it. Keep the flying
  position fractional and the rounding at the edges — rounding early quantises
  the *timing* as well as the drawing, which is what made it stumble.
- **`runMeteor` re-derives the layout every frame** instead of reusing its
  launch copy — only the aim comes from launch. `buildScene` always draws with
  the current grid, so judging the flight against the launch layout let a
  mid-flight resize move the moon into the path: the streak vanished crossing
  the disc's new position, then re-emerged below it and flew on through the
  very thing it is supposed to die against.
- **A meteor dies on contact with the cat's or the moon's bounding box** — both
  by box, never by glyph. The cat is an outline, so most of its box is blank and
  a glyph test let streaks draw straight through its body. The moon needs it for
  a different reason: drawing the streak across the disc looked wrong, and
  merely hiding the overlapping cells was worse, swallowing the head and leaving
  a stub of trail hanging behind it. Killing the whole meteor is the wanted
  behaviour. `meteorAlive` rounds the head first so the test matches the cell
  actually drawn; judging the fraction let a head just outside a box put its
  glyph just inside it and get clipped.
- Meteors overwrite stars and nothing else. The fence needs no test — cells at
  or below the horizon are clipped, so meteors slide behind it.
- Both honour `prefers-reduced-motion` **live**, matching the CSS twinkle guard
  (a media query, so the stars stop the instant the OS setting flips — sampling
  it once at load left the JS animations running until reload). `motionGen` is
  a generation counter: every flip bumps it, every timer/rAF chain carries the
  generation it started with and dies silently on mismatch. That stops running
  chains without keeping handles to them, and makes restarts idempotent — a
  timer still pending from before the flip cannot revive a second chain.

## Determinism

Lawn, weathering and vines are placed by `hash2` over core-relative
coordinates with no randomness source; the real sky depends only on the load
instant and the hash-fragment vantage. Either way the scene is identical for
a given moment and *translates* rather than reshuffles when the window
resizes — a wider grid reveals more sky at the edges without moving what is
already shown.

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
