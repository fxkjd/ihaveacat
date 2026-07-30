/*
 * Moon phase math + ASCII moon rendering for ihavea.cat.
 * Pure functions, no DOM access: loadable both as a browser classic
 * script (exposes window.MoonPhase) and via require() for node --test.
 */
(function (global) {
    'use strict';

    var SYNODIC_MONTH_DAYS = 29.530588853;
    // Known new moon: 2000-01-06 18:14 UTC.
    var NEW_MOON_EPOCH_MS = Date.UTC(2000, 0, 6, 18, 14, 0);
    var MS_PER_DAY = 86400000;

    var PHASE_NAMES = [
        'New Moon',
        'Waxing Crescent',
        'First Quarter',
        'Waxing Gibbous',
        'Full Moon',
        'Waning Gibbous',
        'Last Quarter',
        'Waning Crescent'
    ];

    // Fraction of the illuminated disc for each phase index.
    var LIT_FRACTION = [0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25];

    /*
     * The moon silhouette. `indent` is each row's offset from the disc's
     * leftmost column; the disc spans DISC_WIDTH columns. Characters in
     * M8& are fill cells regenerated per phase; punctuation (, . ') is
     * part of the outline and keeps its glyph, only its color changes.
     */
    var DISC_WIDTH = 13;
    var MOON_ROWS = [
        { indent: 2, body: ',MMM8&&&.' },
        { indent: 1, body: 'MMMM88&&&&&' },
        { indent: 0, body: 'MMMM88&&&&&&&' },
        { indent: 0, body: 'MMM88&&&&&&&&' },
        { indent: 0, body: 'MMM88&&&&&&&&' },
        { indent: 0, body: "'MMM88&&&&&&'" },
        { indent: 2, body: "'MMM8&&&'" }
    ];

    /*
     * Shadow cells whose center lies within this distance of the
     * lit/dark boundary render as the grey terminator band, mimicking
     * the 8s of the original art. Not exactly 2/13 to avoid float ties
     * with cell centers (odd multiples of 0.5/13).
     */
    var TERMINATOR_WIDTH = 0.16;

    var BAND_CHAR = { lit: 'M', term: '8', dark: '&' };
    var BAND_CLASS = { lit: 'moon-1', term: 'moon-2', dark: 'moon-3' };

    function phaseFraction(date) {
        var days = (date.getTime() - NEW_MOON_EPOCH_MS) / MS_PER_DAY;
        var m = days % SYNODIC_MONTH_DAYS;
        return ((m + SYNODIC_MONTH_DAYS) % SYNODIC_MONTH_DAYS) / SYNODIC_MONTH_DAYS;
    }

    function phaseIndex(date) {
        return Math.round(phaseFraction(date) * 8) % 8;
    }

    function phaseName(index) {
        return PHASE_NAMES[index];
    }

    /*
     * Band for a cell centered at x (0 = disc's left edge, 1 = right).
     * Waxing phases light up from the right, waning from the left
     * (Northern Hemisphere). Boundary cells count as lit on both the
     * waxing and waning side so mirrored phases render symmetrically.
     */
    function cellBand(x, phase) {
        if (phase === 4) return 'lit';
        if (phase === 0) return 'dark';
        var lit = LIT_FRACTION[phase];
        var waxing = phase < 4;
        var boundary = waxing ? 1 - lit : lit;
        if (waxing ? x >= boundary : x <= boundary) return 'lit';
        var distance = waxing ? boundary - x : x - boundary;
        return distance <= TERMINATOR_WIDTH ? 'term' : 'dark';
    }

    function renderMoonCells(phase) {
        return MOON_ROWS.map(function (row) {
            return row.body.split('').map(function (ch, i) {
                var x = (row.indent + i + 0.5) / DISC_WIDTH;
                var band = cellBand(x, phase);
                var isFill = ch === 'M' || ch === '8' || ch === '&';
                return {
                    char: isFill ? BAND_CHAR[band] : ch,
                    cls: BAND_CLASS[band]
                };
            });
        });
    }

    function moonRowText(rowIndex, phase) {
        return renderMoonCells(phase)[rowIndex].map(function (cell) {
            return cell.char;
        }).join('');
    }

    // Each row paired with its indent, for callers that composite the moon
    // into a larger scene and need to know where each row starts.
    function renderMoonRows(phase) {
        var cells = renderMoonCells(phase);
        return MOON_ROWS.map(function (row, i) {
            return { indent: row.indent, cells: cells[i] };
        });
    }

    function escapeHTML(text) {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // One row as HTML: consecutive same-class cells merged into one span.
    function renderMoonRowHTML(rowIndex, phase) {
        var cells = renderMoonCells(phase)[rowIndex];
        var html = '';
        var run = '';
        var runCls = null;
        function flush() {
            if (run) html += '<span class="' + runCls + '">' + escapeHTML(run) + '</span>';
            run = '';
        }
        cells.forEach(function (cell) {
            if (cell.cls !== runCls) {
                flush();
                runCls = cell.cls;
            }
            run += cell.char;
        });
        flush();
        return html;
    }

    var MoonPhase = {
        SYNODIC_MONTH_DAYS: SYNODIC_MONTH_DAYS,
        NEW_MOON_EPOCH_MS: NEW_MOON_EPOCH_MS,
        PHASE_NAMES: PHASE_NAMES,
        LIT_FRACTION: LIT_FRACTION,
        DISC_WIDTH: DISC_WIDTH,
        MOON_ROWS: MOON_ROWS,
        phaseFraction: phaseFraction,
        phaseIndex: phaseIndex,
        phaseName: phaseName,
        renderMoonCells: renderMoonCells,
        moonRowText: moonRowText,
        renderMoonRowHTML: renderMoonRowHTML,
        renderMoonRows: renderMoonRows
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = MoonPhase;
    } else {
        global.MoonPhase = MoonPhase;
    }
})(this);
