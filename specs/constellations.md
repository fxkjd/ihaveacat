# Constellations

With the panel's constellations checkbox on, `main.js` draws the figures as an
SVG overlay behind the scene. The figure data is
`js/constellations.generated.js` (see [sky.md](sky.md)); turning the figures
on locks star density to high (see [settings-panel.md](settings-panel.md));
hovering a figure is gated on the names checkbox (see
[star-names.md](star-names.md)).

## Positions and edges

- `starCells` records optional endpoint positions before collision filtering
  **and before the horizon and grid tests** — a position is a projection, not
  a promise that a star is drawn. `main.js` paints an SVG from those positions
  using its existing measured character metrics. The mask reuses
  `Scene.starVisible`, including halos.
- **An edge is drawn when either end is a drawn star.** The other end may be
  below the horizon, past the window's side, or behind the moon, cat or
  fence: the line runs to that cell's centre (`Scene.cellCentre`, placed in
  the visible star's measured text frame) and the mask or the sky's edge ends
  it. Requiring both ends left holes in every figure that touched the fence
  or the moon — Hydra lost most of itself and Virgo its arm across the moon
  at Barcelona. Two hidden ends draw nothing. `starVisible` is bounded by
  `fenceTop`, not `rows`, because a hidden end can now land in a lawn row.
  The hover hit test refuses pointer positions in masked cells, since the
  drawn edges run on under the mask.
- Sky/view/settings/layout changes update it; foreground animation never does.

## Trimming at the stars

- Each independent edge is trimmed to measured glyph ink bounds, using DOM
  Range text placement, a measured HTML baseline, and Canvas text metrics
  (measurement only). Static glyph cutouts also protect stars crossed by an
  unrelated edge. Lines share the dim star color/opacity tokens and never
  inherit twinkle animations or animated mask opacity.
- **The ink box is padded by `Scene.starGap` before either use**, and the same
  padded box is trimmed against and punched out of the mask. Trimmed to the
  outline exactly — which is what a zero gap gives — the break has no width at
  all, and a 0.75px stroke at a quarter opacity then reads as one line passing
  *under* the star rather than two stopping at it. The two uses have to agree:
  the mask erases whatever crosses its hole, so a line trimmed less generously
  than the hole is punched would be eaten there instead of ending cleanly.
  `STAR_GAP_RATIO` (0.25 of the narrower cell dimension, floored at a pixel) is
  the knob; at that size no segment is lost at any viewport, which is the
  constraint — two stars in adjacent cells must still be joined. It was 0.18
  and raised for breathing room; 0.30 is where vertically adjacent pairs
  start dropping their edge, so that is the ceiling.

## Figure hover

- **Each figure is its own `<g class="constellation">`** inside the masked
  group, so hovering one line can light all of them with a single class write.
  `constellation-on` is the lit state: the twinkle keyframe's bright end, i.e.
  the same white at full opacity. Nothing new enters the palette and nothing
  transitions.
- **The figure hit test is geometric**, like the star one and for a second
  reason on top of it: the overlay is `pointer-events: none` behind the scene
  — it has to be, or it would swallow the pointer events that name the stars
  — so its lines never see a pointer. `main.js` keeps the drawn edges and
  measures the pointer's distance to them — within two fifths of a cell for a
  mouse, within the 22px tap reach for a finger (see
  [star-names.md](star-names.md)). **A figure lights only where no star
  answers**: a star takes the pointer and lights alone, and a tap takes the
  nearer of star and line (see [star-names.md](star-names.md)). **The sky must show at the point of the line
  the pointer is taken to mean**, not only under the pointer: within a
  fingertip's reach those are often different cells, and a tap beside the
  moon otherwise lit Canis Major through the stretch the moon hides. A
  highlight cannot outlive a repaint, which
  discards the `<g>` nodes, so `paintConstellations` puts it back and drops the
  label's identity key before rebuilding.
