/*
 * Composes the full responsive scene for ihavea.cat: sky + stars, the moon,
 * the cat, the fence (with the cat's tail woven in), and a lawn that fills
 * whatever space is left. Pure functions, no DOM access: loadable both as a
 * browser classic script (exposes a global Scene object) and via require()
 * for node --test.
 *
 * The moon's own silhouette and phase math live in js/moon.js; this module
 * never requires it. Callers pass rendered moon rows in, so each module
 * stays standalone and independently testable.
 */
(function (global) {
    'use strict';

    /*
     * Geometry. The "core" is the always-visible 45x29 cat + moon
     * composition (down to the fence line — the fence itself is unbounded
     * and spans the viewport) at exactly the original art's proportions and
     * spacing. BASE_COLS and BASE_ROWS are the smallest grid the core fits
     * in; fitGrid() never returns anything smaller, so the core is always
     * fully visible.
     *
     * BASE_ROWS is also the primary size-tuning knob (see CLAUDE.md): raising
     * TOP_PAD_ROWS raises BASE_ROWS, which shrinks every character
     * proportionally on any height-bound (typical desktop) viewport, without
     * affecting full visibility or the constant-proportion guarantee.
     */
    var CORE_COLS = 45;          // the cat + moon composition, core cols 0..44
    var CORE_ROWS = 29;          // moon top row .. fence bottom row
    var SIDE_PAD_COLS = 4;       // breathing room beside the cat and moon (the
                                  // fence spans the whole viewport, so it needs
                                  // no padding of its own)
    var TOP_PAD_ROWS = 13;       // sky rows above the moon AT THE BASE GRID —
                                  // see MOON_CAT_GAP_ROWS below for how the moon
                                  // is actually positioned at any other size
    var GROUND_EXTRA_ROWS = 2;   // lawn rows, strictly below the fence
    var LINE_HEIGHT_RATIO = 1.2;

    var BASE_COLS = CORE_COLS + 2 * SIDE_PAD_COLS;                  // 53
    var BASE_ROWS = CORE_ROWS + TOP_PAD_ROWS + GROUND_EXTRA_ROWS;   // 44

    // Sprite placement, in core-relative coordinates (0 = fence's left edge).
    var MOON_COL = 17;
    var MOON_DISC_WIDTH = 13;    // mirrors moon.js's DISC_WIDTH; not imported,
                                  // so this module stays dependency-free.
    var MOON_ROW_COUNT = 7;
    // The moon sits a fixed number of rows above the cat, regardless of grid
    // height — it is anchored to the cat, not to the top of the screen, so it
    // never drifts away on a tall viewport. 8 matches the original static
    // art's spacing (moon bottom at row 6, cat top at row 15).
    var MOON_CAT_GAP_ROWS = 8;

    var CAT_COL = 9;
    var CAT_ART = [
        ' |\\___/|',
        ' )     (',
        '=\\     /= - Sóc un gat',
        '  )===(',
        ' /     \\',
        ' |     |',
        '/       \\',
        '\\       /'
    ];
    var CAT_CLASS_SPANS = [{ row: 3, col: 3, len: 3, cls: 'collar' }];

    var FENCE_LEFT = 2;
    var FENCE_RIGHT = 44;
    var FENCE_ROW_COUNT = 6;
    var TAIL_PATCH_COL = 12;
    // The cat's tail is woven into the fence at rows 0-3; rows 4-5 are the
    // plain post pattern. Applied opaquely: its spaces erase the rail/post
    // underneath, they don't leave it showing through.
    var TAIL_PATCH = ['_  _/', '( (', ' ) )', '(_(', null, null];
    // The whole patch is the cat: it sits in FRONT of the fence, so every
    // cell inside its silhouette keeps the cat's colour. Colouring row 0 as
    // fence left a dim rail closing the gap between the cat's legs, which
    // read as the cat's own base being greyed out.
    var TAIL_PATCH_IS_CAT = [true, true, true, true, false, false];

    /*
     * Tail wag: a pendulum. The tail hangs from the cat's rear, so the
     * attachment barely moves while the tip travels furthest — each pose
     * gives every row its own column. Pose index 3 is rest and reproduces
     * the original art exactly; poses run left (0) through right (6).
     *
     * The tail is blitted opaquely AFTER the fence, so its cells — including
     * its own blanks — erase whatever fence or vine sits under them. That is
     * deliberate: the tail passes in front of the fence, and the posts it
     * covers reappear on their own as it swings away, because every frame is
     * rebuilt from scratch. Rows here are fence rows 1-3; fence row 0 is the
     * cat's rear (CAT_BASE_ART) and never moves, so the body stays still.
     *
     * Glyphs express SLOPE, not just position: `/` where the tail leans left,
     * `\` where it leans right, `|` where it hangs straight, and the original
     * curved parens at rest where it is relaxed. Drawing every pose with the
     * same `( )` curves and only moving them made the tail look like it was
     * teleporting rather than rotating. The tail is two parallel strokes two
     * columns apart (it is outlined, like the cat), closed at the tip by `_`.
     */
    var TAIL_WAG_FRAMES = [
        [{ col: 11, text: '/ /' }, { col: 10, text: '/ /' }, { col: 9, text: '/_/' }],
        [{ col: 11, text: '/ /' }, { col: 11, text: '/ /' }, { col: 10, text: '/_/' }],
        [{ col: 12, text: '( (' }, { col: 12, text: '| |' }, { col: 11, text: '(_)' }],
        [{ col: 12, text: '( (' }, { col: 13, text: ') )' }, { col: 12, text: '(_(' }],
        [{ col: 12, text: '( (' }, { col: 13, text: '| |' }, { col: 13, text: '(_)' }],
        [{ col: 12, text: '\\ \\' }, { col: 13, text: '\\ \\' }, { col: 14, text: '\\_\\' }],
        [{ col: 13, text: '\\ \\' }, { col: 14, text: '\\ \\' }, { col: 15, text: '\\_\\' }]
    ];
    var TAIL_REST_FRAME = 3;
    // A full sweep: rest, out to the right, across to the left, back to rest.
    var TAIL_WAG_SEQUENCE = [3, 4, 5, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3];

    /*
     * Shooting star. The cell diagonal only, left and right.
     *
     * OWNER DECISION: no other slopes. `\` and `/` run corner to corner, so on
     * a one-column-per-row diagonal each glyph touches the next and the streak
     * is a single unbroken line. Nothing else in ASCII does that. Shallower
     * slopes were drawn with `-` and with the baseline glyphs `` ` `` `-` `.`,
     * steeper ones with `|`; both were tried at length and both read as a
     * staircase or a ladder of detached marks rather than a streak.
     */
    var METEOR_PATHS = [
        { dx: 1, dy: 1 },     // down-right
        { dx: -1, dy: 1 }     // down-left
    ];
    var METEOR_LENGTH = 9;       // cells, head included
    var METEOR_BRIGHT = 3;       // leading cells drawn bright, rest dimmed
    var METEOR_FADE_AT = 5;      // from here back the trail thins to dots

    /*
     * Weathering. A few pickets sag or are missing so the fence reads as an
     * old garden fence rather than a printed band. Keyed on core-relative
     * picket columns via hash2, so it is identical on every load and does not
     * reshuffle as the window resizes.
     */
    var PICKET_INTACT = 0, PICKET_SAGGING = 1, PICKET_MISSING = 2;
    var PICKET_MISSING_PER_MILLE = 45;
    var PICKET_SAG_PER_MILLE = 90;
    // Core cols 8..20 stay perfect: the cat's tail weaves through here, and it
    // detaches from the fence if these pickets sag, vanish, or grow vines.
    var PICKET_PROTECT_LEFT = 8;
    var PICKET_PROTECT_RIGHT = 20;
    var SEED_FENCE = 0x3f1a77c5;

    /*
     * Vines: climbers that spiral up a post, so leaves alternate left and
     * right of it as they rise rather than stacking in a straight column
     * (a straight column reads as a dotted line, not a plant). The base row
     * carries leaves on both sides so the plant looks rooted, and the tip
     * thins to a tendril.
     */
    var VINE_PER_MILLE = 220;
    var VINE_MIN_ROWS = 3;
    var VINE_MAX_ROWS = 5;
    var VINE_LEAF_GLYPHS = ['%', '%', '&', '%'];   // full leaf clusters
    var VINE_TIP_GLYPHS = [',', '\'', '`', ','];    // thin new growth
    var SEED_VINE = 0x11e6b3a9;

    // Star field: one star per jittered block (blue noise, not independent
    // per-cell sampling, which clumps and doesn't match the original art).
    var STAR_GLYPHS = ['.', '*', '.', '*', '\'', '.', '*', '.'];
    var STAR_BLOCK_W = 9;
    var STAR_BLOCK_H = 10;
    var SEED_STAR = 0x5bf03635;

    // Lawn: per-cell density, the opposite scheme from stars — here
    // clumping is wanted, it reads as tufts.
    var LAWN_GLYPHS = [',', '.', ',', '.', '`', ',', '.', ','];
    var LAWN_ROW_DENSITY = [0.45, 0.45];
    var SEED_LAWN = 0x27220a95;

    /*
     * Dependency-free 32-bit integer hash of two coordinates plus a seed.
     * Uses no runtime randomness source, so placement is deterministic and
     * testable. Handles negative inputs (coordinates are scene-relative and
     * can be negative above/left of the anchor).
     */
    function hash2(x, y, seed) {
        var h = Math.imul(x | 0, 0x1f1f1f1f) ^ Math.imul(y | 0, 0x27d4eb2d) ^ (seed | 0);
        h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
        h ^= h >>> 12;
        h = Math.imul(h, 0x297a2d39);
        h ^= h >>> 15;
        return h >>> 0;
    }

    /*
     * The fence pattern at core column c — unbounded, so the fence runs off
     * both edges of the viewport and never shows an end. The post/rail
     * repeats with period 3; because c is core-relative the period stays
     * locked to the cat's tail at every viewport size (generating in screen
     * coordinates would drift the period as the core's on-screen offset
     * changes parity). c is negative left of the core, so the modulo has to
     * be the non-negative kind — plain `c % 3` breaks there.
     */
    function fenceChar(row, c) {
        var m = ((c % 3) + 3) % 3;
        if (row === 0) return m === 2 ? '_' : (m === 0 ? '/' : '\\');
        return m === 2 ? '|' : ' ';
    }

    // The fence char actually drawn at a core column, tail patch included.
    function fencePatchedChar(row, c) {
        var patch = TAIL_PATCH[row];
        if (patch && c >= TAIL_PATCH_COL && c < TAIL_PATCH_COL + patch.length) {
            return patch.charAt(c - TAIL_PATCH_COL);
        }
        return fenceChar(row, c);
    }

    // The post column owning the picket that core column c belongs to.
    function picketPost(c) {
        var m = ((c % 3) + 3) % 3;
        return c - (m === 2 ? 0 : (m === 0 ? 1 : 2));
    }

    function picketProtected(post) {
        return post >= PICKET_PROTECT_LEFT && post <= PICKET_PROTECT_RIGHT;
    }

    // Note the >>> 12: hash2's low bits are measurably biased for this input
    // family (post columns are all multiples of 3), which skewed the rates.
    function picketRawState(post) {
        var r = (hash2(post, 0, SEED_FENCE) >>> 12) % 1000;
        if (r < PICKET_MISSING_PER_MILLE) return PICKET_MISSING;
        if (r < PICKET_MISSING_PER_MILLE + PICKET_SAG_PER_MILLE) return PICKET_SAGGING;
        return PICKET_INTACT;
    }

    function picketState(post) {
        if (picketProtected(post)) return PICKET_INTACT;
        var state = picketRawState(post);
        // Never two gaps in a row: a double gap reads as the fence being cut
        // in half, which is the very thing the full-width fence removed.
        if (state === PICKET_MISSING && picketRawState(post - 3) === PICKET_MISSING) {
            return PICKET_INTACT;
        }
        return state;
    }

    function vineRawRows(post) {
        if (picketProtected(post) || picketState(post) === PICKET_MISSING) return 0;
        var h = hash2(post, 1, SEED_VINE);
        if ((h >>> 12) % 1000 >= VINE_PER_MILLE) return 0;
        return VINE_MIN_ROWS + ((h >>> 22) % (VINE_MAX_ROWS - VINE_MIN_ROWS + 1));
    }

    // How many rows of vine climb this post (0 = none). Neighbouring posts
    // never both carry one: their leaves would meet and read as a hedge
    // rather than as separate climbers.
    function vineRows(post) {
        if (!vineRawRows(post)) return 0;
        if (vineRawRows(post - 3)) return 0;
        return vineRawRows(post);
    }

    /*
     * The cells a shooting star occupies, head first, walked back along the
     * flight line one cell at a time.
     *
     * The head arrives on fractional coordinates (main.js positions it from
     * elapsed time) and is rounded ONCE, here: the streak is exactly the
     * rounded head's streak, never anything in between. It may sit off-grid,
     * so a streak enters and leaves the viewport naturally; callers clip.
     * Pure: the caller owns where and when it flies.
     */
    function meteorCells(head) {
        if (!head) return [];
        var path = METEOR_PATHS[head.path || 0] || METEOR_PATHS[0];
        var stroke = path.dx > 0 ? '\\' : '/';
        var col = Math.round(head.col), row = Math.round(head.row);
        var cells = [];
        for (var i = 0; i < METEOR_LENGTH; i++) {
            cells.push({
                x: col - path.dx * i,
                y: row - path.dy * i,
                // Head, then the stroke, then dots: the tail thins to points
                // rather than ending on a hard stroke.
                char: i === 0 ? '*' : (i < METEOR_FADE_AT ? stroke : '.'),
                cls: i < METEOR_BRIGHT ? 'meteor' : 'meteor-dim'
            });
        }
        return cells;
    }

    /*
     * Is a meteor still flying? It dies on contact with the cat or the moon.
     *
     * Both by BOUNDING BOX, not by glyph. For the cat that is essential — it is
     * an outline, so most of its box is blank and a glyph-only test let the
     * streak show straight through its body. For the moon it is what makes the
     * streak vanish cleanly: drawing it across the disc looked wrong, and
     * merely hiding the cells that overlap left the head swallowed and a stub
     * of trail hanging in the sky behind it.
     *
     * The fence needs no test here; cells at or below the horizon are clipped
     * per-cell, so a meteor slides behind it gracefully instead of popping out.
     */
    function meteorAlive(head, L) {
        if (!head || !L) return false;
        // Round first: the head flies on fractional rows but is DRAWN in a
        // whole cell, and testing the fraction let a head at row 14.6 count as
        // clear of a box starting at 15 while its glyph landed inside it and
        // was clipped — the head vanished and left the trail behind it.
        var col = Math.round(head.col), row = Math.round(head.row);
        return !inBox(col, row, L.catBox) && !inBox(col, row, L.moonBox);
    }

    function inBox(col, row, box) {
        return !!box && col >= box.left && col <= box.right &&
            row >= box.top && row <= box.bottom;
    }

    // The tail pose for a wag frame; out-of-range indices fall back to rest.
    function tailPose(frame) {
        return TAIL_WAG_FRAMES[frame] || TAIL_WAG_FRAMES[TAIL_REST_FRAME];
    }

    // The weathered fence as actually drawn in the scene (no tail patch).
    function fenceSceneChar(row, c) {
        var state = picketState(picketPost(c));
        if (state === PICKET_MISSING) return ' ';
        var sag = state === PICKET_SAGGING ? 1 : 0;
        var m = ((c % 3) + 3) % 3;
        if (m === 2) {                       // the post column
            if (row < sag) return ' ';
            if (row === sag) return '_';
            return '|';
        }
        return row === 0 ? (m === 0 ? '/' : '\\') : ' ';
    }

    /*
     * One row of the original fixed-width fence (45 chars, core cols 0-44,
     * with the fence's own blank margin at cols 0-1). This is the art the
     * no-JS fallback in index.html carries; the live scene draws the
     * unbounded pattern above instead.
     */
    function fenceRowText(row) {
        var chars = [];
        for (var c = 0; c <= FENCE_RIGHT; c++) {
            chars.push(c < FENCE_LEFT ? ' ' : fencePatchedChar(row, c));
        }
        return chars.join('');
    }

    var FENCE_ART = (function () {
        var rows = [];
        for (var r = 0; r < FENCE_ROW_COUNT; r++) rows.push(fenceRowText(r));
        return rows;
    })();

    var CAT_WIDTH = CAT_ART.reduce(function (max, line) {
        return Math.max(max, line.length);
    }, 0);
    // The cat's last row is its footprint on the fence line.
    var CAT_BASE_WIDTH = CAT_ART[CAT_ART.length - 1].length;
    /*
     * The cat's hindquarters rest ON the rail row: in the original art the
     * rail's own glyphs there double as the cat's back leg continuing down
     * and its underside, spelling "\__  _/". They belong to the cat, not the
     * fence, so they are drawn in the cat's colour; treating them as rail
     * deletes part of the cat's body. This is the whole of fence row 0 under
     * the cat, and it never animates — the tail hangs from it.
     */
    var CAT_BASE_COL = 10;
    var CAT_BASE_ART = '\\__  _/';

    /*
     * Viewport-fitting math. Every rounding goes DOWN (fontPx to 2dp,
     * lineHeightPx and cols/rows via floor), which is what guarantees
     * BASE_COLS*charW <= vw and BASE_ROWS*lineHeightPx <= vh rather than
     * leaving it borderline — rounding up (or using ceil for cols/rows)
     * clips a column or row at exactly the design aspect ratio.
     */
    function fitFontSize(vw, vh, ratioW) {
        var raw = Math.min(vw / (BASE_COLS * ratioW), vh / (BASE_ROWS * LINE_HEIGHT_RATIO));
        var fontPx = Math.floor(raw * 100) / 100;
        var lineHeightPx = Math.max(1, Math.floor(fontPx * LINE_HEIGHT_RATIO));
        return { fontPx: fontPx, lineHeightPx: lineHeightPx };
    }

    function fitGrid(vw, vh, charW, lineHeightPx) {
        var cols = Math.max(BASE_COLS, Math.floor(vw / charW + 1e-6));
        var rows = Math.max(BASE_ROWS, Math.floor(vh / lineHeightPx + 1e-6));
        return { cols: cols, rows: rows };
    }

    // Where everything sits for a given grid size. Clamps cols/rows to the
    // base minimums so the function is total even if called with an
    // undersized grid directly (fitGrid already guarantees this in practice).
    function layout(cols, rows) {
        cols = Math.max(BASE_COLS, cols || 0);
        rows = Math.max(BASE_ROWS, rows || 0);

        var groundRow = rows - 1 - GROUND_EXTRA_ROWS;
        var fenceTop = groundRow - (FENCE_ROW_COUNT - 1);
        var catBottom = fenceTop - 1;
        var catTop = catBottom - (CAT_ART.length - 1);
        // Anchored to the cat with a fixed gap, not to the top of the screen
        // (row 0) — otherwise the moon stays pinned near the top edge while
        // the cat sinks toward the bottom on a tall window, and the gap
        // between them grows without bound.
        var moonBottom = catTop - MOON_CAT_GAP_ROWS - 1;
        var moonTop = moonBottom - (MOON_ROW_COUNT - 1);
        var coreLeft = Math.floor((cols - CORE_COLS) / 2);

        return {
            cols: cols,
            rows: rows,
            coreLeft: coreLeft,
            moonTop: moonTop,
            moonBottom: moonBottom,
            catTop: catTop,
            catBottom: catBottom,
            fenceTop: fenceTop,
            fenceBottom: groundRow,
            groundRow: groundRow,
            moonBox: {
                left: coreLeft + MOON_COL, right: coreLeft + MOON_COL + MOON_DISC_WIDTH - 1,
                top: moonTop, bottom: moonBottom
            },
            catBox: {
                left: coreLeft + CAT_COL, right: coreLeft + CAT_COL + CAT_WIDTH - 1,
                top: catTop, bottom: catBottom
            },
            // The fence spans the whole viewport, so its box is full-width.
            // This is what keeps stars out of the fence's rows — they would
            // otherwise be drawn and then immediately painted over.
            fenceBox: {
                left: 0, right: cols - 1,
                top: fenceTop, bottom: groundRow
            }
        };
    }

    function inBoxWithHalo(box, x, y) {
        return x >= box.left - 1 && x <= box.right + 1 &&
               y >= box.top - 1 && y <= box.bottom + 1;
    }

    function occupied(x, y, L) {
        return inBoxWithHalo(L.moonBox, x, y) ||
               inBoxWithHalo(L.catBox, x, y) ||
               inBoxWithHalo(L.fenceBox, x, y);
    }

    // Merge a row of {char, cls} cells into runs, trimming trailing spaces
    // (a space renders the same whether it's inside a classed span or not,
    // so trimming regardless of class keeps output small without changing
    // anything visible).
    function toRuns(cellRow) {
        var end = cellRow.length;
        while (end > 0 && cellRow[end - 1].char === ' ') end--;
        var runs = [];
        for (var i = 0; i < end; i++) {
            var cell = cellRow[i];
            var last = runs[runs.length - 1];
            if (last && last.cls === cell.cls) {
                last.text += cell.char;
            } else {
                runs.push({ text: cell.char, cls: cell.cls });
            }
        }
        return runs;
    }

    /*
     * Build the full scene for a cols x rows grid.
     * opts.moonRows: MoonPhase.renderMoonRows(phase) output — an array of
     *   { indent, cells: [{char, cls}] }, one per moon row. Optional; if
     *   omitted the moon area is left as plain sky (useful for tests that
     *   only care about the rest of the scene).
     * opts.seed: optional integer to vary star/lawn placement; defaults to 0.
     */
    function buildScene(opts) {
        opts = opts || {};
        var L = layout(opts.cols, opts.rows);
        var cols = L.cols, rows = L.rows;
        var seed = opts.seed || 0;

        var grid = [];
        var y, x;
        for (y = 0; y < rows; y++) {
            var row = [];
            for (x = 0; x < cols; x++) row.push({ char: ' ', cls: null });
            grid.push(row);
        }

        function set(px, py, ch, cls) {
            if (px < 0 || px >= cols || py < 0 || py >= rows) return;
            grid[py][px].char = ch;
            grid[py][px].cls = cls;
        }

        // Lawn: painted first, the fence/cat/moon/stars sit on top of it.
        // The lawn sits strictly below the fence, full width — the fence
        // spans the viewport, so there is no "beside the fence" to fill.
        for (var gy = 0; gy < LAWN_ROW_DENSITY.length; gy++) {
            var ly = L.groundRow + 1 + gy;
            if (ly < 0 || ly >= rows) continue;
            var density = LAWN_ROW_DENSITY[gy];
            for (x = 0; x < cols; x++) {
                var lh = hash2(x - L.coreLeft, ly - L.groundRow, seed ^ SEED_LAWN);
                if ((lh % 1000) / 1000 < density) {
                    set(x, ly, LAWN_GLYPHS[(lh >>> 8) % LAWN_GLYPHS.length], 'lawn');
                } else {
                    set(x, ly, ' ', 'lawn');
                }
            }
        }

        // Stars. When the caller supplies a real sky (SkyMap.starCells output,
        // already in grid coordinates), draw that; otherwise fall back to the
        // seeded hash placement, which keeps buildScene() with no options —
        // and every environment without sky.js — rendering the original page.
        // Both paths obey occupied(): never on the moon, cat or fence halos.
        if (opts.stars) {
            opts.stars.forEach(function (s) {
                if (!s) return;
                if (s.x < 0 || s.x >= cols || s.y < 0 || s.y >= rows) return;
                if (occupied(s.x, s.y, L)) return;
                set(s.x, s.y, s.char, s.cls);
            });
        } else {
            var starBottom = L.groundRow - 1;
            for (y = 0; y <= starBottom && y < rows; y++) {
                for (x = 0; x < cols; x++) {
                    var gx = x - L.coreLeft, gy2 = y - L.groundRow;
                    var bx = Math.floor(gx / STAR_BLOCK_W), by = Math.floor(gy2 / STAR_BLOCK_H);
                    var h = hash2(bx, by, seed ^ SEED_STAR);
                    var starX = bx * STAR_BLOCK_W + (h % STAR_BLOCK_W);
                    var starY = by * STAR_BLOCK_H + ((h >>> 8) % STAR_BLOCK_H);
                    if (starX === gx && starY === gy2 && !occupied(x, y, L)) {
                        var glyph = STAR_GLYPHS[(h >>> 16) & 7];
                        var variant = (h >>> 20) & 3;
                        set(x, y, glyph, variant === 0 ? 'star' : 'star star-' + variant);
                    }
                }
            }
        }

        // Moon (transparent: only its own cells are touched).
        if (opts.moonRows) {
            opts.moonRows.forEach(function (r, i) {
                var my = L.moonTop + i;
                r.cells.forEach(function (cell, j) {
                    set(L.coreLeft + MOON_COL + r.indent + j, my, cell.char, cell.cls);
                });
            });
        }

        // Cat (transparent: spaces in the sprite leave the sky showing).
        CAT_ART.forEach(function (line, i) {
            var cy = L.catTop + i;
            for (var j = 0; j < line.length; j++) {
                var ch = line.charAt(j);
                if (ch === ' ') continue;
                set(L.coreLeft + CAT_COL + j, cy, ch, null);
            }
        });
        CAT_CLASS_SPANS.forEach(function (span) {
            var cy2 = L.catTop + span.row;
            for (var k = 0; k < span.len; k++) {
                var cx = L.coreLeft + CAT_COL + span.col + k;
                if (cx >= 0 && cx < cols && cy2 >= 0 && cy2 < rows) {
                    grid[cy2][cx].cls = span.cls;
                }
            }
        });

        // Fence: drawn across every column so it runs off both edges of the
        // viewport and never shows an end. Opaque, so the tail patch's spaces
        // erase the post underneath rather than letting it show through.
        for (var fr = 0; fr < FENCE_ROW_COUNT; fr++) {
            var fy = L.fenceTop + fr;
            for (x = 0; x < cols; x++) {
                var cc = x - L.coreLeft;
                // The cat stands in front of the fence, so the rail is
                // occluded across its base. Without this the rail's peaks
                // butt into the cat's leg tips and the legs look like they
                // turn brown. Row 0 is the cat's rear — it never animates.
                if (fr === 0 && cc >= CAT_COL && cc < CAT_COL + CAT_BASE_WIDTH) {
                    var baseOff = cc - CAT_BASE_COL;
                    if (baseOff >= 0 && baseOff < CAT_BASE_ART.length) {
                        set(x, fy, CAT_BASE_ART.charAt(baseOff), null);
                    } else {
                        set(x, fy, ' ', null);
                    }
                    continue;
                }
                set(x, fy, fenceSceneChar(fr, cc), 'fence');
            }
        }

        // Vines spiral up a post: leaves alternate sides as they climb, both
        // sides at the rooted base, thinning to a tendril at the tip.
        for (x = 0; x < cols; x++) {
            var vc = x - L.coreLeft;
            if (((vc % 3) + 3) % 3 !== 2) continue;   // post columns only
            var climb = vineRows(vc);
            if (!climb) continue;
            for (var k = 0; k < climb; k++) {
                var vrow = FENCE_ROW_COUNT - 1 - k;
                if (vrow < 1) break;                  // never reach the rail row
                var tip = k >= climb - 1;
                var glyphs = tip ? VINE_TIP_GLYPHS : VINE_LEAF_GLYPHS;
                // Alternate sides to suggest the stem winding around the post;
                // the base row gets both so the plant reads as rooted.
                var sides = k === 0 ? [-1, 1] : [k % 2 === 0 ? 1 : -1];
                for (var si = 0; si < sides.length; si++) {
                    var vx = x + sides[si];
                    if (vx < 0 || vx >= cols) continue;
                    var vg = glyphs[(hash2(vx, vrow, SEED_VINE) >>> 6) % glyphs.length];
                    set(vx, L.fenceTop + vrow, vg, 'vine');
                }
            }
        }

        /*
         * The tail, drawn in FRONT of the fence and the vines and blitted
         * opaquely, so it erases whatever it covers — including fence posts,
         * which reappear by themselves as it swings away. Rows here are fence
         * rows 1-3; row 0 is the cat's rear, drawn above and never animated.
         */
        var pose = tailPose(opts.tailFrame === undefined || opts.tailFrame === null
            ? TAIL_REST_FRAME : opts.tailFrame);
        pose.forEach(function (sprite, i) {
            var ty = L.fenceTop + 1 + i;
            for (var k = 0; k < sprite.text.length; k++) {
                set(L.coreLeft + sprite.col + k, ty, sprite.text.charAt(k), null);
            }
        });

        // Shooting star: drawn last so it can see what is already there, and
        // only where the sky is genuinely free.
        if (opts.meteor && meteorAlive(opts.meteor, L)) {
            meteorCells(opts.meteor).forEach(function (c) {
                if (c.x < 0 || c.x >= cols || c.y < 0 || c.y >= rows) return;
                if (c.y >= L.fenceTop) return;                  // behind the horizon
                // Test the cat's BOX, not its glyphs: the cat is an outline,
                // so most of its box is blank and a glyph-only test lets the
                // streak show straight through the cat's body.
                if (inBox(c.x, c.y, L.catBox)) return;
                var cell = grid[c.y][c.x];
                // Only genuinely free sky, and a star it may overwrite. Never
                // the moon: a streak drawn across the disc looked wrong. The
                // flight ends before it can get there anyway — meteorAlive
                // kills it on the moon's box — so this only guards the trail.
                var freeSky = cell.char === ' ' ||
                    (cell.cls && cell.cls.indexOf('star') === 0);
                if (!freeSky) return;
                set(c.x, c.y, c.char, c.cls);
            });
        }

        return { cols: cols, rows: rows, layout: L, grid: grid.map(toRuns) };
    }

    function sceneToText(scene) {
        return scene.grid.map(function (runs) {
            return runs.map(function (r) { return r.text; }).join('');
        }).join('\n');
    }

    function sceneToCells(scene) {
        return scene.grid.map(function (runs) {
            var cells = [];
            runs.forEach(function (r) {
                for (var i = 0; i < r.text.length; i++) {
                    cells.push({ char: r.text.charAt(i), cls: r.cls });
                }
            });
            return cells;
        });
    }

    var Scene = {
        CORE_COLS: CORE_COLS,
        CORE_ROWS: CORE_ROWS,
        BASE_COLS: BASE_COLS,
        BASE_ROWS: BASE_ROWS,
        SIDE_PAD_COLS: SIDE_PAD_COLS,
        TOP_PAD_ROWS: TOP_PAD_ROWS,
        GROUND_EXTRA_ROWS: GROUND_EXTRA_ROWS,
        LINE_HEIGHT_RATIO: LINE_HEIGHT_RATIO,

        MOON_COL: MOON_COL,
        MOON_DISC_WIDTH: MOON_DISC_WIDTH,
        MOON_ROW_COUNT: MOON_ROW_COUNT,
        MOON_CAT_GAP_ROWS: MOON_CAT_GAP_ROWS,
        CAT_COL: CAT_COL,
        CAT_ART: CAT_ART,
        CAT_CLASS_SPANS: CAT_CLASS_SPANS,
        FENCE_LEFT: FENCE_LEFT,
        FENCE_RIGHT: FENCE_RIGHT,
        FENCE_ROW_COUNT: FENCE_ROW_COUNT,
        TAIL_PATCH_COL: TAIL_PATCH_COL,
        TAIL_PATCH: TAIL_PATCH,
        FENCE_ART: FENCE_ART,
        STAR_GLYPHS: STAR_GLYPHS,
        STAR_BLOCK_W: STAR_BLOCK_W,
        STAR_BLOCK_H: STAR_BLOCK_H,
        SEED_STAR: SEED_STAR,
        LAWN_GLYPHS: LAWN_GLYPHS,
        LAWN_ROW_DENSITY: LAWN_ROW_DENSITY,
        SEED_LAWN: SEED_LAWN,

        PICKET_INTACT: PICKET_INTACT,
        PICKET_SAGGING: PICKET_SAGGING,
        PICKET_MISSING: PICKET_MISSING,
        PICKET_PROTECT_LEFT: PICKET_PROTECT_LEFT,
        PICKET_PROTECT_RIGHT: PICKET_PROTECT_RIGHT,
        VINE_LEAF_GLYPHS: VINE_LEAF_GLYPHS,
        VINE_TIP_GLYPHS: VINE_TIP_GLYPHS,
        VINE_MAX_ROWS: VINE_MAX_ROWS,
        CAT_BASE_WIDTH: CAT_BASE_WIDTH,
        CAT_BASE_COL: CAT_BASE_COL,
        CAT_BASE_ART: CAT_BASE_ART,
        TAIL_PATCH_IS_CAT: TAIL_PATCH_IS_CAT,
        TAIL_WAG_FRAMES: TAIL_WAG_FRAMES,
        TAIL_WAG_SEQUENCE: TAIL_WAG_SEQUENCE,
        TAIL_REST_FRAME: TAIL_REST_FRAME,
        METEOR_PATHS: METEOR_PATHS,
        METEOR_LENGTH: METEOR_LENGTH,

        hash2: hash2,
        fenceChar: fenceChar,
        fencePatchedChar: fencePatchedChar,
        fenceSceneChar: fenceSceneChar,
        picketPost: picketPost,
        picketState: picketState,
        vineRows: vineRows,
        tailPose: tailPose,
        meteorCells: meteorCells,
        meteorAlive: meteorAlive,
        fenceRowText: fenceRowText,
        layout: layout,
        fitFontSize: fitFontSize,
        fitGrid: fitGrid,
        buildScene: buildScene,
        sceneToText: sceneToText,
        sceneToCells: sceneToCells
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = Scene;
    } else {
        global.Scene = Scene;
    }
})(this);
