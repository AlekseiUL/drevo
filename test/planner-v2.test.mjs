import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildPlan, formatPlan, getActionKey, validateCase} from '../lib/planner.mjs';
const registry = JSON.parse(await readFile(new URL('../registry/resources.json', import.meta.url)));
const example = JSON.parse(await readFile(new URL('../templates/case.example.json', import.meta.url)));
const makeCase = () => ({schemaVersion: 1, title: 'Вымышленное исследование', goal: 'Проверить одну запись', rootPersonId: 'p1', regions: ['vologda'], period: {from: 1900, to: 2000}, people: [{id: 'p1', name: 'Тестовый Персонаж', aliases: [], status: 'family-story', birth: {year: 1912, place: 'Место рождения'}, death: {year: 1982, place: 'Место смерти'}, places: ['Общее место']}], questions: [{id: 'q1', personId: 'p1', question: 'Где запись?', recordTypes: ['burial'], priority: 'high', context: {event: 'burial', coverageId: 'index-v1'}}], constraints: {freeFirst: true, allowPaid: false, browserAvailable: true}, completedSearches: []});
const log = (a, result, more = {}) => ({resourceId: a.resourceId, personId: a.personId, actionKey: a.actionKey, query: a.queries[0], collectionId: a.context.collectionId, coverageId: a.context.coverageId, coverage: 'Полностью проверен запланированный охват учебного действия', result, checkedAt: '2026-11-11', ...more});
const allCandidates = plan => [...plan.freePlan, ...plan.paidOptions, ...plan.paidReserve];

test('default example exposes three next actions; full eligible queue is explicit', () => {
  const short = buildPlan(example, registry), full = buildPlan(example, registry, {all: true});
  assert.equal(short.nextActions.length, 3);
  assert.ok(short.reserve.length > 0);
  assert.equal(full.nextActions.length, full.freePlan.length);
  assert.equal(short.nextActions[0].resourceId, 'memorial-map');
  assert.ok(short.nextActions.every(a => a.questionIds.includes('q-burial')));
  assert.ok(formatPlan(short).length < formatPlan(full).length / 2);
  assert.ok(!formatPlan(short).includes('https://www.ancestry.com'));
});

test('resolved and paused questions do not produce new work', () => {
  const c = makeCase(); c.questions[0].status = 'resolved';
  c.questions.push({...c.questions[0], id: 'q2', status: 'paused'});
  const plan = buildPlan(c, registry);
  assert.equal(plan.nextActions.length, 0);
  assert.equal(plan.skippedQuestions.length, 2);
});

test('identical source/person/query/scope work serves multiple questions once', () => {
  const c = makeCase(), baseline = buildPlan(c, registry);
  c.questions.push({...structuredClone(c.questions[0]), id: 'q2', question: 'Как сверить даты?'});
  const plan = buildPlan(c, registry);
  assert.equal(plan.freePlan.length, baseline.freePlan.length);
  assert.ok(plan.freePlan.every(a => a.questionIds.length === 2));
  assert.equal(new Set(plan.freePlan.map(a => a.actionKey)).size, plan.freePlan.length);
});

test('event-specific context overrides case geography and uses matching event dates', () => {
  const c = makeCase(); c.questions[0].context = {event: 'death', regions: ['arkhangelsk']};
  const plan = buildPlan(c, registry), item = plan.freePlan.find(a => a.resourceId === 'pomnim-online');
  assert.ok(item.queries[0].includes('Место смерти'));
  assert.ok(item.queries[0].includes('1982'));
  assert.ok(!item.queries[0].includes('1912'));
  assert.ok(!allCandidates(plan).some(a => a.resourceId === 'memorial-map'));
  c.questions[0].context = {event: 'birth', regions: ['vologda']}; c.questions[0].recordTypes = ['civil'];
  const birth = buildPlan(c, registry).freePlan[0];
  assert.ok(birth.queries[0].includes('Место рождения'));
  assert.ok(birth.queries[0].includes('1912'));
});

test('employment query uses institution and explicit historical place without inventing jurisdiction', () => {
  const c = makeCase(); c.questions[0].recordTypes = ['employment'];
  c.questions[0].context = {event: 'employment', place: 'Историческое название', institution: 'Учебная школа', period: {from: 1950, to: 1960}, jurisdiction: 'Учебный район, по семейному документу'};
  const a = buildPlan(c, registry).freePlan[0];
  assert.match(a.queries[0], /Учебная школа работа 1950–1960/);
  assert.equal(a.context.jurisdiction, c.questions[0].context.jurisdiction);
});

test('known war-event periods filter incompatible collections; birth year is not service year', () => {
  const c = makeCase(); c.questions[0].recordTypes = ['military'];
  c.questions[0].context = {event: 'military', period: {from: 1916, to: 1916}};
  let plan = buildPlan(c, registry);
  assert.ok(plan.freePlan.some(a => a.resourceId === 'gwar'));
  assert.ok(!plan.freePlan.some(a => a.resourceId === 'pamyat-naroda'));
  assert.ok(!plan.freePlan.some(a => a.resourceId === 'obd-memorial'));
  c.questions[0].context.period = {from: 1943, to: 1943};
  plan = buildPlan(c, registry);
  assert.ok(!plan.freePlan.some(a => a.resourceId === 'gwar'));
  assert.ok(plan.freePlan.some(a => a.resourceId === 'pamyat-naroda'));
  assert.equal(c.people[0].birth.year, 1912);
});

test('unknown collection period remains explicitly unknown, not invented coverage', () => {
  const c = makeCase(); c.questions[0].recordTypes = ['photographs'];
  c.questions[0].context = {event: 'general', period: {from: 1700, to: 1800}};
  const plan = buildPlan(c, registry);
  assert.ok(!plan.freePlan.some(a => a.resourceId === 'russia-in-photo'));
  const unknown = plan.freePlan.find(a => a.resourceId === 'pastvu');
  assert.equal(unknown.coverageStatus, 'period-unknown');
  assert.match(unknown.coverageNote, /не установлен/);
});

test('exact completed action survives JSON round trip and is not proposed again', () => {
  const c = makeCase(), first = buildPlan(c, registry).nextActions[0];
  assert.equal(getActionKey(JSON.parse(JSON.stringify(first))), first.actionKey);
  c.completedSearches = [log(first, 'not-found')];
  const again = buildPlan(JSON.parse(JSON.stringify(c)), registry);
  assert.ok(again.completed.some(a => a.actionKey === first.actionKey));
  assert.ok(!again.freePlan.some(a => a.actionKey === first.actionKey));
  assert.ok(again.freePlan.some(a => a.resourceId !== first.resourceId));
});

test('new query, collection, or coverage reopens only the changed scoped action', () => {
  for (const patch of [{query: 'Новый вариант запроса'}, {collectionId: 'another-book'}, {coverageId: 'index-v2'}]) {
    const c = makeCase(), first = buildPlan(c, registry).nextActions[0];
    c.completedSearches = [log(first, 'found')]; Object.assign(c.questions[0].context, patch);
    const again = buildPlan(c, registry), item = again.freePlan.find(a => a.resourceId === first.resourceId);
    assert.ok(item); assert.notEqual(item.actionKey, first.actionKey);
  }
});

test('blocked action stays separate until a new reason is supplied and consumed', () => {
  const c = makeCase(), first = buildPlan(c, registry).nextActions[0];
  c.completedSearches = [log(first, 'blocked')];
  assert.ok(buildPlan(c, registry).blocked.some(a => a.actionKey === first.actionKey));
  c.questions[0].context.repeatReason = 'Пользователь предоставил обычную авторизованную сессию';
  assert.ok(buildPlan(c, registry).freePlan.some(a => a.actionKey === first.actionKey));
  c.completedSearches.push(log(first, 'not-found', {repeatReason: c.questions[0].context.repeatReason}));
  const finished = buildPlan(c, registry);
  assert.ok(finished.completed.some(a => a.actionKey === first.actionKey));
  assert.ok(!finished.freePlan.some(a => a.actionKey === first.actionKey));
});

test('one legacy query never exhausts all collections of a site', () => {
  const c = makeCase(), first = buildPlan(c, registry).nextActions[0];
  c.completedSearches = [{resourceId: first.resourceId, personId: first.personId, query: first.queries[0], result: 'not-found', coverage: 'Только первая страница'}];
  assert.ok(buildPlan(c, registry).freePlan.some(a => a.resourceId === first.resourceId));
  c.completedSearches[0].coverageId = c.questions[0].context.coverageId;
  assert.ok(buildPlan(c, registry).completed.some(a => a.resourceId === first.resourceId));
});

test('paid catalog candidates require a specific collection/reason/resource before being proposals', () => {
  const c = makeCase(); c.questions[0].recordTypes = ['immigration']; c.questions[0].context = {event: 'general'};
  const unqualified = buildPlan(c, registry, {paid: true});
  assert.equal(unqualified.paidOptions.length, 0);
  assert.ok(unqualified.paidReserve.length > 0);
  assert.ok(!formatPlan(unqualified).includes('https://www.ancestry.com'));
  Object.assign(c.questions[0].context, {paidResourceId: 'ancestry-paid', collectionId: 'fictional-collection', paidReason: 'Учебная запись найдена в индексе, оригинал доступен в этой коллекции'});
  const qualified = buildPlan(c, registry, {paid: true});
  assert.deepEqual(qualified.paidOptions.map(a => a.resourceId), ['ancestry-paid']);
  assert.ok(formatPlan(qualified).includes('https://www.ancestry.com'));
  assert.ok(!formatPlan(buildPlan(c, registry)).includes('https://www.ancestry.com'));
  assert.equal(qualified.paidOptions[0].actionStatus, 'proposal-only');
});

test('new optional context is validated and the original case stays unchanged', () => {
  const c = makeCase(), original = JSON.stringify(c);
  buildPlan(c, registry); assert.equal(JSON.stringify(c), original);
  c.questions[0].context.period = {from: 2000, to: 1900}; assert.throws(() => validateCase(c));
  assert.throws(() => buildPlan(makeCase(), registry, {limit: 0}));
});

test('birth year searched inside a military record does not become the service period', () => {
  const c = makeCase(); c.questions[0].recordTypes = ['military'];
  c.questions[0].context = {event: 'birth', period: {from: 1912, to: 1912}};
  const plan = buildPlan(c, registry);
  for (const id of ['pamyat-naroda', 'gwar', 'obd-memorial']) {
    const item = plan.freePlan.find(a => a.resourceId === id);
    assert.ok(item, id);
    assert.equal(item.coverageStatus, 'period-needs-context');
  }
});

test('one legacy query cannot retire an action containing several name variants', () => {
  const c = makeCase(); c.people[0].aliases = ['Другой учебный вариант имени'];
  const first = buildPlan(c, registry).nextActions[0];
  c.completedSearches = [{resourceId: first.resourceId, personId: first.personId, query: first.queries[0], collectionId: first.context.collectionId, coverageId: first.context.coverageId, result: 'not-found', coverage: 'Проверен только первый вариант имени'}];
  const plan = buildPlan(c, registry);
  assert.ok(plan.freePlan.some(a => a.actionKey === first.actionKey));
  assert.ok(!plan.completed.some(a => a.actionKey === first.actionKey));
});
