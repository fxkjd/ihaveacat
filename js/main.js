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

    // Computed once at load: a re-render triggered by a mid-session resize
    // must not change which phase of the moon is showing.
    var phase = MoonPhase.phaseIndex(new Date());
    var moonRows = MoonPhase.renderMoonRows(phase);

    var last = { cols: -1, rows: -1 };

    function viewport() {
        var d = document.documentElement;
        return { w: d.clientWidth, h: d.clientHeight };
    }

    function paint(scene) {
        var frag = document.createDocumentFragment();
        scene.grid.forEach(function (runs, i) {
            runs.forEach(function (run) {
                if (run.cls) {
                    var span = document.createElement('span');
                    span.className = run.cls;
                    span.textContent = run.text;
                    frag.appendChild(span);
                } else {
                    frag.appendChild(document.createTextNode(run.text));
                }
            });
            if (i < scene.grid.length - 1) frag.appendChild(document.createTextNode('\n'));
        });
        while (pre.firstChild) pre.removeChild(pre.firstChild);
        pre.appendChild(frag);
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

        if (grid.cols === last.cols && grid.rows === last.rows) return;
        last = grid;

        paint(Scene.buildScene({ cols: grid.cols, rows: grid.rows, moonRows: moonRows }));
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
    addEventListener('resize', onResize);
    addEventListener('orientationchange', render);
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(render, function () {});
    }
})();
