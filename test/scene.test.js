'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Scene = require('../js/scene.js');
const MoonPhase = require('../js/moon.js');

function stripTags(html) {
    return html.replace(/<span[^>]*>/g, '').replace(/<\/span>/g, '');
}

// Merge a scene's cells (undoing run-merging) so tests can index by column
// without worrying about trimmed trailing spaces or run boundaries.
function cellsOf(scene, row) {
    return Scene.sceneToCells(scene)[row] || [];
}

// The fence as buildScene draws it: weathered pattern, occluded across the
// cat's base on the rail row, with the cat's tail patch composited on top.
// Vines are painted over this afterwards.
function drawnFenceChar(row, coreCol) {
    const patch = Scene.TAIL_PATCH[row];
    const inPatch = patch && coreCol >= Scene.TAIL_PATCH_COL &&
        coreCol < Scene.TAIL_PATCH_COL + patch.length;
    if (inPatch) return patch.charAt(coreCol - Scene.TAIL_PATCH_COL);
    if (row === 0 && coreCol >= Scene.CAT_COL &&
        coreCol < Scene.CAT_COL + Scene.CAT_BASE_WIDTH) {
        const off = coreCol - Scene.CAT_BASE_COL;
        return (off >= 0 && off < Scene.CAT_BASE_ART.length)
            ? Scene.CAT_BASE_ART.charAt(off) : ' ';
    }
    return Scene.fenceSceneChar(row, coreCol);
}

// The sky is everything above the fence — the fence spans the full width of
// its own rows, so those rows are not sky and must not dilute the denominator.
function starDensity(cols, rows) {
    const scene = Scene.buildScene({ cols, rows });
    const L = scene.layout;
    const skyCells = cols * L.fenceTop;
    let stars = 0;
    for (let y = 0; y < L.fenceTop; y++) {
        const row = cellsOf(scene, y);
        for (let x = 0; x < row.length; x++) {
            if (row[x].cls && row[x].cls.indexOf('star') === 0) stars++;
        }
    }
    return stars / skyCells;
}

// ---- Art fidelity -----------------------------------------------------

test('fence rows reproduce the original site art byte-for-byte', () => {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const lines = html.split('\n');
    // Locate by content, not by fixed line number, so an unrelated <head> edit
    // can't silently detune this test.
    const fenceTop = lines.findIndex((l) => l.includes('_/\\_/\\_/\\__'));
    assert.ok(fenceTop >= 0, 'fence art not found in index.html');
    const fenceLines = lines.slice(fenceTop, fenceTop + Scene.FENCE_ROW_COUNT);
    fenceLines.forEach((line, i) => {
        assert.equal(Scene.FENCE_ART[i], line, `fence row ${i} mismatch`);
    });
});

test('cat sprite reproduces the original site art (stars stripped)', () => {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const lines = stripTags(html).split('\n');
    const catTop = lines.findIndex((l) => l.includes('|\\___/|'));
    assert.ok(catTop >= 0, 'cat art not found in index.html');
    const catLines = lines.slice(catTop, catTop + Scene.CAT_ART.length);
    catLines.forEach((line, i) => {
        const expected = ' '.repeat(Scene.CAT_COL) + Scene.CAT_ART[i];
        assert.equal(line.slice(0, expected.length), expected, `cat row ${i} mismatch`);
    });
});

test('the collar keeps its own class', () => {
    assert.deepEqual(Scene.CAT_CLASS_SPANS, [{ row: 3, col: 3, len: 3, cls: 'collar' }]);
    const scene = Scene.buildScene({ cols: Scene.BASE_COLS, rows: Scene.BASE_ROWS });
    const L = scene.layout;
    const row = cellsOf(scene, L.catTop + 3);
    const col0 = L.coreLeft + Scene.CAT_COL;
    assert.deepEqual(row.slice(col0, col0 + 7).map((c) => c.char), [' ', ' ', ')', '=', '=', '=', '(']);
    assert.deepEqual(row.slice(col0 + 3, col0 + 6).map((c) => c.cls), ['collar', 'collar', 'collar']);
});

test('the Sóc un gat label keeps its accented character', () => {
    assert.ok(Scene.CAT_ART[2].includes('ó'));
    assert.ok(Scene.CAT_ART[2].includes('Sóc un gat'));
});

test('fence posts/rails repeat with period 3, except the tail patch', () => {
    for (let row = 1; row < Scene.FENCE_ROW_COUNT; row++) {
        for (let c = Scene.FENCE_LEFT; c <= Scene.FENCE_RIGHT; c++) {
            const patched = Scene.TAIL_PATCH[row] &&
                c >= Scene.TAIL_PATCH_COL && c < Scene.TAIL_PATCH_COL + Scene.TAIL_PATCH[row].length;
            if (patched) continue;
            const ch = Scene.fenceChar(row, c);
            if (c % 3 === 2) assert.equal(ch, '|', `row ${row} col ${c}`);
            else assert.equal(ch, ' ', `row ${row} col ${c}`);
        }
    }
});

test('the fence runs to both screen edges, with no end in view', () => {
    [[60, 44], [140, 45], [301, 60]].forEach(([cols, rows]) => {
        const scene = Scene.buildScene({ cols, rows });
        const L = scene.layout;
        for (let fr = 0; fr < Scene.FENCE_ROW_COUNT; fr++) {
            const row = cellsOf(scene, L.fenceTop + fr);
            // Every rendered cell matches the drawn model (weathered fence,
            // tail patch, or a vine on top of the gap beside a post).
            row.forEach((cell, x) => {
                if (cell.cls === 'vine') return;
                assert.equal(cell.char, drawnFenceChar(fr, x - L.coreLeft),
                    `fence mismatch at ${x} on row ${fr} (${cols}x${rows})`);
            });
            // ...and the row reaches its last non-space column. Rows are
            // right-trimmed (trailing spaces are invisible in a <pre>), so
            // comparing against cols directly would be wrong.
            let lastInk = -1;
            for (let x = 0; x < cols; x++) {
                if (drawnFenceChar(fr, x - L.coreLeft) !== ' ') lastInk = x;
            }
            assert.ok(lastInk >= cols - 9, `fence stops short of the right edge (${cols}x${rows})`);
            assert.ok(row.length > lastInk, `fence row ${fr} truncated at ${cols}x${rows}`);
            assert.equal(row[0].char, drawnFenceChar(fr, -L.coreLeft),
                `fence does not reach the left edge at ${cols}x${rows}`);
        }
    });
});

test('fence keeps its period-3 rhythm into negative core columns', () => {
    for (let c = -60; c <= 120; c++) {
        const isPost = ((c % 3) + 3) % 3 === 2;
        assert.equal(Scene.fenceChar(1, c), isPost ? '|' : ' ', `body row at core col ${c}`);
        assert.equal(Scene.fenceChar(0, c), isPost ? '_' : (((c % 3) + 3) % 3 === 0 ? '/' : '\\'),
            `rail row at core col ${c}`);
    }
    // The cat's tail weaves around the post at core column 14; if that column
    // ever stops being a post the tail detaches from the fence.
    assert.equal(Scene.fenceChar(1, 14), '|');
});

// ---- Weathering and vines -----------------------------------------------

test('weathering rates stay sparse, and gaps are never adjacent', () => {
    let missing = 0, sagging = 0, vined = 0, total = 0, run = 0, longestRun = 0;
    for (let post = -900; post <= 900; post += 3) {
        total++;
        const state = Scene.picketState(post);
        if (state === Scene.PICKET_MISSING) {
            missing++;
            run++;
            longestRun = Math.max(longestRun, run);
        } else {
            run = 0;
        }
        if (state === Scene.PICKET_SAGGING) sagging++;
        if (Scene.vineRows(post) > 0) vined++;
    }
    assert.ok(missing / total < 0.08, `too many missing pickets: ${missing / total}`);
    assert.ok(sagging / total < 0.14, `too many sagging pickets: ${sagging / total}`);
    assert.ok(vined / total > 0.05 && vined / total < 0.35, `vine rate off: ${vined / total}`);
    // Two gaps in a row would read as the fence being cut in half.
    assert.equal(longestRun, 1, 'found consecutive missing pickets');
    // Neighbouring climbers would merge into a hedge.
    for (let post = -600; post <= 600; post += 3) {
        if (Scene.vineRows(post) && Scene.vineRows(post - 3)) {
            assert.fail(`adjacent vines at ${post}`);
        }
    }
});

test('the cat\'s rear is drawn in full on the rail row, in the cat\'s colour', () => {
    const scene = Scene.buildScene({ cols: 120, rows: 50 });
    const L = scene.layout;
    const rail = cellsOf(scene, L.fenceTop);
    // Core cols 10-16 spell the cat's hindquarters, exactly as the original
    // art draws them. Losing any of it amputates part of the cat.
    const rear = '\\__  _/';
    for (let i = 0; i < rear.length; i++) {
        const cell = rail[L.coreLeft + Scene.CAT_BASE_COL + i];
        assert.equal(cell.char, rear.charAt(i), `cat rear wrong at core col ${Scene.CAT_BASE_COL + i}`);
        assert.notEqual(cell.cls, 'fence', `cat rear is fence-coloured at core col ${Scene.CAT_BASE_COL + i}`);
    }
    // Either side of the cat the rail is occluded, so no brown touches it.
    [Scene.CAT_COL, Scene.CAT_COL + Scene.CAT_BASE_WIDTH - 1].forEach((c) => {
        const cell = rail[L.coreLeft + c];
        assert.equal(cell.char, ' ', `rail drawn under the cat at core col ${c}`);
    });
});

test('the pickets around the cat\'s tail are never weathered or vined', () => {
    for (let post = Scene.PICKET_PROTECT_LEFT; post <= Scene.PICKET_PROTECT_RIGHT; post += 3) {
        assert.equal(Scene.picketState(post), Scene.PICKET_INTACT, `picket ${post} weathered`);
        assert.equal(Scene.vineRows(post), 0, `picket ${post} vined`);
    }
    // The tail weaves around the post at core column 14; it detaches if that
    // post is ever missing or sagging.
    assert.equal(Scene.fenceSceneChar(1, 14), '|');
    assert.equal(Scene.fenceSceneChar(0, 14), '_');
});

test('the cat\'s tail keeps the cat\'s colour, not the fence\'s', () => {
    const scene = Scene.buildScene({ cols: 120, rows: 50 });
    const L = scene.layout;
    // The cat is in front of the fence, so the whole tail patch is the cat.
    [0, 1, 2, 3].forEach((fr) => {
        const row = cellsOf(scene, L.fenceTop + fr);
        const patch = Scene.TAIL_PATCH[fr];
        for (let k = 0; k < patch.length; k++) {
            if (patch.charAt(k) === ' ') continue;
            const cell = row[L.coreLeft + Scene.TAIL_PATCH_COL + k];
            assert.equal(cell.char, patch.charAt(k), `tail char at row ${fr} offset ${k}`);
            assert.equal(cell.cls, null, `tail at row ${fr} offset ${k} is not cat-coloured`);
        }
    });
});

test('vines stay inside the fence rows and never reach the rail row', () => {
    [[80, 44], [160, 60], [301, 70]].forEach(([cols, rows]) => {
        const scene = Scene.buildScene({ cols, rows });
        const L = scene.layout;
        const cells = Scene.sceneToCells(scene);
        cells.forEach((row, y) => {
            row.forEach((cell, x) => {
                if (cell.cls !== 'vine') return;
                assert.ok(y > L.fenceTop, `vine on the rail row at ${x},${y}`);
                assert.ok(y <= L.groundRow, `vine below the fence at ${x},${y}`);
                const known = Scene.VINE_LEAF_GLYPHS.concat(Scene.VINE_TIP_GLYPHS);
                assert.ok(known.indexOf(cell.char) >= 0,
                    `unexpected vine glyph ${JSON.stringify(cell.char)}`);
            });
        });
    });
});

test('the fence is coloured as background, not as the cat', () => {
    const scene = Scene.buildScene({ cols: 120, rows: 50 });
    const L = scene.layout;
    // Posts well away from the tail must carry the fence class.
    const row = cellsOf(scene, L.groundRow);
    let posts = 0;
    row.forEach((cell, x) => {
        if (cell.char !== '|') return;
        posts++;
        assert.equal(cell.cls, 'fence', `post at ${x} is not fence-coloured`);
    });
    assert.ok(posts > 10, 'expected many posts on the fence base row');
});

// ---- Idle animations ------------------------------------------------------

test('the resting scene is unchanged by the animation feature', () => {
    const opts = { cols: 140, rows: 50, moonRows: MoonPhase.renderMoonRows(4) };
    const plain = Scene.sceneToText(Scene.buildScene(opts));
    // No animation options, an explicit rest frame, and an absent meteor must
    // all produce exactly the same page.
    assert.equal(Scene.sceneToText(Scene.buildScene({ ...opts, tailFrame: 0 })), plain);
    assert.equal(Scene.sceneToText(Scene.buildScene({ ...opts, meteor: null })), plain);
    // Frame 0 must render the tail exactly as the static TAIL_PATCH does.
    Scene.TAIL_PATCH.forEach((patch, r) => {
        const frame = Scene.TAIL_WAG_FRAMES[0][r];
        if (patch === null) {
            assert.equal(frame, null, `frame 0 row ${r} should be null`);
            return;
        }
        assert.equal(frame.slice(0, patch.length), patch, `frame 0 row ${r} diverges`);
        assert.match(frame.slice(patch.length), /^ *$/, `frame 0 row ${r} pads with non-space`);
    });
});

test('every wag frame stays inside the tail\'s five columns', () => {
    Scene.TAIL_WAG_FRAMES.forEach((frame, f) => {
        assert.equal(frame.length, Scene.TAIL_PATCH.length, `frame ${f} row count`);
        frame.forEach((patch, r) => {
            if (patch === null) return;
            assert.ok(patch.length <= 5,
                `frame ${f} row ${r} is ${patch.length} cols — it would erase a fence post`);
        });
        // Row 0 is the cat's rear, where the tail attaches: the body must not move.
        assert.equal(frame[0], Scene.TAIL_WAG_FRAMES[0][0], `frame ${f} moved the cat's body`);
    });
});

test('wagging never disturbs the fence posts flanking the tail', () => {
    Scene.TAIL_WAG_FRAMES.forEach((_, f) => {
        const scene = Scene.buildScene({ cols: 120, rows: 50, tailFrame: f });
        const L = scene.layout;
        for (let fr = 1; fr < Scene.FENCE_ROW_COUNT; fr++) {
            const row = cellsOf(scene, L.fenceTop + fr);
            [11, 17].forEach((post) => {
                const cell = row[L.coreLeft + post];
                assert.equal(cell.char, '|', `frame ${f} lost the post at col ${post}, row ${fr}`);
                assert.equal(cell.cls, 'fence', `frame ${f} recoloured the post at col ${post}`);
            });
        }
    });
});

test('the wagging tail stays the cat\'s colour, never the fence\'s', () => {
    Scene.TAIL_WAG_FRAMES.forEach((frame, f) => {
        const scene = Scene.buildScene({ cols: 120, rows: 50, tailFrame: f });
        const L = scene.layout;
        frame.forEach((patch, r) => {
            if (patch === null) return;
            for (let k = 0; k < patch.length; k++) {
                if (patch.charAt(k) === ' ') continue;
                const cell = cellsOf(scene, L.fenceTop + r)[L.coreLeft + Scene.TAIL_PATCH_COL + k];
                assert.equal(cell.char, patch.charAt(k), `frame ${f} row ${r} col ${k}`);
                assert.equal(cell.cls, null, `frame ${f} row ${r} col ${k} is not cat-coloured`);
            }
        });
    });
});

test('the wag sequence starts and ends at rest', () => {
    const seq = Scene.TAIL_WAG_SEQUENCE;
    assert.ok(seq.length > 2, 'sequence too short to read as a wag');
    assert.equal(seq[0], 0, 'wag must start from the resting pose');
    assert.equal(seq[seq.length - 1], 0, 'wag must return to the resting pose');
    seq.forEach((f) => {
        assert.ok(f >= 0 && f < Scene.TAIL_WAG_FRAMES.length, `frame ${f} does not exist`);
    });
});

test('meteorCells lays a fading trail back up-left from the head', () => {
    const cells = Scene.meteorCells({ row: 20, col: 40 });
    assert.equal(cells.length, Scene.METEOR_TRAIL.length);
    assert.equal(cells[0].char, '*', 'the head should be the bright glyph');
    cells.forEach((c, i) => {
        // 1:1 diagonal, so every trail cell sits on the diagonal behind the head.
        assert.equal(c.x, 40 - i, `cell ${i} off the diagonal`);
        assert.equal(c.y, 20 - i, `cell ${i} off the diagonal`);
        assert.equal(c.char, Scene.METEOR_TRAIL[i].char);
        assert.equal(c.cls, Scene.METEOR_TRAIL[i].cls);
    });
    assert.deepEqual(Scene.meteorCells(null), [], 'no head means no meteor');
});

test('the meteor stays in the sky and passes behind the art', () => {
    const moonRows = MoonPhase.renderMoonRows(4);
    const probe = Scene.buildScene({ cols: 140, rows: 50, moonRows });
    const L = probe.layout;
    const before = Scene.sceneToCells(probe);
    // Sweep the head right across the sky, including well past the edges.
    for (let step = -10; step < L.fenceTop + 20; step++) {
        const scene = Scene.buildScene({
            cols: 140, rows: 50, moonRows, meteor: { row: step, col: step + 30 }
        });
        Scene.sceneToCells(scene).forEach((row, y) => {
            row.forEach((cell, x) => {
                if (cell.cls !== 'meteor' && cell.cls !== 'meteor-dim') return;
                assert.ok(y < L.fenceTop, `meteor below the sky at ${x},${y}`);
                // It may only claim blank sky or a background star — never art.
                const was = (before[y] || [])[x];
                const wasFree = !was || was.char === ' ' ||
                    (was.cls && was.cls.indexOf('star') === 0);
                assert.ok(wasFree, `meteor overwrote art at ${x},${y}`);
            });
        });
    }
});

test('a meteor is deterministic and leaves no trace once gone', () => {
    const opts = { cols: 140, rows: 50, moonRows: MoonPhase.renderMoonRows(2) };
    const a = Scene.buildScene({ ...opts, meteor: { row: 12, col: 30 } });
    const b = Scene.buildScene({ ...opts, meteor: { row: 12, col: 30 } });
    assert.equal(Scene.sceneToText(a), Scene.sceneToText(b));
    assert.notEqual(Scene.sceneToText(a), Scene.sceneToText(Scene.buildScene(opts)),
        'a visible meteor should change the scene');
    assert.equal(
        Scene.sceneToText(Scene.buildScene({ ...opts, meteor: null })),
        Scene.sceneToText(Scene.buildScene(opts)),
        'clearing the meteor must restore the resting scene exactly'
    );
});

// ---- Sizing math --------------------------------------------------------

test('fitFontSize/fitGrid worked examples', () => {
    const cases = [
        { vw: 1440, vh: 900, ratioW: 0.6, fontPx: 17.04, lineHeightPx: 20, cols: 140, rows: 45 },
        { vw: 1920, vh: 1080, ratioW: 0.6, fontPx: 20.45, lineHeightPx: 24, cols: 156, rows: 45 },
        { vw: 3840, vh: 2160, ratioW: 0.6, fontPx: 40.9, lineHeightPx: 49, cols: 156, rows: 44 },
        { vw: 375, vh: 667, ratioW: 0.6, fontPx: 11.79, lineHeightPx: 14, cols: 53, rows: 47 }
    ];
    cases.forEach((c) => {
        const f = Scene.fitFontSize(c.vw, c.vh, c.ratioW);
        assert.equal(f.fontPx, c.fontPx, `fontPx for ${c.vw}x${c.vh}`);
        assert.equal(f.lineHeightPx, c.lineHeightPx, `lineHeightPx for ${c.vw}x${c.vh}`);
        const g = Scene.fitGrid(c.vw, c.vh, f.fontPx * c.ratioW, f.lineHeightPx);
        assert.equal(g.cols, c.cols, `cols for ${c.vw}x${c.vh}`);
        assert.equal(g.rows, c.rows, `rows for ${c.vw}x${c.vh}`);
    });
});

test('the core never overflows the viewport, at any size or font ratio', () => {
    const ratios = [0.5498, 0.6, 0.602];
    for (let vw = 240; vw <= 4000; vw += 251) {
        for (let vh = 180; vh <= 2600; vh += 271) {
            for (const ratioW of ratios) {
                const f = Scene.fitFontSize(vw, vh, ratioW);
                const charW = f.fontPx * ratioW;
                const g = Scene.fitGrid(vw, vh, charW, f.lineHeightPx);
                assert.ok(g.cols >= Scene.BASE_COLS, `cols<BASE_COLS at ${vw}x${vh}/${ratioW}`);
                assert.ok(g.rows >= Scene.BASE_ROWS, `rows<BASE_ROWS at ${vw}x${vh}/${ratioW}`);
                assert.ok(Scene.BASE_COLS * charW <= vw + 1e-6, `core overflows width at ${vw}x${vh}/${ratioW}`);
                assert.ok(Scene.BASE_ROWS * f.lineHeightPx <= vh + 1e-6, `core overflows height at ${vw}x${vh}/${ratioW}`);
            }
        }
    }
});

// ---- Layout --------------------------------------------------------------

test('layout keeps the core fully inside the grid at every size', () => {
    for (let cols = Scene.BASE_COLS; cols <= 400; cols += 13) {
        for (let rows = Scene.BASE_ROWS; rows <= 200; rows += 17) {
            const L = Scene.layout(cols, rows);
            assert.ok(L.coreLeft >= Scene.SIDE_PAD_COLS, `coreLeft too small at ${cols}x${rows}`);
            assert.ok(L.coreLeft + Scene.CORE_COLS <= cols, `core overflows right at ${cols}x${rows}`);
            assert.ok(L.moonBottom < L.catTop, `moon overlaps cat at ${cols}x${rows}`);
            assert.ok(L.catBottom < L.fenceTop, `cat overlaps fence at ${cols}x${rows}`);
            assert.ok(L.fenceTop >= 0, `fence top negative at ${cols}x${rows}`);
            assert.ok(L.groundRow < rows, `groundRow overflows at ${cols}x${rows}`);
        }
    }
});

test('layout is total: undersized input clamps to the base grid', () => {
    const L = Scene.layout(10, 5);
    assert.equal(L.cols, Scene.BASE_COLS);
    assert.equal(L.rows, Scene.BASE_ROWS);
});

test('at the base grid, the composition matches the original spacing exactly', () => {
    const L = Scene.layout(Scene.BASE_COLS, Scene.BASE_ROWS);
    assert.equal(L.moonTop, 13);
    assert.equal(L.moonBottom, 19);
    assert.equal(L.catTop, 28);
    assert.equal(L.catBottom, 35);
    assert.equal(L.fenceTop, 36);
    assert.equal(L.fenceBottom, 41);
    assert.equal(L.groundRow, 41);
    assert.equal(L.coreLeft, Scene.SIDE_PAD_COLS);
});

test('the moon keeps a fixed gap above the cat regardless of window height', () => {
    for (let rows = Scene.BASE_ROWS; rows <= Scene.BASE_ROWS + 300; rows += 11) {
        const L = Scene.layout(Scene.BASE_COLS, rows);
        assert.equal(
            L.catTop - L.moonBottom - 1, Scene.MOON_CAT_GAP_ROWS,
            `gap drifted at rows=${rows}`
        );
    }
});

test('the core rectangle is pixel-identical across a dense sweep of small grids', () => {
    for (let cols = Scene.BASE_COLS; cols <= Scene.BASE_COLS + 17; cols++) {
        for (let rows = Scene.BASE_ROWS; rows <= Scene.BASE_ROWS + 12; rows++) {
            const scene = Scene.buildScene({ cols, rows, moonRows: MoonPhase.renderMoonRows(4) });
            const L = scene.layout;
            // The live fence is weathered and tiles past the core, so it is
            // pinned against the drawn model rather than the static FENCE_ART
            // (which the byte-for-byte fidelity test covers separately).
            for (let r = 0; r < Scene.FENCE_ROW_COUNT; r++) {
                const row = cellsOf(scene, L.fenceTop + r);
                row.forEach((cell, x) => {
                    if (cell.cls === 'vine') return;
                    assert.equal(cell.char, drawnFenceChar(r, x - L.coreLeft),
                        `fence row ${r} col ${x} at ${cols}x${rows}`);
                });
            }
            // Only the cat's own non-space glyphs are guaranteed (it blits
            // transparently); columns before/around it are open sky where a
            // star may legitimately land, exactly as in the original art.
            for (let r = 0; r < Scene.CAT_ART.length; r++) {
                const row = cellsOf(scene, L.catTop + r);
                const line = Scene.CAT_ART[r];
                for (let j = 0; j < line.length; j++) {
                    if (line[j] === ' ') continue;
                    const cell = row[L.coreLeft + Scene.CAT_COL + j];
                    assert.equal(cell.char, line[j], `cat row ${r} col ${j} at ${cols}x${rows}`);
                }
            }
        }
    }
});

// ---- Determinism and resize stability -------------------------------------

test('buildScene is deterministic: identical input gives identical output', () => {
    const a = Scene.buildScene({ cols: 130, rows: 50, moonRows: MoonPhase.renderMoonRows(2) });
    const b = Scene.buildScene({ cols: 130, rows: 50, moonRows: MoonPhase.renderMoonRows(2) });
    assert.equal(Scene.sceneToText(a), Scene.sceneToText(b));
});

function starSceneCoords(cols, rows) {
    const scene = Scene.buildScene({ cols, rows });
    const L = scene.layout;
    const set = new Set();
    for (let y = 0; y < L.groundRow; y++) {
        const row = cellsOf(scene, y);
        for (let x = 0; x < row.length; x++) {
            if (row[x].cls && row[x].cls.indexOf('star') === 0) {
                set.add((x - L.coreLeft) + ',' + (y - L.groundRow));
            }
        }
    }
    return set;
}

test('growing the grid translates the star field instead of reshuffling it', () => {
    const base = starSceneCoords(100, 40);
    [102, 107, 130].forEach((cols) => {
        const grown = starSceneCoords(cols, 40);
        for (const coord of base) {
            assert.ok(grown.has(coord), `star at ${coord} disappeared when growing to ${cols} cols`);
        }
    });
});

test('hash2 is well distributed and handles negative coordinates', () => {
    const buckets = new Array(8).fill(0);
    let n = 0;
    for (let x = -80; x <= 80; x++) {
        for (let y = -80; y <= 80; y++) {
            buckets[(Scene.hash2(x, y, Scene.SEED_STAR) >>> 16) & 7]++;
            n++;
        }
    }
    buckets.forEach((count) => {
        const frac = count / n;
        assert.ok(frac > 0.10 && frac < 0.16, `bucket fraction ${frac} far from uniform 0.125`);
    });
});

// ---- Stars -----------------------------------------------------------

test('star density stays close to the original ~1.1% across sizes', () => {
    [[200, 80], [300, 60], [400, 200], [60, 200]].forEach(([cols, rows]) => {
        const d = starDensity(cols, rows);
        assert.ok(d > 0.006 && d < 0.02, `density ${d} for ${cols}x${rows} out of tolerance`);
    });
});

test('no star coincides with a moon, cat, or fence cell', () => {
    const scene = Scene.buildScene({ cols: 160, rows: 70, moonRows: MoonPhase.renderMoonRows(4) });
    const L = scene.layout;
    for (let y = L.moonTop; y <= L.fenceBottom; y++) {
        const row = cellsOf(scene, y);
        for (let x = 0; x < row.length; x++) {
            const cell = row[x];
            if (cell.cls && cell.cls.indexOf('star') === 0) {
                const inMoon = y >= L.moonTop && y <= L.moonBottom && x >= L.moonBox.left && x <= L.moonBox.right;
                const inCat = y >= L.catTop && y <= L.catBottom && x >= L.catBox.left && x <= L.catBox.right;
                const inFence = y >= L.fenceTop && y <= L.fenceBottom && x >= L.fenceBox.left && x <= L.fenceBox.right;
                assert.ok(!inMoon && !inCat && !inFence, `star at ${x},${y} overlaps art`);
            }
        }
    }
});

// ---- Moon integration --------------------------------------------------

test('the scene\'s moon cells match MoonPhase.renderMoonCells for every phase', () => {
    for (let phase = 0; phase < 8; phase++) {
        const moonRows = MoonPhase.renderMoonRows(phase);
        const scene = Scene.buildScene({ cols: Scene.BASE_COLS, rows: Scene.BASE_ROWS, moonRows });
        const L = scene.layout;
        moonRows.forEach((r, i) => {
            const row = cellsOf(scene, L.moonTop + i);
            const start = L.coreLeft + Scene.MOON_COL + r.indent;
            r.cells.forEach((cell, j) => {
                assert.equal(row[start + j].char, cell.char, `phase ${phase} row ${i} cell ${j} char`);
                assert.equal(row[start + j].cls, cell.cls, `phase ${phase} row ${i} cell ${j} cls`);
            });
        });
    }
});

test('MoonPhase is not mutated by scene composition', () => {
    const before = JSON.stringify(MoonPhase.MOON_ROWS);
    Scene.buildScene({ cols: 100, rows: 40, moonRows: MoonPhase.renderMoonRows(3) });
    assert.equal(JSON.stringify(MoonPhase.MOON_ROWS), before);
});

// ---- Lawn ---------------------------------------------------------------

test('the lawn sits strictly below the fence and spans the full width', () => {
    // One density entry per lawn row — a mismatch silently renders bare rows.
    assert.equal(Scene.LAWN_ROW_DENSITY.length, Scene.GROUND_EXTRA_ROWS);
    const scene = Scene.buildScene({ cols: 150, rows: 60 });
    const L = scene.layout;
    for (let y = 0; y <= L.groundRow; y++) {
        cellsOf(scene, y).forEach((cell, x) => {
            assert.notEqual(cell.cls, 'lawn', `lawn at or above the fence's base at ${x},${y}`);
        });
    }
    const lawnRows = [];
    for (let y = L.groundRow + 1; y < scene.rows; y++) lawnRows.push(y);
    assert.equal(lawnRows.length, Scene.GROUND_EXTRA_ROWS);
    lawnRows.forEach((y) => {
        const row = cellsOf(scene, y);
        assert.ok(row.some((c) => c.cls === 'lawn'), `no lawn on row ${y}`);
        // Grass reaches both edges — the ground is not a centred island.
        assert.ok(row.slice(0, 10).some((c) => c.cls === 'lawn'), `no lawn at left edge of row ${y}`);
        assert.ok(row.slice(-10).some((c) => c.cls === 'lawn'), `no lawn at right edge of row ${y}`);
    });
});

// ---- Structure -----------------------------------------------------------

test('scene structure invariants: no empty runs, no adjacent same-class runs, correct row count', () => {
    const scene = Scene.buildScene({ cols: 140, rows: 55, moonRows: MoonPhase.renderMoonRows(1) });
    assert.equal(scene.grid.length, 55);
    scene.grid.forEach((runs, y) => {
        let lastCls = Symbol('none');
        let width = 0;
        runs.forEach((run) => {
            assert.ok(run.text.length > 0, `empty run at row ${y}`);
            assert.notEqual(run.cls, lastCls, `adjacent runs share a class at row ${y}`);
            lastCls = run.cls;
            width += run.text.length;
        });
        assert.ok(width <= scene.cols, `row ${y} exceeds cols`);
    });
    assert.equal(Scene.sceneToText(scene).split('\n').length, 55);
});

// ---- Purity ----------------------------------------------------------

test('js/scene.js stays pure: no Math.random, no Date, no clock/DOM reads', () => {
    const src = fs.readFileSync(path.join(__dirname, '../js/scene.js'), 'utf8');
    assert.doesNotMatch(src, /Math\.random/);
    assert.doesNotMatch(src, /new Date\(/);
    assert.doesNotMatch(src, /\bdocument\./);
    assert.doesNotMatch(src, /\bwindow\./);
});

test('scene.js exposes window.Scene when loaded as a classic script', () => {
    const vm = require('node:vm');
    const src = fs.readFileSync(path.join(__dirname, '../js/scene.js'), 'utf8');
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    assert.equal(typeof sandbox.Scene.buildScene, 'function');
});
