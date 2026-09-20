'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pipeline = require('../tools/catalog');
const source = require('../tools/data/hyg-v41-subset.json');
const Sky = require('../js/sky');
const read = name => fs.readFileSync(path.join(__dirname, '../tools/data', name), 'utf8');
const iau = pipeline.parseFigures(read('constellation_lines_iau.dat'));
const figures = pipeline.figuresWithFallback(iau, pipeline.parseFigures(read('constellation_lines_simplified.dat')));

test('parser joins consecutive HIP IDs, honours pen lifts, annotations and Serpens halves', () => {
    const result = pipeline.parseFigures('# comment\n* SerpensA\n["12*","34","56"]\n["78","90"]\n* SerpensB\n["91","92"]');
    assert.deepEqual(result, [{ name: 'Serpens', segments: [[12,34],[34,56],[78,90],[91,92]] }]);
    assert.throws(() => pipeline.parseFigures('* Bad\n["12oops","34"]'), /Invalid HIP/);
    assert.throws(() => pipeline.parseFigures('["12","34"]'), /before constellation/);
    assert.throws(() => pipeline.parseFigures('* Bad\n["0","34"]'), /Invalid HIP/);
});

test('CSV importer handles quoting and maps exact baseline triplets to source HIP identities', () => {
    assert.deepEqual(pipeline.parseCSV('id,proper\n1,"A, B"\n2,"C""D"\n'), [{ id: '1', proper: 'A, B' }, { id: '2', proper: 'C"D' }]);
    const csv = 'id,hip,ra,dec,mag\n0,,0,0,-26.7\n1,10,2,3,4\n2,20,3,4,5.4\n3,30,4,5,6\n';
    const stars = pipeline.importHYG(csv, [30,3,4], [{ name: 'Test', segments: [[10,20]] }]);
    assert.deepEqual(stars.map(s => [s.id, s.hip, s.originalIndex]), [[1,10,0],[2,20,null]]);
    assert.throws(() => pipeline.importHYG(csv, [30.1,3,4], []), /No exact HYG match/);
    assert.throws(() => pipeline.hipMap([{ hip: 1 }, { hip: 1 }]), /Ambiguous/);
});

test('coverage distinguishes missing stars, missing source identities and unavailable segments', () => {
    const stars = [{ id: 1, hip: 10, mag: 4 }, { id: 2, hip: 20, mag: 5.4 }];
    const a = pipeline.audit([{ name: 'Test', segments: [[10,20],[20,30]] }], stars, new Set([1]));
    assert.equal(a.required, 3);
    assert.equal(a.available, 1);
    assert.deepEqual(a.missing.map(s => [s.hip, s.mag]), [[20,5.4],[30,null]]);
    assert.equal(a.constellations[0].renderableSegments, 0);
    assert.equal(a.constellations[0].starCoverage, 100 / 3);
    assert.throws(() => pipeline.generate([{ name: 'Test', segments: [[10,99]] }], stars), /Missing HIP/);
});

test('the pinned audit covers all 88 figures and documents the two IAU omissions', () => {
    assert.equal(iau.length, 88);
    assert.deepEqual(iau.filter(c => !c.segments.length).map(c => c.name), ['Mensa', 'Microscopium']);
    const original = new Set(source.filter(s => s.originalIndex !== null).map(s => s.id));
    const a = pipeline.audit(figures, source, original);
    assert.equal(original.size, 1637);
    assert.equal(a.required, 750);
    assert.equal(a.available, 730);
    assert.equal(a.missing.length, 20);
    assert.equal(a.complete, 77);
    assert.equal(pipeline.summary(a), read('coverage-before.txt'));
    // A published identity mapping, never a nearby-star substitution.
    assert.equal(pipeline.hipMap(source).get(55203).id, 118742);
});

test('generation contains exactly normal UNION required stars with valid compact indexes', () => {
    const result = pipeline.generate(figures, source);
    assert.equal(result.stars.length, 1657);
    assert.deepEqual(result.catalog, Sky.CATALOG);
    assert.deepEqual(result.constellations, Sky.CONSTELLATIONS);
    const byHIP = pipeline.hipMap(result.stars);
    figures.forEach((c, i) => c.segments.forEach((s, j) => s.forEach((hip, k) => {
        const index = result.constellations[i].segments[j][k];
        assert.equal(result.stars[index].id, byHIP.get(hip).id);
    })));
    const after = pipeline.audit(figures, source, new Set(result.stars.map(s => s.id)));
    assert.equal(after.complete, 88);
    assert.equal(after.missing.length, 0);
    assert.equal(after.constellations.reduce((n, c) => n + c.renderableSegments, 0), 756);
    assert.deepEqual(pipeline.generate(figures, source), result);
});
