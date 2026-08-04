'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    SYNODIC_MONTH_DAYS,
    NEW_MOON_EPOCH_MS,
    PHASE_NAMES,
    MOON_ROWS,
    phaseFraction,
    phaseIndex,
    phaseName,
    renderMoonCells,
    moonRowText
} = require('../js/moon.js');

const DAY_MS = 86400000;
const NEW = 0, WAXING_CRESCENT = 1, FIRST_QUARTER = 2, WAXING_GIBBOUS = 3,
      FULL = 4, WANING_GIBBOUS = 5, LAST_QUARTER = 6, WANING_CRESCENT = 7;
const PARTIAL_PHASES = [1, 2, 3, 5, 6, 7];

function utc(iso) {
    return new Date(iso);
}

test('epoch instant is a new moon', () => {
    const epoch = new Date(NEW_MOON_EPOCH_MS);
    assert.ok(phaseFraction(epoch) < 1e-9);
    assert.equal(phaseIndex(epoch), NEW);
    assert.equal(phaseName(NEW), 'New Moon');
});

test('matches published principal phases of January 2000', () => {
    assert.equal(phaseIndex(utc('2000-01-14T13:34Z')), FIRST_QUARTER);
    assert.equal(phaseIndex(utc('2000-01-21T04:40Z')), FULL);
    assert.equal(phaseIndex(utc('2000-01-28T07:57Z')), LAST_QUARTER);
});

test('matches intermediate phases across a lunation', () => {
    assert.equal(phaseIndex(utc('2000-01-10T12:00Z')), WAXING_CRESCENT);
    assert.equal(phaseIndex(utc('2000-01-17T12:00Z')), WAXING_GIBBOUS);
    assert.equal(phaseIndex(utc('2000-01-24T12:00Z')), WANING_GIBBOUS);
    assert.equal(phaseIndex(utc('2000-02-01T12:00Z')), WANING_CRESCENT);
});

test('next lunation starts new again', () => {
    // Actual new moon: 2000-02-05 13:03 UTC.
    assert.equal(phaseIndex(utc('2000-02-05T13:03Z')), NEW);
});

test('dates before the epoch wrap around correctly', () => {
    // Actual full moon: 1999-12-22 17:31 UTC (days-since-epoch is negative).
    const d = utc('1999-12-22T17:31Z');
    assert.equal(phaseIndex(d), FULL);
    assert.ok(phaseFraction(d) >= 0 && phaseFraction(d) < 1);
});

test('stays accurate decades from the epoch', () => {
    // Actual full moon 2024-04-23 23:49 UTC.
    assert.equal(phaseIndex(utc('2024-04-23T23:49Z')), FULL);
    // Actual new moon 2024-04-08 18:21 UTC (total solar eclipse day);
    // fraction is just below 1, exercising the round-to-8 wrap.
    assert.equal(phaseIndex(utc('2024-04-08T18:21Z')), NEW);
    // Actual full moon 2026-07-29.
    assert.equal(phaseIndex(utc('2026-07-29T12:00Z')), FULL);
});

test('phaseFraction is always in [0, 1)', () => {
    for (let year = 1950; year <= 2050; year += 7) {
        for (let day = 0; day < 40; day += 3) {
            const f = phaseFraction(new Date(Date.UTC(year, 5, 1) + day * DAY_MS));
            assert.ok(f >= 0 && f < 1, `fraction ${f} out of range`);
        }
    }
});

test('all 8 phases occur within 30 consecutive days', () => {
    const seen = new Set();
    for (let i = 0; i < 30; i++) {
        seen.add(phaseIndex(new Date(NEW_MOON_EPOCH_MS + i * DAY_MS)));
    }
    assert.deepEqual([...seen].sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('phase windows are centered on the astronomical event', () => {
    for (let k = 0; k < 8; k++) {
        const at = new Date(NEW_MOON_EPOCH_MS + k * (SYNODIC_MONTH_DAYS / 8) * DAY_MS);
        assert.equal(phaseIndex(at), k);
    }
    // Just past half a window (synodic/16) the phase flips.
    const halfWindow = (SYNODIC_MONTH_DAYS / 16) * DAY_MS;
    assert.equal(phaseIndex(new Date(NEW_MOON_EPOCH_MS + halfWindow + DAY_MS / 24)), WAXING_CRESCENT);
    assert.equal(phaseIndex(new Date(NEW_MOON_EPOCH_MS + halfWindow - DAY_MS / 24)), NEW);
});

test('result is timezone-independent (same instant, different notations)', () => {
    const a = utc('2000-01-21T04:40Z');
    const b = utc('2000-01-21T10:10+05:30');
    assert.equal(a.getTime(), b.getTime());
    assert.equal(phaseFraction(a), phaseFraction(b));
    assert.equal(phaseIndex(a), phaseIndex(b));
});

test('PHASE_NAMES lists 8 unique names', () => {
    assert.equal(PHASE_NAMES.length, 8);
    assert.equal(new Set(PHASE_NAMES).size, 8);
});

test('every phase preserves the moon silhouette', () => {
    for (let phase = 0; phase < 8; phase++) {
        const rows = renderMoonCells(phase);
        assert.equal(rows.length, MOON_ROWS.length);
        rows.forEach((cells, r) => {
            const template = MOON_ROWS[r].body;
            assert.equal(cells.length, template.length);
            cells.forEach((cell, i) => {
                if (/[M8&]/.test(template[i])) {
                    assert.match(cell.char, /^[M8&]$/);
                } else {
                    // Outline punctuation keeps its glyph.
                    assert.equal(cell.char, template[i]);
                }
                const expectedClass = { M: 'moon-1', 8: 'moon-2', '&': 'moon-3' }[cell.char];
                if (expectedClass) assert.equal(cell.cls, expectedClass);
            });
        });
    }
});

test('full moon is fully lit, new moon fully dark', () => {
    renderMoonCells(FULL).flat().forEach((cell) => {
        assert.notEqual(cell.char, '&');
        assert.notEqual(cell.char, '8');
        assert.equal(cell.cls, 'moon-1');
    });
    renderMoonCells(NEW).flat().forEach((cell) => {
        assert.notEqual(cell.char, 'M');
        assert.notEqual(cell.char, '8');
        assert.equal(cell.cls, 'moon-3');
    });
});

test('waxing lights from the right, waning from the left', () => {
    const widestRow = 3;
    const firstQuarter = moonRowText(widestRow, FIRST_QUARTER);
    assert.equal(firstQuarter[0], '&');
    assert.equal(firstQuarter[firstQuarter.length - 1], 'M');
    const lastQuarter = moonRowText(widestRow, LAST_QUARTER);
    assert.equal(lastQuarter[0], 'M');
    assert.equal(lastQuarter[lastQuarter.length - 1], '&');
});

test('lit area grows through waxing and shrinks through waning', () => {
    const countLit = (phase) =>
        renderMoonCells(phase).flat().filter((c) => c.cls === 'moon-1').length;
    assert.ok(countLit(NEW) < countLit(WAXING_CRESCENT));
    assert.ok(countLit(WAXING_CRESCENT) < countLit(FIRST_QUARTER));
    assert.ok(countLit(FIRST_QUARTER) < countLit(WAXING_GIBBOUS));
    assert.ok(countLit(WAXING_GIBBOUS) < countLit(FULL));
    assert.ok(countLit(WANING_CRESCENT) < countLit(LAST_QUARTER));
    assert.ok(countLit(LAST_QUARTER) < countLit(WANING_GIBBOUS));
    assert.ok(countLit(WANING_GIBBOUS) < countLit(FULL));
});

test('mirrored phases are reflections of each other', () => {
    const pairs = [[WAXING_CRESCENT, WANING_CRESCENT],
                   [FIRST_QUARTER, LAST_QUARTER],
                   [WAXING_GIBBOUS, WANING_GIBBOUS]];
    for (const [waxing, waning] of pairs) {
        const waxRows = renderMoonCells(waxing);
        const wanRows = renderMoonCells(waning);
        waxRows.forEach((cells, r) => {
            const mirrored = cells.map((c) => c.cls).reverse();
            assert.deepEqual(wanRows[r].map((c) => c.cls), mirrored,
                `row ${r} of phases ${waxing}/${waning} not mirrored`);
        });
    }
});

test('partial phases show a terminator band on every row', () => {
    for (const phase of PARTIAL_PHASES) {
        renderMoonCells(phase).forEach((cells, r) => {
            assert.ok(cells.some((c) => c.cls === 'moon-2'),
                `phase ${phase} row ${r} has no terminator`);
        });
    }
});

test('waning crescent reproduces the original site art rows', () => {
    // The static art on ihavea.cat shades rows 3-4 as MMM88&&&&&&&&.
    assert.equal(moonRowText(3, WANING_CRESCENT), 'MMM88&&&&&&&&');
    assert.equal(moonRowText(4, WANING_CRESCENT), 'MMM88&&&&&&&&');
});

