# Settings panel

The gear in the top-right corner opens a small ASCII readout for latitude,
longitude, facing direction, the star density, and the constellations and
names checkboxes. It is shut on every load. Code: `js/menu.js`; pinned by
`test/menu.test.js` and `test/browser.test.js`.

## Design

- Split like the rest: `rows(fields, settings)` is **pure** art over
  pre-formatted strings, in the same `{text, cls}` shape `scene.js` emits (so
  `test/menu.test.js` pins the drawing with no DOM at all); `install()` is the
  wiring.
- It writes the URL fragment and **there is no wire to `main.js` on purpose** —
  the panel, the address bar, a shared link and the Back button are then one
  code path, and the URL always says what is drawn. Display settings that do
  not travel in the fragment are announced as a `CustomEvent` on `window`
  instead, which is the same idea: a channel the browser owns, not a reference
  between the two files.
- It builds itself from script, so nothing appears on the no-JS page that
  could not work.
- `SkyMap.formatFields`/`formatView` are the inverse of `parseView` and live
  beside it, so the fragment's syntax is written down once and a round-trip
  test guards the pair. The panel displays *literally the strings it would
  write*, so what you read and what the URL says can never drift apart.
- **The menu is chrome, not scenery.** It never paints into `<pre id="scene">`
  (a test asserts the scene is byte-identical across open, commit and close),
  its font size is **clamped** instead of scaling with the art — "no font-size
  cap" is a rule about the *scene*, and chrome obeying it would be 60px on a 4K
  window — and owns no randomness. Scene animation timers stay in `main.js`;
  the menu owns only its coordinate-button hold-repeat timer.
- No click-outside-to-close, no geolocation, no presets: the fragment *is* the
  state, and it is already shareable.

## Drawing

- **The panel is ASCII only** (the gear, outside it, is the one exception
  below) and is drawn as one ruled column — no title, two blocks split by a
  blank line, where you stand above and what the sky shows below:

  ```
   lat   - [  41.39 ] +
   lon   - [   2.17 ] +
   dir   n  e (s) w

   stars low (medium) high
   show [ ] constellations
        [ ] names
  ```

  Every label is padded to `LABEL_COLS` (6, ` stars`), so each control
  starts in the same cell. On/off is a checkbox (`[x]`), pick-one is a radio
  mark (`(s)`), and the brackets carry the state with no colour at all. Every
  button is at least three cells wide — a stepper is ` - `/` + ` with its
  spaces, a checkbox includes its word, as a `<label>` would — because a
  one-cell button was a ten-pixel target on a phone. Keyboard focus is the
  field's highlight block on every control, never a ring round characters.
- Every direction slot is three cells (`(s)` marked, ` s ` not), so clicking one
  cannot shift the row.
- The gear is U+2699 **plus U+FE0E**. Without the variation selector, iOS and
  Android draw a full-colour emoji cog — the one thing on this page that could
  look less like the rest of the drawing.
- **A tap-target overhang never covers another control.** The buttons grow
  their targets 0.7em up and down with `::after`s, which reaches past the
  middle of the next row, and a later button paints over an earlier one: the
  density row took most of the constellations switch — disabled `medium`
  then swallowed the click that would turn the figures off — and the compass
  took the bottom of the longitude field. The overhangs carry `z-index: -1`
  (inside `.menu`'s stacking context), so they only claim space no real box
  is drawn in. A disabled density slot drops its overhang: its opacity makes
  it a stacking context of its own, which would lift the overhang back up.

## Vantage fields

- **One fragment write per deliberate change** (Enter, blur, a compass click),
  never per keystroke: each write is a history entry. A commit that does not
  move the vantage writes **nothing at all**, not even to canonicalise the
  spelling — otherwise opening the panel and leaving a field would stamp a
  fragment onto a URL that never had one, and the blur that follows Escape
  would commit the very edit Escape abandons. `close()` restores the fields
  *before* it moves focus, for the same reason.
- **Setting the fragment to the value it already holds fires no `hashchange`.**
  The panel updates itself before writing and never waits for the event to come
  back. The stub in `test/browser.test.js` models this faithfully — one that
  always fired would let a regression pass green.
- **Opening does not focus a field.** Grabbing focus raises the on-screen
  keyboard over the scene on a phone, and it would leave `lat` permanently
  mid-edit, which is exactly what `sync()` refuses to overwrite.
- An out-of-range coordinate is **rejected, not clamped**: the field snaps back
  to the value the sky is drawn from. `parseView`'s garbage→default rule is
  right for a URL typed once and wrong for a field being edited.
- Coordinate rows use `lat - [number] +` (and `lon`). Each stepper steps by 1°
  and clamps at ±90° latitude or ±180° longitude; typed invalid values are
  still rejected.
  Holding an arrow steps immediately, waits 500 ms, then repeats with intervals
  accelerating from 256 ms down to 60 ms. Release, pointer cancellation, loss
  of focus, hiding the page or closing the panel stops the hold. The release
  click does not add another step; keyboard clicks still work normally.

## Display settings

- The names toggle is **persistent locally and deliberately not in the
  fragment**. The fragment is a shareable description of *what is drawn*; a
  display preference is neither shareable nor a property of the sky. Having no
  address bar to travel through, it is announced as a `CustomEvent` on
  `window` — the `hashchange` analogue. The event name is duplicated as a
  literal in `main.js` and `menu.js` because main.js loads first and cannot
  read the constant when it registers, the same reason `hash2` is copied
  between `sky.js` and `scene.js`; a test pins the two spellings together.
- The **constellations** preference defaults off and persists in the guarded
  `localStorage` key `ihaveacat.constellations`. It shares `settingschange`
  with names. Names persist in `ihaveacat.names`, and the formatted vantage
  in `ihaveacat.view`. A nonempty URL fragment takes precedence over the saved
  vantage; storage failures never prevent changing settings.
- The **star density** row (`stars low (medium) high`) sits directly above
  constellations, marked like the compass so marking a slot shifts nothing.
  It persists in `ihaveacat.density` and travels in `settingschange` as
  `density`; an absent or unknown value is medium. **Constellations on forces
  high and disables low and medium; turning them off leaves high selected
  and re-enables the other two** — the owner's decision: switching the
  figures off is not a request for fewer stars. The lock lives in three
  places on purpose: `rows()` cannot draw another slot marked while
  constellations are on, `setDensity` refuses it (not just `disabled`), and
  `main.js` renders high whenever the figures are on, because a figure
  without its faint endpoints has no positions for them and comes apart. A
  saved constellations-on beside any other saved density loads as high.
