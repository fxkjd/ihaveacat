'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const Scene = require('../js/scene.js');

function readFile(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function stripTags(html) {
    return html.replace(/<span[^>]*>/g, '').replace(/<\/span>/g, '');
}

test('index.html keeps the no-JS moon fallback', () => {
    const html = readFile('index.html');
    assert.equal((html.match(/class="moon-row"/g) || []).length, 7);
});

test('static fallback art matches the module art (they cannot silently diverge)', () => {
    const html = readFile('index.html');
    const rawLines = html.split('\n');
    const fenceTop = rawLines.findIndex((l) => l.includes('_/\\_/\\_/\\__'));
    assert.ok(fenceTop >= 0, 'fence art not found');
    const fenceLines = rawLines.slice(fenceTop, fenceTop + Scene.FENCE_ROW_COUNT);
    assert.deepEqual(fenceLines, Scene.FENCE_ART);

    const strippedLines = stripTags(html).split('\n');
    const catTop = strippedLines.findIndex((l) => l.includes('|\\___/|'));
    assert.ok(catTop >= 0, 'cat art not found');
    Scene.CAT_ART.forEach((line, i) => {
        const expected = ' '.repeat(Scene.CAT_COL) + line;
        assert.equal(strippedLines[catTop + i].slice(0, expected.length), expected, `cat row ${i}`);
    });
});

test('page stays file:// compatible and script order is correct', () => {
    const html = readFile('index.html');
    assert.doesNotMatch(html, /type="module"/);
    assert.doesNotMatch(html, /(src|href)="\//, 'absolute path breaks file://');

    const order = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(order, ['js/moon.js', 'js/scene.js', 'js/main.js']);

    const refs = [
        ...order,
        ...[...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1])
    ];
    refs.forEach((ref) => {
        const p = path.join(ROOT, ref);
        assert.ok(fs.existsSync(p), `missing referenced file: ${ref}`);
        // macOS is case-insensitive; the web server this ships to is not.
        assert.ok(
            fs.readdirSync(path.dirname(p)).includes(path.basename(p)),
            `case mismatch for ${ref}`
        );
    });
});

test('main.js never uses innerHTML (CLAUDE.md hard constraint)', () => {
    assert.doesNotMatch(readFile('js/main.js'), /innerHTML/);
});

test('every class the scene can emit is styled in css/style.css', () => {
    const css = readFile('css/style.css');
    const defined = new Set([...css.matchAll(/\.([A-Za-z][-\w]*)/g)].map((m) => m[1]));

    const MoonPhase = require('../js/moon.js');
    const used = new Set();
    for (let phase = 0; phase < 8; phase++) {
        const scene = Scene.buildScene({
            cols: 220, rows: 90, moonRows: MoonPhase.renderMoonRows(phase)
        });
        scene.grid.forEach((runs) => runs.forEach((run) => {
            if (run.cls) run.cls.split(' ').forEach((c) => used.add(c));
        }));
    }
    used.forEach((cls) => {
        assert.ok(defined.has(cls), `class .${cls} is emitted but never styled in css/style.css`);
    });
});

test('scene.js and moon.js expose their browser (non-CommonJS) global correctly', () => {
    ['js/scene.js', 'js/moon.js'].forEach((rel) => {
        const src = readFile(rel);
        const sandbox = {};
        vm.createContext(sandbox);
        vm.runInContext(src, sandbox); // no `module` in scope -> exercises the browser branch
        const globalName = rel.includes('scene') ? 'Scene' : 'MoonPhase';
        assert.equal(typeof sandbox[globalName], 'object', `${rel} did not expose ${globalName}`);
    });
});

test('the project stays dependency-free', () => {
    const pkg = require('../package.json');
    ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].forEach((k) => {
        assert.ok(!pkg[k] || Object.keys(pkg[k]).length === 0, `package.json gained ${k}`);
    });
});
