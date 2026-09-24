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
- Tests cover production webpage code and assets only, not development tools.
  Keep development tooling out of the test suite.
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

## Specs

Each area's rules — and the reasons behind them, most of them learned the hard
way — live in `specs/`. **Read the relevant spec before changing that area**,
and update it in the same change when a rule moves.

- [Scene](specs/scene.md) — sizing, layout, fence, cat, lawn, determinism.
- [Sky and moon](specs/sky.md) — star catalog, projection, star density, moon
  phase algorithm.
- [Animations](specs/animations.md) — tail wag, shooting stars, fireflies,
  reduced motion.
- [Settings panel](specs/settings-panel.md) — the gear menu, the URL fragment,
  persisted display settings.
- [Constellations](specs/constellations.md) — figure lines, masking, figure
  hover and tap.
- [Star names](specs/star-names.md) — the hover- and tap-to-name lookup and its
  label.
- [Testing](specs/testing.md) — what each suite pins, the browser harness and
  its traps.

## Architecture

Classic scripts sharing UMD-lite globals (`window.X` / `module.exports`). The
pure modules take everything — date, grid size, phase, animation state — as
arguments: **no DOM, no `Date`, no `Math.random`, no timers** (enforced by
tests).

- `js/moon.js` — `MoonPhase`: phase math and moon cell generation. Pure.
- `js/constellations.generated.js` — 88 figures as catalogue-index pairs;
  loads before `sky.js`.
- `js/sky.js` — `SkyMap`: the real night sky. A vendored HYG v4.1 catalog and
  star-name tables, Meeus sidereal and alt/az math, the grid projection with
  the fence as the horizon, and `parseView`/`formatView` for the URL hash.
  Pure: the **date is an argument**.
- `js/scene.js` — `Scene`: composes the whole scene for a grid size — sizing
  (`fitFontSize`/`fitGrid`), `layout()`, sprites, seeded placement of stars,
  lawn, weathering and vines, and `buildScene`. Pure. It does *not* require
  `moon.js`: callers pass `MoonPhase.renderMoonRows(phase)` in, so the two stay
  independently testable.
- `js/main.js` — browser wiring only. Measures character metrics with an
  offscreen probe, derives font and grid size from the viewport, and paints
  into `<pre id="scene">` with `createElement`/`textContent` (never
  `innerHTML`), one `<span>` per row so a frame repaints only the rows that
  changed. Owns **all scene animation timing and randomness**, the
  constellation overlay and the star-name hover and tap. If anything fails
  before the first paint, the static fallback is left alone.
- `js/menu.js` — the settings panel. `rows(fields, settings)` is **pure** art in
  `scene.js`'s `{text, cls}` shape; `install()` is the wiring. It reaches
  `main.js` only through channels the browser owns — the URL fragment and a
  `settingschange` `CustomEvent` on `window` — and **never by reference, on
  purpose**: the panel, the address bar, a shared link and the Back button are
  then one code path, and the URL always says what is drawn.
- `css/style.css` — site styling, the monospace stack with ligatures and kerning
  disabled (a coding font ligating `/\`, `=\`, `===` would break the character
  grid), and a rule for every class the scene and menu emit. The bare `pre`
  rules are the no-JS fallback's layout; `main.js` overrides them inline.
- `test/` — one suite per module, plus `page` (HTML/CSS/CSP contract) and
  `browser` (runs `main.js` against a stub DOM and frame clock).

The scene is identical for a given moment and *translates* rather than
reshuffles when the window resizes. Chrome (the panel, the name label) never
paints into `<pre id="scene">` and never scales with the art.

## Testing lesson

**Never assert only at the tidy value.** A flying meteor is never on a whole
row and a frame clock never starts at zero, so anything checked only at row 40
or time 0 is checked at the one point that cannot fail — a meteor loop that
assumed a zero clock passed every other test while the live page showed no
shooting stars at all. Sweep the fractional row; start the clock late.

## Settled decisions

The owner has decided these; don't reopen them. The reasons are in the specs.

- The scene has **no font-size cap or floor**; `BASE_ROWS` (in practice
  `TOP_PAD_ROWS`) is the only size knob. ([scene](specs/scene.md))
- The moon stays anchored above the cat — the one unreal object in a real
  sky. ([sky](specs/sky.md))
- Meteors fly **only on the cell diagonal**; shallow and steep paths were each
  built and rejected. ([animations](specs/animations.md))
- Fireflies blink in place, **only in the lawn rows**.
  ([animations](specs/animations.md))
- Constellations on forces high star density; turning them off leaves high
  selected. ([settings panel](specs/settings-panel.md))
- The `names` checkbox is the one switch for everything that answers the
  pointer, stars and figures alike. ([star names](specs/star-names.md))
- Highlighting the hovered star is a dead end. ([star names](specs/star-names.md))
- The panel has no click-outside-to-close, no geolocation and no presets: the
  fragment *is* the state. ([settings panel](specs/settings-panel.md))
