# ihaveacat

Source code for https://ihavea.cat/ — a single-page ASCII-art site: stars, a cat
("Sóc un gat"), and a moon whose art renders the **real current lunar phase**,
computed from the date on each page load (8 standard phases: new → waxing
crescent → first quarter → waxing gibbous → full → waning gibbous → last
quarter → waning crescent).

## Commands

- `npm test` — runs `node --test` (built-in runner, nothing to install).
- `open index.html` — view the page; it must always work via `file://`.

## Hard constraints

- Pure HTML + vanilla JS. **Zero dependencies**, runtime and tests.
- No build step, no dev server, no ES modules — classic scripts only, so the
  page works opened directly from the filesystem.
- Art fidelity: the cat, stars, and fence stay exactly as in the original art;
  the moon keeps its silhouette and its M/8/& + `moon-1/2/3` color-band style.
- The static moon markup in `index.html` is the no-JS fallback — don't remove it.
- No extras by explicit owner decision: no `?date=`/`?phase=` URL params, no
  phase-name label.

## Architecture

- `js/moon.js` — ALL logic, pure and DOM-free (UMD-lite: `window.MoonPhase` in
  the browser, `module.exports` under Node). Phase math + ASCII cell generation.
- `js/main.js` — browser wiring only; rebuilds the `pre .moon-row` spans with
  `createElement`/`textContent` (no `innerHTML`).
- `test/moon.test.js` — `node:test` + `node:assert/strict`. Pins the algorithm
  to published astronomical dates and asserts rendering invariants (silhouette
  preserved, waxing/waning orientation, mirror symmetry, terminator presence).
- `css/style.css`, `favicon.ico` — original site assets, unchanged.

## Moon algorithm

Days since the known new moon of 2000-01-06 18:14 UTC, mod the synodic month
(29.530588853 d), gives the phase fraction; `phaseIndex = Math.round(f * 8) % 8`
puts each phase in a window centered on the astronomical event (±1.85 d).
Waxing lights from the right, waning from the left (Northern Hemisphere).
Cells are shaded against the global 13-column disc width, giving a straight
vertical terminator; the waning crescent exactly reproduces the site's original
static art rows (`MMM88&&&&&&&&`).
