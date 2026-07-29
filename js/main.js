/*
 * Replaces the static moon art with today's phase. The markup shipped
 * in index.html stays as the fallback when JS is disabled.
 */
(function () {
    'use strict';
    var cellRows = MoonPhase.renderMoonCells(MoonPhase.phaseIndex(new Date()));
    document.querySelectorAll('pre .moon-row').forEach(function (el, i) {
        el.textContent = '';
        cellRows[i].forEach(function (cell) {
            var last = el.lastElementChild;
            if (!last || last.className !== cell.cls) {
                last = document.createElement('span');
                last.className = cell.cls;
                el.appendChild(last);
            }
            last.textContent += cell.char;
        });
    });
})();
