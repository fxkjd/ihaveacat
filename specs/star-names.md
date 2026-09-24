# Star names

Hovering a star names it — the proper name where the star has one, otherwise
the Bayer designation spelled out, otherwise the catalogue number. Off by
default, behind the panel's `names` checkbox — named for both, not
`star names`, because it names figures too. With constellations on too, hovering
a line names the figure the same way and lights the whole of it (see
[constellations.md](constellations.md)). The lookup and label live in
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
- **Exact cell, no snap radius.** Stars are ~1.1% of cells, so a one-cell
  radius would make a tenth of the sky live and flicker between neighbours
  inside a constellation. Exact is the only rule that is honest, and the only
  one testable as a biconditional.
- **The `names` checkbox is the one switch for anything answering the pointer**
  — the owner's decision. Hovering a figure lights it and writes its name into
  the same `.star-name` label only while names are on (and the figures, of
  course); with names off the lines are scenery and hold still, and a
  mousemove costs one comparison. Where both answer — near the end of a
  figure — the star wins the label and the figure still lights.
- Hover is guarded by `matchMedia('(hover: hover)')`, checked live: a tap
  synthesises one `mousemove` and never a `mouseleave`, so a touch device would
  otherwise light a label and keep it lit.
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
  very mousemove that positions it and flickers itself away.
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
