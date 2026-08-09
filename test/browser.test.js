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
        matchMedia() {
            return {
                get matches() { return media.matches; },
                addEventListener(type, fn) { if (type === 'change') media.handlers.push(fn); }
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

    const ctx = vm.createContext(win);
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

// Sky text above the fence: what a vantage point actually changes.
function skyOf(page) {
    return page.text().split('\n').slice(0, 25).join('\n');
}

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
