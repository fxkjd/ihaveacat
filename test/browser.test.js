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

    const win = {
        requestAnimationFrame(cb) { return frameQueue.push(cb); },
        setTimeout(fn, ms) { return timers.push({ fn, at: now + ms }); },
        addEventListener() {},
        matchMedia() { return { matches: !!opts.reducedMotion }; },
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
    ['js/moon.js', 'js/scene.js', 'js/main.js'].forEach((rel) => {
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
        }
    };
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
