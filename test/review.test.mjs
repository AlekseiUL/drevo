import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm, symlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {buildPlan, validateCase, formatPlan} from '../lib/planner.mjs';
import {auditEvidence} from '../lib/evidence.mjs';
const registry = JSON.parse(await readFile(new URL('../registry/resources.json', import.meta.url)));
const makeCase = () => ({schemaVersion: 1, title: 'Вымышленное дело', goal: 'Уточнить кадровый след', rootPersonId: 'p1', regions: ['arkhangelsk'], people: [{id: 'p1', name: 'Учебный Персонаж', status: 'family-story'}], questions: [{id: 'q1', personId: 'p1', question: 'Какое учреждение хранит документы?', recordTypes: ['employment'], priority: 'high'}], constraints: {freeFirst: true, allowPaid: false, browserAvailable: true}, completedSearches: []});

test('regional case gets its national sources without unrelated regional archives', () => {
  const plan = buildPlan(makeCase(), registry);
  const ids = new Set([...plan.freePlan, ...plan.paidOptions].map(r => r.resourceId));
  assert.ok(ids.has('dvinaland'));
  assert.ok(ids.has('uiad-catalog'), 'regional geography should expand upward to russia');
  assert.ok(!ids.has('vologda-archives'));
  assert.ok(!ids.has('gavo-paid'));
});

test('country-only case does not claim coverage in every regional archive', () => {
  const c = makeCase(); c.regions = ['russia']; c.questions[0].recordTypes = ['burial', 'employment'];
  const plan = buildPlan(c, registry);
  const ids = new Set([...plan.freePlan, ...plan.paidOptions].map(r => r.resourceId));
  assert.ok(ids.has('pomnim-online'));
  for (const id of ['memorial-map', 'dvinaland', 'vologda-archives', 'gaao-paid', 'gavo-paid']) assert.ok(!ids.has(id), id);
});

test('question with no record types is rejected instead of silently producing no tasks', () => {
  const c = makeCase(); c.questions[0].recordTypes = [];
  assert.throws(() => validateCase(c));
});

test('human-readable paid proposal retains access failures and resource limits', () => {
  const c = makeCase(); c.regions = ['worldwide']; c.questions[0].recordTypes = ['immigration'];
  c.questions[0].context = {collectionId: 'fictional-collection', paidResourceId: 'ancestry-paid', paidReason: 'Вымышленная проверка: нужная запись обнаружена в коллекции, бесплатный оригинал недоступен.'};
  const plan = buildPlan(c, registry, {paid: true}), ancestry = plan.paidOptions.find(x => x.resourceId === 'ancestry-paid');
  assert.ok(ancestry);
  const markdown = formatPlan(plan);
  assert.ok(markdown.includes(ancestry.verification.note), '403 status must not disappear from human-readable proposal');
  for (const limit of ancestry.limits) assert.ok(markdown.includes(limit));
});

test('evidence audit reports malformed array members without crashing', () => {
  for (const packet of [
    {schemaVersion: 1, sources: [null], claims: []},
    {schemaVersion: 1, sources: [], claims: [null]},
    {schemaVersion: 1, sources: [], claims: [{id: 'c1', statement: 'Вымышленный факт', personIds: ['p1'], status: 'candidate', evidence: [null], researchCoverage: [], conflicts: []}]},
    {schemaVersion: 1, sources: [], claims: [{id: 'c1', statement: 'Вымышленный факт', personIds: ['p1'], status: 'candidate', evidence: [], researchCoverage: [null], conflicts: [null]}]}
  ]) {
    let report;
    assert.doesNotThrow(() => { report = auditEvidence(packet); });
    assert.ok(report.errors > 0);
  }
});

test('evidence person references must be nonempty strings', () => {
  const packet = {schemaVersion: 1, sources: [], claims: [{id: 'c1', statement: 'Вымышленный факт', personIds: [null], status: 'candidate', evidence: [], researchCoverage: [], conflicts: []}]};
  assert.ok(auditEvidence(packet).errors > 0);
});

test('init refuses a target reached through a symlink into the public repository', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'drevo-link-review-'));
  try {
    const repository = fileURLToPath(new URL('../', import.meta.url));
    const link = path.join(dir, 'repository-link');
    await symlink(repository, link, 'dir');
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/drevo.mjs', import.meta.url)), 'init', path.join(link, 'test-private-must-not-exist')], {encoding: 'utf8'});
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /вне публичного репозитория/);
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('init includes the blank search journal required by the research workflow', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'drevo-journal-review-'));
  try {
    const target = path.join(dir, 'case');
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/drevo.mjs', import.meta.url)), 'init', target], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    const journal = await readFile(path.join(target, 'search-log.csv'), 'utf8');
    assert.match(journal, /coverage,result/);
    assert.equal(journal.trim().split('\n').length, 1, 'new journal must not include fictional search results');
  } finally { await rm(dir, {recursive: true, force: true}); }
});
