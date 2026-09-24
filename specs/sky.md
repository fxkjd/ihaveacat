# Sky and moon

The stars are the real night sky and the moon shows the real lunar phase, both
computed on each page load. Code: `js/sky.js`, `js/moon.js`,
`js/constellations.generated.js`. Pinned by `test/sky.test.js` and
`test/moon.test.js` (see [testing.md](testing.md)).

## `js/sky.js`

- A vendored star catalog (HYG v4.1, 1,637 stars to magnitude 5.0 plus 20
  constellation endpoints, whole sphere, brightest-first; maintained directly
  in `js/sky.js`) plus textbook sidereal-time and alt/az math (Meeus), a
  1°-per-column / 2°-per-row projection with the fence as the horizon, and
  `parseView` for the URL hash.
- It also carries `NAMES`/`IDS` — parallel to the catalog by index, covering
  every star down to `SKY_MAG_LIMIT` — plus `EXTRA_NAMES`/`EXTRA_IDS`, keyed by
  index, for the constellation endpoints below it, and `starLabel(index)` over
  both (see [star-names.md](star-names.md)). `visibleSegments` tags each edge
  with the figure that drew it, and `figureName(i)` spells that figure out.
- `js/constellations.generated.js` loads before sky.js and contains 88 figures
  as catalogue-index pairs, maintained directly alongside the star catalogue
  (see [constellations.md](constellations.md)).
- Pure like moon.js: the **date is an argument** — no clock, no randomness, no
  DOM (enforced by a test).
- The catalog is the map, not the view: seasons and hours come from the
  sidereal formula, and the data itself is good for decades (proper motion
  ~900 yr/cell; precession ~0.36° since J2000, uncorrected on purpose).

## What is drawn

- **The stars are the real sky** — Barcelona looking south by default, any
  vantage via the hash fragment, frozen at the load instant (refreshing is how
  time advances; same contract as the moon phase).
- The panel's star density picks the cutoff: `SKY_MAG_LIMIT` (3.6) is
  **medium**, the default, calibrated to the original ~1.1%; **low** is
  `SKY_LOW_MAG_LIMIT` (3.3, the owner's choice); **high** is medium plus every
  constellation endpoint down to magnitude 6.5 — exactly what the figures
  draw. `starEnabled(index, density)` is the one predicate, and any other
  density reads as medium. How the panel sets it, and why constellations lock
  it to high, is in [settings-panel.md](settings-panel.md).
- Brightness maps to the original glyphs (`*` ≤ 2.0, `'` ≤ 3.0, `.` fainter).
- **The moon stays anchored above the cat wherever the real moon is — the one
  unreal object, on purpose.**
- The seeded hash stars remain as scene.js's fallback whenever no `stars` input
  is supplied (tests, no-sky environments), still at ~1.1%.

## Moon algorithm (`js/moon.js`)

Days since the known new moon of 2000-01-06 18:14 UTC, mod the synodic month
(29.530588853 d), give the phase fraction; `phaseIndex = round(f * 8) % 8` puts
each phase in a window centred on the astronomical event (±1.85 d). Waxing
lights from the right, waning from the left (Northern Hemisphere). Cells are
shaded against the 13-column disc width, giving a straight vertical terminator;
the waning crescent exactly reproduces the original static art rows
(`MMM88&&&&&&&&`).
