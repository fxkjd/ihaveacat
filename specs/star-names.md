# Star names

Hovering a star with a mouse, or tapping near one with a finger or pen, names
it — the proper name where the star has one, otherwise the Bayer designation
spelled out, otherwise the catalogue number. Off by default, behind the panel's
`names` checkbox — named for both, not `star names`, because it names figures
too. With constellations on too, pointing at a line names the figure the same
way and lights the whole of it (see [constellations.md](constellations.md)). The lookup and label live in
`main.js`; the tables in `sky.js` (see [sky.md](sky.md)).

**The catalogue number appears only where the label is not really a name.**
`Vega` needs no HD number beside it; `Alpha Lupi` does, because a designation
is something you look up; and a star whose only name *is* `HD 82668` must not
say it twice. So 206 of the 343 show a bare name, 130 carry a number, and the
rest are a number standing alone.

## Hit test

- **The hit test is geometric, and has to be.** The sky is painted as merged
  runs, so two adjacent stars sharing a twinkle class are a single `<span>`
  with nothing to attach a listener to. Star identity cannot go in the class
  either: `cls` is pinned to `/^star( star-[123])?$/` and every emitted class
  needs a stylesheet rule. So the pointer is converted to a grid cell and
  looked up. **Highlighting the hovered star is a dead end** for the same
  reason — don't spend a day on it.
- The lookup is built from `Scene.starVisible`, **the same predicate
  `buildScene` uses**, because `starCells()` output is a *superset* of what is
  painted: anything in the moon, cat or fence halo is dropped. A second copy of
  that rule in `main.js` would drift silently — nothing would fail, a few stars
  would just be named while not being on the page.
- **Exact cell, no snap radius — for the mouse.** Stars are ~1.1% of cells, so
  a one-cell radius would make a tenth of the sky live and flicker between
  neighbours inside a constellation. Exact is the only rule that is honest,
  and the only one testable as a biconditional.
- **A tap reaches 22px** (`TOUCH_REACH_PX`, half the 44px touch target), for a
  star and a line alike, and names the nearest star by distance to its cell
  centre. A fingertip covers several cells — a phone's are ~6×12px — so an
  exact cell is all but untappable; and a tap is one discrete event, so the
  flicker that rules a radius out for the mouse never happens. The label is
  anchored to the star's cell, not the finger's.
- **The `names` checkbox is the one switch for anything answering the pointer**
  — the owner's decision. Hovering a figure lights it and writes its name into
  the same `.star-name` label only while names are on (and the figures, of
  course); with names off the lines are scenery and hold still, and a
  pointer move costs one comparison. Where both answer — near the end of a
  figure — the star wins the label and the figure still lights.
- **For a tap too the star wins** — the owner's decision, made knowing the
  cost: at 22px most points on a line have a named star in reach (65% on a
  phone, 58% on a desktop window), so tapping a line mostly lights its figure
  and names a star on it.
  A figure's own name comes from the middle of its longer lines.
- **Routed by `pointerType` per event, never by the device.** A mouse hovers
  (`pointermove`/`pointerleave`); a finger or pen taps. `(hover: hover)`
  describes only the *primary* pointer: it hid names from phones entirely, and
  on a touch-screen laptop a tap still lit a label nothing put out. Listening
  to pointer events rather than mouse events is itself the guard against the
  compatibility `mousemove` a tap synthesises, which no `mouseleave` follows.
- **A tap is a `click`**, typed by the `pointerdown` that began it (not every
  browser gives a click a `pointerType`). By then the browser has applied
  its own slop and ruled out a pan, a pinch or a long press — none of which
  click — so pinch-zoom keeps working with no `touch-action` on the scene. A
  mouse click is ignored: the mouse already names what it is over. `#scene`
  turns off `-webkit-tap-highlight-color`, or iOS flashes the whole scene grey
  on every tap.
- **A tap is looked up once, and then held by identity, never by pixel**: the
  star by catalogue index, the figure by id, and the cell to anchor a
  figure's label to. A setting that repaints the sky finds them again — or
  lets the tap go when neither is drawn any more. Held as a pixel and
  re-aimed the way the mouse rightly is, an empty tap followed by switching
  the figures on lit Orion, and raising the density handed the name to a
  faint star drawn nearer the finger.
- **A tapped name stays until the next tap**, which names what it lands near
  or, landing near nothing, puts the name away. A finger's `pointerleave`
  fires on every lift and is ignored. Names off, a new grid (a rotation, on a
  phone) or a new vantage drops it; a resize that keeps the grid does not.
- **Taps are heard on the window**, in the capture phase, and the target
  decides: the `<pre>`, its wrapper or the bare page around them is the
  scene — the grid hangs from the bottom of the window, and a tap in the strip
  above its first row still reaches the stars along it — and anything else,
  which is the gear or the open panel, puts the name away, or it would be left
  lit across the panel. `main.js` still never names the menu.
- **Not wired to `motionGen`.** The label does not animate, and gating it on
  reduced motion would take star names away from people who asked for less
  movement, not less information. A test pins that.
- `render()` ends in a *condition*, not an early return. The hoisted cell
  metrics must be assigned on every resize, including one that keeps the same
  cell count — an early return there once left them stale.

## Label

- The label is chrome: a `<span>` appended to `<body>`, **never inside
  `<pre id="scene">`**. A `<div>` would inherit the bare `div` rule and become
  a full-width banner pinned to the bottom of the window — plausible enough in
  a screenshot to be missed. It carries `pointer-events: none`, or it takes the
  very pointer move that positions it and flickers itself away.
- **The label never lies across the moon or the cat.** They are the subject of
  the picture; a name written over them reads as damage, and hiding the
  overlapping part would be worse. Placement tries below-right, below-left,
  above-right, above-left and takes the first that is on screen *and* clear of
  both — so the viewport edge and the two subjects share one rule rather than
  each getting their own special case. If nothing is clear it stays on screen
  and accepts the overlap, because vanishing would read as a broken feature.
  The test constructs the near-miss rather than hoping a star sits close
  enough, which depends on the date.

## Name tables

- The dense table stops at `SKY_MAG_LIMIT` rather than covering all 1,657
  stars, which keeps it at ~9 KB. Raising the limit fails a test rather than
  silently producing anonymous stars. The constellation endpoints below the
  limit — 438 of them, reaching magnitude 6.5 — are named by a second,
  index-keyed table instead of extending the first: that way the invariant
  above stays pinned on exactly what a plain sky names, and the ~900 catalogue
  entries no figure ever touches cost nothing. A star nothing draws stays
  unnamed, and a test pins that too.
- **Both lookups go through `hasOwnProperty`.** A plain `NAMES[index]` answers
  `'constructor'` with a Function and calls it a star, and the index reaches
  `starLabel` from a hovered cell, so a string is not hypothetical.
- Both name tables follow the same rule: proper name, else the Bayer
  designation spelled out, else Flamsteed, else the catalogue number standing
  in as the name. Preserve that rule when editing the shipped tables.
