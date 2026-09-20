# ihaveacat

Source code for https://ihavea.cat/.

## Constellations

Enable **Constellations** in the settings menu. Stars remain ASCII; faint SVG
independent lines stop a visible gap short of each star glyph's measured ink
bounds, at both their own ends and at any star they cross. Hovering a line
brightens the whole figure to the star colour at full opacity; with the
**name** setting on it also names it, in the same label the stars use, and a
star under the pointer wins that label from its own figure. The preference
survives reloads using `localStorage` (`ihaveacat.constellations`); it defaults
off and still works when storage is unavailable. The existing star-name
preference remains page-local. No network data fetch or build step is needed
to open the page, including over `file://`.

## Coverage and data regeneration

Run with Node.js (no dependencies):

```sh
npm run audit:constellations
node tools/catalog.js audit --iau-only
npm run generate:catalog
npm test
```

The checked-in [before audit](tools/data/coverage-before.txt) and
[unmodified IAU audit](tools/data/coverage-iau-before.txt) include every
constellation's star and segment counts, percentages, and missing HIP IDs with
their unrounded HYG magnitudes. It always compares against the original 1,637
stars, even after regeneration:

| Dataset | Required stars | Originally available | Missing | Complete figures |
| --- | ---: | ---: | ---: | ---: |
| IAU file alone | 742 | 726 | 16 | 76 |
| IAU + two fallback figures | 750 | 730 | 20 | 77 |
| Generated catalogue | 750 | 750 | 0 | 88 |

The original IAU file has 10 partial figures and **two empty figures**, Mensa
and Microscopium. Only those two use Dominic Ford's simplified dataset.
Serpens A/B are merged into one constellation without connecting their paths.
The resulting 88 figures contain 756 segments; originally 731 were renderable.
Only 20 stars were added, giving **1,657 catalogue entries**.

`tools/catalog.js` owns parsing, auditing, HIP mapping, naming and generation.
`tools/data/hyg-v41-subset.json` is a development-only extract of the pinned HYG
v4.1 CSV, containing the normal stars plus required endpoints, their HYG/HIP
IDs, original precision, original catalogue indexes, and the name columns
(`proper`, `bayer`, `flam`, `con`, `hd`, `hr`, `gl`). It is not loaded by
the browser. `originalIndex` preserves existing star names and twinkle phases.
The original catalogue had no identity table; import reconstructs it using
exact rounded `(RA, Dec, magnitude)` triplets and checks all 1,637 entries
one-for-one, using source order for identical triplets. It never uses proximity.
All subsequent constellation joins use HIP/HYG IDs.

HYG removed the invalid HIP 55203 record in v3.5 but retained Xi UMa's two
components. [hip-aliases.json](tools/data/hip-aliases.json) documents the
published HIP → HD 98231 → HYG 118742 mapping to the brighter existing component.
This resolves Ursa Major without adding a duplicate or guessing coordinates.

To re-import the source extract, download the pinned CSV at development time:

```sh
curl -L -o /tmp/hyg-v41.csv https://raw.githubusercontent.com/astronexus/HYG-Database/c7f7f883fe678cc7680169a50ccd7dcc49b060ce/hyg/CURRENT/hygdata_v41.csv
node tools/catalog.js import /tmp/hyg-v41.csv
npm run generate:catalog
```

Constellation source files are vendored from
`dcf21/constellation-stick-figures` revision
`75d29c207bbd752023c447ddd1f9f4ff0eb47538`. Generation is deterministic and
offline. It updates the packed triplets in `js/sky.js`, compact catalogue-index
pairs in `js/constellations.generated.js`, and the saved coverage report.
There are no runtime HIP IDs. Unknown endpoints fail generation.

## Rendering

The existing RA/Dec → altitude/azimuth → grid projection is unchanged.
`SkyMap.starCells` optionally records positions before cell collision filtering,
so stars sharing an ASCII cell retain their endpoint identities. Normal stars
still use magnitude 3.6; only required constellation stars bypass that limit,
and only while enabled. Additional faint stars use the existing `.` glyph.

## Star names

Every star a figure draws is named, not only the 343 down to the display
magnitude limit: `js/sky.js` carries the dense `NAMES`/`IDS` arrays plus an
index-keyed table for the 438 constellation endpoints below that limit. Both
are written by `npm run generate:catalog` from one rule — proper name, else the
Bayer designation spelled out, else Flamsteed, else the catalogue number — and
generation re-derives all 343 shipped names first and stops if any has drifted,
so the two tables cannot disagree about how a star is written down. A star no
figure touches stays unnamed: naming the other ~900 catalogue entries would
cost file size for stars nobody can point at.

`main.js` positions a pointer-transparent SVG at the measured `<pre>` origin,
using the same character width and line height as the ASCII grid. A DOM Range
locates each painted character (including fractional text-run rounding); a
zero-height baseline marker and Canvas text metrics supply the glyph's ink
bounds. Canvas is used only for font measurement; stars remain ASCII.
Each edge is independently trimmed to its two glyph bounds grown by
`Scene.starGap` — a gap of 25% of the narrower cell dimension — and the same
padded box punches the static mask that protects any other star the edge
crosses. The padding is what makes the termination visible: trimmed to the
outline exactly, the break has no width, and a 0.75px line at a quarter
opacity reads as one stroke passing under the star. The two must use the same
box, because the mask erases whatever crosses its hole. A segment is drawn
when *either* endpoint is in view and passes `Scene.starVisible`; the other
may be below the horizon, past the window's side, or behind the moon, cat or
fence, and the line then runs to that cell's centre (`Scene.cellCentre`) for
the mask or the sky's edge to cut. Zero-length and azimuth wrap-crossing lines
are omitted, as are lines with both ends hidden. The SVG mask is built from
that same scene predicate, including moon/cat/fence halos, so lines crossing
foreground objects are clipped even when both endpoints are clear, and the
hover hit test ignores pointer positions in masked cells for the same reason.

Each figure gets its own `<g class="constellation">`, so a hover lights all of
its lines with one class write. The hit test is geometric, in `main.js`,
against the drawn edges: the overlay is `pointer-events: none` behind the
scene, so its lines never receive a pointer, and nearest-within-reach avoids
two crossing figures trading the highlight. A repaint discards those groups, so
the highlight is restored and re-applied rather than kept as a node reference.

SVG work occurs on settings, view/hash, grid, font, resize and orientation
changes, including resizes with unchanged grid counts. Tail, meteor and firefly
frames never touch it. Lines have no animation or transition and use the same
white and 25% opacity as the dimmest star twinkle state; a hovered figure uses
that same white at the twinkle's bright end, full opacity, and still does not
transition. The glyph masks never
inherit star opacity, so twinkling cannot expose a line through a star.
Constellations retain the existing projection's zenith
distortion; this feature does not introduce a new celestial projection.

See [CLAUDE.md](CLAUDE.md#astronomical-data-licenses-and-attribution) for data licenses and attribution.
