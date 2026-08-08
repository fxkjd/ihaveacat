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
    assert.deepEqual(order, ['js/moon.js', 'js/sky.js', 'js/scene.js', 'js/main.js']);

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

test('the idle animations honour prefers-reduced-motion', () => {
    const src = readFile('js/main.js');
    assert.match(src, /prefers-reduced-motion/,
        'main.js starts timers, so it must check prefers-reduced-motion itself — ' +
        'the CSS guard only covers the star twinkle');
    // Timing and randomness must stay out of the pure scene module.
    assert.doesNotMatch(readFile('js/scene.js'), /setTimeout|setInterval|requestAnimationFrame/);
});

test('index.html has no inline script or style (CSP: default-src \'self\')', () => {
    const html = readFile('index.html');
    // Every <script> must be external — an inline one is blocked outright by
    // the site's CSP, and whatever it was setting up silently never happens.
    [...html.matchAll(/<script\b([^>]*)>/g)].forEach((m) => {
        assert.match(m[1], /\ssrc=/, `inline <script> found: <script${m[1]}>`);
    });
    assert.doesNotMatch(html, /<style\b/, 'inline <style> is blocked by the CSP');
    assert.doesNotMatch(html, /\sstyle=/, 'style="" attributes are blocked by the CSP');
    // Inline event handlers are inline script too.
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'inline event handler is blocked by the CSP');
});

test('the pre carries an explicit monospace stack unconditionally', () => {
    const css = readFile('css/style.css');
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const preRules = [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter((m) => m[1].trim() === 'pre')
        .map((m) => m[2]);
    assert.ok(preRules.length, 'no bare `pre` rule found in css/style.css');
    assert.ok(
        preRules.some((body) => /font-family:[^;]*monospace/.test(body)),
        'a bare `pre` rule must set a monospace family — leaving it to the UA ' +
        'default resolves to -moz-fixed in Firefox, which main.js cannot copy ' +
        'onto its measuring probe'
    );
    // The stack must not be gated behind a class that needs an inline script.
    assert.doesNotMatch(css, /html\.js\b/, 'html.js gating requires an inline script (CSP)');
});

test('every class the scene can emit is styled in css/style.css', () => {
    const css = readFile('css/style.css');
    const defined = new Set([...css.matchAll(/\.([A-Za-z][-\w]*)/g)].map((m) => m[1]));

    const MoonPhase = require('../js/moon.js');
    const used = new Set();
    for (let phase = 0; phase < 8; phase++) {
        // Animation options included, so their classes are covered too: the
        // meteor head sits in open sky on this grid, and one firefly per
        // brightness phase sits in the lawn rows (groundRow 87 -> 88-89).
        const scene = Scene.buildScene({
            cols: 220, rows: 90, moonRows: MoonPhase.renderMoonRows(phase),
            tailFrame: 0,
            meteor: { row: 20, col: 60, path: 0 },
            fireflies: Scene.FIREFLY_PHASES.map((_, i) => ({ x: 3 + i, y: 88 + (i % 2), phase: i }))
        });
        scene.grid.forEach((runs) => runs.forEach((run) => {
            if (run.cls) run.cls.split(' ').forEach((c) => used.add(c));
        }));
    }
    used.forEach((cls) => {
        assert.ok(defined.has(cls), `class .${cls} is emitted but never styled in css/style.css`);
    });
});

test('scene.js, moon.js and sky.js expose their browser (non-CommonJS) global correctly', () => {
    const globals = { 'js/scene.js': 'Scene', 'js/moon.js': 'MoonPhase', 'js/sky.js': 'SkyMap' };
    Object.keys(globals).forEach((rel) => {
        const src = readFile(rel);
        const sandbox = {};
        vm.createContext(sandbox);
        vm.runInContext(src, sandbox); // no `module` in scope -> exercises the browser branch
        assert.equal(typeof sandbox[globals[rel]], 'object', `${rel} did not expose ${globals[rel]}`);
    });
});

test('the project stays dependency-free', () => {
    const pkg = require('../package.json');
    ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].forEach((k) => {
        assert.ok(!pkg[k] || Object.keys(pkg[k]).length === 0, `package.json gained ${k}`);
    });
});
