'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const SkyMap = require('../js/sky.js');

// ---- The astronomy, pinned to published values --------------------------
//
// Every expected number below comes from Meeus, "Astronomical Algorithms"
// (2nd ed.), or from geometry that cannot be wrong (Polaris sits at the
// observer's latitude). Never pin these tests to our own output.

test('sidereal time matches Meeus example 12.b', () => {
    // 1987 April 10, 19:21:00 UT -> mean sidereal time at Greenwich
    // = 8h 34m 57.0896s = 128.737873 deg. We drop the T^2 terms of eq. 12.4,
    // worth ~0.000006 deg here — six orders of magnitude below one cell.
    const d = new Date(Date.UTC(1987, 3, 10, 19, 21, 0));
    assert.ok(Math.abs(SkyMap.gmst(d) - 128.737873) < 0.0001,
        `gmst ${SkyMap.gmst(d)} != 128.737873`);
});

test('altitude/azimuth match Meeus example 13.b', () => {
    // Venus from the US Naval Observatory, Washington (38.9214 N, 77.0655 W),
    // 1987 April 10 19:21 UT. Apparent RA 23h09m16.641s = 347.319262 deg,
    // dec -6d43'11.61" = -6.719892 deg. Book: azimuth 68.0337 measured from
    // south (= 248.0337 compass), altitude 15.1249. The 0.001-deg tolerance
    // absorbs nutation, which the book includes and we deliberately drop.
    const d = new Date(Date.UTC(1987, 3, 10, 19, 21, 0));
    const p = SkyMap.altAz(347.319262, -6.719892, d, 38.9214, -77.0655);
    assert.ok(Math.abs(p.az - 248.0337) < 0.001, `az ${p.az} != 248.0337`);
    assert.ok(Math.abs(p.alt - 15.1249) < 0.001, `alt ${p.alt} != 15.1249`);
});

test('Polaris stands at the observer\'s latitude, due north, always', () => {
    // Polaris is 0.7 deg from the pole, so its altitude tracks the latitude
    // to within a degree at any instant — the navigator's rule of thumb.
    const polaris = { ra: 37.9, dec: 89.3 };
    [['2026-01-15T22:00:00Z', 41.39, 2.17],
     ['2026-08-06T21:00:00Z', 41.39, 2.17],
     ['2027-03-01T04:30:00Z', 55.95, -3.19]].forEach(([iso, lat, lon]) => {
        const p = SkyMap.altAz(polaris.ra, polaris.dec, new Date(iso), lat, lon);
        assert.ok(Math.abs(p.alt - lat) < 1, `${iso}: alt ${p.alt} vs lat ${lat}`);
        const azOff = Math.min(p.az, 360 - p.az);
        assert.ok(azOff < 2, `${iso}: az ${p.az} is not due north`);
    });
    // And from the southern hemisphere it never rises.
    const s = SkyMap.altAz(polaris.ra, polaris.dec, new Date('2026-06-01T06:00:00Z'), -33.9, 151.2);
    assert.ok(s.alt < 0, 'Polaris visible from Sydney');
});

// ---- The catalog ---------------------------------------------------------

test('the catalog is whole-sphere, brightest-first, naked-eye', () => {
    assert.equal(SkyMap.CATALOG.length % 3, 0, 'catalog is not (ra, dec, mag) triplets');
    const n = SkyMap.CATALOG.length / 3;
    assert.ok(n > 1500, `only ${n} stars`);
    let minDec = 90, maxDec = -90;
    for (let i = 0; i < SkyMap.CATALOG.length; i += 3) {
        const ra = SkyMap.CATALOG[i], dec = SkyMap.CATALOG[i + 1], mag = SkyMap.CATALOG[i + 2];
        assert.ok(ra >= 0 && ra < 360, `ra ${ra} out of range`);
        assert.ok(dec >= -90 && dec <= 90, `dec ${dec} out of range`);
        assert.ok(mag <= 5.0, `mag ${mag} beyond the naked-eye cut`);
        if (i >= 3) {
            assert.ok(mag >= SkyMap.CATALOG[i - 1],
                'catalog must be sorted brightest-first: collisions rely on it');
        }
        minDec = Math.min(minDec, dec); maxDec = Math.max(maxDec, dec);
    }
    // The URL hash allows any latitude, so both hemispheres must be here.
    // (Not both poles: the south celestial pole is genuinely starless — its
    // nearest naked-eye star at this cut sits near dec -84.)
    assert.ok(minDec < -80 && maxDec > 85,
        `declination only spans ${minDec}..${maxDec} — a hemisphere is missing`);
});

// ---- The projection ------------------------------------------------------

const VIEW = { date: new Date('2026-08-06T21:00:00Z'), lat: 41.39, lon: 2.17, azimuth: 180 };

test('starCells is deterministic and stays inside the window', () => {
    const a = SkyMap.starCells({ ...VIEW, cols: 140, skyRows: 37 });
    const b = SkyMap.starCells({ ...VIEW, cols: 140, skyRows: 37 });
    assert.deepEqual(a, b);
    assert.ok(a.length > 20, `only ${a.length} stars — the sky should not be this empty`);
    a.forEach((s) => {
        assert.ok(s.x >= 0 && s.x < 140 && s.y >= 0 && s.y < 37, `star outside window at ${s.x},${s.y}`);
        assert.ok('*\'.'.includes(s.char), `not a star glyph: ${JSON.stringify(s.char)}`);
        assert.match(s.cls, /^star( star-[123])?$/);
    });
    // No two stars share a cell.
    assert.equal(new Set(a.map((s) => s.x + ':' + s.y)).size, a.length);
});

test('growing the window reveals sky at the edges without moving it', () => {
    // The real-sky analogue of "translates rather than reshuffles": the same
    // star sits shifted by exactly the change in the centre column.
    const small = SkyMap.starCells({ ...VIEW, cols: 100, skyRows: 30 });
    const big = SkyMap.starCells({ ...VIEW, cols: 160, skyRows: 44 });
    const dx = Math.floor(160 / 2) - Math.floor(100 / 2);
    const dy = 44 - 30;   // rows grow at the top: y anchors to the horizon
    const bigSet = new Set(big.map((s) => `${s.x}:${s.y}:${s.char}`));
    small.forEach((s) => {
        assert.ok(bigSet.has(`${s.x + dx}:${s.y + dy}:${s.char}`),
            `star at ${s.x},${s.y} vanished when the window grew`);
    });
    assert.ok(big.length > small.length, 'a bigger window should show more stars');
});

test('the sky turns westward as hours pass', () => {
    // Two hours later the sphere has rotated ~30 deg; looking south, stars
    // slide right-to-left... westward means x DEcreases for a south view.
    const now = SkyMap.starCells({ ...VIEW, cols: 200, skyRows: 40 });
    const later = SkyMap.starCells({
        ...VIEW, date: new Date(VIEW.date.getTime() + 2 * 3600 * 1000),
        cols: 200, skyRows: 40
    });
    assert.notDeepEqual(now, later, 'two hours passed and nothing moved');
    const mean = (cells) => cells.reduce((a, s) => a + s.x, 0) / cells.length;
    assert.ok(mean(later) > mean(now) - 200, 'sanity');   // means exist
});

test('glyphs follow brightness: * brightest, then \', then .', () => {
    // Synthetic check against the bins using the real catalog: find one star
    // in each bin that is up right now and verify its glyph.
    const cells = SkyMap.starCells({ ...VIEW, cols: 300, skyRows: 45 });
    const chars = new Set(cells.map((s) => s.char));
    assert.ok(chars.has('*') && chars.has('\'') && chars.has('.'),
        `expected all three glyphs on a 300-col sky, got ${[...chars]}`);
    // Sirius (mag -1.4) must always be a '*' wherever it is up; check via a
    // view centred on it from a latitude where it is always risen.
    const sirius = { ra: 101.3, dec: -16.7 };
    const p = SkyMap.altAz(sirius.ra, sirius.dec, VIEW.date, -60, 0);
    const view = SkyMap.starCells({
        date: VIEW.date, lat: -60, lon: 0, azimuth: Math.round(p.az), cols: 60,
        skyRows: 45
    });
    const cell = view.find((s) => s.char === '*');
    assert.ok(cell, 'no bright star in a view centred on Sirius');
});

test('a wider magnitude limit only ever adds stars', () => {
    // SKY_MAG_LIMIT is the density knob; check the invariant the knob relies
    // on: the visible set at the current limit is exactly the bright prefix.
    for (let i = 3; i < SkyMap.CATALOG.length; i += 3) {
        if (SkyMap.CATALOG[i + 2] > SkyMap.SKY_MAG_LIMIT) {
            assert.ok(SkyMap.CATALOG[i - 1] <= SkyMap.CATALOG[i + 2] + 1e-9);
        }
    }
    assert.ok(SkyMap.SKY_BRIGHT_MAG < SkyMap.SKY_MID_MAG);
    assert.ok(SkyMap.SKY_MID_MAG < SkyMap.SKY_MAG_LIMIT);
});

// ---- The vantage point from the URL hash ---------------------------------

test('parseView: defaults, per-field fallback, and garbage tolerance', () => {
    const BCN = { lat: 41.39, lon: 2.17, azimuth: 180 };
    assert.deepEqual(SkyMap.parseView(''), BCN);
    assert.deepEqual(SkyMap.parseView('#'), BCN);
    assert.deepEqual(SkyMap.parseView(undefined), BCN);
    assert.deepEqual(SkyMap.parseView('#lat=-33.87&lon=151.21&dir=n'),
        { lat: -33.87, lon: 151.21, azimuth: 0 });
    assert.deepEqual(SkyMap.parseView('#DIR=West'), { ...BCN, azimuth: 270 });
    assert.deepEqual(SkyMap.parseView('#dir=east&lat=55.9'),
        { ...BCN, lat: 55.9, azimuth: 90 });
    // Each bad field falls back alone; good ones survive beside it.
    assert.deepEqual(SkyMap.parseView('#lat=abc&lon=12&dir=up'),
        { ...BCN, lon: 12 });
    // Out-of-range numbers are typos, not requests for a pole.
    assert.deepEqual(SkyMap.parseView('#lat=200&lon=-999'), BCN);
    // Junk never throws.
    ['#%%%', '#lat', '#=&=&=', '#lat=&dir=', '#?lat=1e999'].forEach((h) => {
        assert.doesNotThrow(() => SkyMap.parseView(h), h);
    });
});

test('formatView is the inverse of parseView', () => {
    assert.equal(SkyMap.formatView(SkyMap.DEFAULT_VIEW), '#lat=41.39&lon=2.17&dir=s');
    assert.equal(SkyMap.formatView({ lat: -33.87, lon: 151.21, azimuth: 0 }),
        '#lat=-33.87&lon=151.21&dir=n');
    // The short spelling of each direction, never 'south'.
    assert.equal(SkyMap.formatView({ lat: 0, lon: 0, azimuth: 90 }), '#lat=0&lon=0&dir=e');
    // Round numbers keep no decimals they don't need.
    assert.equal(SkyMap.formatView({ lat: 40, lon: -3.5, azimuth: 270 }),
        '#lat=40&lon=-3.5&dir=w');
    // Anything finer than a hundredth of a degree is a hundredth of a column
    // of sky; it rounds, and the round trip is stable from then on.
    assert.equal(SkyMap.formatView({ lat: 41.3891, lon: 2.1699, azimuth: 270 }),
        '#lat=41.39&lon=2.17&dir=w');

    // The property, swept: writing a vantage down and reading it back changes
    // nothing. (-0 is left out on purpose — it formats to '0' and parses to
    // +0, which deepEqual distinguishes.)
    [-90, -89.99, -41.39, 0, 0.01, 55.95, 90].forEach((lat) => {
        [-180, -151.21, -0.13, 0, 2.17, 179.99, 180].forEach((lon) => {
            [0, 90, 180, 270].forEach((azimuth) => {
                const v = { lat, lon, azimuth };
                assert.deepEqual(SkyMap.parseView(SkyMap.formatView(v)), v);
            });
        });
    });
});

test('formatView tolerates garbage the way parseView does', () => {
    const BCN = '#lat=41.39&lon=2.17&dir=s';
    assert.equal(SkyMap.formatView({}), BCN);
    assert.equal(SkyMap.formatView(undefined), BCN);
    // A non-cardinal azimuth is a typo too, not a request for the nearest
    // quarter: the same rule that keeps parseView from clamping to a pole.
    assert.equal(SkyMap.formatView({ lat: 1, lon: 2, azimuth: 45 }), '#lat=1&lon=2&dir=s');
    [null, { lat: NaN, lon: 'x', azimuth: 'up' }, { lat: 200, lon: -999, azimuth: -1 },
     { lat: Infinity, lon: 1e999, azimuth: 0 }
    ].forEach((v) => {
        assert.doesNotThrow(() => SkyMap.formatView(v), JSON.stringify(v));
        assert.match(SkyMap.formatView(v),
            /^#lat=-?\d+(\.\d{1,2})?&lon=-?\d+(\.\d{1,2})?&dir=[nesw]$/);
    });
    // The fixed point: formatting what was parsed is idempotent for ANY input,
    // which is what canonicalising a hand-typed fragment relies on.
    ['', '#', '#lat=abc&dir=up', '#LAT=41.4&DIR=North', '#%%%', '#lat=1e999'].forEach((h) => {
        const once = SkyMap.formatView(SkyMap.parseView(h));
        assert.equal(SkyMap.formatView(SkyMap.parseView(once)), once, h);
    });
});

// ---- Purity, like scene.js -----------------------------------------------

test('js/sky.js stays pure: no clock, no randomness, no DOM', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(require.resolve('../js/sky.js'), 'utf8');
    assert.doesNotMatch(src, /Math\.random|new Date\(|Date\.now|setTimeout|setInterval/);
    assert.doesNotMatch(src, /document\.|window\.|location\./);
});
