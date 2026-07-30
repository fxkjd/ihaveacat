# ihaveacat

Source code for https://ihavea.cat/ — a single-page ASCII-art site: stars, a cat
("Sóc un gat"), a fence with a lawn, and a moon whose art renders the **real
current lunar phase**, computed from the date on each page load (8 standard
phases: new → waxing crescent → first quarter → waxing gibbous → full → waning
gibbous → last quarter → waning crescent).

The scene is **responsive**: it composes to fill the browser window at any size,
with JavaScript enabled. The cat, moon and fence keep a constant proportion of
the window (they grow with it) and are always fully visible; the sky fills with
stars and the ground with a lawn to use whatever space is left.

## Commands

- `npm test` — runs `node --test` (built-in runner, nothing to install).
- `open index.html` — view the page; it must always work via `file://`.
- CI runs the same suite on pull requests and pushes to `main`
  (`.github/workflows/ci.yml`).

## Hard constraints

- Pure HTML + vanilla JS. **Zero dependencies**, runtime and tests.
- No build step, no dev server, no ES modules — classic scripts only, so the
  page works opened directly from the filesystem.
- Art fidelity: the cat, star glyphs, and fence pattern stay exactly as in the
  original art; the moon keeps its silhouette and its M/8/& + `moon-1/2/3`
  color-band style.
- **The cat and moon keep a constant proportion of the window at every size**
  (owner decision) — they grow with the window rather than being capped at a
  fixed pixel size. There is deliberately no font-size cap; see "Sizing" below
  for the one knob that *is* meant to be tuned.
- **The fence, cat and moon are always fully visible**, at any window size.
- **The fence spans the whole viewport, running off both edges** (owner
  decision). It deliberately has no visible end: when it stopped at a fixed
  width it terminated in a full-height post, and that 6-row vertical cut into
  the lawn read as an ugly "steep" edge. A tapered end was tried and rejected —
  even after stepping down it left a noticeable drop. This supersedes the
  earlier decision that the fence stay ~45 columns wide.
- **The fence must stay visually subordinate to the cat and moon.** Because it
  now spans the viewport, it had to stop being pure white — at the cat's own
  colour it outweighed the cat itself. It is `.fence` (muted slate), weathered
  with occasional sagging/missing pickets, and carries sparse green `.vine`
  climbers. Do not restore it to the body's white.
- **The pickets around the cat's tail (core cols 8-20) are never weathered or
  vined** — the tail weaves through them and detaches if a post there sags or
  disappears. `Scene.picketState` and `Scene.vineRows` both enforce this, and
  tests pin it.
- **The cat's silhouette must be entirely white.** The cat stands *in front of*
  the fence, so the rail row is occluded across its base (`CAT_BASE_WIDTH`
  columns from `CAT_COL`) and the whole tail patch renders in the cat's colour.
  Without the occlusion the rail's brown peaks butt into the cat's leg tips and
  the legs look like they turn brown; without the white tail patch the rail
  closes the gap between the legs and greys out the cat's base.
- Star density stays close to the original art's (~1.1%, about one star per 88
  sky cells) at every window size.
- The static moon markup in `index.html` is the no-JS fallback — don't remove
  it. It renders as today's fixed, non-responsive art when JavaScript is off.
- No extras by explicit owner decision: no `?date=`/`?phase=` URL params, no
  phase-name label.

## Architecture

- `js/moon.js` — moon phase math + ASCII cell generation, pure and DOM-free
  (UMD-lite: `window.MoonPhase` in the browser, `module.exports` under Node).
- `js/scene.js` — composes the full scene (sky + stars, moon, cat, fence, lawn)
  for a given grid size. Pure and DOM-free, same UMD-lite shape as `moon.js`,
  and does **not** require `moon.js` — callers pass rendered moon rows in via
  `MoonPhase.renderMoonRows(phase)`, so the two modules stay independently
  testable. Owns the sizing math (`fitFontSize`/`fitGrid`), the layout
  (`layout`), the sprite data (fence generator + tail patch, cat art, moon
  placement), and the seeded, dependency-free placement of stars and lawn
  tufts (no `Math.random`, so output is deterministic).
- `js/main.js` — browser wiring only: measures monospace character metrics with
  an offscreen probe, derives the font size and grid size from the viewport via
  `Scene`, and paints the result into `<pre id="scene">` with
  `createElement`/`createTextNode`/`textContent` (no `innerHTML`). Re-renders on
  resize. If anything fails before the first paint, the static fallback art is
  left in place rather than cleared.
- `test/moon.test.js` — `node:test` + `node:assert/strict`. Pins the algorithm
  to published astronomical dates and asserts rendering invariants (silhouette
  preserved, waxing/waning orientation, mirror symmetry, terminator presence).
- `test/scene.test.js` — pins art fidelity (fence/cat reproduce the original
  site art byte-for-byte), the sizing math (worked examples plus a sweep
  guaranteeing the core composition never overflows the viewport), layout
  invariants across a wide range of grid sizes, determinism and resize
  stability (growing the grid translates the star field instead of
  reshuffling it), star/lawn placement, and moon integration.
- `test/page.test.js` — checks the static fallback art hasn't silently drifted
  from `js/scene.js`, `file://`/script-order/case-sensitivity safety, that
  every CSS class the scene can emit is actually styled, and that both UMD
  modules expose their browser global correctly.
- Vines spiral: leaves alternate sides of the post as they climb, both sides at
  the rooted base, thinning to a tendril at the tip. A straight column of glyphs
  beside the post was tried first and read as a dotted line, not a plant. Two
  neighbouring posts never both carry a vine — their leaves meet and read as a
  hedge, the same failure mode as adjacent missing pickets.
- Fence weathering and vines are deterministic (`hash2` on core-relative picket
  columns, no randomness source), so the fence is identical on every load and
  does not reshuffle while the window is resized. Note `picketState` extracts
  hash bits with `>>> 12`: `hash2`'s low bits are measurably biased for post
  columns (all multiples of 3) and skewed the rates badly. `fenceChar` stays the
  plain unweathered pattern so `FENCE_ART` — and therefore the no-JS fallback in
  `index.html` — is unaffected; `fenceSceneChar` is the weathered one the scene
  actually draws.
- `css/style.css` — original site styling plus the full-bleed responsive rules
  (`html.js` scope), an explicit monospace stack with ligatures/kerning
  disabled (a coding font's default ligatures for `/\`, `=\`, `===` would
  silently break the character grid), and the `.lawn`/star-variant classes.
  The pre-JS fallback styling (`html:not(.js)`) keeps today's mobile
  `2.8vw` behavior unchanged.
- `favicon.ico` — original site asset, unchanged.

## Moon algorithm

Days since the known new moon of 2000-01-06 18:14 UTC, mod the synodic month
(29.530588853 d), gives the phase fraction; `phaseIndex = Math.round(f * 8) % 8`
puts each phase in a window centered on the astronomical event (±1.85 d).
Waxing lights from the right, waning from the left (Northern Hemisphere).
Cells are shaded against the global 13-column disc width, giving a straight
vertical terminator; the waning crescent exactly reproduces the site's original
static art rows (`MMM88&&&&&&&&`).

## Sizing

The always-visible "core" (moon + cat, in their original relative spacing, down
to the fence line) is 45×29 cells. `Scene.BASE_COLS` (53) and `Scene.BASE_ROWS` (44) are
the smallest grid the core fits in with a little padding; `Scene.fitGrid` never
returns anything smaller, which is what guarantees full visibility. Character
size is derived from the viewport (`Scene.fitFontSize`) so the core keeps a
constant proportion of the window — there is intentionally no pixel cap, since
a cap is exactly what would break that property. A 4K window rendering at
proportionally larger characters than 1080p is the requirement working as
intended, not a bug.

If the composition ever needs to look smaller relative to the window (e.g. on
very large displays), the constant to tune is **`Scene.BASE_ROWS`** (in
practice via `TOP_PAD_ROWS`, see below) — raising it shrinks every character
proportionally while keeping the core fully visible and centered. Do not add a
font-size cap or floor instead; both were considered and rejected because they
break "constant proportion" and "always visible" respectively.

**The moon is anchored to the cat, not to the top of the screen.** It sits a
fixed `Scene.MOON_CAT_GAP_ROWS` (8, matching the original static art's spacing)
rows above the cat at every grid size — `layout()` computes `moonBottom` from
`catTop`, not from row 0. Anchoring it to the screen top instead was tried and
was a bug: on a tall/portrait window the cat (anchored to the bottom via the
fence/`groundRow` chain) sinks lower while a top-anchored moon stays pinned
near the top edge, so the gap between them grows without bound. If the moon
ever needs repositioning, change `MOON_CAT_GAP_ROWS`, not the anchor.

`TOP_PAD_ROWS` (13) is the sky-row count above the moon *at the base grid
specifically* — it's what you tune to change the overall scale (see above), not
the moon's literal position at other sizes. `GROUND_EXTRA_ROWS` (2) is the
lawn's thickness: the lawn renders exactly that many rows, strictly *below* the
fence, full width, regardless of window height; `Scene.LAWN_ROW_DENSITY` must
have exactly that many entries.

These two are deliberately balanced so `BASE_ROWS` stays 44: when the fence
became full-width the lawn had to move a row down (its first row used to be the
fence's own base row, painted only in the gaps beyond the fence's ends — with no
ends left, that row would have rendered no grass at all). `GROUND_EXTRA_ROWS`
went 1→2 and `TOP_PAD_ROWS` 14→13 so the overall scale did not shift. Adjust
them as a pair unless you actually intend to resize the art.

`CORE_COLS` (45) no longer describes the fence — the fence is unbounded. It is
now just the width reserved for the cat and moon composition, and `fitGrid`
guarantees it always fits.
