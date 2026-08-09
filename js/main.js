/*
 * Sizes and paints the responsive scene. The static art shipped in
 * index.html stays as the no-JS fallback; if anything here fails before the
 * first paint, it is left untouched rather than cleared.
 */
(function () {
    'use strict';

    if (typeof Scene === 'undefined' || typeof MoonPhase === 'undefined') return;

    var pre = document.getElementById('scene');
    if (!pre) return;

    var REF_FONT_PX = 100;
    var PROBE_CHARS = 200;

    var probe = document.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.position = 'absolute';
    probe.style.left = '-9999px';
    probe.style.top = '0';
    probe.style.visibility = 'hidden';
    probe.style.whiteSpace = 'pre';
    probe.style.padding = '0';
    probe.style.border = '0';
    probe.style.margin = '0';
    probe.style.letterSpacing = 'normal';
    probe.style.wordSpacing = 'normal';
    probe.style.fontKerning = 'none';
    probe.style.fontVariantLigatures = 'none';
    probe.style.fontFamily = getComputedStyle(pre).fontFamily;
    probe.textContent = new Array(PROBE_CHARS + 1).join('M');
    document.body.appendChild(probe);

    function measureCharWidth(fontPx) {
        probe.style.fontSize = fontPx + 'px';
        return probe.getBoundingClientRect().width / PROBE_CHARS;
    }

    var ratioW = measureCharWidth(REF_FONT_PX) / REF_FONT_PX;

    // One instant for the whole visit, taken at load: a re-render triggered
    // by a mid-session resize must not change the moon's phase or turn the
    // sky. Refreshing the page is how time advances here.
    var loadedAt = new Date();
    var moonRows = MoonPhase.renderMoonRows(MoonPhase.phaseIndex(loadedAt));

    var last = { cols: -1, rows: -1 };
    /*
     * The cell size the grid was last fitted with. Hoisted out of render()
     * because the hover lookup needs it: getBoundingClientRect gives the
     * <pre>'s origin but not these — it is a full-width block, so its box
     * width is the container's, not cols * charW.
     */
    var charWpx = 0, lineHpx = 0;

    /*
     * The real sky, when js/sky.js is present; otherwise skyStars stays null
     * and scene.js falls back to its seeded stars — the page degrades, never
     * breaks. The vantage point comes from the URL hash fragment
     * (#lat=..&lon=..&dir=n|s|e|w), Barcelona looking south by default; the
     * DATE is never configurable, per the no-?date= owner rule.
     */
    var hasSky = typeof SkyMap !== 'undefined';
    var skyView = hasSky ? SkyMap.parseView(
        typeof location === 'object' && location ? location.hash : '') : null;
    var skyStars = null;

    function computeStars() {
        if (!hasSky || !(last.cols > 0)) return;
        skyStars = SkyMap.starCells({
            date: loadedAt,
            lat: skyView.lat,
            lon: skyView.lon,
            azimuth: skyView.azimuth,
            cols: last.cols,
            skyRows: Scene.layout(last.cols, last.rows).fenceTop
        });
    }

    function viewport() {
        var d = document.documentElement;
        return { w: d.clientWidth, h: d.clientHeight };
    }

    var rowEls = [];      // one <span> per grid row, so frames can update rows alone
    var rowKeys = [];     // serialised runs per row, to spot which rows changed

    function rowKey(runs) {
        var key = '';
        for (var i = 0; i < runs.length; i++) {
            key += runs[i].cls + '\u0000' + runs[i].text + '\u0001';
        }
        return key;
    }

    function fillRow(el, runs) {
        while (el.firstChild) el.removeChild(el.firstChild);
        runs.forEach(function (run) {
            if (run.cls) {
                var span = document.createElement('span');
                span.className = run.cls;
                span.textContent = run.text;
                el.appendChild(span);
            } else {
                el.appendChild(document.createTextNode(run.text));
            }
        });
    }

    // Full rebuild. Rows are wrapped in their own inline <span> — invisible
    // inside `white-space: pre`, but it lets an animation frame refill a
    // single row instead of the whole grid.
    function paint(scene) {
        var frag = document.createDocumentFragment();
        rowEls = [];
        rowKeys = [];
        scene.grid.forEach(function (runs, i) {
            var rowEl = document.createElement('span');
            fillRow(rowEl, runs);
            frag.appendChild(rowEl);
            if (i < scene.grid.length - 1) frag.appendChild(document.createTextNode('\n'));
            rowEls.push(rowEl);
            rowKeys.push(rowKey(runs));
        });
        while (pre.firstChild) pre.removeChild(pre.firstChild);
        pre.appendChild(frag);
    }

    // Animation frame: touch only the rows whose contents actually differ.
    function applyScene(scene) {
        if (scene.grid.length !== rowEls.length) {
            paint(scene);
            return;
        }
        scene.grid.forEach(function (runs, i) {
            var key = rowKey(runs);
            if (key === rowKeys[i]) return;
            rowKeys[i] = key;
            fillRow(rowEls[i], runs);
        });
    }

    /*
     * Switch the fallback's centred inline-block layout to the full-bleed grid.
     * Done from script rather than a CSS class because setting that class
     * needed an inline <script>, which a `default-src 'self'` CSP blocks.
     * Writing properties through CSSOM is not inline style in the CSP sense,
     * so it is allowed.
     */
    function claimLayout() {
        pre.style.display = 'block';
        pre.style.margin = '0';
        var wrap = pre.parentNode;
        if (wrap && wrap.style) {
            wrap.style.left = '0';
            wrap.style.textAlign = 'left';
        }
    }

    function render() {
        var vp = viewport();
        if (!(vp.w > 0 && vp.h > 0)) return;
        claimLayout();

        var f = Scene.fitFontSize(vp.w, vp.h, ratioW);
        var charW, grid, tries = 0;
        do {
            pre.style.fontSize = f.fontPx + 'px';
            pre.style.lineHeight = f.lineHeightPx + 'px';
            charW = measureCharWidth(f.fontPx);
            if (!(charW > 0)) return; // can't measure; leave the fallback alone
            grid = Scene.fitGrid(vp.w, vp.h, charW, f.lineHeightPx);
            if (grid.cols * charW <= vp.w) break;
            f = Scene.fitFontSize(vp.w * 0.99, vp.h, charW / f.fontPx);
        } while (++tries < 3);

        pre.style.marginLeft = Math.max(0, (vp.w - grid.cols * charW) / 2) + 'px';

        charWpx = charW;
        lineHpx = f.lineHeightPx;

        /*
         * Deliberately a condition rather than an early return. Everything
         * above must run on every resize, and anything added below must run
         * too — an early return here once meant the hoisted metrics went stale
         * whenever a resize kept the same cell count.
         */
        if (grid.cols !== last.cols || grid.rows !== last.rows) {
            last = grid;
            // Same frozen instant, new window: the sky is recomputed so a wider
            // grid reveals more of it at the edges without moving what is shown.
            computeStars();
            buildHoverNames();
            paint(buildFrame());
        }
        // A stationary cursor covers a different cell after a resize.
        updateHover();
    }

    /* ---- star names on hover ---------------------------------------------
     * Off by default. js/menu.js announces the setting on window — the
     * analogue of the address bar announcing a vantage change — so neither
     * file names the other.
     *
     * The hit test is geometric rather than a listener per star, and has to
     * be: the sky is painted as merged runs, so two adjacent stars sharing a
     * twinkle class are a single <span> with nothing to attach to.
     */
    var HOVER_EVENT = 'settingschange';        // must match js/menu.js
    var LABEL_DX = 10, LABEL_DY = 6, LABEL_PAD = 6;

    var label = document.createElement('span');
    label.className = 'star-name';
    label.hidden = true;
    // Mouse-only by nature. A live region reading names out as the pointer
    // drifts across the sky would be worse than silence.
    label.setAttribute('aria-hidden', 'true');
    document.body.appendChild(label);

    var hoverOn = false;
    var hoverNames = null;     // 'x:y' -> { name, id }, painted stars only
    var hoverBoxes = null;     // what the label must not be written across
    var hoverKey = null;       // the cell the label currently describes
    var ptrX = 0, ptrY = 0, ptrIn = false, ptrQueued = false;
    var hoverQuery = window.matchMedia ? window.matchMedia('(hover: hover)') : null;

    /*
     * Keyed by cell, holding the resolved label rather than the star index, so
     * the hover path is one property read and an unnamed star never enters the
     * map at all. Built from Scene.starVisible — the very predicate buildScene
     * uses — so it cannot name a star that is not on the page; starCells()
     * output is a superset, since anything in the moon, cat or fence halo is
     * dropped. Rebuilt only where the sky can change, never per frame.
     */
    function buildHoverNames() {
        hoverNames = null;
        hoverBoxes = null;
        if (!hasSky || !skyStars || !(last.cols > 0) || !SkyMap.starLabel) return;
        var L = Scene.layout(last.cols, last.rows);
        // Cached with the names rather than re-derived per frame: both only
        // change when the grid does.
        hoverBoxes = [L.moonBox, L.catBox];
        var found = {};
        skyStars.forEach(function (s) {
            if (!Scene.starVisible(s, L)) return;
            var lab = SkyMap.starLabel(s.index);
            if (lab) found[s.x + ':' + s.y] = lab;
        });
        hoverNames = found;
    }

    function hideLabel() {
        hoverKey = null;
        label.hidden = true;
    }

    // Does a label placed here lie across the moon or the cat?
    function coversSubject(x, y, w, h, r) {
        if (!hoverBoxes) return false;
        for (var i = 0; i < hoverBoxes.length; i++) {
            var b = hoverBoxes[i];
            if (x < r.left + (b.right + 1) * charWpx &&
                x + w > r.left + b.left * charWpx &&
                y < r.top + (b.bottom + 1) * lineHpx &&
                y + h > r.top + b.top * lineHpx) return true;
        }
        return false;
    }

    /*
     * Below and right of the cell by preference, so the cursor never covers
     * the glyph being named — then left, then above, taking the first
     * placement that is both on screen and clear of the moon and the cat.
     *
     * Those two are the subject of the picture: a name written across them
     * reads as damage rather than as a label, and hiding the overlapping part
     * would be worse still. Flipping is the same move the right-hand edge
     * already asked for, so the edge and the subjects share one rule.
     */
    function placeLabel(col, row, r) {
        // Measured, not reserved: names run from 'Vega' to the likes of
        // 'Gamma Trianguli Australis'.
        var box = label.getBoundingClientRect();
        var w = box.width, h = box.height || lineHpx;
        var vw = document.documentElement.clientWidth;
        var vh = document.documentElement.clientHeight;
        var rightX = r.left + (col + 1) * charWpx + LABEL_DX;
        var leftX = r.left + col * charWpx - LABEL_DX - w;
        var belowY = r.top + (row + 1) * lineHpx + LABEL_DY;
        var aboveY = r.top + row * lineHpx - LABEL_DY - h;
        var tries = [
            [rightX, belowY], [leftX, belowY], [rightX, aboveY], [leftX, aboveY]
        ];
        var best = null;
        for (var i = 0; i < tries.length && !best; i++) {
            var x = tries[i][0], y = tries[i][1];
            if (x < LABEL_PAD || x + w > vw - LABEL_PAD) continue;
            if (y < LABEL_PAD || y + h > vh - LABEL_PAD) continue;
            if (coversSubject(x, y, w, h, r)) continue;
            best = tries[i];
        }
        // Nowhere clear: stay on screen and accept the overlap rather than
        // disappear, which would read as the feature being broken.
        if (!best) {
            best = [Math.max(LABEL_PAD, Math.min(rightX, vw - LABEL_PAD - w)), belowY];
        }
        label.style.left = best[0] + 'px';
        label.style.top = best[1] + 'px';
    }

    function updateHover() {
        if (!hoverOn || !ptrIn || !hoverNames || !(charWpx > 0 && lineHpx > 0)) {
            hideLabel();
            return;
        }
        // Read fresh every flush: the rect folds in marginLeft and the
        // wrapper's bottom anchoring, and caching it would buy an
        // invalidation protocol that has to know about resize, zoom and DPR.
        var r = pre.getBoundingClientRect();
        var col = Math.floor((ptrX - r.left) / charWpx);
        var row = Math.floor((ptrY - r.top) / lineHpx);
        var inGrid = col >= 0 && col < last.cols && row >= 0 && row < last.rows;
        var key = col + ':' + row;
        var star = inGrid ? hoverNames[key] : null;
        if (!star) {
            hideLabel();
            return;
        }
        // Identity separately from placement, so the DOM write happens only
        // when the cell actually changes.
        if (key !== hoverKey) {
            hoverKey = key;
            label.textContent = star.id ? star.name + '  ' + star.id : star.name;
            label.hidden = false;
        }
        placeLabel(col, row, r);
    }

    function onMove(e) {
        // Gated first, so with the feature off — the default — a mousemove
        // costs one comparison and never reaches the frame clock.
        if (!hoverOn) return;
        // Checked live, like the reduced-motion query. A tap synthesises one
        // mousemove and no mouseleave ever follows it, so without this a
        // touch device would light a label and keep it lit.
        if (hoverQuery && !hoverQuery.matches) return;
        ptrX = e.clientX;
        ptrY = e.clientY;
        ptrIn = true;
        if (ptrQueued) return;
        ptrQueued = true;
        requestAnimationFrame(function () {
            ptrQueued = false;
            updateHover();
        });
    }

    pre.addEventListener('mousemove', onMove);
    // Leaving the scene covers moving onto the gear or the open panel too:
    // the browser does that hit-testing, so nothing here needs to know the
    // menu exists. A window-level listener would have gone on naming stars
    // hidden behind it.
    pre.addEventListener('mouseleave', function () {
        ptrIn = false;
        hideLabel();
    });

    /*
     * Deliberately NOT wired to motionGen. The label does not animate, and
     * gating it on reduced motion would take star names away from people who
     * asked for less movement, not less information.
     */
    addEventListener(HOVER_EVENT, function (e) {
        var on = !!(e && e.detail && e.detail.names);
        if (on === hoverOn) return;
        hoverOn = on;
        if (!on) {
            ptrIn = false;
            hideLabel();
        }
    });

    /* ---- idle animations ------------------------------------------------
     * All timing and randomness lives here: js/scene.js stays pure, taking
     * the current tail frame and shooting-star position as plain inputs.
     */

    // The wag steps between poses rather than moving anything continuously, so
    // it stays on a timer; only the meteor needs the display's frame clock.
    var WAG_FRAME_MS = 180;
    var WAG_MIN_MS = 5000, WAG_MAX_MS = 10000;
    // Grid cells per second along the flight — one row and one column per
    // cell, since the path is the diagonal. The one speed knob.
    var METEOR_CELLS_PER_SEC = 54;
    var METEOR_MIN_MS = 20000, METEOR_MAX_MS = 30000;
    // Fireflies: stepped brightness poses on a timer, like the wag. A blink
    // is FIREFLY_BLINK_SEQUENCE at FIREFLY_STEP_MS per pose (~2.8 s), then
    // the slot goes dark for a gap before lighting somewhere new. FIREFLY_MAX
    // independent slots cap concurrency at 2 — usually one or none is lit;
    // the gap range is the density knob.
    var FIREFLY_STEP_MS = 400;
    var FIREFLY_MIN_MS = 3000, FIREFLY_MAX_MS = 7000;
    var FIREFLY_MAX = 2;

    var anim = { tailFrame: Scene.TAIL_REST_FRAME, meteor: null, fireflies: [] };

    /*
     * prefers-reduced-motion is honoured LIVE, matching the CSS twinkle guard
     * (a media query, so the stars stop the instant the OS setting flips —
     * sampling it once at load left the wag and meteors running until reload).
     *
     * motionGen is a generation counter: every flip bumps it, and every timer
     * or rAF chain carries the generation it was started with, dying silently
     * on mismatch. That stops running chains without keeping handles to them,
     * and makes restarts idempotent — a timer still pending from before the
     * flip cannot revive a second chain when it finally fires.
     */
    var motionQuery = window.matchMedia ?
        window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var motionGen = 0;

    function buildFrame() {
        return Scene.buildScene({
            cols: last.cols,
            rows: last.rows,
            moonRows: moonRows,
            stars: skyStars,
            tailFrame: anim.tailFrame,
            meteor: anim.meteor,
            fireflies: anim.fireflies
        });
    }

    function redraw() {
        if (last.cols > 0) applyScene(buildFrame());
    }

    function after(minMs, maxMs, fn) {
        setTimeout(fn, minMs + Math.random() * (maxMs - minMs));
    }

    function runWag(gen) {
        if (gen !== motionGen) return;
        var seq = Scene.TAIL_WAG_SEQUENCE;
        var i = 0;
        (function step() {
            if (gen !== motionGen) return;   // reduced-motion flipped mid-sweep
            anim.tailFrame = seq[i];
            redraw();
            if (++i < seq.length) {
                setTimeout(step, WAG_FRAME_MS);
            } else {
                anim.tailFrame = Scene.TAIL_REST_FRAME;
                after(WAG_MIN_MS, WAG_MAX_MS, function () { runWag(gen); });
            }
        })();
    }

    function runMeteor(gen) {
        if (gen !== motionGen) return;
        if (!(last.cols > 0)) {
            after(METEOR_MIN_MS, METEOR_MAX_MS, function () { runMeteor(gen); });
            return;
        }
        // The layout as of launch: it aims the flight. The flight itself is
        // judged against a FRESH layout every frame (see below).
        var L = Scene.layout(last.cols, last.rows);
        var pathIndex = Math.floor(Math.random() * Scene.METEOR_PATHS.length);
        var path = Scene.METEOR_PATHS[pathIndex];
        // How far the trail reaches behind the head: the flight has to start
        // and end with all of it out of sight, so the streak is never seen
        // popping into or out of existence.
        var pad = Scene.METEOR_LENGTH + 2;
        // Aim at a point in the open sky and work outwards from there. A
        // diagonal covers as many columns as rows, so on a wide window it runs
        // out of sky first and on a narrow one it runs off the side; bounding
        // the flight by rows alone spent much of it off-screen.
        var aimRow = Math.round(L.fenceTop * (0.25 + Math.random() * 0.5));
        var aimCol = Math.round(last.cols * (0.2 + Math.random() * 0.6));

        function at(t) {
            return { r: aimRow + path.dy * t, c: aimCol + path.dx * t };
        }
        // One test for both ends of the flight. A meteor can enter and leave
        // through a side edge as readily as through the top, so an asymmetric
        // pair — back up until off the side, then stop when off the side —
        // ended the flight on the very frame it started.
        function inFlight(p, lay) {
            return p.r >= -pad && p.r <= lay.fenceTop + pad &&
                p.c >= -pad && p.c <= last.cols + pad;
        }

        var t0 = 0;
        while (inFlight(at(t0 - 1), L)) t0--;
        var cellsPerSec = METEOR_CELLS_PER_SEC * (0.85 + Math.random() * 0.3);
        var started = null;

        // Never call the first frame by hand with a made-up timestamp: rAF
        // counts from page load, not from zero, so seeding `started` with 0
        // made the very first real frame look seconds late and fling the
        // meteor straight past the far edge before it drew anything.
        function frame(now) {
            if (gen !== motionGen) return;   // reduced-motion flipped mid-flight
            if (started === null) started = now;
            // Position from elapsed time on the display's own clock, never from
            // a frame count on a timer. setTimeout lands between refreshes, so
            // each step was held for one, two or three of them in an uneven
            // pattern and every timer hiccup became a stumble. The position
            // stays fractional here — scene.js rounds it at the edges; rounding
            // it early quantised the timing too, which is what stuttered.
            var p = at(t0 + (now - started) / 1000 * cellsPerSec);
            // The layout is re-derived every frame, not reused from launch.
            // buildScene always draws with the current grid, so judging the
            // flight against the launch layout let a mid-flight resize move
            // the moon into the path: the streak vanished crossing the disc's
            // new position, then re-emerged below it and flew on through the
            // very thing it is supposed to die against.
            var Lnow = Scene.layout(last.cols, last.rows);
            var head = { row: p.r, col: p.c, path: pathIndex };
            // meteorAlive ends the flight on contact with the cat or the moon.
            if (!inFlight(p, Lnow) || !Scene.meteorAlive(head, Lnow)) {
                anim.meteor = null;
                redraw();
                after(METEOR_MIN_MS, METEOR_MAX_MS, function () { runMeteor(gen); });
                return;
            }
            anim.meteor = head;
            redraw();
            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    function runFirefly(gen, slot) {
        if (gen !== motionGen) return;
        if (!(last.cols > 0)) {
            after(FIREFLY_MIN_MS, FIREFLY_MAX_MS, function () { runFirefly(gen, slot); });
            return;
        }
        // Position from the CURRENT grid, never a stale copy: buildScene
        // clips against the live layout, so a mid-blink resize simply drops
        // this one and the next spawn lands somewhere valid on the new grid.
        var L = Scene.layout(last.cols, last.rows);
        var fly = {
            x: Math.floor(Math.random() * last.cols),
            y: L.groundRow + 1 + Math.floor(Math.random() * Scene.GROUND_EXTRA_ROWS),
            phase: 0
        };
        var seq = Scene.FIREFLY_BLINK_SEQUENCE;
        var i = 0;
        (function step() {
            if (gen !== motionGen) return;   // reduced-motion flipped mid-blink
            if (i < seq.length) {
                fly.phase = seq[i++];
                anim.fireflies[slot] = fly;
                redraw();
                setTimeout(step, FIREFLY_STEP_MS);
            } else {
                // Unlike the wag, the sequence does not end at a resting
                // state: the slot has to be put out explicitly, and the tuft
                // underneath returns on the redraw.
                anim.fireflies[slot] = null;
                redraw();
                after(FIREFLY_MIN_MS, FIREFLY_MAX_MS, function () { runFirefly(gen, slot); });
            }
        })();
    }

    function startAnimations() {
        if (motionQuery && motionQuery.matches) return;
        var gen = motionGen;
        after(WAG_MIN_MS, WAG_MAX_MS, function () { runWag(gen); });
        after(METEOR_MIN_MS, METEOR_MAX_MS, function () { runMeteor(gen); });
        for (var slot = 0; slot < FIREFLY_MAX; slot++) {
            (function (s) {
                // Staggered first light, so the page doesn't open on a
                // double flash; the jittered gaps keep them apart after.
                after(FIREFLY_MIN_MS * (s + 1), FIREFLY_MAX_MS * (s + 1),
                    function () { runFirefly(gen, s); });
            })(slot);
        }
    }

    if (motionQuery && motionQuery.addEventListener) {
        motionQuery.addEventListener('change', function () {
            motionGen++;                              // stale chains die at their next tick
            anim.tailFrame = Scene.TAIL_REST_FRAME;
            anim.meteor = null;
            anim.fireflies = [];                      // a lit glow must not freeze on screen
            redraw();                                 // straight back to the resting scene
            startAnimations();                        // a no-op while reduce stays on
        });
    }

    var resizeQueued = false;
    function onResize() {
        if (resizeQueued) return;
        resizeQueued = true;
        requestAnimationFrame(function () {
            resizeQueued = false;
            render();
        });
    }

    render();
    startAnimations();
    addEventListener('resize', onResize);
    addEventListener('orientationchange', render);
    // Retune the vantage point live when the hash is edited — no reload, and
    // the frozen load instant is kept: only WHERE you look changes, not WHEN.
    addEventListener('hashchange', function () {
        if (!hasSky) return;
        skyView = SkyMap.parseView(
            typeof location === 'object' && location ? location.hash : '');
        computeStars();
        // Same cell under the cursor, different star in it.
        buildHoverNames();
        redraw();
        updateHover();
    });
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(render, function () {});
    }
})();
