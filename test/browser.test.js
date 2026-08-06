'use strict';

/*
 * Runs js/main.js for real against a stub DOM and a stub frame clock.
 *
 * The other suites test scene.js, which is pure, and read main.js as text.
 * Neither can catch a browser-contract mistake: a meteor loop that seeded its
 * start time with 0 shipped green through 71 unit tests and a sweep of several
 * hundred simulated flights, because both assumed the clock starts at zero.
 * requestAnimationFrame counts from page load, so the first real frame looked
 * seconds late and flung every meteor past the far edge before it drew — the
 * page ran with no shooting stars at all and nothing failed.
 *
 * So the clock here deliberately starts at a large, page-load-relative value.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const Scene = require('../js/scene.js');

// The grid main.js will derive for a viewport, given the harness's fixed
// 0.6em character width (see getBoundingClientRect below).
function gridFor(w, h) {
    const f = Scene.fitFontSize(w, h, 0.6);
    return Scene.fitGrid(w, h, 0.6 * f.fontPx, f.lineHeightPx);
}

function element(tag) {
    return {
        tagName: tag,
        children: [],
        style: {},
        className: '',
        textContent: '',
        firstChild: null,
        parentNode: null,
        setAttribute() {},
        addEventListener() {},
        appendChild(child) {
            // A real DOM moves a fragment's children into the parent and
            // leaves the fragment itself out of the tree. Without that, every
            // row lands one level too deep and a walk of pre.children finds
            // nothing.
            if (child.tagName === '#fragment') {
                child.children.forEach((c) => { this.children.push(c); c.parentNode = this; });
                child.children = [];
                child.firstChild = null;
            } else {
                this.children.push(child);
                child.parentNode = this;
            }
            this.firstChild = this.children[0] || null;
            return child;
        },
        removeChild(child) {
            this.children = this.children.filter((c) => c !== child);
            this.firstChild = this.children[0] || null;
            return child;
        },
        // main.js measures a run of Ms to derive the character width; 0.6 em is
        // what a real monospace face gives.
        getBoundingClientRect() {
            return { width: this.textContent.length * parseFloat(this.style.fontSize || '10') * 0.6 };
        }
    };
}

// Loads the three scripts in page order and returns a handle that drives the
// clock. `tick` advances one display frame, running whichever callbacks are due.
function loadPage(options) {
    const opts = options || {};
    const pre = element('pre');
    pre.parentNode = element('div');
    let now = 8421.7;               // the page has been open a while, as in life
    const frameQueue = [];
    const timers = [];
    const errors = [];
    const listeners = {};           // window event listeners, by type
    // The reduced-motion media query, stateful so a test can flip it live.
    const media = { matches: !!opts.reducedMotion, handlers: [] };

    const win = {
        requestAnimationFrame(cb) { return frameQueue.push(cb); },
        setTimeout(fn, ms) { return timers.push({ fn, at: now + ms }); },
        location: { hash: opts.hash || '' },
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        matchMedia() {
            return {
                get matches() { return media.matches; },
                addEventListener(type, fn) { if (type === 'change') media.handlers.push(fn); }
            };
        },
        getComputedStyle() { return { fontFamily: 'monospace' }; },
        document: {
            getElementById(id) { return id === 'scene' ? pre : null; },
            createElement: element,
            createTextNode(text) { return { nodeValue: text }; },
            createDocumentFragment() { return element('#fragment'); },
            documentElement: { clientWidth: 1400, clientHeight: 900 },
            body: element('body'),
            addEventListener() {}
        }
    };
    win.window = win;

    const ctx = vm.createContext(win);
    // Pin the context's Math.random before the scripts load — main.js draws
    // from it during startup, and a deterministic flight lets a test aim it.
    if (opts.random) vm.runInContext('Math', ctx).random = opts.random;
    ['js/moon.js', 'js/sky.js', 'js/scene.js', 'js/main.js'].forEach((rel) => {
        if (opts.withoutSky && rel === 'js/sky.js') return;
        vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
    });

    return {
        pre,
        errors,
        // One display frame at 60Hz. Returns how many animation frames ran.
        tick() {
            now += 1000 / 60;
            timers.filter((t) => t.at <= now).forEach((t) => {
                timers.splice(timers.indexOf(t), 1);
                try { t.fn(); } catch (e) { errors.push(e); }
            });
            const due = frameQueue.splice(0, frameQueue.length);
            due.forEach((cb) => {
                try { cb(now); } catch (e) { errors.push(e); }
            });
            return due.length;
        },
        // Classes currently painted into the <pre>, one flat set.
        paintedClasses() {
            const out = new Set();
            pre.children.forEach((row) => {
                (row.children || []).forEach((run) => { if (run.className) out.add(run.className); });
            });
            return out;
        },
        // The full text of the <pre>, for change detection.
        text() {
            return pre.children.map((row) =>
                (row.children || []).map((c) => c.textContent || c.nodeValue || '').join('')
            ).join('\n');
        },
        // A window resize: new viewport dimensions, then the resize event.
        resize(w, h) {
            win.document.documentElement.clientWidth = w;
            win.document.documentElement.clientHeight = h;
            (listeners.resize || []).forEach((fn) => {
                try { fn(); } catch (e) { errors.push(e); }
            });
        },
        // Flip the OS reduced-motion setting mid-session.
        setReducedMotion(on) {
            media.matches = on;
            media.handlers.forEach((fn) => {
                try { fn(); } catch (e) { errors.push(e); }
            });
        },
        // Edit the URL hash and fire hashchange, as the address bar would.
        setHash(hash) {
            win.location.hash = hash;
            (listeners.hashchange || []).forEach((fn) => {
                try { fn(); } catch (e) { errors.push(e); }
            });
        }
    };
}

// Ticks until the first meteor cell is painted; throws if none ever is.
function tickUntilMeteor(page) {
    for (let t = 0; t < 4000; t++) {
        page.tick();
        if ([...page.paintedClasses()].some((c) => c.indexOf('meteor') === 0)) return;
    }
    assert.fail('no meteor ever appeared');
}

// Runs page time until `wanted` flights have finished, or `seconds` runs out.
// Stopping at the first complete flight keeps this quick whatever the gap
// between meteors is set to — the schedule is 20-30 s on the live site.
function fly(page, seconds, wanted) {
    const flights = [];
    let run = 0, sawMeteorInDom = false;
    for (let i = 0; i < Math.round(seconds * 60); i++) {
        const frames = page.tick();
        if (frames > 0) {
            run += frames;
            page.paintedClasses().forEach((c) => {
                if (c.indexOf('meteor') === 0) sawMeteorInDom = true;
            });
        } else if (run) {
            flights.push(run);
            run = 0;
            if (wanted && flights.length >= wanted) break;
        }
    }
    return { flights, sawMeteorInDom };
}

test('the page paints the scene without throwing', () => {
    const page = loadPage();
    page.tick();
    assert.deepEqual(page.errors, []);
    assert.ok(page.pre.children.length > 40,
        `expected a full grid of row spans, got ${page.pre.children.length}`);
});

test('a meteor flies a full flight on a page-load-relative frame clock', () => {
    // The regression this file exists for. Seeding the flight's start time with
    // a made-up 0 while requestAnimationFrame counts from page load ended every
    // flight on its first frame — which is off-screen by construction, so the
    // page showed no shooting stars at all.
    const page = loadPage();
    const { flights, sawMeteorInDom } = fly(page, 90, 1);

    assert.deepEqual(page.errors, []);
    assert.ok(flights.length >= 1, 'no meteor flight ran in 90 s of page time');
    assert.ok(sawMeteorInDom, 'a flight ran but never painted a meteor cell into the DOM');
    flights.forEach((frames, i) => {
        assert.ok(frames > 20,
            `flight ${i} lasted ${frames} frame(s) — a flight that dies in a frame or ` +
            'two is starting past its own end, not flying');
    });
});

test('prefers-reduced-motion stops the flight before it starts', () => {
    const page = loadPage({ reducedMotion: true });
    const { flights } = fly(page, 45);
    assert.deepEqual(page.errors, []);
    assert.equal(flights.length, 0, 'meteors flew despite prefers-reduced-motion');
});

test('a mid-flight resize cannot tunnel the meteor through the moon', () => {
    // Regression: runMeteor judged the whole flight against the layout it
    // captured at launch, while buildScene draws with the current one. A
    // resize that moved the moon into the flight line made the streak vanish
    // crossing the disc's new position, then RE-EMERGE below it and fly on —
    // through the very thing it is supposed to die against.
    // 0.9 pins path {-1,1} and aims the flight through the sky's right half —
    // with Math.random pinned, the whole line is exactly predictable.
    const RAND = 0.9;
    const page = loadPage({ random: () => RAND });
    const g0 = gridFor(1400, 900);
    const L0 = Scene.layout(g0.cols, g0.rows);
    const aimRow = Math.round(L0.fenceTop * (0.25 + RAND * 0.5));
    const aimCol = Math.round(g0.cols * (0.2 + RAND * 0.6));
    const lineCol = (r) => aimCol - (r - aimRow);
    const inB = (r, c, b) => c >= b.left && c <= b.right && r >= b.top && r <= b.bottom;

    // The un-resized flight must be clear of the original moon and cat all the
    // way to the horizon — otherwise it dies on its own and the resize proves
    // nothing. (0.5, for instance, aims straight into the moon.)
    for (let r = 0; r < L0.fenceTop; r++) {
        assert.ok(!inB(r, lineCol(r), L0.moonBox) && !inB(r, lineCol(r), L0.catBox),
            `the launch line hits the original scene at row ${r} — pick another RAND`);
    }

    // Find a resize that drops the fresh moon onto the remaining flight line,
    // with the head still on-grid and open sky below the disc for a tunnelling
    // streak to re-emerge into (so the buggy behaviour would be visible).
    let target = null;
    for (let w = 700; w <= 1400 && !target; w += 50) {
        for (let h = 450; h <= 900 && !target; h += 50) {
            const g = gridFor(w, h);
            const Lf = Scene.layout(g.cols, g.rows);
            const hit = [];
            for (let r = Math.max(6, Lf.moonBox.top); r <= Lf.moonBox.bottom; r++) {
                if (inB(r, lineCol(r), Lf.moonBox)) hit.push(r);
            }
            if (!hit.length) continue;
            // A tunnelled streak must have somewhere visible to re-emerge.
            const below = hit[hit.length - 1] + 2;
            if (below >= Lf.fenceTop - 2 || lineCol(below) < 3 ||
                lineCol(below) >= g.cols - 3 || inB(below, lineCol(below), Lf.catBox)) continue;
            target = { w, h };
        }
    }
    assert.ok(target, 'no resize target found — widen the search bounds');

    tickUntilMeteor(page);
    page.resize(target.w, target.h);

    // Watch the rest of the flight: once the streak has been seen and then
    // disappears, it must never come back.
    let sawInk = false, gapAfterInk = false;
    for (let i = 0; i < 900; i++) {
        page.tick();
        const ink = [...page.paintedClasses()].some((c) => c.indexOf('meteor') === 0);
        if (ink && gapAfterInk) {
            assert.fail('the streak re-emerged after vanishing — it tunnelled through the moon');
        }
        if (ink) sawInk = true;
        else if (sawInk) gapAfterInk = true;
    }
    assert.deepEqual(page.errors, []);
    assert.ok(sawInk, 'the flight never showed after the resize — the scenario proves nothing');
});

test('the page shows the real sky, retuned live by the URL hash', () => {
    // Sky text above the fence for comparison across vantage points.
    const skyText = (page) => page.text().split('\n').slice(0, 25).join('\n');

    const bcn = loadPage();
    bcn.tick();
    assert.deepEqual(bcn.errors, []);
    assert.ok([...bcn.paintedClasses()].some((c) => c.indexOf('star') === 0),
        'no stars painted at all');

    // A different vantage point in the hash yields a different sky at the
    // same instant (Sydney looking north shares no sky with Barcelona south).
    const syd = loadPage({ hash: '#lat=-33.87&lon=151.21&dir=n' });
    syd.tick();
    assert.deepEqual(syd.errors, []);
    assert.notEqual(skyText(syd), skyText(bcn),
        'the hash vantage point changed nothing');

    // Editing the hash retunes the view without a reload...
    const before = skyText(bcn);
    bcn.setHash('#dir=e');
    bcn.tick();
    assert.notEqual(skyText(bcn), before, 'hashchange did not repaint the sky');
    // ...and a garbage hash falls back to the default view, not a blank sky.
    bcn.setHash('#lat=abc&dir=up');
    bcn.tick();
    assert.equal(skyText(bcn), before, 'garbage hash should mean the default view');
    assert.deepEqual(bcn.errors, []);
});

test('without js/sky.js the page falls back to the seeded stars', () => {
    const page = loadPage({ withoutSky: true });
    page.tick();
    assert.deepEqual(page.errors, []);
    assert.ok([...page.paintedClasses()].some((c) => c.indexOf('star') === 0),
        'the fallback stars are missing');
    // The hash is meaningless without the sky module — and harmless.
    page.setHash('#lat=10');
    page.tick();
    assert.deepEqual(page.errors, []);
});

test('flipping prefers-reduced-motion mid-session stops and restarts the animations', () => {
    // Regression: the setting was sampled once at load, so flipping it stopped
    // the CSS twinkle instantly but left the wag and meteors running.
    const page = loadPage({ random: () => 0.5 });
    tickUntilMeteor(page);

    page.setReducedMotion(true);
    page.tick();                    // the already-queued frame dies on the bumped generation
    page.tick();
    assert.ok(![...page.paintedClasses()].some((c) => c.indexOf('meteor') === 0),
        'the streak survived the flip to reduced motion');

    // Nothing may move while reduced: the DOM stays byte-identical for 40 s,
    // across both the pending wag timer and the pending meteor reschedule.
    const still = page.text();
    for (let i = 0; i < 2400; i++) page.tick();
    assert.equal(page.text(), still, 'something kept animating under prefers-reduced-motion');

    // Flip back off: the animations must return on their own.
    page.setReducedMotion(false);
    tickUntilMeteor(page);
    assert.deepEqual(page.errors, []);
});
