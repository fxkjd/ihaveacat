/*
 * The vantage panel: a gear in the top-right corner that opens a small ASCII
 * readout for latitude, longitude and the way you are facing.
 *
 * It renders no sky itself. It writes the URL fragment, and main.js's existing
 * hashchange listener repaints — exactly what happens when the fragment is
 * edited in the address bar. This panel is a nicer keyboard for the address
 * bar and nothing more, which is why main.js needs no change and knows nothing
 * about it: the panel, a shared link and the Back button are all one code path,
 * and the URL always says what is drawn.
 *
 * Split like the rest of the project: rows() is pure art over pre-formatted
 * strings, testable with no DOM at all; install() is the browser wiring. It
 * builds itself from script, so nothing appears on the no-JS page that could
 * not work, and index.html gains no on* attribute for the CSP to block.
 */
(function (global) {
    'use strict';

    // '-179.99' is the longest value a fragment can hold, so a field is never
    // wider than its brackets and the value can never overflow them.
    var FIELD_COLS = 7;
    var FIELDS = ['lat', 'lon'];
    var ROSE = ['n', 'e', 's', 'w'];
    var TOGGLES = ['name'];
    var TOGGLE_ON = '(x)', TOGGLE_OFF = '( )';
    var TITLE = 'settings';
    var GEAR = '⚙︎';
    // Must match js/main.js. Duplicated rather than shared because main.js
    // loads first and cannot read this constant when it registers — the same
    // reason hash2 is copied between sky.js and scene.js.
    var SETTINGS_EVENT = 'settingschange';

    function rep(ch, n) { return n > 0 ? new Array(n + 1).join(ch) : ''; }
    function label(text) { return { text: text, cls: 'menu-label' }; }

    /*
     * The panel as rows of {text, cls} segments — the same shape scene.js
     * emits. Values arrive already formatted (SkyMap.formatFields), so the
     * panel cannot disagree with the fragment about what it is showing.
     *
     * Every direction slot is three cells wide, marked '(s)' or ' s ', so
     * clicking one can never shift the row by a column and the state survives
     * with the colours stripped out.
     */
    function rows(fields, settings) {
        var f = fields || {};
        var out = [];
        out.push([label(rep(' ', 5) + TITLE)]);
        out.push([]);
        FIELDS.forEach(function (name) {
            out.push([
                label(' ' + name + '  ['),
                {
                    field: name,
                    value: String(f[name] === undefined ? '' : f[name]),
                    cols: FIELD_COLS,
                    cls: 'menu-field'
                },
                label(' ]')
            ]);
        });
        out.push([label(' dir  ')].concat(ROSE.map(function (d) {
            var on = d === f.dir;
            // The unmarked letters carry menu-label too, so they take the same
            // brown as the labels; menu-dir-on is declared after it and wins
            // the marked one back to the cat's white.
            return {
                dir: d,
                text: on ? '(' + d + ')' : ' ' + d + ' ',
                cls: on ? 'menu-dir menu-dir-on' : 'menu-dir menu-label'
            };
        })));
        /*
         * Display preferences, below the sky. Taken as a second argument
         * rather than merged into `fields`: formatFields returns exactly the
         * three strings the fragment holds, and these are not among them —
         * they are session-only and never travel in the URL. rows(fields)
         * with no settings therefore draws them all off, which is the default
         * made structural.
         */
        var s = settings || {};
        out.push([]);
        TOGGLES.forEach(function (name) {
            var lit = !!s[name];
            out.push([
                label(' ' + name + rep(' ', 5 - name.length)),
                {
                    toggle: name,
                    // Three cells either way, like a compass slot: the mark
                    // cannot shift the row, and it carries the state with no
                    // colour at all.
                    text: lit ? TOGGLE_ON : TOGGLE_OFF,
                    cls: lit ? 'menu-toggle menu-toggle-on' : 'menu-toggle menu-label'
                }
            ]);
        });
        return out;
    }

    // A row as plain text, values right-aligned in their columns exactly as the
    // inputs render them. Used by the tests to pin the drawing.
    function rowText(row) {
        return row.map(function (seg) {
            if (!seg.field) return seg.text;
            return rep(' ', seg.cols - seg.value.length) + seg.value;
        }).join('');
    }

    /*
     * The wiring. Everything above this line is pure; everything below it
     * touches the page and never the sky — the only thing it writes is the
     * URL fragment.
     */
    function install(doc, win) {
        var sky = win.SkyMap;
        var view = sky.parseView(win.location ? win.location.hash : '');
        var inputs = {}, dirs = {}, toggles = {};
        // Session-only: no fragment, off again on every load.
        var settings = { name: false };

        function within(n, limit) { return isFinite(n) && n >= -limit && n <= limit; }

        /*
         * The panel shows what the page is actually drawing, so it re-derives
         * from rows() rather than keeping a second copy of the marking rules.
         * Without `force` it leaves a focused field alone: the fragment can
         * change from the address bar mid-edit, and that must not yank the
         * text out from under whoever is typing.
         */
        function sync(force) {
            rows(sky.formatFields(view), settings).forEach(function (row) {
                row.forEach(function (seg) {
                    if (seg.field) {
                        if (force || inputs[seg.field] !== doc.activeElement) {
                            inputs[seg.field].value = seg.value;
                        }
                    } else if (seg.dir) {
                        mark(dirs[seg.dir], seg, 'menu-dir-on');
                    } else if (seg.toggle) {
                        mark(toggles[seg.toggle], seg, 'menu-toggle-on');
                    }
                });
            });
        }

        function mark(el, seg, onClass) {
            el.className = seg.cls;
            el.textContent = seg.text;
            el.setAttribute('aria-pressed',
                seg.cls.indexOf(onClass) >= 0 ? 'true' : 'false');
        }

        /*
         * One fragment write per deliberate change — never per keystroke,
         * because each write is a history entry.
         *
         * The panel is brought up to date BEFORE the write and never reads the
         * event back, so the browser firing nothing when the value is
         * unchanged is not a special case: it is the ordinary case where
         * nothing needed to happen.
         */
        function commitView(next) {
            var hash = sky.formatView(next);
            /*
             * A commit that does not move the vantage writes nothing at all —
             * not even to canonicalise the spelling. Otherwise merely opening
             * the panel and leaving a field would stamp a fragment onto a URL
             * that never had one, and an abandoned edit would commit itself
             * through the blur that follows Escape.
             */
            if (hash === sky.formatView(view)) {
                sync(true);
                return;
            }
            view = sky.parseView(hash);
            sync(true);
            if (win.location.hash !== hash) win.location.hash = hash;
        }

        function commitFields() {
            var lat = parseFloat(inputs.lat.value);
            var lon = parseFloat(inputs.lon.value);
            // Rejected outright: not clamped, and not silently swapped for
            // Barcelona. The field snaps back to the value the sky is drawn
            // from, which is the only honest thing it can show.
            if (!within(lat, sky.LAT_LIMIT) || !within(lon, sky.LON_LIMIT)) {
                sync(true);
                return;
            }
            commitView({ lat: lat, lon: lon, azimuth: view.azimuth });
        }

        /*
         * A session-only setting has no address bar to travel through, so the
         * panel announces it on window instead — the direct analogue of
         * hashchange. The panel is brought up to date BEFORE the announcement
         * and never reads the event back, exactly as commitView is.
         */
        function announce() {
            if (!win.CustomEvent || !win.dispatchEvent) return;   // degrade, don't throw
            win.dispatchEvent(new win.CustomEvent(SETTINGS_EVENT, {
                detail: { names: settings.name }
            }));
        }

        function setToggle(name) {
            settings[name] = !settings[name];
            sync(true);
            announce();
        }

        function setDir(letter) {
            // parseView is already the letter-to-azimuth map, validated, over
            // the one DIRECTIONS table. No second copy of the compass here.
            commitView({
                lat: view.lat, lon: view.lon,
                azimuth: sky.parseView('#dir=' + letter).azimuth
            });
        }

        function onKey(e) {
            if (!e) return;
            if (e.key === 'Enter') {
                // There is no <form> here, but a stray Enter should do nothing
                // except commit.
                if (e.preventDefault) e.preventDefault();
                commitFields();
            } else if (e.key === 'Escape') {
                close(true);
            }
        }

        // For the buttons only Escape is ours: on a <button>, Enter's default
        // action IS the click, so the field handler's preventDefault would
        // swallow the activation and leave Enter doing nothing.
        function onButtonKey(e) {
            if (e && e.key === 'Escape') close(true);
        }

        function node(seg) {
            var el;
            if (seg.field) {
                el = doc.createElement('input');
                // Never type="number": spinners, a locale-dependent decimal
                // separator, and widget chrome that cannot be made to look
                // like seven characters of ASCII.
                el.type = 'text';
                el.value = seg.value;
                el.maxLength = seg.cols;
                el.inputMode = 'decimal';
                el.autocomplete = 'off';
                el.spellcheck = false;
                // The ' lat  [' text is a sibling span, not a <label>, so the
                // input needs its own name — spelled out, like 'look n' is.
                el.setAttribute('aria-label',
                    seg.field === 'lat' ? 'latitude' : 'longitude');
                // Exactly as many columns as the brackets reserve, applied
                // through CSSOM: a style="" attribute is what the CSP blocks.
                el.style.width = seg.cols + 'ch';
                el.addEventListener('keydown', onKey);
                el.addEventListener('blur', commitFields);
                inputs[seg.field] = el;
            } else if (seg.dir) {
                el = doc.createElement('button');
                el.type = 'button';
                el.textContent = seg.text;
                el.setAttribute('aria-label', 'look ' + seg.dir);
                el.addEventListener('click', function () { setDir(seg.dir); });
                el.addEventListener('keydown', onButtonKey);
                dirs[seg.dir] = el;
            } else if (seg.toggle) {
                el = doc.createElement('button');
                el.type = 'button';
                el.textContent = seg.text;
                el.setAttribute('aria-label', 'star ' + seg.toggle + 's');
                el.addEventListener('click', function () { setToggle(seg.toggle); });
                el.addEventListener('keydown', onButtonKey);
                toggles[seg.toggle] = el;
            } else {
                el = doc.createElement('span');
                el.textContent = seg.text;
            }
            el.className = seg.cls;
            return el;
        }

        /*
         * Opening deliberately does NOT move focus into a field. Grabbing it
         * would raise the on-screen keyboard over the scene the moment the
         * panel opens on a phone, and it would leave `lat` permanently
         * "being edited", which is what sync() refuses to overwrite.
         */
        function open() {
            panel.hidden = false;
            gear.setAttribute('aria-expanded', 'true');
            sync(true);
        }

        function close(restore) {
            // Restore BEFORE moving focus. Hiding the panel blurs whatever is
            // focused inside it, and that blur would otherwise commit the
            // half-typed value Escape is supposed to abandon.
            if (restore) sync(true);
            panel.hidden = true;
            gear.setAttribute('aria-expanded', 'false');
            if (gear.focus) gear.focus();
        }

        var gear = doc.createElement('button');
        gear.type = 'button';
        gear.className = 'menu-gear';
        gear.textContent = GEAR;
        gear.title = TITLE;
        gear.setAttribute('aria-label', 'sky vantage');
        gear.setAttribute('aria-expanded', 'false');
        gear.addEventListener('click', function () {
            if (panel.hidden) open(); else close(true);
        });
        gear.addEventListener('keydown', function (e) {
            if (e && e.key === 'Escape' && !panel.hidden) close(true);
        });

        var panel = doc.createElement('pre');
        panel.className = 'menu';
        panel.hidden = true;              // built shut, so it cannot flash at load

        rows(sky.formatFields(view), settings).forEach(function (row, i) {
            if (i) panel.appendChild(doc.createTextNode('\n'));
            row.forEach(function (seg) { panel.appendChild(node(seg)); });
        });

        doc.body.appendChild(gear);
        doc.body.appendChild(panel);

        /*
         * The fragment also changes from the address bar, a shared link and
         * the Back button. Re-read it and show what the page is drawing — for
         * a garbage fragment that is the default view, not the garbage, since
         * the default is what parseView hands the renderer.
         */
        win.addEventListener('hashchange', function () {
            view = sky.parseView(win.location.hash);
            sync(false);
        });
    }

    var Menu = {
        FIELD_COLS: FIELD_COLS,
        FIELDS: FIELDS,
        ROSE: ROSE,
        TOGGLES: TOGGLES,
        TITLE: TITLE,
        SETTINGS_EVENT: SETTINGS_EVENT,
        GEAR: GEAR,
        rows: rows,
        rowText: rowText,
        install: install
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = Menu;
    } else {
        global.Menu = Menu;
    }

    /*
     * Export first, install second: page.test.js runs this file in a bare
     * sandbox with no document to check the browser global. And with no sky
     * module there is no vantage to set, so the page gets no gear rather than
     * a control that cannot do anything — the same degradation main.js's own
     * hashchange listener already makes.
     */
    if (global.document && global.document.body && global.SkyMap) {
        install(global.document, global);
    }
})(this);
