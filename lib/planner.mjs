import {createHash} from 'node:crypto';

const costs = new Set(['free', 'freemium', 'paid']);
const statuses = new Set(['family-story', 'documented', 'candidate', 'hypothesis']);
const events = new Set(['general', 'birth', 'death', 'burial', 'marriage', 'employment', 'military', 'residence']);
const results = new Set(['found', 'not-found', 'blocked', 'not-searched']);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const strings = value => Array.isArray(value) && value.every(nonempty);
const normalized = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const unique = values => [...new Set(values)];
const periodValid = (period, label) => {
  assert(object(period), `Некорректный период: ${label}`);
  for (const value of [period.from, period.to]) assert(value == null || (Number.isInteger(value) && value > 0 && value <= 9999), `Некорректный год: ${label}`);
  assert(period.from == null || period.to == null || period.from <= period.to, `Период перевёрнут: ${label}`);
};
export function validateRegistry(registry) {
  assert(registry?.schemaVersion === 1, 'Нужен registry.schemaVersion: 1');
  assert(Array.isArray(registry.stages) && registry.stages.length, 'Нет стадий поиска');
  assert(registry.stages.every(s => object(s) && nonempty(s.id) && nonempty(s.title) && Number.isFinite(s.order)), 'Некорректная стадия');
  const stages = new Set(registry.stages.map(s => s.id));
  assert(stages.size === registry.stages.length, 'Повторяются стадии');
  assert(Array.isArray(registry.resources) && registry.resources.length, 'Нет ресурсов');
  const ids = new Set(), parents = registry.regionParents || {};
  assert(object(parents), 'regionParents должен быть объектом');
  for (const [region, parent] of Object.entries(parents)) {
    assert(nonempty(region) && nonempty(parent), 'Пустая связь географии');
    const seen = new Set(); let current = region;
    while (current) { assert(!seen.has(current), `Цикл географии: ${region}`); seen.add(current); current = parents[current]; }
  }
  for (const r of registry.resources) {
    assert(object(r) && nonempty(r.id) && !ids.has(r.id), 'Повторный/пустой resource.id'); ids.add(r.id);
    assert(nonempty(r.name) && stages.has(r.stage) && costs.has(r.cost), `Некорректный ресурс: ${r.id}`);
    assert(strings(r.regions) && r.regions.length && strings(r.recordTypes) && r.recordTypes.length, `Нет покрытия: ${r.id}`);
    assert(Number.isFinite(r.priority), `Нет приоритета: ${r.id}`);
    for (const url of [r.url, ...(r.verification?.evidenceUrls || [])]) assert(typeof url === 'string' && /^https?:\/\//.test(url), `Нужен URL: ${r.id}`);
    assert(['verified', 'partial', 'not-checked'].includes(r.verification?.status) && nonempty(r.verification?.note), `Нет пределов проверки: ${r.id}`);
    assert(nonempty(r.whenToUse) && strings(r.searchHints) && strings(r.limits), `Нет инструкции поиска: ${r.id}`);
    assert(r.access?.browser === true, `Нет браузерного маршрута: ${r.id}`);
    if (r.recordPeriod) {
      periodValid(r.recordPeriod, r.id);
      if (r.recordPeriod.eventTypes != null) assert(strings(r.recordPeriod.eventTypes) && r.recordPeriod.eventTypes.every(x => events.has(x)), `Неверное основание временного охвата: ${r.id}`);
      assert(nonempty(r.recordPeriod.note) && strings(r.recordPeriod.evidenceUrls) && r.recordPeriod.evidenceUrls.length, `Нет основания временного охвата: ${r.id}`);
    }
    if (r.routeFile != null) assert(nonempty(r.routeFile) && !r.routeFile.startsWith('/') && !r.routeFile.split('/').includes('..'), `Некорректный routeFile: ${r.id}`);
  }
  return registry;
}
export function validateCase(data) {
  assert(data?.schemaVersion === 1, 'Нужен case.schemaVersion: 1');
  assert(nonempty(data.title) && typeof data.goal === 'string', 'Нужны title и goal');
  assert(strings(data.regions), 'regions должен быть массивом кодов регионов');
  assert(Array.isArray(data.people), 'people должен быть массивом');
  const ids = new Set();
  for (const p of data.people) {
    assert(object(p) && nonempty(p.id) && !ids.has(p.id), 'Повторный/пустой person.id'); ids.add(p.id);
    assert(nonempty(p.name) && statuses.has(p.status), `Нужны имя и статус человека: ${p.id}`);
    for (const field of ['aliases', 'places', 'occupations', 'institutions']) if (p[field] != null) assert(strings(p[field]), `Неверное ${p.id}.${field}`);
    for (const event of ['birth', 'death']) {
      if (p[event] != null) assert(object(p[event]), `Неверное событие ${p.id}.${event}`);
      const year = p[event]?.year;
      assert(year == null || (Number.isInteger(year) && year > 0 && year <= 9999), `Неверный год ${p.id}.${event}`);
      if (p[event]?.place != null) assert(typeof p[event].place === 'string', `Неверное место ${p.id}.${event}`);
    }
    assert(!p.birth?.year || !p.death?.year || p.death.year >= p.birth.year, `Смерть раньше рождения: ${p.id}`);
  }
  assert(data.rootPersonId == null || ids.has(data.rootPersonId), 'rootPersonId не найден');
  if (data.period) periodValid(data.period, 'case');
  assert(Array.isArray(data.questions), 'questions должен быть массивом');
  const qids = new Set();
  for (const q of data.questions) {
    assert(object(q) && nonempty(q.id) && !qids.has(q.id), 'Повторный/пустой question.id'); qids.add(q.id);
    assert(ids.has(q.personId) && nonempty(q.question) && strings(q.recordTypes) && q.recordTypes.length, `Неверный вопрос или пустые recordTypes: ${q.id}`);
    assert(['high', 'medium', 'low'].includes(q.priority), `Неверный приоритет: ${q.id}`);
    assert(q.status == null || ['open', 'resolved', 'paused'].includes(q.status), `Неверный статус вопроса: ${q.id}`);
    if (q.context != null) {
      assert(object(q.context), `Неверный context: ${q.id}`);
      const x = q.context;
      if (x.event != null) assert(events.has(x.event), `Неизвестное событие: ${q.id}`);
      if (x.regions != null) assert(strings(x.regions), `Неверная география вопроса: ${q.id}`);
      if (x.period != null) periodValid(x.period, q.id);
      for (const field of ['place', 'institution', 'jurisdiction', 'query', 'collectionId', 'coverageId', 'repeatReason', 'paidReason', 'paidResourceId']) if (x[field] != null) assert(typeof x[field] === 'string', `Неверное context.${field}: ${q.id}`);
    }
  }
  assert(Array.isArray(data.completedSearches), 'completedSearches должен быть массивом');
  for (const s of data.completedSearches) {
    assert(object(s) && nonempty(s.resourceId) && ids.has(s.personId) && typeof s.query === 'string', 'Неверная запись журнала');
    assert(results.has(s.result), 'Неверный результат поиска');
    for (const field of ['actionKey', 'collectionId', 'coverageId', 'repeatReason']) if (s[field] != null) assert(typeof s[field] === 'string', `Неверное поле журнала ${field}`);
  }
  assert(data.constraints && ['browserAvailable', 'allowPaid', 'freeFirst'].every(k => typeof data.constraints[k] === 'boolean'), 'Нужны constraints: browserAvailable, allowPaid, freeFirst');
  return data;
}

function expandRegions(regions, registry) {
  const expanded = new Set(regions);
  for (const region of regions) { let parent = registry.regionParents?.[region]; while (parent) { expanded.add(parent); parent = registry.regionParents?.[parent]; } }
  return expanded;
}
function contextFor(q, p, data) {
  const x = q.context || {};
  let event = x.event;
  if (!event) event = q.recordTypes.includes('burial') ? 'burial' : q.recordTypes.includes('employment') ? 'employment' : q.recordTypes.includes('military') ? 'military' : 'general';
  // Only explicit birth/death questions may use the person's matching year as the event period.
  const life = event === 'birth' ? p.birth : ['death', 'burial'].includes(event) ? p.death : null;
  const period = x.period || (life?.year ? {from: life.year, to: life.year} : data.period) || {from: null, to: null};
  return {event, period: {from: period.from ?? null, to: period.to ?? null}, regions: x.regions ?? data.regions,
    place: x.place ?? life?.place ?? p.places?.[0] ?? '', institution: x.institution ?? p.institutions?.[0] ?? '',
    jurisdiction: x.jurisdiction || '', query: x.query || '', collectionId: x.collectionId || '', coverageId: x.coverageId || '',
    repeatReason: x.repeatReason || '', paidReason: x.paidReason || '', paidResourceId: x.paidResourceId || ''};
}
const periodText = p => p.from == null && p.to == null ? 'годы не уточнены' : p.from === p.to ? String(p.from) : `${p.from ?? '?'}–${p.to ?? '?'}`;
function queriesFor(p, context) {
  if (context.query) return [context.query.trim()];
  const tag = {birth: 'рождение', death: 'смерть', burial: 'захоронение', marriage: 'брак', employment: 'работа', military: 'служба', residence: 'проживание', general: ''}[context.event];
  return unique([p.name, ...(p.aliases || [])]).map(name => [name, context.place, context.institution, tag, context.period.from != null || context.period.to != null ? periodText(context.period) : ''].filter(Boolean).join(' '));
}
export function getActionKey(action) {
  // This identifies one planned scope, not an entire person or website. Question IDs are deliberately omitted.
  const identity = [action.resourceId, action.personId, action.queries.map(normalized).sort(), action.context.event,
    action.context.period.from, action.context.period.to, [...action.context.regions].sort(), normalized(action.context.place),
    normalized(action.context.institution), normalized(action.context.jurisdiction), action.context.collectionId, action.context.coverageId];
  return 'search-v2-' + createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24);
}
function exactHistory(action, row) {
  if (row.actionKey) return row.actionKey === action.actionKey;
  // Old unscoped logs remain visible but cannot retire an entire route. Explicit IDs allow exact legacy matching.
  return action.queries.length === 1 && nonempty(action.context.coverageId) && row.coverageId === action.context.coverageId &&
    (row.collectionId || '') === action.context.collectionId && action.queries.some(q => normalized(q) === normalized(row.query));
}
function priorityScore(action) {
  const preferred = {
    burial: ['memorials', 'records', 'archives', 'local-context', 'discovery'],
    death: ['memorials', 'records', 'archives', 'local-context', 'discovery'],
    birth: ['records', 'archives', 'discovery', 'local-context', 'memorials'],
    marriage: ['records', 'archives', 'discovery', 'local-context', 'memorials'],
    employment: ['archives', 'local-context', 'discovery', 'records', 'memorials'],
    military: ['records', 'archives', 'local-context', 'discovery', 'memorials'],
    residence: ['records', 'archives', 'discovery', 'local-context', 'memorials'],
    general: ['records', 'archives', 'discovery', 'local-context', 'memorials']
  }[action.context.event];
  const index = preferred.indexOf(action.stage);
  return (index < 0 ? 6 : index) * 100 + action.priority * 10 + (action.regionalMatch ? 0 : 3) + (action.verification.status === 'verified' ? 0 : 2);
}
function paidReady(action) { return nonempty(action.context.paidReason) && nonempty(action.context.collectionId) && action.context.paidResourceId === action.resourceId; }

export function buildPlan(data, registry, options = {}) {
  validateCase(data); validateRegistry(registry);
  const display = {all: options.all === true, paid: options.paid === true, limit: options.limit ?? 3};
  assert(Number.isInteger(display.limit) && display.limit > 0 && display.limit <= 100, 'limit должен быть целым числом от 1 до 100');
  const warnings = [], excluded = [], merged = new Map();
  if (!data.constraints.browserAvailable) warnings.push('Браузер недоступен: план подготовлен, поиск и проверка сканов ещё не выполнены.');
  if (!data.goal.trim()) warnings.push('Сначала сформулируйте цель исследования.');
  if (!data.questions.length) warnings.push('Нет исследовательских вопросов: заполните интервью и добавьте хотя бы один вопрос.');
  const knownRegions = new Set([...registry.resources.flatMap(r => r.regions), ...Object.keys(registry.regionParents || {}), ...Object.values(registry.regionParents || {})]);
  const knownTypes = new Set(registry.resources.flatMap(r => r.recordTypes));
  const qOrder = {high: 0, medium: 1, low: 2};
  const openQuestions = data.questions.filter(q => !q.status || q.status === 'open').sort((a, b) => qOrder[a.priority] - qOrder[b.priority]);
  for (const [questionOrder, q] of openQuestions.entries()) {
    const p = data.people.find(x => x.id === q.personId), context = contextFor(q, p, data), regions = expandRegions(context.regions, registry);
    if (!regions.size) warnings.push(`${q.id}: не задана география; показаны международные входы, покрытие места нужно уточнить.`);
    for (const region of context.regions) if (!knownRegions.has(region)) warnings.push(`${q.id}: в реестре нет региона ${region}; требуется уточнить хранителя.`);
    for (const type of q.recordTypes) if (!knownTypes.has(type)) warnings.push(`Тип записи ${type} (${q.id}) не покрыт реестром.`);
    let matches = 0;
    for (const r of registry.resources) {
      if (!r.regions.includes('worldwide') && !r.regions.some(x => regions.has(x))) continue;
      if (!q.recordTypes.some(x => r.recordTypes.includes(x))) continue;
      const rp = r.recordPeriod, qp = context.period;
      const matchingTimeBasis = rp?.eventTypes?.includes(context.event) === true;
      if (matchingTimeBasis && ((rp.to != null && qp.from != null && qp.from > rp.to) || (rp.from != null && qp.to != null && qp.to < rp.from))) {
        excluded.push({questionId: q.id, resourceId: r.id, reason: `Период вопроса ${periodText(qp)} вне описанного маршрута ${periodText(rp)}.`, recordPeriod: rp}); continue;
      }
      matches++;
      const action = {questionId: q.id, questionIds: [q.id], question: q.question, questions: [q.question], questionOrder, personId: p.id, person: p.name,
        resourceId: r.id, name: r.name, url: r.url, stage: r.stage, cost: r.cost, priority: r.priority, whenToUse: r.whenToUse,
        context, queries: queriesFor(p, context), queryFields: {names: unique([p.name, ...(p.aliases || [])]), place: context.place, institution: context.institution, event: context.event, period: context.period}, searchHints: r.searchHints, access: r.access, limits: r.limits, verification: r.verification,
        routeFile: r.routeFile || null, regionalMatch: r.regions.some(region => context.regions.includes(region) && registry.regionParents?.[region]),
        coverageStatus: rp ? (matchingTimeBasis ? 'period-described' : 'period-needs-context') : 'period-unknown', recordPeriod: rp || null,
        coverageNote: rp ? (matchingTimeBasis ? `${rp.note} Пересечение лет не подтверждает наличие конкретной коллекции или записи.` : `${rp.note} Период этого источника и событие ${context.event} относятся к разным основаниям времени; маршрут не исключён, нужно уточнить период самого документа.`) : 'Временной охват конкретной коллекции не установлен; сначала проверить её место, годы и образы.',
        nextStep: nonempty(context.collectionId) ? `Открыть коллекцию ${context.collectionId} и проверить выбранный охват.` : 'Сначала проверить покрытие места и лет; затем выполнить запланированные запросы и сохранить фактически проверенный охват.',
        expectedValue: r.whenToUse, actionStatus: r.cost === 'paid' ? 'proposal-only' : 'planned',
        previousSearches: data.completedSearches.filter(s => s.resourceId === r.id && s.personId === p.id),
        paidAuthorization: r.cost === 'paid' ? 'Предложение требует проверки цены, условий и конкретного поручения; план и allowPaid не разрешают платёж.' : null};
      action.actionKey = getActionKey(action);
      const same = merged.get(action.actionKey);
      if (same) {
        same.questionIds = unique([...same.questionIds, q.id]); same.questions = unique([...same.questions, q.question]);
        if (!same.context.repeatReason && context.repeatReason) same.context = {...same.context, repeatReason: context.repeatReason};
        if (!paidReady(same) && paidReady(action)) same.context = {...same.context, paidReason: context.paidReason, paidResourceId: context.paidResourceId};
      } else merged.set(action.actionKey, action);
    }
    if (!matches) warnings.push(`Для вопроса ${q.id} нет подходящих ресурсов: уточните тип записи, географию, период или дополните реестр.`);
  }
  const freePlan = [], completed = [], blocked = [], paidOptions = [], paidReserve = [];
  for (const action of merged.values()) {
    const exact = action.previousSearches.filter(s => exactHistory(action, s));
    // Journal append order is authoritative; dates may be missing in legacy records.
    const last = exact.at(-1), repeat = nonempty(action.context.repeatReason) && normalized(action.context.repeatReason) !== normalized(last?.repeatReason);
    action.repeatPolicy = action.previousSearches.length ? 'Повтор только с новым основанием, запросом или охватом; прошлый not-found не закрывает сайт целиком.' : 'Новая проверка; сохраните actionKey, запрос, коллекцию, охват и результат.';
    if (last && !repeat && ['found', 'not-found'].includes(last.result)) {
      action.actionStatus = 'completed'; action.lastResult = last.result; completed.push(action);
    } else if (last && !repeat && last.result === 'blocked') {
      action.actionStatus = 'blocked'; action.lastResult = last.result; blocked.push(action);
    } else if (action.cost === 'paid') {
      (paidReady(action) ? paidOptions : paidReserve).push(action);
    } else freePlan.push(action);
  }
  const sort = (a, b) => a.questionOrder - b.questionOrder || priorityScore(a) - priorityScore(b) || a.name.localeCompare(b.name, 'ru');
  for (const group of [freePlan, completed, blocked, paidOptions, paidReserve]) group.sort(sort);
  const nextActions = display.all ? [...freePlan] : freePlan.slice(0, display.limit);
  return {schemaVersion: 1, plannerVersion: 2, title: data.title, goal: data.goal, registryUpdatedAt: registry.updatedAt, display,
    notice: 'Это план следующего прохода, не выполненный поиск. Порядок отражает полезность маршрута для вопроса, а не достоверность родства.',
    warnings: unique(warnings), focusQuestionId: nextActions[0]?.questionId || null,
    nextActions, reserve: display.all ? [] : freePlan.slice(display.limit), freePlan, completed, blocked, paidOptions, paidReserve, excluded,
    skippedQuestions: data.questions.filter(q => ['resolved', 'paused'].includes(q.status)).map(q => ({id: q.id, status: q.status}))};
}

function describeAction(a, verbose) {
  const lines = [`### ${a.questionIds.join(', ')} · ${a.name}${a.cost === 'freemium' ? ' (бесплатная часть)' : ''}`,
    a.questions.join(' / '), `Источник: ${a.url}`, `Следующий шаг: ${a.nextStep}`, `Зачем: ${a.expectedValue}`,
    `Запросы: ${a.queries.join(' | ')}`, `Период: ${periodText(a.context.period)}. ${a.coverageNote}`,
    `Доступ: ${a.access.account}; ${a.verification.status}. ${a.verification.note}`];
  if (a.routeFile) lines.push(`Маршрут браузера: ${a.routeFile}`);
  if (a.context.jurisdiction) lines.push(`Историческое подчинение со слов дела: ${a.context.jurisdiction}`);
  if (verbose) lines.push(`Приёмы: ${a.searchHints.join(' ')}`, `Пределы: ${a.limits.join(' ')}`, a.repeatPolicy);
  if (a.context.repeatReason) lines.push(`Основание повторного прохода: ${a.context.repeatReason}`);
  if (a.cost === 'paid') lines.push(`Основание предложения: ${a.context.paidReason}`, a.paidAuthorization);
  lines.push(`Ключ для журнала: ${a.actionKey}`);
  if (verbose) for (const s of a.previousSearches) lines.push(`Уже в журнале: ${s.checkedAt || 'дата неизвестна'} · ${s.query} · ${s.result} · ${typeof s.coverage === 'string' ? s.coverage : JSON.stringify(s.coverage || null)}`);
  return lines;
}
export function formatPlan(plan) {
  const display = plan.display || {all: false, paid: false};
  const lines = [`# ${plan.title}`, '', plan.goal, '', plan.notice, '', ...plan.warnings.map(w => `Внимание: ${w}`), '', display.all ? '## Все доступные бесплатные действия' : '## Следующие действия'];
  for (const action of plan.nextActions || plan.freePlan) lines.push('', ...describeAction(action, display.all));
  if (!(plan.nextActions || plan.freePlan).length) lines.push('Новых бесплатных действий нет. Посмотрите завершённые/заблокированные проверки и уточните следующий вопрос или охват.');
  lines.push('', `Резерв: ${plan.reserve?.length || 0}. Завершённые проверки: ${plan.completed?.length || 0}. Заблокированы: ${plan.blocked?.length || 0}.`, 'Полный план: --all. Платные предложения с конкретным основанием: --paid.');
  if (display.all) {
    for (const [title, group] of [['Завершённые проверки этого охвата', plan.completed], ['Препятствия доступа', plan.blocked]]) {
      if (group?.length) { lines.push('', `## ${title}`); for (const action of group) lines.push('', ...describeAction(action, true)); }
    }
    if (plan.excluded?.length) lines.push('', `По несовместимому периоду пропущено маршрутов: ${plan.excluded.length}. Подробности доступны в JSON.`);
  }
  if (display.all || display.paid) {
    lines.push('', '## Обоснованные платные предложения — не задания на оплату');
    for (const action of plan.paidOptions) lines.push('', ...describeAction(action, true));
    if (!plan.paidOptions.length) lines.push('Обоснованных предложений пока нет: нужны точный ресурс, коллекция и причина покупки в контексте вопроса.');
    if (plan.paidReserve?.length) lines.push(`Ещё ${plan.paidReserve.length} кандидатов без подтверждённой предпосылки скрыты. Список сервисов: sources --paid.`);
  }
  return lines.join('\n') + '\n';
}
