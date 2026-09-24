# Animations

Scheduled from `main.js`; `scene.js` takes the current `tailFrame`, `meteor`
head and `fireflies` as plain inputs and stays pure.

- **Tail wag** — every 5–10 s, a full sweep through `TAIL_WAG_SEQUENCE` at
  ~180 ms per frame, then back to rest. It steps between poses rather than
  moving anything continuously, so it stays on `setTimeout` deliberately;
  `requestAnimationFrame` would buy it nothing.
- **Shooting star** — every 20–30 s on one of the two `METEOR_PATHS`: the cell
  diagonal, down-left or down-right. The flight is aimed at a point in the open
  sky and extended outwards until the whole streak is off-screen at both ends,
  so it never pops in or out; on a narrow window it may leave through a side
  edge rather than the bottom.
- **Fireflies** — `FIREFLY_MAX` (2) independent slots; each lights a random
  lawn cell, steps dim → bright → dim through `FIREFLY_BLINK_SEQUENCE` (~2.8 s
  at `FIREFLY_STEP_MS` per pose), goes dark for 3–7 s, then lights somewhere
  new. They blink **in place** — no drifting. Discrete poses, so `setTimeout`
  like the wag; brightness is colour classes repainted by JS, not a CSS
  keyframe, so the reduced-motion CSS list needs no entry for them.
  `FIREFLY_MIN_MS`/`FIREFLY_MAX_MS` (the gap range) is the density knob.

**`buildScene` with no animation options renders exactly the resting page**, so
the feature cannot drift the static scene.

## Tail

- The tail is blitted **in front of** the fence and vines and erases what it
  covers; posts under it return on their own as it swings past. Boxing it in to
  protect those posts once limited it to a tiny rightward twitch.
- Fence row 0 never animates — it is the cat's rear (`CAT_BASE_ART`), where the
  tail attaches. Poses cover fence rows 1–3 only.
- The tail is a **pendulum** (attachment travels least, tip most) and its glyphs
  express **slope**: `/`, `\`, `|`, and the curved parens at rest. Using the same
  curves at every pose made it look like it was teleporting rather than rotating.

## Shooting stars

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

## Fireflies

- **Fireflies exist only in the lawn rows** — the owner's decision. `buildScene`
  clips them against the CURRENT layout's ground band (and the grid) and drops
  the rest silently, so one spawned before a resize can never surface on the
  fence or in the sky — it goes dark and the next blink spawns on the new grid.
  Each spawn picks its cell from the current `last` grid; the two slots may
  rarely coincide, which draws one glyph and is harmless.

## Reduced motion

All of them honour `prefers-reduced-motion` **live**, matching the CSS twinkle
guard (a media query, so the stars stop the instant the OS setting flips —
sampling it once at load left the JS animations running until reload).
`motionGen` is a generation counter: every flip bumps it, every timer/rAF
chain carries the generation it started with and dies silently on mismatch.
That stops running chains without keeping handles to them, and makes restarts
idempotent — a timer still pending from before the flip cannot revive a second
chain. The change listener also clears `anim.fireflies` — the `gen` check only
stops the chain, and without the reset a lit glow froze on screen (invisible
to a byte-stillness assertion; `test/browser.test.js` checks the snuff
explicitly).
