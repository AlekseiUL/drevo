const costs = new Set(['free', 'freemium', 'paid']);
const statuses = new Set(['family-story', 'documented', 'candidate', 'hypothesis']);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const strings = value => Array.isArray(value) && value.every(x => typeof x === 'string' && x.trim());
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
export function validateRegistry(registry) {
  assert(registry.schemaVersion === 1, 'Нужен registry.schemaVersion: 1');
  assert(Array.isArray(registry.stages) && registry.stages.length > 0, 'Нет стадий поиска');
  const stages = new Set(registry.stages.map(s => s.id));
  assert(stages.size === registry.stages.length, 'Повторяются стадии');
  assert(registry.stages.every(s => nonempty(s.id) && nonempty(s.title) && Number.isFinite(s.order)), 'Некорректная стадия');
  assert(Array.isArray(registry.resources) && registry.resources.length > 0, 'Нет ресурсов');
  const ids = new Set();
  const regionParents = registry.regionParents || {};
  for (const region of Object.keys(regionParents)) {
    const seen = new Set(); let current = region;
    while (current) { assert(!seen.has(current), `Цикл географии: ${region}`); seen.add(current); current = regionParents[current]; }
  }
  for (const r of registry.resources) {
    assert(nonempty(r.id) && !ids.has(r.id), `Повторный/пустой resource.id: ${r.id}`); ids.add(r.id);
    assert(nonempty(r.name) && stages.has(r.stage) && costs.has(r.cost), `Некорректный ресурс: ${r.id}`);
    assert(strings(r.regions) && r.regions.length && strings(r.recordTypes) && r.recordTypes.length, `Нет покрытия: ${r.id}`);
    assert(Number.isFinite(r.priority), `Нет приоритета: ${r.id}`);
    for (const url of [r.url, ...(r.verification?.evidenceUrls || [])]) assert(/^https?:\/\//.test(url), `Нужен URL: ${r.id}`);
    assert(['verified', 'partial', 'not-checked'].includes(r.verification?.status), `Нет статуса проверки: ${r.id}`);
    assert(nonempty(r.verification?.note), `Нет пределов проверки: ${r.id}`);
    assert(nonempty(r.whenToUse) && strings(r.searchHints) && strings(r.limits), `Нет инструкции поиска: ${r.id}`);
    assert(r.access?.browser === true, `Нет браузерного маршрута: ${r.id}`);
  }
  return registry;
}
export function validateCase(data) {
  assert(data?.schemaVersion === 1, 'Нужен case.schemaVersion: 1');
  assert(nonempty(data.title), 'Нужно название дела (title)');
  assert(typeof data.goal === 'string', 'Нужно поле goal');
  assert(strings(data.regions), 'regions должен быть массивом кодов регионов');
  assert(Array.isArray(data.people), 'people должен быть массивом');
  const ids = new Set();
  for (const p of data.people) {
    assert(nonempty(p.id) && !ids.has(p.id), `Повторный/пустой person.id: ${p.id}`); ids.add(p.id);
    assert(nonempty(p.name) && statuses.has(p.status), `Нужны имя и статус человека: ${p.id}`);
    for (const field of ['aliases', 'places', 'occupations', 'institutions']) if (p[field] != null) assert(strings(p[field]), `Неверное ${p.id}.${field}`);
    for (const event of ['birth', 'death']) {
      const year = p[event]?.year;
      assert(year == null || (Number.isInteger(year) && year > 0 && year <= 9999), `Неверный год ${p.id}.${event}`);
    }
    if (p.birth?.year && p.death?.year) assert(p.death.year >= p.birth.year, `Смерть раньше рождения: ${p.id}`);
  }
  assert(data.rootPersonId == null || ids.has(data.rootPersonId), 'rootPersonId не найден');
  if (data.period) {
    for (const value of [data.period.from, data.period.to]) assert(value == null || (Number.isInteger(value) && value > 0 && value <= 9999), 'Некорректный период');
    if (data.period.from && data.period.to) assert(data.period.from <= data.period.to, 'Период перевёрнут');
  }
  assert(Array.isArray(data.questions), 'questions должен быть массивом');
  const qids = new Set();
  for (const q of data.questions) {
    assert(nonempty(q.id) && !qids.has(q.id), `Повторный/пустой question.id: ${q.id}`); qids.add(q.id);
    assert(ids.has(q.personId) && nonempty(q.question) && strings(q.recordTypes) && q.recordTypes.length > 0, `Неверный вопрос или пустые recordTypes: ${q.id}`);
    assert(['high', 'medium', 'low'].includes(q.priority), `Неверный приоритет: ${q.id}`);
  }
  assert(Array.isArray(data.completedSearches), 'completedSearches должен быть массивом');
  for (const s of data.completedSearches) {
    assert(nonempty(s.resourceId) && ids.has(s.personId) && typeof s.query === 'string', 'Неверная запись журнала');
    assert(['found', 'not-found', 'blocked', 'not-searched'].includes(s.result), 'Неверный результат поиска');
  }
  assert(data.constraints && typeof data.constraints.browserAvailable === 'boolean' && typeof data.constraints.allowPaid === 'boolean' && typeof data.constraints.freeFirst === 'boolean', 'Нужны constraints: browserAvailable, allowPaid, freeFirst');
  return data;
}

export function buildPlan(data, registry) {
  validateCase(data); validateRegistry(registry);
  const warnings = [];
  if (!data.constraints.browserAvailable) warnings.push('Браузер недоступен: можно подготовить план, но поиск и проверка сканов ещё не выполнены.');
  if (!data.goal.trim()) warnings.push('Сначала сформулируйте цель исследования.');
  if (!data.regions.length) warnings.push('Не задана география: показаны только международные источники, уточните места и юрисдикции.');
  if (!data.questions.length) warnings.push('Нет исследовательских вопросов: заполните интервью и добавьте хотя бы один вопрос.');
  const knownRegions = new Set([...registry.resources.flatMap(r => r.regions), ...Object.keys(registry.regionParents || {}), ...Object.values(registry.regionParents || {})]);
  const searchRegions = new Set(data.regions);
  for (const region of data.regions) {
    let parent = registry.regionParents?.[region];
    while (parent) { searchRegions.add(parent); parent = registry.regionParents?.[parent]; }
  }
  for (const r of data.regions) if (!knownRegions.has(r)) warnings.push(`В реестре нет региона ${r}: понадобится региональное исследование.`);
  const knownTypes = new Set(registry.resources.flatMap(r => r.recordTypes));
  for (const q of data.questions) for (const type of q.recordTypes) if (!knownTypes.has(type)) warnings.push(`Тип записи ${type} (${q.id}) не покрыт реестром.`);
  const stageOrder = new Map(registry.stages.map(s => [s.id, s.order]));
  const qOrder = { high: 0, medium: 1, low: 2 };
  const actions = [];
  for (const q of [...data.questions].sort((a, b) => qOrder[a.priority] - qOrder[b.priority])) {
    const p = data.people.find(x => x.id === q.personId);
    for (const r of registry.resources) {
      if (!r.regions.includes('worldwide') && !r.regions.some(x => searchRegions.has(x))) continue;
      if (!q.recordTypes.some(x => r.recordTypes.includes(x))) continue;
      const previous = data.completedSearches.filter(s => s.resourceId === r.id && s.personId === p.id);
      actions.push({questionId: q.id, question: q.question, personId: p.id, person: p.name,
        resourceId: r.id, name: r.name, url: r.url, stage: r.stage, cost: r.cost,
        priority: r.priority, whenToUse: r.whenToUse,
        queries: [...new Set([p.name, ...(p.aliases || [])])].map(name => [name, p.birth?.place || p.places?.[0], p.birth?.year].filter(Boolean).join(' ')),
        searchHints: r.searchHints, access: r.access, limits: r.limits, verification: r.verification,
        previousSearches: previous,
        repeatPolicy: previous.length ? 'Сравните параметры и уже проверенное покрытие. Повтор только с новым основанием; not-found не означает отсутствие человека.' : 'Новая проверка; зафиксируйте точный запрос, коллекцию, годы, страницы и результат.',
        actionStatus: r.cost === 'paid' ? 'proposal-only' : 'planned',
        paidAuthorization: r.cost === 'paid' ? (data.constraints.allowPaid ? 'Бюджет/коллекцию/срок подтвердить в поручении; флаг сам по себе не разрешает платёж.' : 'Платные действия не разрешены; только предложение после анализа бесплатного поиска.') : null});
    }
  }
  actions.sort((a, b) => qOrder[data.questions.find(q => q.id === a.questionId).priority] - qOrder[data.questions.find(q => q.id === b.questionId).priority] || stageOrder.get(a.stage) - stageOrder.get(b.stage) || a.priority - b.priority || a.name.localeCompare(b.name, 'ru'));
  for (const q of data.questions) if (!actions.some(a => a.questionId === q.id)) warnings.push(`Для вопроса ${q.id} нет подходящих ресурсов: уточните тип записи, географию или дополните реестр.`);
  return {schemaVersion: 1, title: data.title, goal: data.goal, registryUpdatedAt: registry.updatedAt,
    notice: 'Это очередь кандидатов по географии и типу записи, не выполненный поиск. Агент уточняет историческую юрисдикцию, годы, охват и ценность каждой проверки. Очерёдность не оценивает достоверность родства.',
    warnings, freePlan: actions.filter(a => a.cost !== 'paid'), paidOptions: actions.filter(a => a.cost === 'paid')};
}

export function formatPlan(plan) {
  const lines = [`# ${plan.title}`, '', plan.goal, '', plan.notice, '', ...plan.warnings.map(w => `Внимание: ${w}`), '', '## Бесплатный поиск и бесплатные части смешанных сервисов'];
  for (const a of plan.freePlan) {
    lines.push('', `### ${a.questionId} · ${a.name}${a.cost === 'freemium' ? ' (только бесплатная часть)' : ''}`, a.question,
      `Источник: ${a.url}`, `Зачем: ${a.whenToUse}`, `Начальные варианты: ${a.queries.join(' | ')}`,
      `Доступ: ${a.access.account}; проверка ресурса: ${a.verification.status}. ${a.verification.note}`,
      `Приёмы: ${a.searchHints.join(' ')}`, `Пределы: ${a.limits.join(' ')}`, a.repeatPolicy);
    for (const s of a.previousSearches) lines.push(`Уже в журнале: ${s.checkedAt || 'дата неизвестна'} · ${s.query} · ${s.result} · ${typeof s.coverage === 'string' ? s.coverage : JSON.stringify(s.coverage || null)}`);
  }
  lines.push('', '## Платный резерв — предложения, не задания на оплату', 'Прежде чем предложить оплату: какая запись нужна, где она доступна, что уже проверено бесплатно, полный расход и что даст отрицательный результат.');
  for (const a of plan.paidOptions) {
    lines.push('', `- ${a.questionId} · ${a.name}: ${a.url}`, `  ${a.whenToUse}`, `  ${a.paidAuthorization}`,
      `  Проверка: ${a.verification.status}. ${a.verification.note}`, `  Пределы: ${a.limits.join(' ')}`, `  ${a.repeatPolicy}`);
    for (const s of a.previousSearches) lines.push(`  Уже в журнале: ${s.checkedAt || 'дата неизвестна'} · ${s.query} · ${s.result} · ${typeof s.coverage === 'string' ? s.coverage : JSON.stringify(s.coverage || null)}`);
  }
  return lines.join('\n') + '\n';
}
