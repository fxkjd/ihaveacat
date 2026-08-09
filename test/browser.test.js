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
const SkyMap = require('../js/sky.js');

// The grid main.js will derive for a viewport, given the harness's fixed
// 0.6em character width (see getBoundingClientRect below).
function gridFor(w, h) {
    const f = Scene.fitFontSize(w, h, 0.6);
    return Scene.fitGrid(w, h, 0.6 * f.fontPx, f.lineHeightPx);
}

function element(tag, doc) {
    return {
        tagName: tag,
        children: [],
        style: {},
        className: '',
        textContent: '',
        value: '',
        hidden: false,
        type: '',
        ownerDocument: doc || null,
        listeners: {},
        firstChild: null,
        parentNode: null,
        setAttribute() {},
        // Real listeners. These used to be a no-op, which is why no UI in this
        // project was ever testable; main.js attaches none, so recording them
        // changes nothing for the suites that came before.
        addEventListener(type, fn) {
            (this.listeners[type] = this.listeners[type] || []).push(fn);
        },
        // Enough of an event object for the code under test, and no more: the
        // menu reads `key` and calls preventDefault, and nothing else.
        dispatch(type, props) {
            const ev = Object.assign({
                type,
                target: this,
                defaultPrevented: false,
                preventDefault() { this.defaultPrevented = true; }
            }, props);
            (this.listeners[type] || []).forEach((fn) => fn(ev));
            return ev;
        },
        click() { return this.dispatch('click'); },
        // Focusing one element blurs whatever held focus before it, which is
        // the whole reason a commit-on-blur can be tested here at all.
        focus() {
            if (!this.ownerDocument) return;
            const prev = this.ownerDocument.activeElement;
            if (prev === this) return;
            this.ownerDocument.activeElement = this;
            if (prev) prev.dispatch('blur');
        },
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
        // what a real monospace face gives. A test can pin a full box by
        // assigning `rect` — the hover label's width, for instance, which
        // decides whether it flips at the right edge.
        rect: null,
        getBoundingClientRect() {
            if (this.rect) return this.rect;
            const w = this.textContent.length * parseFloat(this.style.fontSize || '10') * 0.6;
            return { left: 0, top: 0, right: w, bottom: 0, width: w, height: 0, x: 0, y: 0 };
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
    // A pointer that can hover, i.e. a mouse. Separate from the one above:
    // a stub that ignored matchMedia's argument would answer BOTH queries with
    // the reduced-motion state, silently disabling hover in every ordinary
    // test and enabling it only for a reduced-motion user.
    const hoverMedia = { matches: opts.hover !== false, handlers: [] };

    let hash = opts.hash || '';
    let hashChanges = 0;
    function fireHashChange() {
        hashChanges++;
        (listeners.hashchange || []).forEach((fn) => {
            try { fn(); } catch (e) { errors.push(e); }
        });
    }

    const win = {
        requestAnimationFrame(cb) { return frameQueue.push(cb); },
        setTimeout(fn, ms) { return timers.push({ fn, at: now + ms }); },
        /*
         * A real accessor, because the browser's own semantics are the thing
         * most easily got wrong here: assigning the value it already holds
         * fires NOTHING. Code that writes the hash and then waits for the
         * event to refresh itself looks perfect against a stub that always
         * fires, and freezes on the live page.
         */
        location: {
            get hash() { return hash; },
            set hash(v) {
                const next = String(v);
                const norm = next === '' || next.charAt(0) === '#' ? next : '#' + next;
                if (norm === hash) return;
                hash = norm;
                // And it arrives as a task, not as part of the assignment.
                timers.push({ fn: fireHashChange, at: now });
            }
        },
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        // The menu announces a session-only setting this way — the analogue of
        // hashchange for something that has no address bar.
        CustomEvent: class {
            constructor(type, init) { this.type = type; this.detail = init && init.detail; }
        },
        dispatchEvent(ev) {
            (listeners[ev.type] || []).forEach((fn) => {
                try { fn(ev); } catch (e) { errors.push(e); }
            });
            return true;
        },
        matchMedia(query) {
            const m = /prefers-reduced-motion/.test(String(query)) ? media : hoverMedia;
            return {
                get matches() { return m.matches; },
                addEventListener(type, fn) { if (type === 'change') m.handlers.push(fn); }
            };
        },
        getComputedStyle() { return { fontFamily: 'monospace' }; },
        document: {
            getElementById(id) { return id === 'scene' ? pre : null; },
            createElement(tag) { return element(tag, this); },
            createTextNode(text) { return { nodeValue: text }; },
            createDocumentFragment() { return element('#fragment'); },
            documentElement: { clientWidth: 1400, clientHeight: 900 },
            body: element('body'),
            activeElement: null,
            addEventListener() {}
        }
    };
    win.window = win;

    /*
     * The <pre>'s real box, derived live so it can never go stale after a
     * resize. The wrapper div is `position: absolute; bottom: 0`, so the grid
     * hangs from the BOTTOM of the viewport — a stub answering top: 0 would let
     * hover code that ignores the anchoring pass with its row index off by the
     * entire height of the sky.
     */
    pre.getBoundingClientRect = function () {
        var lineH = parseFloat(pre.style.lineHeight || '0') || 0;
        // Row spans only: the '\n' separators are text nodes with no tagName.
        var rows = pre.children.filter(function (c) { return c.tagName === 'span'; }).length;
        var height = rows * lineH;
        var left = parseFloat(pre.style.marginLeft || '0') || 0;
        var top = win.document.documentElement.clientHeight - height;
        var width = win.document.documentElement.clientWidth - left;
        return {
            left: left, top: top, right: left + width, bottom: top + height,
            width: width, height: height, x: left, y: top
        };
    };

    const ctx = vm.createContext(win);
    /*
     * Pin the clock, so the sky and the moon phase are the same every run.
     * main.js takes ONE instant at load, so this only has to hold on startup.
     */
    if (opts.now) {
        const RealDate = vm.runInContext('Date', ctx);
        const at = opts.now;
        function StubDate() {
            return arguments.length
                ? new (Function.prototype.bind.apply(RealDate, [null].concat([].slice.call(arguments))))()
                : new RealDate(at);
        }
        StubDate.prototype = RealDate.prototype;
        StubDate.now = function () { return new RealDate(at).getTime(); };
        StubDate.UTC = RealDate.UTC;
        StubDate.parse = RealDate.parse;
        win.Date = StubDate;
    }
    // Pin the context's Math.random before the scripts load — main.js draws
    // from it during startup, and a deterministic flight lets a test aim it.
    if (opts.random) vm.runInContext('Math', ctx).random = opts.random;
    ['js/moon.js', 'js/sky.js', 'js/scene.js', 'js/main.js', 'js/menu.js'].forEach((rel) => {
        if (opts.withoutSky && rel === 'js/sky.js') return;
        vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
    });

    return {
        pre,
        errors,
        hash() { return hash; },
        // How many hashchange events have actually fired, so a test can prove
        // that a redundant write fires none.
        hashChanges() { return hashChanges; },
        // getElementById only ever answers 'scene', so the menu is reached by
        // walking the body. A dozen hand-built nodes; a walk is enough.
        byClass(cls) {
            const out = [];
            (function walk(el) {
                (el.children || []).forEach((c) => {
                    if (String(c.className).split(' ').indexOf(cls) >= 0) out.push(c);
                    walk(c);
                });
            })(win.document.body);
            return out;
        },
        gear() { return this.byClass('menu-gear')[0]; },
        panel() { return this.byClass('menu')[0]; },
        label() { return this.byClass('star-name')[0]; },
        toggle() { return this.byClass('menu-toggle')[0]; },
        rect() { return pre.getBoundingClientRect(); },
        // A pixel inside a grid cell. fx/fy pick where in the cell, so a test
        // can sweep the fraction instead of only ever probing the centre.
        pointAt(col, row, fx, fy) {
            const r = pre.getBoundingClientRect();
            const charW = parseFloat(pre.style.fontSize) * 0.6;
            const lineH = parseFloat(pre.style.lineHeight);
            return {
                clientX: r.left + (col + (fx === undefined ? 0.5 : fx)) * charW,
                clientY: r.top + (row + (fy === undefined ? 0.5 : fy)) * lineH
            };
        },
        hover(col, row, fx, fy) { pre.dispatch('mousemove', this.pointAt(col, row, fx, fy)); },
        leave() { pre.dispatch('mouseleave', {}); },
        // Announce the session-only setting the way the menu does, so a test
        // can drive the feature with no panel open.
        setNames(on) {
            win.dispatchEvent(new win.CustomEvent('settingschange', { detail: { names: on } }));
        },
        field(name) {
            // lat then lon, in the order rows() lays them out.
            return this.byClass('menu-field')[name === 'lat' ? 0 : 1];
        },
        dir(letter) {
            return this.byClass('menu-dir')
                .find((b) => b.textContent.replace(/[()\s]/g, '') === letter);
        },
        // What the panel currently reads, row by row.
        menuText() {
            return (this.panel().children || [])
                .map((c) => c.textContent || c.nodeValue || '').join('');
        },
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
        // Edit the URL hash as the address bar would — through the same setter
        // the page itself writes to, so both share one set of semantics.
        setHash(h) {
            win.location.hash = h;
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

// Sky text above the fence: what a vantage point actually changes.
function skyOf(page) {
    return page.text().split('\n').slice(0, 25).join('\n');
}

test('the page shows the real sky, retuned live by the URL hash', () => {
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
    assert.notEqual(skyOf(syd), skyOf(bcn),
        'the hash vantage point changed nothing');

    // Editing the hash retunes the view without a reload...
    const before = skyOf(bcn);
    bcn.setHash('#dir=e');
    bcn.tick();
    assert.notEqual(skyOf(bcn), before, 'hashchange did not repaint the sky');
    // ...and a garbage hash falls back to the default view, not a blank sky.
    bcn.setHash('#lat=abc&dir=up');
    bcn.tick();
    assert.equal(skyOf(bcn), before, 'garbage hash should mean the default view');
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

// The grid rows currently holding a firefly run, by row index. Row spans are
// the <pre>'s element children; the '\n' separators between them are text
// nodes with no tagName.
function fireflyRows(page) {
    const rows = page.pre.children.filter((c) => c.tagName === 'span');
    const out = [];
    rows.forEach((row, y) => {
        (row.children || []).forEach((run) => {
            if (String(run.className).indexOf('firefly') === 0) out.push(y);
        });
    });
    return out;
}

function tickUntilFirefly(page) {
    for (let t = 0; t < 1500; t++) {
        page.tick();
        if (fireflyRows(page).length > 0) return;
    }
    assert.fail('no firefly ever lit');
}

test('fireflies blink in the lawn rows only, and the reduced-motion flip snuffs a lit one', () => {
    const page = loadPage({ random: () => 0.5 });
    const g = gridFor(1400, 900);
    const L = Scene.layout(g.cols, g.rows);

    tickUntilFirefly(page);

    // Watch a whole blink and then some: every lit cell stays strictly below
    // the fence's base, and the glow must swell through dim to bright and
    // back — a static dot is not a firefly.
    const seen = new Set();
    for (let i = 0; i < 180; i++) {
        fireflyRows(page).forEach((y) => {
            assert.ok(y > L.groundRow && y < g.rows,
                `a firefly lit outside the lawn, on row ${y}`);
        });
        page.paintedClasses().forEach((c) => {
            if (c.indexOf('firefly') === 0) seen.add(c);
        });
        page.tick();
    }
    assert.ok(seen.has('firefly-dim'), 'the blink never showed its dim pose');
    assert.ok(seen.has('firefly'), 'the blink never reached full glow');

    // Catch one lit, then flip: the glow must vanish, not freeze. The 40 s
    // byte-stillness test above cannot see this — a frozen glow never changes.
    tickUntilFirefly(page);
    page.setReducedMotion(true);
    page.tick();
    page.tick();
    assert.equal(fireflyRows(page).length, 0,
        'a lit firefly froze on screen through the flip to reduced motion');

    // And back off: they return on their own.
    page.setReducedMotion(false);
    tickUntilFirefly(page);
    assert.deepEqual(page.errors, []);
});

test('prefers-reduced-motion at load means no firefly ever lights', () => {
    const page = loadPage({ reducedMotion: true });
    // 25 s of page time — past both slots' latest possible first light. The
    // scan is per tick: a transient blink between samples must not slip by.
    for (let i = 0; i < 1500; i++) {
        page.tick();
        assert.equal(fireflyRows(page).length, 0,
            'a firefly lit despite prefers-reduced-motion');
    }
    assert.deepEqual(page.errors, []);
});

// ---- The vantage panel ---------------------------------------------------

// Type into a field and commit the way a person does: Enter.
function typeInto(page, name, value) {
    const el = page.field(name);
    el.focus();
    el.value = value;
    el.dispatch('keydown', { key: 'Enter' });
}

test('the gear toggles a panel that starts shut', () => {
    const page = loadPage();
    page.tick();
    const gear = page.gear();
    assert.ok(gear, 'no gear was installed');
    assert.equal(gear.textContent, '⚙︎');
    assert.equal(page.panel().hidden, true, 'the panel should start shut');

    gear.click();
    assert.equal(page.panel().hidden, false);
    gear.click();
    assert.equal(page.panel().hidden, true);
    assert.deepEqual(page.errors, []);
});

test('the panel opens reading the vantage the page is drawn from', () => {
    const page = loadPage({ hash: '#lat=-33.87&lon=151.21&dir=n' });
    page.tick();
    page.gear().click();

    assert.equal(page.field('lat').value, '-33.87');
    assert.equal(page.field('lon').value, '151.21');
    assert.equal(page.dir('n').textContent, '(n)');
    ['e', 's', 'w'].forEach((d) => {
        assert.equal(page.dir(d).textContent, ' ' + d + ' ', d);
        assert.doesNotMatch(page.dir(d).className, /menu-dir-on/);
    });
    assert.match(page.dir('n').className, /menu-dir-on/);
});

test('committing the panel draws the sky that fragment draws', () => {
    const page = loadPage();
    page.tick();
    const before = skyOf(page);
    page.gear().click();

    page.field('lon').value = '151.21';
    typeInto(page, 'lat', '-33.87');
    page.dir('n').click();
    page.tick();

    // The fragment is canonical and complete, so the URL is shareable alone.
    assert.equal(page.hash(), '#lat=-33.87&lon=151.21&dir=n');
    assert.notEqual(skyOf(page), before, 'the sky did not retune');

    // And the whole point: the panel is a way of typing the fragment, and
    // produces nothing that typing the fragment would not.
    const direct = loadPage({ hash: '#lat=-33.87&lon=151.21&dir=n' });
    direct.tick();
    assert.equal(skyOf(page), skyOf(direct));
    assert.deepEqual(page.errors, []);
});

test('a rejected coordinate moves neither the sky nor the fragment', () => {
    const page = loadPage();
    page.tick();
    page.gear().click();
    const sky = skyOf(page);
    const hash = page.hash();

    // Out of range, and plain nonsense. Both are typos, not requests.
    ['999', '-91', 'abc', ''].forEach((bad) => {
        typeInto(page, 'lat', bad);
        page.tick();
        assert.equal(page.hash(), hash, bad);
        assert.equal(skyOf(page), sky, bad);
        // The field snaps back to what the sky is actually drawn from.
        assert.equal(page.field('lat').value, '41.39', bad);
    });
    assert.deepEqual(page.errors, []);
});

test('committing the same vantage twice fires no second hashchange', () => {
    const page = loadPage();
    page.tick();
    page.gear().click();
    typeInto(page, 'lat', '55.9');
    page.tick();

    const fired = page.hashChanges();
    const sky = skyOf(page);
    // The identical value, and a differently-spelled identical value.
    typeInto(page, 'lat', '55.9');
    page.tick();
    typeInto(page, 'lat', '55.90');
    page.tick();
    page.dir('s').click();
    page.tick();

    assert.equal(page.hashChanges(), fired, 'a redundant write fired an event');
    assert.equal(skyOf(page), sky);
    assert.equal(page.field('lat').value, '55.9', 'the field should canonicalise');
    assert.deepEqual(page.errors, []);
});

test('editing the fragment directly moves the panel with it', () => {
    const page = loadPage();
    page.tick();
    page.gear().click();
    page.setHash('#lat=-33.87&lon=151.21&dir=w');
    page.tick();

    assert.equal(page.field('lat').value, '-33.87');
    assert.equal(page.field('lon').value, '151.21');
    assert.equal(page.dir('w').textContent, '(w)');
    // A garbage fragment shows the default view — what the page is drawing —
    // rather than echoing the garbage back.
    page.setHash('#lat=abc&dir=up');
    page.tick();
    assert.equal(page.field('lat').value, '41.39');
    assert.deepEqual(page.errors, []);
});

test('Enter on a compass or toggle button is left to the browser', () => {
    // On a <button>, Enter's default action IS the click: preventDefault on
    // its keydown (the field handler's commit move) swallows the activation,
    // leaving Enter dead for keyboard users while Space still works.
    const page = loadPage();
    page.tick();
    page.gear().click();

    const dirEv = page.dir('n').dispatch('keydown', { key: 'Enter' });
    assert.equal(dirEv.defaultPrevented, false, 'Enter on a compass button was swallowed');
    const togEv = page.toggle().dispatch('keydown', { key: 'Enter' });
    assert.equal(togEv.defaultPrevented, false, 'Enter on a toggle button was swallowed');

    // Escape from a button still shuts the panel.
    page.dir('n').dispatch('keydown', { key: 'Escape' });
    assert.equal(page.panel().hidden, true, 'Escape from a button did not shut the panel');
    assert.deepEqual(page.errors, []);
});

test('Escape shuts the panel and abandons the half-typed value', () => {
    const page = loadPage();
    page.tick();
    page.gear().click();
    const hash = page.hash();

    const lat = page.field('lat');
    lat.focus();
    lat.value = '-33.8';                       // mid-edit, never committed
    lat.dispatch('keydown', { key: 'Escape' });
    page.tick();

    assert.equal(page.panel().hidden, true, 'Escape did not shut the panel');
    // The blur that follows hiding the panel must not commit the abandoned
    // value: close() restores the fields before it moves focus.
    assert.equal(page.hash(), hash, 'Escape committed the abandoned edit');
    assert.equal(page.field('lat').value, '41.39');
    assert.deepEqual(page.errors, []);
});

test('the menu is chrome: it never touches a cell of the scene', () => {
    const page = loadPage();
    page.tick();
    const scene = page.text();

    page.gear().click();
    assert.equal(page.text(), scene, 'opening the menu redrew the scene');
    typeInto(page, 'lat', '41.39');            // the value it already holds
    page.tick();
    assert.equal(page.text(), scene, 'a no-op commit redrew the scene');
    page.gear().click();
    assert.equal(page.text(), scene, 'shutting the menu redrew the scene');
    assert.deepEqual(page.errors, []);
});

test('without js/sky.js there is no gear at all', () => {
    const page = loadPage({ withoutSky: true });
    page.tick();
    // No sky module, no vantage to set: a control that cannot do anything is
    // worse than no control.
    assert.equal(page.gear(), undefined);
    assert.equal(page.panel(), undefined);
    assert.deepEqual(page.errors, []);
});

// ---- Star names on hover -------------------------------------------------

/*
 * NOT the harness's default 1400x900. There the grid is exactly 45 rows of
 * 20px = 900, so the <pre> fills the window, rect.top is 0, and hover code
 * that ignored the wrapper's bottom anchoring would pass. At 939 the grid is
 * 924px and hangs 15px down — the same lesson as "a flying meteor is never on
 * a whole row". HOVER_TOP asserts the trap stays defused.
 */
const HOVER_W = 1400, HOVER_H = 939, HOVER_TOP = 15;
const HOVER_NOW = Date.UTC(2026, 1, 14, 21, 0, 0);

function hoverPage(extra) {
    const page = loadPage({ now: HOVER_NOW, ...(extra || {}) });
    page.resize(HOVER_W, HOVER_H);
    page.tick();
    assert.equal(page.rect().top, HOVER_TOP,
        'the grid should not exactly fill the window, or this suite proves nothing');
    return page;
}

// The sky main.js is drawing, split the way buildScene splits it.
function skyFor() {
    const grid = gridFor(HOVER_W, HOVER_H);
    const layout = Scene.layout(grid.cols, grid.rows);
    const cells = SkyMap.starCells({
        date: new Date(HOVER_NOW),
        lat: SkyMap.DEFAULT_VIEW.lat, lon: SkyMap.DEFAULT_VIEW.lon,
        azimuth: SkyMap.DEFAULT_VIEW.azimuth,
        cols: grid.cols, skyRows: layout.fenceTop
    });
    return {
        grid, layout, cells,
        shown: cells.filter((s) => Scene.starVisible(s, layout) && SkyMap.starLabel(s.index)),
        dropped: cells.filter((s) => !Scene.starVisible(s, layout))
    };
}

function labelFor(s) {
    const l = SkyMap.starLabel(s.index);
    return l.id ? l.name + '  ' + l.id : l.name;
}

// A named star with no other star in any of the eight cells around it, so
// stepping over a cell edge is guaranteed to land on empty sky. Stars do sit
// side by side in a constellation, and a neighbour would mask the very
// boundary these tests are trying to find.
function isolatedStar(sky) {
    const taken = new Set(sky.cells.map((c) => c.x + ':' + c.y));
    return sky.shown.find((s) => {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if ((dx || dy) && taken.has((s.x + dx) + ':' + (s.y + dy))) return false;
            }
        }
        return true;
    });
}

test('star names are off until they are asked for', () => {
    const page = hoverPage();
    const sky = skyFor();
    assert.ok(sky.shown.length > 0, 'no named star is on screen to test with');

    page.hover(sky.shown[0].x, sky.shown[0].y);
    page.tick();
    assert.equal(page.label().hidden, true, 'a name showed without being enabled');
    assert.equal(page.label().textContent, '');

    // And the panel agrees.
    page.gear().click();
    assert.equal(page.toggle().textContent, '( )');
    assert.deepEqual(page.errors, []);
});

test('hovering a star names it, and only where the star is', () => {
    const page = hoverPage();
    page.setNames(true);
    const sky = skyFor();
    const s = sky.shown[0];

    page.hover(s.x, s.y);
    page.tick();
    assert.equal(page.label().hidden, false, 'the star was not named');
    assert.equal(page.label().textContent, labelFor(s));

    // A blank cell nearby names nothing. Find one that really is blank.
    const taken = new Set(sky.cells.map((c) => c.x + ':' + c.y));
    let blank = null;
    for (let dx = 1; dx < 20 && !blank; dx++) {
        if (!taken.has((s.x + dx) + ':' + s.y)) blank = { x: s.x + dx, y: s.y };
    }
    assert.ok(blank, 'no blank cell found beside the star');
    page.hover(blank.x, blank.y);
    page.tick();
    assert.equal(page.label().hidden, true, 'a blank cell was named');
    assert.deepEqual(page.errors, []);
});

test('the cell boundary is the label boundary', () => {
    const page = hoverPage();
    page.setNames(true);
    const s = isolatedStar(skyFor());
    assert.ok(s, 'no isolated star to probe the cell edges with');

    // Sweep the fraction rather than only probing the centre: a rounding
    // error would be invisible at 0.5 and obvious at the edges.
    [0.02, 0.5, 0.98].forEach((f) => {
        page.hover(s.x, s.y, f, f);
        page.tick();
        assert.equal(page.label().hidden, false, `inside the cell at ${f}`);
    });
    [[-0.05, 0.5], [1.05, 0.5], [0.5, -0.05], [0.5, 1.05]].forEach(([fx, fy]) => {
        page.hover(s.x, s.y, fx, fy);
        page.tick();
        assert.equal(page.label().hidden, true, `outside the cell at ${fx},${fy}`);
    });
    assert.deepEqual(page.errors, []);
});

test('a star hidden behind the moon or the cat is never named', () => {
    const page = hoverPage();
    page.setNames(true);
    const sky = skyFor();
    // The precondition, asserted: starCells returns a superset of what is
    // painted, and this date must actually exercise that.
    assert.ok(sky.dropped.length > 0, 'nothing was occluded — pick another instant');

    // The biconditional over every star the sky module offered, so the test
    // cannot pass by the feature being broken everywhere.
    let named = 0;
    sky.cells.forEach((s) => {
        page.hover(s.x, s.y);
        page.tick();
        const shouldName = Scene.starVisible(s, sky.layout) && !!SkyMap.starLabel(s.index);
        assert.equal(page.label().hidden, !shouldName,
            `star ${s.index} at ${s.x},${s.y}: expected named=${shouldName}`);
        if (shouldName) named++;
    });
    assert.ok(named > 10, `only ${named} stars were named`);
    assert.deepEqual(page.errors, []);
});

test('the label is chrome: it never touches a cell of the scene', () => {
    const page = hoverPage();
    const before = page.text();
    page.setNames(true);
    const s = skyFor().shown[0];
    page.hover(s.x, s.y);
    page.tick();

    assert.equal(page.label().hidden, false);
    assert.equal(page.text(), before, 'naming a star redrew the scene');
    // And it lives outside the <pre>, not in it.
    assert.equal(page.byClass('star-name').length, 1);
    const inPre = [];
    (function walk(el) {
        (el.children || []).forEach((c) => {
            if (String(c.className).indexOf('star-name') >= 0) inPre.push(c);
            walk(c);
        });
    })(page.pre);
    assert.deepEqual(inPre, []);
});

test('turning star names off clears the label without waiting for a move', () => {
    const page = hoverPage();
    page.setNames(true);
    const s = skyFor().shown[0];
    page.hover(s.x, s.y);
    page.tick();
    assert.equal(page.label().hidden, false);

    const hash = page.hash();
    page.setNames(false);
    assert.equal(page.label().hidden, true, 'the label survived being switched off');
    // A display preference is not a vantage: it must never reach the URL.
    assert.equal(page.hash(), hash);
    assert.deepEqual(page.errors, []);
});

test('the panel toggle drives the names, and writes no fragment', () => {
    const page = hoverPage();
    const hash = page.hash();
    page.gear().click();
    assert.equal(page.toggle().textContent, '( )');

    page.toggle().click();
    page.tick();
    assert.equal(page.toggle().textContent, '(x)', 'the mark did not move');
    const s = skyFor().shown[0];
    page.hover(s.x, s.y);
    page.tick();
    assert.equal(page.label().textContent, labelFor(s));

    page.toggle().click();
    page.tick();
    assert.equal(page.toggle().textContent, '( )');
    assert.equal(page.label().hidden, true);
    assert.equal(page.hash(), hash, 'the toggle wrote to the URL');
    assert.deepEqual(page.errors, []);
});

test('leaving the scene hides the label', () => {
    const page = hoverPage();
    page.setNames(true);
    const s = skyFor().shown[0];
    page.hover(s.x, s.y);
    page.tick();
    assert.equal(page.label().hidden, false);
    page.leave();
    assert.equal(page.label().hidden, true);
});

test('star names survive the reduced-motion flip', () => {
    // Regression guard: the hover has no animation, so gating it on motionGen
    // would take names away from people who asked for less movement.
    const page = hoverPage({ reducedMotion: true });
    page.setNames(true);
    const s = skyFor().shown[0];
    page.hover(s.x, s.y);
    page.tick();
    assert.equal(page.label().hidden, false, 'reduced motion suppressed the name');
    assert.equal(page.label().textContent, labelFor(s));

    page.setReducedMotion(false);
    page.tick();
    page.hover(s.x, s.y);
    page.tick();
    assert.equal(page.label().hidden, false);
});

test('a pointer that cannot hover never names anything', () => {
    const page = hoverPage({ hover: false });
    page.setNames(true);
    const s = skyFor().shown[0];
    page.hover(s.x, s.y);
    page.tick();
    // A tap synthesises one mousemove and never a mouseleave, so a label lit
    // here would stay lit forever.
    assert.equal(page.label().hidden, true);
});

test('the label flips rather than running off the right edge', () => {
    const page = hoverPage();
    page.setNames(true);
    const sky = skyFor();
    // A wide label, and the rightmost named star.
    const s = sky.shown.reduce((a, b) => (b.x > a.x ? b : a));
    page.label().rect = { left: 0, top: 0, right: 300, bottom: 12, width: 300, height: 12, x: 0, y: 0 };
    page.hover(s.x, s.y);
    page.tick();

    const left = parseFloat(page.label().style.left);
    assert.ok(left >= 0, `label left ${left} is off the left edge`);
    assert.ok(left + 300 <= HOVER_W, `label right ${left + 300} exceeds ${HOVER_W}`);
});

test('a resize re-aims the hover at the cell now under the cursor', () => {
    const page = hoverPage();
    page.setNames(true);
    const s = skyFor().shown[0];
    page.hover(s.x, s.y);
    page.tick();
    const first = page.label().textContent;
    assert.ok(first.length > 0);

    // The pixel the cursor is actually sitting on, before anything moves.
    const pixel = page.pointAt(s.x, s.y);

    // A materially different grid. The cell under that pixel changes, and
    // metrics captured once at load would now map it to the wrong one.
    page.resize(1100, 780);
    page.tick();
    const afterResize = page.label().textContent;
    const hiddenAfterResize = page.label().hidden;

    // The resize re-aimed the hover on its own. Re-dispatching the very same
    // pixel must agree with what it computed — if it did not, the metrics the
    // resize used and the metrics a move uses have drifted apart.
    page.pre.dispatch('mousemove', pixel);
    page.tick();
    assert.equal(page.label().hidden, hiddenAfterResize);
    assert.equal(page.label().textContent, afterResize);
    assert.deepEqual(page.errors, []);
});

test('the name is never written across the moon or the cat', () => {
    const page = hoverPage();
    page.setNames(true);
    const sky = skyFor();
    const H = 14;

    // Pixel boxes for the two things the label must keep off.
    const r0 = page.rect();
    const charW = parseFloat(page.pre.style.fontSize) * 0.6;
    const lineH = parseFloat(page.pre.style.lineHeight);
    const boxes = [sky.layout.moonBox, sky.layout.catBox].map((b) => ({
        x0: r0.left + b.left * charW, x1: r0.left + (b.right + 1) * charW,
        y0: r0.top + b.top * lineH, y1: r0.top + (b.bottom + 1) * lineH
    }));
    const hits = (x, y, w) => boxes.some((b) =>
        x < b.x1 && x + w > b.x0 && y < b.y1 && y + H > b.y0);
    // Where main.js would put the label if nothing were in the way.
    const defaultAt = (s) => ({
        x: r0.left + (s.x + 1) * charW + 10,
        y: r0.top + (s.y + 1) * lineH + 6
    });
    const setWidth = (w) => {
        page.label().rect =
            { left: 0, top: 0, right: w, bottom: H, width: w, height: H, x: 0, y: 0 };
    };

    /*
     * Whether a real star happens to sit close enough to the moon depends on
     * the date, so the case is constructed rather than hoped for: take the
     * star lying left of the moon on the moon's own rows, and give it a label
     * just long enough to reach. Otherwise this test would quietly stop
     * exercising the flip the next time the sky moved.
     */
    const moon = boxes[0];
    let target = null, reach = 0;
    sky.shown.forEach((s) => {
        const d = defaultAt(s);
        if (d.y + H <= moon.y0 || d.y >= moon.y1) return;   // not on its rows
        if (d.x >= moon.x0) return;                          // already past it
        const need = moon.x0 - d.x + 60;
        if (!target || need < reach) { target = s; reach = need; }
    });
    assert.ok(target, 'no star lies left of the moon on its rows');

    setWidth(reach);
    const d = defaultAt(target);
    assert.ok(hits(d.x, d.y, reach), 'the constructed label would not have hit the moon');
    page.hover(target.x, target.y);
    page.tick();
    assert.ok(!hits(parseFloat(page.label().style.left),
                    parseFloat(page.label().style.top), reach),
        'the label was written across the moon');

    // And at a realistic width, no star anywhere lands on either subject.
    const W = 170;
    setWidth(W);
    sky.shown.forEach((s) => {
        page.hover(s.x, s.y);
        page.tick();
        assert.equal(page.label().hidden, false, `star at ${s.x},${s.y} was not named`);
        const x = parseFloat(page.label().style.left);
        const y = parseFloat(page.label().style.top);
        assert.ok(!hits(x, y, W),
            `the label for the star at ${s.x},${s.y} lies across the moon or the cat`);
        assert.ok(x >= 0 && x + W <= HOVER_W, `label off the side at ${x}`);
    });
    assert.deepEqual(page.errors, []);
});
