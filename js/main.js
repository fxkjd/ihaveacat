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

    function currentHash() {
        return typeof location === 'object' && location ? location.hash : '';
    }

    var skyView = hasSky ? SkyMap.parseView(currentHash()) : null;
    var skyStars = null;
    var constellationsOn = false;
    var starDensity = hasSky ? SkyMap.DEFAULT_DENSITY : null;
    var starPositions = [];
    var constellationSVG = null;
    // One entry per figure with at least one drawn edge:
    // { figure, name, group, edges }. The edges are the same pixel geometry
    // handed to the <line> nodes, kept so the pointer can be tested against
    // them — see the hover section for why the hit test cannot be the SVG's.
    var constellationHits = [];
    var FIGURE_CLASS = 'constellation';
    var FIGURE_ON_CLASS = 'constellation constellation-on';
    var baselineProbe = null, inkContext = null;

    function measureStarInk() {
        if (!baselineProbe) {
            inkContext = document.createElement('canvas').getContext('2d');
            baselineProbe = document.createElement('span');
            baselineProbe.setAttribute('aria-hidden', 'true');
            baselineProbe.style.display = 'inline-block';
            baselineProbe.style.width = '0';
            baselineProbe.style.height = '0';
            baselineProbe.style.verticalAlign = 'baseline';
        }
        if (!inkContext) return null;
        var style = getComputedStyle(pre);
        var font = (style.fontStyle || 'normal') + ' ' + (style.fontWeight || 'normal') +
            ' ' + pre.style.fontSize + ' ' + style.fontFamily;
        // An empty inline-block sits exactly on the HTML text baseline.
        rowEls[0].appendChild(baselineProbe);
        var baseline = baselineProbe.getBoundingClientRect().top - pre.getBoundingClientRect().top;
        rowEls[0].removeChild(baselineProbe);
        inkContext.font = font;
        inkContext.fontKerning = 'none';
        inkContext.textAlign = 'left';
        inkContext.textBaseline = 'alphabetic';
        var metrics = {};
        ['*', "'", '.'].forEach(function (glyph) { metrics[glyph] = inkContext.measureText(glyph); });
        return { baseline: baseline, metrics: metrics };
    }

    function paintedStarBox(star, ink, origin) {
        var runs = rowEls[star.y].childNodes, offset = star.x;
        for (var i = 0; i < runs.length; i++) {
            var run = runs[i], text = run.textContent;
            if (offset >= text.length) { offset -= text.length; continue; }
            var range = document.createRange();
            range.selectNodeContents(run);
            var node = run.nodeType === 3 ? run : run.firstChild;
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            var rect = range.getBoundingClientRect();
            // Range supplies the browser's final text placement, including
            // fractional advance rounding at run boundaries. Canvas is only
            // used for ink metrics, never to paint stars or project the sky.
            // Padded once, here: the same box is trimmed against and punched
            // out of the mask, so a line cannot be cut by one and not the other.
            var box = Scene.starInkBox(star, ink.metrics[star.char], charWpx, lineHpx,
                ink.baseline, Scene.starGap(charWpx, lineHpx));
            var dx = rect.left - origin.left - star.x * charWpx;
            box.left += dx; box.right += dx;
            box.shift = dx;
            return box;
        }
        return null;
    }

    function computeStars() {
        if (!hasSky || !(last.cols > 0)) return;
        starPositions = [];
        skyStars = SkyMap.starCells({
            date: loadedAt,
            lat: skyView.lat,
            lon: skyView.lon,
            azimuth: skyView.azimuth,
            cols: last.cols,
            // The panel already locks the density to high while the figures
            // are on; the renderer holds the same line on its own, because a
            // figure drawn without its faint stars has no positions for them
            // and comes apart.
            density: constellationsOn ? 'high' : starDensity,
            positions: constellationsOn ? starPositions : null,
            skyRows: Scene.layout(last.cols, last.rows).fenceTop
        });
    }

    function svgNode(tag, attrs) {
        var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        Object.keys(attrs).forEach(function (key) { el.setAttribute(key, attrs[key]); });
        return el;
    }

    // Only called on sky/settings/layout changes, never by redraw() or an
    // animation frame. Pixel metrics and the pre origin also update on a
    // resize which leaves the grid dimensions unchanged.
    function paintConstellations() {
        constellationHits = [];
        resetHighlight();
        if (!constellationsOn || !hasSky || !(last.cols > 0)) {
            if (constellationSVG) constellationSVG.style.display = 'none';
            return;
        }
        if (!constellationSVG) {
            constellationSVG = svgNode('svg', { 'class': 'constellations', 'aria-hidden': 'true', focusable: 'false' });
            document.body.appendChild(constellationSVG);
        }
        var L = Scene.layout(last.cols, last.rows);
        var ink = measureStarInk();
        if (!ink) { constellationSVG.style.display = 'none'; return; }
        var r = pre.getBoundingClientRect();
        var w = last.cols * charWpx, h = L.fenceTop * lineHpx;
        constellationSVG.style.display = 'block';
        constellationSVG.style.left = r.left + 'px';
        constellationSVG.style.top = r.top + 'px';
        constellationSVG.style.width = w + 'px';
        constellationSVG.style.height = h + 'px';
        constellationSVG.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
        var frag = document.createDocumentFragment();
        var defs = svgNode('defs', {});
        var mask = svgNode('mask', { id: 'constellation-sky-mask', maskUnits: 'userSpaceOnUse',
            x: 0, y: 0, width: w, height: h });
        // Reuse the exact scene visibility predicate, including its halos.
        // White row runs leave the moon, cat (including text) and fence black.
        for (var y = 0; y < L.fenceTop; y++) {
            var start = -1;
            for (var x = 0; x <= last.cols; x++) {
                var clear = x < last.cols && Scene.starVisible({ x: x, y: y }, L);
                if (clear && start < 0) start = x;
                if (!clear && start >= 0) {
                    mask.appendChild(svgNode('rect', { x: start * charWpx, y: y * lineHpx,
                        width: (x - start) * charWpx, height: lineHpx, fill: 'white' }));
                    start = -1;
                }
            }
        }
        var boxes = {};
        skyStars.forEach(function (star) {
            if (!Scene.starVisible(star, L)) return;
            var box = paintedStarBox(star, ink, r);
            if (!box) return;
            boxes[star.x + ':' + star.y] = box;
            // Also protect unrelated stars that a segment happens to cross.
            // This mask never inherits animated star opacity.
            mask.appendChild(svgNode('rect', { x: box.left, y: box.top,
                width: box.right - box.left, height: box.bottom - box.top, fill: 'black' }));
        });
        defs.appendChild(mask);
        frag.appendChild(defs);
        var lines = svgNode('g', { mask: 'url(#constellation-sky-mask)' });
        // A <g> per figure, so lighting one up is a single class write rather
        // than a walk over its lines — and so the DOM says which figure is
        // which, which the flat list it replaces could not.
        var groups = {};
        // An end with no painted glyph — under the horizon, off the side, or
        // behind the moon, cat or fence — gets the bare cell centre, and the
        // mask above ends the line where the star would have been. It is put
        // in the measured frame of the star at the OTHER end (the Range shift
        // that end was placed with), so the line keeps the direction it would
        // have had with both glyphs measured: nothing was painted at a hidden
        // cell to measure, and the visible star is the nearest thing that was.
        function endBox(p, other) {
            var box = boxes[p.x + ':' + p.y];
            if (box) return box;
            var c = Scene.cellCentre(p, charWpx, lineHpx);
            var dx = (boxes[other.x + ':' + other.y] || {}).shift || 0;
            c.left += dx; c.right += dx;
            return c;
        }
        SkyMap.visibleSegments(starPositions, function (s) { return Scene.starVisible(s, L); })
            .forEach(function (s) {
                var edge = Scene.starEdge(endBox(s.a, s.b), endBox(s.b, s.a));
                if (!edge) return;
                var hit = groups[s.figure];
                if (!hit) {
                    hit = groups[s.figure] = {
                        figure: s.figure,
                        name: SkyMap.figureName(s.figure),
                        group: svgNode('g', { 'class': FIGURE_CLASS }),
                        edges: []
                    };
                    constellationHits.push(hit);
                    lines.appendChild(hit.group);
                }
                hit.group.appendChild(svgNode('line', edge));
                hit.edges.push(edge);
            });
        frag.appendChild(lines);
        while (constellationSVG.firstChild) constellationSVG.removeChild(constellationSVG.firstChild);
        constellationSVG.appendChild(frag);
    }

    function viewport() {
        var d = document.documentElement;
        return { w: d.clientWidth, h: d.clientHeight };
    }

    var rowEls = [];      // one <span> per grid row, so frames can update rows alone
    var rowKeys = [];     // serialised runs per row, to spot which rows changed
    var rowRuns = [];     // the runs each row was last drawn from, one node each

    function rowKey(runs) {
        var key = '';
        for (var i = 0; i < runs.length; i++) {
            key += runs[i].cls + '\u0000' + runs[i].text + '\u0001';
        }
        return key;
    }

    function runNode(run) {
        if (!run.cls) return document.createTextNode(run.text);
        var span = document.createElement('span');
        span.className = run.cls;
        span.textContent = run.text;
        return span;
    }

    function fillRow(el, runs) {
        while (el.firstChild) el.removeChild(el.firstChild);
        runs.forEach(function (run) { el.appendChild(runNode(run)); });
    }

    function sameRun(a, b) {
        return a.cls === b.cls && a.text === b.text;
    }

    /*
     * Replace only the runs that changed, keeping the nodes on either side.
     * A replaced <span> starts its twinkle over, so refilling the whole row
     * made every star on it blink whenever one star lit or a meteor crossed.
     */
    function patchRow(i, runs) {
        var el = rowEls[i], old = rowRuns[i];
        var head = 0, tail = 0;
        while (head < old.length && head < runs.length && sameRun(old[head], runs[head])) head++;
        while (tail < old.length - head && tail < runs.length - head &&
            sameRun(old[old.length - 1 - tail], runs[runs.length - 1 - tail])) tail++;
        for (var k = old.length - head - tail; k > 0; k--) el.removeChild(el.childNodes[head]);
        var frag = document.createDocumentFragment();
        for (var j = head; j < runs.length - tail; j++) frag.appendChild(runNode(runs[j]));
        el.insertBefore(frag, el.childNodes[head] || null);
        rowRuns[i] = runs;
    }

    // Full rebuild. Rows are wrapped in their own inline <span> — invisible
    // inside `white-space: pre`, but it lets an animation frame refill a
    // single row instead of the whole grid.
    function paint(scene) {
        var frag = document.createDocumentFragment();
        rowEls = [];
        rowKeys = [];
        rowRuns = [];
        scene.grid.forEach(function (runs, i) {
            var rowEl = document.createElement('span');
            fillRow(rowEl, runs);
            frag.appendChild(rowEl);
            if (i < scene.grid.length - 1) frag.appendChild(document.createTextNode('\n'));
            rowEls.push(rowEl);
            rowKeys.push(rowKey(runs));
            rowRuns.push(runs);
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
            patchRow(i, runs);
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
            // A tap is held in cells, and a new grid — a rotation, on a
            // phone — renumbers every one of them.
            tap = null;
            // Same frozen instant, new window: the sky is recomputed so a wider
            // grid reveals more of it at the edges without moving what is shown.
            computeStars();
            buildHoverNames();
            paint(buildFrame());
        }
        paintConstellations();
        // A stationary cursor covers a different cell after a resize.
        updateHover();
    }

    /* ---- names on hover and tap -------------------------------------------
     * Off by default. js/menu.js announces the setting on window — the
     * analogue of the address bar announcing a vantage change — so neither
     * file names the other.
     *
     * The hit test is geometric rather than a listener per thing, and has to
     * be, twice over. The sky is painted as merged runs, so two adjacent stars
     * sharing a twinkle class are a single <span> with nothing to attach to.
     * And the constellation overlay is `pointer-events: none` behind the
     * scene — it has to be, or it would swallow the very pointer events that
     * name the stars — so its lines never see a pointer either. Both are
     * answered the same way: convert the pointer, then look it up.
     *
     * A mouse hovers and a finger taps. The mouse looks stars up by exact
     * cell; a tap, by the nearest within a fingertip. Figures are found by
     * distance to a drawn line, because a line is a line and no cell contains
     * it. One thing answers at a time: the star lights up and takes the
     * label, and its figure stays dark. A mouse on a star's cell is the star.
     * So is a tap on it; elsewhere a tap takes whichever of star and line it
     * landed nearer, or at a fingertip's reach the stars along a line would
     * leave almost none of it to tap.
     */
    var HOVER_EVENT = 'settingschange';        // must match js/menu.js
    var LABEL_DX = 10, LABEL_DY = 6, LABEL_PAD = 6;
    // How near a line counts as on it: about two fifths of a cell, wide enough
    // to catch without a steady hand, narrow enough that two lines crossing
    // the same patch of sky do not trade the highlight back and forth.
    var HIT_RATIO = 0.4, HIT_MIN_PX = 3;
    // How far a tap reaches, for a star or a line: half the 44px touch target
    // the platforms ask for. A fingertip covers several cells, so the exact
    // cell a mouse is held to would be all but impossible to hit.
    var TOUCH_REACH_PX = 22;

    var label = document.createElement('span');
    label.className = 'star-name';
    label.hidden = true;
    // Pointer-only by nature. A live region reading names out as the pointer
    // drifts across the sky would be worse than silence.
    label.setAttribute('aria-hidden', 'true');
    document.body.appendChild(label);

    var hoverOn = false;
    var hoverNames = null;     // 'x:y' -> { lab, index, x, y }, painted stars only
    var hoverStars = null;     // catalogue index -> the same entries
    var hoverBoxes = null;     // what the label must not be written across
    var hoverKey = null;       // what the label currently describes, tagged
    var hoverFigure = null;    // the lit constellation, or null
    var litStar = null;        // the hoverNames entry drawn lit, or null
    var ptrX = 0, ptrY = 0, ptrIn = false, ptrQueued = false;   // the mouse
    var tap = null;            // what a finger last named — see tapAt
    var downType = null;       // the pointerType of the gesture a click ends

    /*
     * Keyed by cell, holding the resolved label with the star, so the hover
     * path is one property read and an unnamed star never enters the map at
     * all; and by catalogue index too, so a tapped star can be found again
     * after a setting repaints the sky. Built from Scene.starVisible — the very predicate buildScene
     * uses — so it cannot name a star that is not on the page; starCells()
     * output is a superset, since anything in the moon, cat or fence halo is
     * dropped. Rebuilt only where the sky can change, never per frame.
     */
    function buildHoverNames() {
        hoverNames = null;
        hoverStars = null;
        hoverBoxes = null;
        // The lit star is one of the entries being replaced, and its cell may
        // hold another star by now. Every caller repaints next, and the
        // updateHover() that follows lights it again where it still is.
        litStar = null;
        if (!hasSky || !skyStars || !(last.cols > 0) || !SkyMap.starLabel) return;
        var L = Scene.layout(last.cols, last.rows);
        // Cached with the names rather than re-derived per frame: both only
        // change when the grid does.
        hoverBoxes = [L.moonBox, L.catBox];
        var found = {}, byIndex = {};
        skyStars.forEach(function (s) {
            if (!Scene.starVisible(s, L)) return;
            var lab = SkyMap.starLabel(s.index);
            if (!lab) return;
            found[s.x + ':' + s.y] = byIndex[s.index] =
                { lab: lab, index: s.index, x: s.x, y: s.y };
        });
        hoverNames = found;
        hoverStars = byIndex;
    }

    function hideLabel() {
        hoverKey = null;
        label.hidden = true;
    }

    function clearHighlight() {
        if (hoverFigure) hoverFigure.group.setAttribute('class', FIGURE_CLASS);
        hoverFigure = null;
    }

    /*
     * The star is lit in the scene itself, through buildScene's `lit`: a
     * class on its one cell, so the painted glyph is the one turned up and
     * nothing is laid over it. A repaint only when the star changes — a
     * pointer move within its cell costs nothing — and patchRow keeps the
     * rest of its row, twinkles and all.
     */
    function lightStar(star) {
        if (star === litStar) return;
        litStar = star;
        redraw();
    }

    /*
     * A highlight cannot outlive a repaint: the <g> it points at is discarded
     * and rebuilt. So put it back while those nodes are still on the page —
     * a figure left lit behind `display: none` is a lie the DOM keeps telling
     * — and drop the label's identity key with it, or updateHover() would skip
     * the very write that re-lights the new group.
     */
    function resetHighlight() {
        clearHighlight();
        hoverKey = null;
    }

    // The point of a segment nearest (x, y), clamped to the segment: a pointer
    // past the end of a line is measured to the end, not to the infinite ray.
    function edgePoint(e, x, y) {
        var dx = e.x2 - e.x1, dy = e.y2 - e.y1;
        var len2 = dx * dx + dy * dy;
        var t = len2 ? ((x - e.x1) * dx + (y - e.y1) * dy) / len2 : 0;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        return { x: e.x1 + t * dx, y: e.y1 + t * dy };
    }

    // Is the sky showing at this pixel of the <pre>? The mask's predicate.
    function skyAt(x, y, L) {
        return Scene.starVisible({ x: Math.floor(x / charWpx), y: Math.floor(y / lineHpx) }, L);
    }

    // Nearest figure within reach, as { hit, d }, in the overlay's own
    // coordinates — which are the <pre>'s, since the SVG is positioned on its
    // rect. Nearest rather than first, so where two figures pass close the
    // pointer picks one and stays with it instead of flickering on data order.
    function figureNear(x, y, reach) {
        /*
         * The drawn edges run on into the moon, the fence halo and past the
         * horizon, where the mask hides them; the pointer must not find a
         * line there that nobody can see. So the sky must show both where the
         * pointer is and at the point of the line it is taken to mean —
         * within a fingertip's reach, those are often different cells.
         */
        var L = Scene.layout(last.cols, last.rows);
        if (!skyAt(x, y, L)) return null;
        var best = null, bestD = reach;
        constellationHits.forEach(function (hit) {
            hit.edges.forEach(function (e) {
                var p = edgePoint(e, x, y);
                var d = Math.sqrt((p.x - x) * (p.x - x) + (p.y - y) * (p.y - y));
                if (d < bestD && skyAt(p.x, p.y, L)) { bestD = d; best = hit; }
            });
        });
        return best ? { hit: best, d: bestD } : null;
    }

    function figureAt(x, y, reach) {
        var near = figureNear(x, y, reach);
        return near ? near.hit : null;
    }

    function figureById(id) {
        for (var i = 0; i < constellationHits.length; i++) {
            if (constellationHits[i].figure === id) return constellationHits[i];
        }
        return null;
    }

    /*
     * The painted, named star nearest a tap, measured to its cell centre, if
     * one is within reach, as { star, d } — scanning only the cells the reach
     * can touch, so a tap costs a few dozen property reads rather than a pass
     * over the sky. Nearest rather than first, so a tap between two stars
     * names the one it was nearer.
     */
    function starNear(x, y) {
        if (!hoverNames) return null;
        var c0 = Math.floor((x - TOUCH_REACH_PX) / charWpx);
        var c1 = Math.floor((x + TOUCH_REACH_PX) / charWpx);
        var r0 = Math.floor((y - TOUCH_REACH_PX) / lineHpx);
        var r1 = Math.floor((y + TOUCH_REACH_PX) / lineHpx);
        var best = null, bestD = TOUCH_REACH_PX;
        for (var row = r0; row <= r1; row++) {
            for (var col = c0; col <= c1; col++) {
                var s = hoverNames[col + ':' + row];
                if (!s) continue;
                var c = Scene.cellCentre(s, charWpx, lineHpx);
                var d = Math.sqrt((c.left - x) * (c.left - x) + (c.top - y) * (c.top - y));
                if (d < bestD) { bestD = d; best = s; }
            }
        }
        return best ? { star: best, d: bestD } : null;
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

    /*
     * What is being pointed at, as { star, figure, x, y }: a painted, named
     * star entry or a drawn figure — never both, the star taking the pointer
     * from its figure — and the cell to anchor a figure's label to. The mouse
     * is looked up where it is, afresh each time.
     * A tap was looked up once, where it landed (tapAt), and is only found
     * again — the star by catalogue index, the figure by id — so a setting
     * that repaints the sky cannot swap in a stranger at the tapped pixel,
     * nor light a figure an empty tap never reached.
     */
    function mouseTarget(r) {
        var x = ptrX - r.left, y = ptrY - r.top;
        var col = Math.floor(x / charWpx);
        var row = Math.floor(y / lineHpx);
        var inGrid = col >= 0 && col < last.cols && row >= 0 && row < last.rows;
        var star = inGrid && hoverNames ? hoverNames[col + ':' + row] || null : null;
        return {
            star: star,
            figure: !star && inGrid && constellationsOn
                ? figureAt(x, y, Math.max(HIT_MIN_PX, charWpx * HIT_RATIO)) : null,
            x: col, y: row
        };
    }

    function tapTarget() {
        return {
            star: tap.index !== null && hoverStars ? hoverStars[tap.index] || null : null,
            figure: tap.figure !== null && constellationsOn ? figureById(tap.figure) : null,
            x: tap.x, y: tap.y
        };
    }

    function updateHover() {
        /*
         * The naming setting is the one switch for "answer what I am
         * pointing at", star or figure alike — the highlight included, the
         * owner's decision: with names off, the lines are scenery and hold
         * still under the pointer.
         */
        if (!hoverOn || !(charWpx > 0 && lineHpx > 0) || !(tap || ptrIn)) {
            clearHighlight();
            lightStar(null);
            hideLabel();
            return;
        }
        // Read fresh every flush: the rect folds in marginLeft and the
        // wrapper's bottom anchoring, and caching it would buy an
        // invalidation protocol that has to know about resize, zoom and DPR.
        var r = pre.getBoundingClientRect();
        var t = tap ? tapTarget() : mouseTarget(r);
        // A setting took what was tapped off the sky: let the tap go with it.
        if (tap && !t.star && !t.figure) tap = null;
        if (t.figure !== hoverFigure) {
            clearHighlight();
            if (t.figure) t.figure.group.setAttribute('class', FIGURE_ON_CLASS);
            hoverFigure = t.figure;
        }
        var star = t.star;
        lightStar(star);
        var key = star ? 'star:' + star.index : (t.figure ? 'figure:' + t.figure.figure : null);
        if (!key) {
            hideLabel();
            return;
        }
        // Identity separately from placement, so the DOM write happens only
        // when what is being named actually changes.
        if (key !== hoverKey) {
            hoverKey = key;
            label.textContent = star
                ? (star.lab.id ? star.lab.name + '  ' + star.lab.id : star.lab.name)
                : t.figure.name;
            label.hidden = false;
        }
        // Anchored to the star rather than the finger, which a tap need not
        // have put on it.
        placeLabel(star ? star.x : t.x, star ? star.y : t.y, r);
    }

    /*
     * Routed per event by pointerType, not by what the device's primary
     * pointer is: a touch-screen laptop answers (hover: hover) and a tablet
     * with a trackpad does not, and each is used both ways. A mouse hovers;
     * a finger or a pen taps.
     *
     * Listening to pointer events rather than mouse events is itself the
     * guard against the compatibility mousemove a tap synthesises — one that
     * no mouseleave ever follows, so answering it would light a label and
     * keep it lit.
     */
    function onMove(e) {
        // Gated first, so with names off — the default — a move costs one
        // comparison and never reaches the frame clock.
        if (!hoverOn) return;
        if (e.pointerType !== 'mouse') return;
        ptrX = e.clientX;
        ptrY = e.clientY;
        ptrIn = true;
        tap = null;
        if (ptrQueued) return;
        ptrQueued = true;
        requestAnimationFrame(function () {
            ptrQueued = false;
            updateHover();
        });
    }

    pre.addEventListener('pointermove', onMove);
    // Leaving the scene covers moving onto the gear or the open panel too:
    // the browser does that hit-testing, so nothing here needs to know the
    // menu exists. A window-level listener would have gone on naming stars
    // hidden behind it. A finger leaves on every lift, and a tapped name is
    // meant to stay until the next tap, so only a mouse leaving counts.
    pre.addEventListener('pointerleave', function (e) {
        if (e.pointerType !== 'mouse') return;
        ptrIn = false;
        clearHighlight();
        lightStar(null);
        hideLabel();
    });

    /*
     * Look a tap up, once, where it landed, and keep what it found by name:
     * the star by catalogue index or the figure by id, and the cell to anchor
     * a figure's label to. Null when it landed near nothing — which is how a
     * name is put away.
     *
     * One of the two, never both. A tap on a star's own cell is the star, as
     * for the mouse: a line that runs past it can be nearer the finger than
     * the star's centre is. Anywhere else the nearer wins, a tie going to the
     * star.
     */
    function tapAt(clientX, clientY) {
        if (!(charWpx > 0 && lineHpx > 0) || !(last.cols > 0)) return null;
        var r = pre.getBoundingClientRect();
        var x = clientX - r.left, y = clientY - r.top;
        var col = Math.floor(x / charWpx), row = Math.floor(y / lineHpx);
        var own = hoverNames ? hoverNames[col + ':' + row] || null : null;
        var star = own ? { star: own, d: 0 } : starNear(x, y);
        var figure = !own && constellationsOn ? figureNear(x, y, TOUCH_REACH_PX) : null;
        if (star && figure) {
            if (figure.d < star.d) star = null;
            else figure = null;
        }
        if (!star && !figure) return null;
        return {
            index: star ? star.star.index : null,
            figure: figure ? figure.hit.figure : null,
            x: col, y: row
        };
    }

    // Is this the scene — the <pre>, its wrapper, or the bare page around
    // them? Anything else under a finger is the gear or the open panel.
    function onScene(node) {
        if (node === document.body || node === document.documentElement ||
            node === pre.parentNode) return true;
        for (; node; node = node.parentNode) if (node === pre) return true;
        return false;
    }

    /*
     * A tap is a click rather than a pointerup: by then the browser has
     * decided it was one — within its own slop, and not the end of a pan, a
     * pinch or a long press, none of which click. Not every browser gives a
     * click a pointerType, so the pointerdown that began the gesture records
     * it, and a cancelled gesture forgets it. A mouse click is ignored: the
     * mouse already names whatever it is over, by hovering.
     *
     * Heard on the window, in the capture phase, rather than on the <pre>.
     * The grid hangs from the bottom of the window and need not reach its
     * top, and a tap in that strip is still a tap on the sky; and a tap on
     * the gear or the panel must put the name away, or it would be left lit
     * across the panel — which the target says without this file having to
     * know the menu exists.
     */
    addEventListener('pointerdown', function (e) {
        downType = e.pointerType;
    }, true);
    addEventListener('pointercancel', function () {
        downType = null;
    }, true);
    addEventListener('click', function (e) {
        var type = downType;
        downType = null;
        if (!hoverOn || !type || type === 'mouse') return;
        tap = onScene(e.target) ? tapAt(e.clientX, e.clientY) : null;
        updateHover();
    }, true);

    /*
     * Deliberately NOT wired to motionGen. The label does not animate, and
     * gating it on reduced motion would take star names away from people who
     * asked for less movement, not less information.
     */
    addEventListener(HOVER_EVENT, function (e) {
        var show = !!(e && e.detail && e.detail.constellations);
        // An absent density is the default, as an absent toggle is off.
        var density = (e && e.detail && e.detail.density) || (hasSky ? SkyMap.DEFAULT_DENSITY : null);
        if (show !== constellationsOn || density !== starDensity) {
            constellationsOn = show;
            starDensity = density;
            computeStars();
            buildHoverNames();
            redraw();
            paintConstellations();
        }
        var on = !!(e && e.detail && e.detail.names);
        if (on !== hoverOn) {
            hoverOn = on;
            if (!on) hideLabel();
        }
        // Nothing is listening for the pointer any more, so the last position
        // it reported will be stale by the time something is: forget it rather
        // than light up wherever the cursor happened to be left — and forget
        // a tap, which names off has put away.
        if (!hoverOn) {
            ptrIn = false;
            tap = null;
        }
        updateHover();
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
            lit: litStar,
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
        skyView = SkyMap.parseView(currentHash());
        computeStars();
        // Same cell under the cursor, different star in it. A tapped star is
        // somewhere else in a different sky, so the tap is let go.
        tap = null;
        buildHoverNames();
        redraw();
        paintConstellations();
        updateHover();
    });
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(render, function () {});
    }
})();
