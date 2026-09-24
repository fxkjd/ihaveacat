# Scene

How `js/scene.js` composes the picture for a grid size, and how `main.js`
sizes that grid. Pinned by `test/scene.test.js`. The stars are covered in
[sky.md](sky.md), the moving parts in [animations.md](animations.md).

## Sizing and layout

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
- `GROUND_EXTRA_ROWS` (2) is the lawn's thickness, drawn strictly below the
  fence; `LAWN_ROW_DENSITY` must have exactly that many entries. It is balanced
  against `TOP_PAD_ROWS` (13) to keep `BASE_ROWS` at 44 — change them as a pair
  unless you mean to resize the art.
- `CORE_COLS` (45) is the width reserved for the cat and moon, not the fence
  (which is unbounded).

## Fence and cat

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
