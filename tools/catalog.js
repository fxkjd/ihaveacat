'use strict';

// Development-only data pipeline. No dependencies or network access.
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(__dirname, 'data');
const LIMIT = 5;
const ALIASES = require('./data/hip-aliases.json');
const DESIGNATIONS = require('./data/designations.json');

function parseCSV(text) {
    const rows = []; let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
            if (quoted && text[i + 1] === '"') { field += '"'; i++; }
            else quoted = !quoted;
        } else if (!quoted && (c === ',' || c === '\n')) {
            row.push(field.replace(/\r$/, '')); field = '';
            if (c === '\n') { rows.push(row); row = []; }
        } else field += c;
    }
    if (quoted) throw new Error('Unterminated CSV quote');
    if (field || row.length) { row.push(field); rows.push(row); }
    const headers = rows.shift();
    return rows.filter(r => r.length > 1).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}

function parseFigures(text) {
    const figures = new Map(); let current;
    text.split(/\r?\n/).forEach((raw, i) => {
        const line = raw.trim();
        if (!line || line.startsWith('#')) return;
        if (line.startsWith('* ')) {
            // The disconnected head and tail are ONE official constellation.
            const name = line.slice(2).replace(/^Serpens[AB]$/, 'Serpens');
            if (!figures.has(name)) figures.set(name, { name, segments: [] });
            current = figures.get(name);
            return;
        }
        if (!current) throw new Error('Path before constellation at line ' + (i + 1));
        const stars = JSON.parse(line).map(value => {
            if (!/^\d+\*?$/.test(String(value))) throw new Error('Invalid HIP: ' + value);
            const hip = Number(String(value).replace('*', ''));
            if (hip <= 0) throw new Error('Invalid HIP: ' + value);
            return hip;
        });
        if (stars.length < 2) throw new Error('Path needs two stars');
        for (let j = 1; j < stars.length; j++) current.segments.push([stars[j - 1], stars[j]]);
    });
    return [...figures.values()];
}

function figuresWithFallback(iau, simplified) {
    return iau.map(c => {
        if (c.segments.length) return c;
        const fallback = simplified.find(f => f.name === c.name);
        if (!fallback || !fallback.segments.length) throw new Error('No figure for ' + c.name);
        return { ...fallback, source: 'simplified' };
    });
}
function requiredHIP(figures) { return new Set(figures.flatMap(c => c.segments.flat())); }
function hipMap(stars) {
    const map = new Map();
    stars.forEach(s => {
        if (!s.hip) return;
        if (map.has(s.hip)) throw new Error('Ambiguous HIP ' + s.hip);
        map.set(s.hip, s);
    });
    ALIASES.forEach(a => {
        const star = stars.find(s => s.id === a.hyg);
        if (star) {
            if (map.has(a.hip) && map.get(a.hip) !== star) throw new Error('Conflicting HIP alias ' + a.hip);
            map.set(a.hip, star);
        }
    });
    return map;
}
// Whichever catalogue number the record actually carries. `gl` already
// spells its own prefix; the others are bare numbers.
function catalogNumber(s) {
    if (s.hd) return 'HD ' + s.hd;
    if (s.hr) return 'HR ' + s.hr;
    if (s.gl) return s.gl;
    if (s.hip) return 'HIP ' + s.hip;
    throw new Error('Star ' + s.id + ' carries no catalogue number');
}

/*
 * How a star is written down, in the order a star atlas uses: the traditional
 * name where it has one, else the Bayer designation spelled out, else
 * Flamsteed, else the catalogue number standing in as the name.
 *
 * `id` is the catalogue number, and is present exactly for the designation
 * forms — Vega needs no number beside it, Alpha Lupi does because a
 * designation is something you look up, and a star whose only name IS
 * HD 82668 must not say it twice.
 *
 * This reproduces all 343 names already in js/sky.js, which generate() checks
 * before it writes a single new one.
 */
function starLabel(s) {
    if (s.proper) return { name: s.proper, id: '' };
    const genitive = DESIGNATIONS.genitive[s.con];
    if (s.bayer) {
        const m = /^([A-Za-z]+)(?:-(\d))?$/.exec(s.bayer);
        const greek = m && DESIGNATIONS.greek[m[1]];
        if (!greek) throw new Error('Unknown Bayer letter ' + s.bayer);
        if (!genitive) throw new Error('Unknown constellation ' + s.con);
        return { name: greek + (m[2] ? '-' + m[2] : '') + ' ' + genitive, id: catalogNumber(s) };
    }
    if (s.flam) {
        if (!genitive) throw new Error('Unknown constellation ' + s.con);
        return { name: s.flam + ' ' + genitive, id: catalogNumber(s) };
    }
    return { name: catalogNumber(s), id: '' };
}

const round = n => Math.round(n * 10) / 10 || 0;
const triplet = s => [round(s.ra * 15) % 360, round(s.dec), round(s.mag)];

function audit(figures, stars, availableIDs) {
    const byHIP = hipMap(stars);
    const required = requiredHIP(figures);
    const available = hip => byHIP.has(hip) && availableIDs.has(byHIP.get(hip).id);
    const missing = [...required].filter(hip => !available(hip)).sort((a, b) => a - b).map(hip => ({
        hip, mag: byHIP.get(hip)?.mag ?? null,
        constellations: figures.filter(c => c.segments.some(s => s.includes(hip))).map(c => c.name)
    }));
    const constellations = figures.map(c => {
        const hips = [...requiredHIP([c])];
        const starCount = hips.filter(available).length;
        const segmentCount = c.segments.filter(s => s.every(available)).length;
        return { name: c.name, requiredStars: hips.length, availableStars: starCount,
            starCoverage: hips.length ? 100 * starCount / hips.length : 0,
            requiredSegments: c.segments.length, renderableSegments: segmentCount,
            segmentCoverage: c.segments.length ? 100 * segmentCount / c.segments.length : 0,
            missingHIP: hips.filter(hip => !available(hip)) };
    });
    return { total: figures.length, required: required.size, available: required.size - missing.length,
        complete: constellations.filter(c => c.requiredSegments && c.renderableSegments === c.requiredSegments).length,
        missing, constellations };
}
function summary(a) {
    const empty = a.constellations.filter(c => !c.requiredSegments).length;
    return [`Total constellations: ${a.total}`, `Unique constellation stars: ${a.required}`,
        `Already in catalog: ${a.available}`, `Missing from catalog: ${a.missing.length}`,
        `Complete constellations: ${a.complete}`, `Partial constellations: ${a.total - a.complete - empty}`,
        `Empty figures: ${empty}`,
        `Segments: ${a.constellations.reduce((n, c) => n + c.renderableSegments, 0)}/${a.constellations.reduce((n, c) => n + c.requiredSegments, 0)}`, '',
        ...a.missing.map(s => `Missing HIP ${s.hip}: magnitude ${s.mag ?? 'NOT IN HYG'}; ${s.constellations.join(', ')}`), '',
        ...a.constellations.map(c => `${c.name}:\n  stars: ${c.availableStars}/${c.requiredStars} (${c.starCoverage.toFixed(1)}%)\n  segments: ${c.renderableSegments}/${c.requiredSegments} (${c.segmentCoverage.toFixed(1)}%)` +
            (c.missingHIP.length ? '\n  missing HIP: ' + c.missingHIP.join(', ') : ''))].join('\n') + '\n';
}
function generate(figures, source) {
    const required = requiredHIP(figures);
    // Preserve all existing indexes (including label/twinkle identities).
    const normal = source.filter(s => s.originalIndex !== null).sort((a, b) => a.originalIndex - b.originalIndex);
    const extras = source.filter(s => s.originalIndex === null && (s.mag <= LIMIT || required.has(s.hip)))
        .sort((a, b) => round(a.mag) - round(b.mag) || a.id - b.id);
    const stars = [...normal, ...extras];
    const byHIP = hipMap(stars);
    const indexes = new Map(stars.map((s, i) => [s.id, i]));
    const constellations = figures.map(c => ({ name: c.name, segments: c.segments.map(segment => segment.map(hip => {
        if (!byHIP.has(hip)) throw new Error('Missing HIP ' + hip);
        return indexes.get(byHIP.get(hip).id);
    })) }));
    return { catalog: stars.flatMap(triplet), constellations, stars };
}

/*
 * The label tables js/sky.js carries. The dense NAMES/IDS it already ships are
 * re-derived and checked rather than rewritten — 343 names that are on the
 * page and correct are not worth regenerating — and the constellation
 * endpoints the magnitude limit does not reach get a table of their own,
 * keyed by catalogue index.
 *
 * Only endpoints: a star the figures never touch is never drawn either, and
 * naming the whole catalogue would triple the file for stars nobody can point
 * at. An endpoint with no label stops generation.
 */
function labelTables(result, sky) {
    const limit = Number(/var SKY_MAG_LIMIT = ([\d.]+);/.exec(sky)[1]);
    const names = JSON.parse('[' + /var NAMES = \[([\s\S]*?)\];/.exec(sky)[1] + ']');
    const ids = JSON.parse('[' + /var IDS = \[([\s\S]*?)\];/.exec(sky)[1] + ']');
    const endpoints = new Set(result.constellations.flatMap(c => c.segments.flat()));
    const dense = result.stars.filter(s => round(s.mag) <= limit).length;
    if (dense !== names.length || dense !== ids.length) {
        throw new Error(`The dense tables cover ${names.length}/${ids.length} stars, not the ${dense} below magnitude ${limit}`);
    }
    const extraNames = {}, extraIds = {};
    result.stars.forEach((s, i) => {
        const label = starLabel(s);
        if (i < dense) {
            // Every name already on the page has to come out of the same rule
            // as the new ones, or the two halves of the table drift apart and
            // the sky ends up named by two different authorities.
            if (names[i] !== label.name || ids[i] !== label.id) {
                throw new Error(`Label drift at index ${i}: shipped ${JSON.stringify([names[i], ids[i]])}, ` +
                    `derived ${JSON.stringify([label.name, label.id])}`);
            }
            return;
        }
        if (!endpoints.has(i)) return;
        extraNames[i] = label.name;
        extraIds[i] = label.id;
    });
    const missing = [...endpoints].filter(i => i >= dense && extraNames[i] === undefined);
    if (missing.length) throw new Error('Unlabelled constellation endpoints: ' + missing.join(', '));
    return { extraNames, extraIds, dense };
}

// A JS object literal, wrapped to roughly the width of the tables above it.
function objectLiteral(map) {
    const lines = [];
    let line = '';
    Object.keys(map).forEach(key => {
        const entry = JSON.stringify(key) + ': ' + JSON.stringify(map[key]);
        const joined = line ? line + ', ' + entry : entry;
        if (joined.length > 92) { lines.push(line + ','); line = entry; } else line = joined;
    });
    if (line) lines.push(line);
    return '{\n' + lines.map(l => '        ' + l).join('\n') + '\n    }';
}

function readFigures() {
    const iau = parseFigures(fs.readFileSync(path.join(DATA, 'constellation_lines_iau.dat'), 'utf8'));
    const simplified = parseFigures(fs.readFileSync(path.join(DATA, 'constellation_lines_simplified.dat'), 'utf8'));
    return { iau, figures: figuresWithFallback(iau, simplified) };
}

// One-time import, also reproducible from the pinned upstream CSV. Exact
// rounded triplets reconstruct the legacy catalogue, NEVER nearest neighbours.
// Equal triplets use HYG source order; both entries must exist in the baseline.
function importHYG(csv, catalog, figures) {
    // The name columns travel with the coordinates so that regeneration stays
    // offline afterwards: a star's designation is as much part of the record
    // as its position, and re-deriving it would mean re-downloading 34 MB.
    const named = s => {
        const out = {};
        ['proper', 'bayer', 'flam', 'con', 'hd', 'hr', 'gl'].forEach(k => {
            const v = String(s[k] || '').trim();
            if (v) out[k] = v;
        });
        return out;
    };
    const source = parseCSV(csv).filter(s => Number(s.id) !== 0).map(s => ({
        id: Number(s.id), hip: Number(s.hip) || null,
        ra: Number(s.ra), dec: Number(s.dec), mag: Number(s.mag), originalIndex: null,
        ...named(s)
    }));
    const normal = source.filter(s => s.mag <= LIMIT);
    const buckets = new Map();
    normal.forEach(s => {
        const key = JSON.stringify(triplet(s));
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(s);
    });
    if (normal.length * 3 !== catalog.length) throw new Error('Baseline count differs from HYG magnitude <= 5');
    for (let i = 0; i < catalog.length; i += 3) {
        const candidates = buckets.get(JSON.stringify(catalog.slice(i, i + 3)));
        if (!candidates?.length) throw new Error('No exact HYG match at catalogue index ' + i / 3);
        candidates.shift().originalIndex = i / 3;
    }
    if (normal.some(s => s.originalIndex === null)) throw new Error('Unmatched HYG normal star');
    const required = requiredHIP(figures);
    return source.filter(s => s.originalIndex !== null || required.has(s.hip));
}

function main() {
    const { iau, figures } = readFigures();
    const command = process.argv[2] || 'audit';
    const sourcePath = path.join(DATA, 'hyg-v41-subset.json');
    if (command === 'import') {
        const sky = fs.readFileSync(path.join(ROOT, 'js/sky.js'), 'utf8');
        // Once imported, retain the baseline identity even after generation.
        const catalog = fs.existsSync(sourcePath)
            ? JSON.parse(fs.readFileSync(sourcePath, 'utf8')).filter(s => s.originalIndex !== null)
                .sort((a, b) => a.originalIndex - b.originalIndex).flatMap(triplet)
            : JSON.parse('[' + /var CATALOG = \[([\s\S]*?)\];/.exec(sky)[1] + ']');
        const subset = importHYG(fs.readFileSync(process.argv[3], 'utf8'), catalog, figures);
        fs.writeFileSync(sourcePath, JSON.stringify(subset) + '\n');
        return;
    }
    const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    const original = new Set(source.filter(s => s.originalIndex !== null).map(s => s.id));
    if (command === 'audit') {
        const report = audit(process.argv.includes('--iau-only') ? iau : figures, source, original);
        process.stdout.write(summary(report));
    } else if (command === 'generate') {
        const result = generate(figures, source);
        if (result.constellations.length !== 88 || result.constellations.some(c => !c.segments.length)) {
            throw new Error('Expected 88 nonempty figures');
        }
        const skyPath = path.join(ROOT, 'js/sky.js');
        const sky = fs.readFileSync(skyPath, 'utf8');
        const tables = labelTables(result, sky);
        const lines = [];
        for (let i = 0; i < result.catalog.length; i += 24) lines.push('        ' + result.catalog.slice(i, i + 24).join(','));
        fs.writeFileSync(skyPath, sky
            .replace(/var CATALOG = \[[\s\S]*?\];/, 'var CATALOG = [\n' + lines.join(',\n') + '\n    ];')
            .replace(/var EXTRA_NAMES = \{[\s\S]*?\};/, 'var EXTRA_NAMES = ' + objectLiteral(tables.extraNames) + ';')
            .replace(/var EXTRA_IDS = \{[\s\S]*?\};/, 'var EXTRA_IDS = ' + objectLiteral(tables.extraIds) + ';'));
        const data = '/* Generated by tools/catalog.js; constellation data © Dominic Ford, GPL-3.0-or-later. See AGENTS.md. */\n' +
            '(function (global) {\n    var data = [\n' + result.constellations.map(c => '        ' + JSON.stringify(c)).join(',\n') +
            '\n    ];\n    if (typeof module !== "undefined" && module.exports) module.exports = data;\n    else global.ConstellationData = data;\n})(this);\n';
        fs.writeFileSync(path.join(ROOT, 'js/constellations.generated.js'), data);
        fs.writeFileSync(path.join(DATA, 'coverage-before.txt'), summary(audit(figures, source, original)));
        fs.writeFileSync(path.join(DATA, 'coverage-iau-before.txt'), summary(audit(iau, source, original)));
        const after = audit(figures, source, new Set(result.stars.map(s => s.id)));
        if (after.missing.length) throw new Error('Incomplete generated catalogue');
        console.log(`${result.stars.length - original.size} added; ${result.stars.length} total; ${after.complete}/88 complete; ` +
            `${tables.dense} named below the limit + ${Object.keys(tables.extraNames).length} constellation endpoints`);
    } else throw new Error('Usage: node tools/catalog.js [audit [--iau-only]|import HYG.csv|generate]');
}
module.exports = { parseCSV, parseFigures, figuresWithFallback, requiredHIP, hipMap, audit, summary,
    generate, importHYG, starLabel, catalogNumber, labelTables };
if (require.main === module) main();
