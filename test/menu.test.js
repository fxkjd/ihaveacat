'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Requiring the module in Node is itself the purity test: there is no
// document here, so install() never runs and rows() has to stand alone.
const Menu = require('../js/menu.js');
const SkyMap = require('../js/sky.js');

const BCN = SkyMap.formatFields(SkyMap.DEFAULT_VIEW);

function textOf(fields, settings) {
    return Menu.rows(fields, settings).map(Menu.rowText);
}

// The compass row, found by what it holds rather than by its position, so
// adding rows below it cannot quietly re-point these tests.
function dirRow(fields) {
    return Menu.rows(fields).find((row) => row.some((seg) => seg.dir));
}

test('the panel is drawn exactly as designed', () => {
    assert.deepEqual(textOf(BCN), [
        ' lat   - [  41.39 ] + ',
        ' lon   - [   2.17 ] + ',
        ' dir   n  e (s) w ',
        '',
        ' stars low (medium) high ',
        ' show [ ] constellations',
        '      [ ] names'
    ]);
});

test('every mark the panel draws is ASCII', () => {
    // The steppers were U+25BC/U+25B2 once. Every mark the panel draws is
    // now a character any terminal has; the gear, outside rows(), is the one
    // exception and is pinned below.
    const settings = [{}, { name: true, constellations: true }, { density: 'low' }];
    settings.forEach((s) => textOf({ lat: '-89.99', lon: '-179.99', dir: 'w' }, s)
        .forEach((row) => assert.match(row, /^[\x20-\x7e]*$/, JSON.stringify(row))));
});

test('a toggle is off unless the panel is asked for it', () => {
    // rows() with no settings draws every toggle off: the default made
    // structural, rather than a value someone has to remember to pass.
    assert.deepEqual(Menu.rows(BCN), Menu.rows(BCN, undefined));
    assert.deepEqual(Menu.rows(BCN), Menu.rows(BCN, {}));
    assert.equal(textOf(BCN).pop(), '      [ ] names');
    assert.equal(textOf(BCN, { name: true }).pop(), '      [x] names');
    assert.equal(textOf(BCN, { constellations: true }).slice(-2)[0], ' show [x] constellations');
});

test('marking a toggle shifts nothing and needs no colour', () => {
    const off = Menu.rows(BCN, { name: false }).pop();
    const on = Menu.rows(BCN, { name: true }).pop();
    assert.equal(Menu.rowText(off).length, Menu.rowText(on).length);
    // The brackets carry the state, so it reads with the palette stripped out.
    assert.notEqual(off[1].text, on[1].text);
    assert.match(on[1].cls, /\bmenu-toggle-on\b/);
    assert.doesNotMatch(off[1].cls, /\bmenu-toggle-on\b/);
    assert.match(off[1].cls, /\bmenu-label\b/);
});

test('a switch is a checkbox and a pick is a radio mark', () => {
    // [x] for on/off, (s) for one-of-several: the two conventions every text
    // UI already uses, so the panel needs no legend.
    const rows = Menu.rows(BCN, { name: true });
    rows.flat().filter((s) => s.toggle).forEach((s) => assert.match(s.text, /^\[[x ]\] \w+$/));
    rows.flat().filter((s) => s.dir || s.density).forEach((s) => assert.doesNotMatch(s.text, /[[\]]/));
});

test('every control starts in the one column after the labels', () => {
    // ' stars' is the longest label, so the stepper, the first compass slot,
    // the first density slot and both checkboxes all begin in the cell after
    // it — the panel reads as one ruled column.
    const text = textOf(BCN);
    const [lat, lon, dir, stars, show, names] = [text[0], text[1], text[2], text[4], text[5], text[6]];
    const col = Menu.LABEL_COLS;
    assert.equal(col, ' stars'.length);
    [lat, lon].forEach((row) => assert.equal(row.indexOf(' - '), col));
    assert.equal(dir.indexOf(' n '), col);
    assert.equal(stars.indexOf(' low '), col);
    assert.equal(show.indexOf('[ ]'), col);
    assert.equal(names.indexOf('[ ]'), col);
    // Every label cell is a label, never a control.
    Menu.rows(BCN).filter((row) => row.length).forEach((row) => {
        assert.equal(row[0].cls, 'menu-label');
        assert.equal(row[0].text.length, col);
    });
});

test('the steppers are three cells wide', () => {
    // A one-cell button is ten pixels wide on a phone. The spaces either side
    // are part of the button, as they are in a compass slot.
    Menu.rows(BCN).flat().filter((s) => s.stepField).forEach((s) => {
        assert.equal(s.text.length, 3);
        assert.equal(s.text.trim(), s.delta < 0 ? '-' : '+');
    });
});

// The density row, found by what it holds, like the compass row.
function densityRow(settings) {
    return Menu.rows(BCN, settings).find((row) => row.some((seg) => seg.density));
}
function marked(row, onClass) {
    return row.filter((s) => s.cls && s.cls.indexOf(onClass) >= 0);
}

test('the density slots are the sky module\'s densities, in order', () => {
    // Duplicated because rows() must stand alone without sky.js; this is
    // what keeps the two lists together.
    assert.deepEqual(Menu.DENSITIES, SkyMap.DENSITIES);
    assert.deepEqual(densityRow().filter((s) => s.density).map((s) => s.density), Menu.DENSITIES);
});

test('the density row marks one slot, and marking it shifts nothing', () => {
    const widths = Menu.DENSITIES.map((density) => {
        const row = densityRow({ density });
        const on = marked(row, 'menu-density-on');
        assert.equal(on.length, 1, density);
        assert.equal(on[0].density, density);
        assert.equal(on[0].text, '(' + density + ')');
        assert.doesNotMatch(on[0].cls, /\bmenu-label\b/);
        row.filter((s) => s.density && s.density !== density).forEach((s) => {
            assert.equal(s.text, ' ' + s.density + ' ');
            assert.match(s.cls, /\bmenu-label\b/);
        });
        return Menu.rowText(row).length;
    });
    assert.deepEqual(widths, widths.map(() => widths[0]));
});

test('medium is marked unless the panel is asked for another density', () => {
    [undefined, {}, { density: 'dense' }, { density: '' }].forEach((settings) => {
        assert.equal(marked(densityRow(settings), 'menu-density-on')[0].density, 'medium');
    });
});

test('constellations mark high and disable the other densities', () => {
    // Whatever density is handed in: the figures need their faint stars, so
    // the panel cannot draw a state the sky could not be in.
    Menu.DENSITIES.forEach((density) => {
        const row = densityRow({ constellations: true, density });
        assert.equal(marked(row, 'menu-density-on')[0].density, 'high', density);
        const slots = row.filter((s) => s.density);
        assert.deepEqual(slots.map((s) => !!s.disabled), [true, true, false]);
    });
    // And off again, every slot answers.
    Menu.DENSITIES.forEach((density) => {
        const slots = densityRow({ density }).filter((s) => s.density);
        assert.deepEqual(slots.map((s) => !!s.disabled), [false, false, false]);
    });
});

test('the brackets hold the same columns on both value rows', () => {
    const [latRow, lonRow] = textOf(BCN).slice(0, 2);
    assert.equal(latRow.indexOf('['), lonRow.indexOf('['));
    assert.equal(latRow.indexOf(']'), lonRow.indexOf(']'));
    // The gap between them is the field plus the one space before ']'.
    assert.equal(latRow.indexOf(']') - latRow.indexOf('[') - 1, Menu.FIELD_COLS + 1);
});

test('the longest value a fragment can hold still fits between the brackets', () => {
    // parseView accepts down to -179.99 / -89.99; both are seven characters,
    // so nothing the URL can carry overflows the field.
    ['-179.99', '-89.99', '179.99'].forEach((v) => {
        assert.ok(v.length <= Menu.FIELD_COLS, v);
    });
    const rows = textOf({ lat: '-89.99', lon: '-179.99', dir: 'w' });
    assert.equal(rows[0], ' lat   - [ -89.99 ] + ');
    assert.equal(rows[1], ' lon   - [-179.99 ] + ');
    // Every value row is the same width whatever the value.
    assert.equal(rows[0].length, textOf(BCN)[0].length);
});

test('the compass marks the way you face, and only that way', () => {
    Menu.ROSE.forEach((dir) => {
        const segs = dirRow({ ...BCN, dir });
        const on = segs.filter((s) => s.cls && s.cls.indexOf('menu-dir-on') >= 0);
        assert.equal(on.length, 1, dir);
        assert.equal(on[0].dir, dir);
        assert.equal(on[0].text, '(' + dir + ')');
        // The brackets carry the state too, so it reads with no colour at all.
        segs.filter((s) => s.dir && s.dir !== dir).forEach((s) => {
            assert.equal(s.text, ' ' + s.dir + ' ');
            // Unmarked letters take the label brown, staying subordinate the
            // way the fence does; the marked one is won back to white.
            assert.match(s.cls, /\bmenu-label\b/);
        });
        assert.doesNotMatch(on[0].cls, /\bmenu-label\b/);
    });
});

test('every direction row is the same width, so marking one shifts nothing', () => {
    const widths = Menu.ROSE.map((dir) => Menu.rowText(dirRow({ ...BCN, dir })).length);
    assert.deepEqual(widths, widths.map(() => widths[0]));
});

test('rows is deterministic and survives fields it was never given', () => {
    assert.deepEqual(Menu.rows(BCN), Menu.rows(BCN));
    // An unknown direction simply marks nothing; the panel still draws.
    const none = Menu.rows({ ...BCN, dir: 'up' }).pop();
    assert.equal(none.filter((s) => s.cls && s.cls.indexOf('menu-dir-on') >= 0).length, 0);
    [undefined, {}, { lat: 1 }].forEach((f) => {
        assert.equal(Menu.rows(f).length, Menu.rows(BCN).length);
    });
});

test('the gear asks for its text presentation, not a colour emoji', () => {
    // U+2699 alone is emoji-presentation-eligible: iOS and Android draw a
    // full-colour cog for it. U+FE0E is what keeps it a monochrome glyph that
    // takes `color` like the rest of the drawing.
    assert.equal(Menu.GEAR, '⚙︎');
});
