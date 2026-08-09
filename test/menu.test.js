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
        '     settings',
        '',
        ' lat  [  41.39 ]',
        ' lon  [   2.17 ]',
        ' dir   n  e (s) w ',
        '',
        ' name ( )'
    ]);
});

test('a toggle is off unless the panel is asked for it', () => {
    // rows() with no settings draws every toggle off: the default made
    // structural, rather than a value someone has to remember to pass.
    assert.deepEqual(Menu.rows(BCN), Menu.rows(BCN, undefined));
    assert.deepEqual(Menu.rows(BCN), Menu.rows(BCN, {}));
    assert.equal(textOf(BCN).pop(), ' name ( )');
    assert.equal(textOf(BCN, { name: true }).pop(), ' name (x)');
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

test('the toggle keeps the panel label column', () => {
    // ' name ' is six cells, so the mark starts where '[' and the first
    // compass slot do.
    const text = textOf(BCN);
    const [lat, dir, name] = [text[2], text[4], text[6]];
    assert.equal(lat.indexOf('['), 6);
    assert.equal(dir.indexOf(' n '), 6);
    assert.equal(name.indexOf('( )'), 6);
});

test('the brackets hold the same columns on both value rows', () => {
    const [latRow, lonRow] = textOf(BCN).slice(2, 4);
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
    assert.equal(rows[2], ' lat  [ -89.99 ]');
    assert.equal(rows[3], ' lon  [-179.99 ]');
    // Every value row is the same width whatever the value.
    assert.equal(rows[2].length, textOf(BCN)[2].length);
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
