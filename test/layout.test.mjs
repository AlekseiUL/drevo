import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutFamily } from '../skills/family-tree-studio/assets/viewer/scripts/model.mjs';

function fixture() {
  const ids = ['focus', 'a-parent', 'z-parent', 'a-grandparent', 'b-grandparent', 'y-grandparent', 'z-grandparent',
    'deep-ancestor', 'great-grandparent', 'first-sibling', 'first-spouse', 'first-child', 'second-sibling', 'second-spouse', 'second-child', 'paternal-sibling'];
  const edges = [];
  const relation = (a, b, type = 'parent-child') => edges.push({ id: `e${edges.length}`, a, b, type, confidence: 'reported', claimIds: [], evidence: [] });
  relation('a-parent', 'focus'); relation('z-parent', 'focus');
  relation('a-grandparent', 'a-parent'); relation('b-grandparent', 'a-parent');
  relation('y-grandparent', 'z-parent'); relation('z-grandparent', 'z-parent');
  relation('deep-ancestor', 'great-grandparent'); relation('great-grandparent', 'a-grandparent');
  relation('a-grandparent', 'first-sibling', 'sibling'); relation('first-sibling', 'first-spouse', 'partner');
  relation('first-sibling', 'first-child'); relation('first-spouse', 'first-child');
  relation('b-grandparent', 'second-sibling', 'sibling'); relation('second-sibling', 'second-spouse', 'partner');
  relation('second-sibling', 'second-child'); relation('second-spouse', 'second-child');
  relation('z-grandparent', 'paternal-sibling', 'sibling');
  return { rootPerson: 'focus', title: 'Fictional layout fixture', demo: true,
    persons: ids.map(id => ({ id, name: `Fictional ${id}`, evidence: [], dossier: { biography: 'Synthetic only', materials: [], findings: [] } })),
    families: [], edges };
}
const people = model => new Map(model.persons.map(person => [person.id, person]));
const center = (model, person) => person.x + model.box.width / 2;
function noOverlaps(model) {
  for (const a of model.persons) {
    assert(Number.isFinite(a.x) && Number.isFinite(a.y), a.id);
    assert(a.x >= 0 && a.y >= 0 && a.x + model.box.width <= model.width && a.y + model.box.height <= model.height, a.id);
    for (const b of model.persons) if (a.id < b.id) assert(!(a.x < b.x + model.box.width && a.x + model.box.width > b.x && a.y < b.y + model.box.height && a.y + model.box.height > b.y), `${a.id} overlaps ${b.id}`);
  }
}

test('generations are relative to the root despite different ancestral depths', () => {
  const model = layoutFamily(fixture()), p = people(model);
  for (const id of ['a-parent', 'z-parent', 'first-child', 'second-child']) assert.equal(p.get(id).generation, -1, id);
  for (const id of ['a-grandparent', 'b-grandparent', 'y-grandparent', 'z-grandparent', 'first-sibling', 'second-sibling']) assert.equal(p.get(id).generation, -2, id);
  assert.equal(p.get('deep-ancestor').generation, -4);
  assert.equal(p.get('focus').y, Math.max(...model.persons.map(p => p.y)));
  for (const edge of model.edges) if (edge.type === 'parent-child') assert.equal(p.get(edge.b).generation - p.get(edge.a).generation, 1);
  for (const row of model.generationRows) assert.equal(new Set(model.persons.filter(p => p.generation === row.generation).map(p => p.y)).size, 1);
});

test('the two parental branches stay on opposite sides at each ancestor generation', () => {
  const model = layoutFamily(fixture());
  for (const generation of [-2, -3, -4]) {
    const left = model.persons.filter(p => p.generation === generation && p.branch === -1);
    const right = model.persons.filter(p => p.generation === generation && p.branch === 1);
    if (left.length && right.length) assert(Math.max(...left.map(p => p.x + model.box.width)) < Math.min(...right.map(p => p.x)));
  }
});

test('couples and co-parents are adjacent without inventing partnership evidence', () => {
  const input = fixture(), model = layoutFamily(input), p = people(model);
  for (const [a, b] of [['a-parent', 'z-parent'], ['a-grandparent', 'b-grandparent'], ['y-grandparent', 'z-grandparent'], ['first-sibling', 'first-spouse']]) {
    assert.equal(p.get(a).y, p.get(b).y);
    assert.equal(Math.abs(p.get(a).x - p.get(b).x), model.box.width + 24);
  }
  assert.deepEqual(model.edges, input.edges);
  assert(!model.edges.some(e => e.type === 'partner' && [e.a, e.b].includes('a-parent')));
});

test('siblings remain beside their own half of the couple and their children below', () => {
  const model = layoutFamily(fixture()), p = people(model);
  assert(p.get('first-sibling').x < p.get('a-grandparent').x);
  assert(p.get('first-spouse').x < p.get('a-grandparent').x);
  assert(p.get('second-sibling').x > p.get('b-grandparent').x);
  assert(p.get('second-spouse').x > p.get('b-grandparent').x);
  for (const prefix of ['first', 'second']) {
    const child = p.get(`${prefix}-child`), parents = [p.get(`${prefix}-sibling`), p.get(`${prefix}-spouse`)];
    assert(child.y > parents[0].y);
    assert(Math.abs(center(model, child) - (center(model, parents[0]) + center(model, parents[1])) / 2) <= model.box.width * 2);
  }
  noOverlaps(model);
});

test('candidate records and separate families do not acquire a generation or a link to the root', () => {
  const input = fixture();
  for (const id of ['candidate-one', 'candidate-two', 'other-parent', 'other-child', 'third-parent', 'third-child']) input.persons.push({ id, name: `Fictional ${id}` });
  input.edges.push({ id: 'other-edge', a: 'other-parent', b: 'other-child', type: 'parent-child', confidence: 'hypothesis', evidence: [] },
    { id: 'third-edge', a: 'third-parent', b: 'third-child', type: 'parent-child', confidence: 'unknown', evidence: [] });
  const model = layoutFamily(input), primary = model.persons.filter(p => p.layoutComponent === 'main');
  for (const p of model.persons.filter(p => p.layoutComponent === 'other')) {
    assert.equal(p.generation, null);
    assert(p.x > Math.max(...primary.map(p => p.x + model.box.width)));
  }
  assert.equal(model.layoutZones.length, 1); assert.deepEqual(model.edges, input.edges); noOverlaps(model);
});

test('guardianship remains a social connection without assigning biological ancestry', () => {
  const input = fixture(); input.persons.push({ id: 'guardian', name: 'Fictional guardian' });
  input.edges.push({ id: 'guard', a: 'guardian', b: 'focus', type: 'guardian', confidence: 'documented', evidence: [] });
  const model = layoutFamily(input);
  assert.equal(people(model).get('guardian').generation, null);
  assert.equal(model.edges.find(e => e.id === 'guard').type, 'guardian'); noOverlaps(model);
});

test('layout preserves dossier data, evidence, conflicts, confidence and its input', () => {
  const input = fixture(); input.edges[0].confidence = 'hypothesis';
  input.edges[0].evidence = [{ claimId: 'synthetic-claim', conflicts: [{ status: 'open', description: 'Synthetic conflict' }] }];
  input.persons[0].photo = { path: 'assets/photos/synthetic.png', kind: 'original' };
  const saved = structuredClone(input), model = layoutFamily(input);
  assert.deepEqual(input, saved); assert.deepEqual(model.edges, saved.edges);
  for (const p of model.persons) {
    const original = saved.persons.find(other => other.id === p.id);
    for (const key of Object.keys(original)) assert.deepEqual(p[key], original[key]);
  }
});

test('person and edge input order do not change the layout', () => {
  const input = fixture(), first = layoutFamily(input);
  input.persons.reverse(); input.edges.reverse();
  const second = people(layoutFamily(input));
  for (const person of first.persons) { assert(Math.abs(person.x - second.get(person.id).x) < 0.00001, person.id); assert.equal(person.y, second.get(person.id).y); }
});

test('a root with descendants keeps younger generations below it', () => {
  const input = fixture(); input.persons.push({ id: 'child', name: 'Fictional child' });
  input.edges.push({ id: 'child-edge', a: 'focus', b: 'child', type: 'adoptive', confidence: 'reported', evidence: [] });
  const model = layoutFamily(input), p = people(model);
  assert.equal(p.get('child').generation, 1); assert(p.get('child').y > p.get('focus').y);
  assert.equal(model.edges.at(-1).type, 'adoptive'); noOverlaps(model);
});

test('impossible parent cycles still fail instead of drawing invented generations', () => {
  const input = fixture(); input.edges.push({ id: 'cycle', a: 'focus', b: 'deep-ancestor', type: 'parent-child' });
  assert.throws(() => layoutFamily(input), /цикл|поколением/);
});

test('a shared ancestor reached through different depths is retained with a layout warning', () => {
  const model = { rootPerson: 'root', persons: ['root', 'p1', 'p2', 'gp', 'shared'].map(id => ({ id, name: `Fictional ${id}` })), families: [],
    edges: [['p1', 'root'], ['p2', 'root'], ['shared', 'p1'], ['shared', 'gp'], ['gp', 'p2']].map(([a, b], i) => ({ id: `e${i}`, a, b, type: 'parent-child' })) };
  const output = layoutFamily(model), p = people(output);
  assert.equal(output.persons.length, model.persons.length); assert(output.layoutWarnings.length);
  for (const edge of output.edges) assert(p.get(edge.a).y < p.get(edge.b).y); noOverlaps(output);
});


test('unrelated families with overlapping spans use different horizontal channels', () => {
  const input = fixture(), model = layoutFamily(input), p = people(model);
  const parents = new Map();
  for (const e of model.edges.filter(e => e.type === 'parent-child')) {
    if (!parents.has(e.b)) parents.set(e.b, []);
    parents.get(e.b).push(e.a);
  }
  const family = e => parents.get(e.b).sort().join(':');
  const vertical = model.edges.filter(e => e.type === 'parent-child');
  for (const a of vertical) for (const b of vertical) {
    if (a.id >= b.id || family(a) === family(b)) continue;
    if (p.get(a.a).y !== p.get(b.a).y || p.get(a.b).y !== p.get(b.b).y) continue;
    const aa = [p.get(a.a).x, p.get(a.b).x].sort((x, y) => x - y), bb = [p.get(b.a).x, p.get(b.b).x].sort((x, y) => x - y);
    if (aa[0] <= bb[1] && bb[0] <= aa[1]) assert.notEqual(model.connectionRoutes[a.id].viaY, model.connectionRoutes[b.id].viaY);
  }
});
