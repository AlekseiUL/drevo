import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm, access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildPlan, validateCase, validateRegistry} from '../lib/planner.mjs';
const registry = JSON.parse(await readFile(new URL('../registry/resources.json', import.meta.url)));
const makeCase = () => ({schemaVersion: 1, title: 'Учебное дело', goal: 'Уточнить место захоронения', rootPersonId: 'p1', regions: ['russia', 'vologda'], period: {from: 1900, to: 2000}, people: [{id: 'p1', name: 'Учебный Персонаж', status: 'family-story', aliases: ['Учебный П.']}], questions: [{id: 'q1', personId: 'p1', question: 'Где похоронен?', recordTypes: ['burial'], priority: 'high'}], constraints: {freeFirst: true, allowPaid: false, browserAvailable: true}, completedSearches: []});
test('registry validates unique IDs, proof of checks and coverage', () => { assert.equal(validateRegistry(registry), registry); });
test('burial plan contains memorials, not unrelated records or a paid action', () => {
  const plan = buildPlan(makeCase(), registry);
  assert.ok(plan.freePlan.some(x => x.url.includes('memorial-map.ru')));
  assert.ok(plan.freePlan.length > 1);
  assert.ok(plan.freePlan.every(x => x.cost !== 'paid'));
  assert.ok(plan.paidOptions.every(x => x.actionStatus === 'proposal-only'));
  assert.ok(plan.freePlan.every(x => registry.resources.find(r => r.id === x.resourceId).recordTypes.includes('burial')));
});
test('unknown geography does not silently enable all regional archives', () => {
  const c = makeCase(); c.regions = ['unknown-region'];
  const plan = buildPlan(c, registry);
  assert.ok(plan.warnings.some(x => x.includes('unknown-region')));
  assert.ok(plan.freePlan.every(x => registry.resources.find(r => r.id === x.resourceId).regions.includes('worldwide')));
});
test('previous null search remains a bounded observation, not proof or entire-resource exclusion', () => {
  const c = makeCase(); const resourceId = buildPlan(c, registry).freePlan[0].resourceId;
  c.completedSearches = [{resourceId, personId: 'p1', query: 'Учебный Персонаж', result: 'not-found', checkedAt: '2026-11-11', coverage: 'Одна страница выдачи'}];
  const item = buildPlan(c, registry).freePlan.find(x => x.resourceId === resourceId);
  assert.equal(item.previousSearches.length, 1);
  assert.match(item.repeatPolicy, /новым основанием/);
});
test('invalid references, dates and duplicate people are rejected', () => {
  let c = makeCase(); c.questions[0].personId = 'absent'; assert.throws(() => validateCase(c));
  c = makeCase(); c.people.push(c.people[0]); assert.throws(() => validateCase(c));
  c = makeCase(); c.people[0].birth = {year: 2000}; c.people[0].death = {year: 1900}; assert.throws(() => validateCase(c));
});
test('browser unavailable is visible and never reported as completed search', () => {
  const c = makeCase(); c.constraints.browserAvailable = false;
  const plan = buildPlan(c, registry); assert.ok(plan.warnings.some(x => /Браузер недоступен/.test(x)));
  assert.ok(plan.freePlan.every(x => x.actionStatus === 'planned'));
});
test('init creates a blank case, refuses overwrites and repository locations', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'drevo-test-'));
  const cli = new URL('../bin/drevo.mjs', import.meta.url);
  try {
    const target = path.join(dir, 'case');
    const call = (...args) => spawnSync(process.execPath, [fileURLToPath(cli), ...args], {encoding: 'utf8'});
    const created = call('init', target); assert.equal(created.status, 0, created.stderr);
    const data = JSON.parse(await readFile(path.join(target, 'case.json'), 'utf8'));
    assert.deepEqual(data.people, []); assert.equal(data.constraints.allowPaid, false);
    await access(path.join(target, 'originals'));
    assert.notEqual(call('init', target).status, 0);
    const inRepo = fileURLToPath(new URL('../cases/test-should-not-exist', import.meta.url));
    assert.notEqual(call('init', inRepo).status, 0);
  } finally { await rm(dir, {recursive: true, force: true}); }
});
