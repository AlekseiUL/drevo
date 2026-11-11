/** Structural review of a research packet. No truth score and no automatic promotion. */
export function auditEvidence(packet) {
  const issues = [];
  const add = (severity, claimId, message) => issues.push({severity, claimId, message});
  const filled = value => typeof value === 'string' && value.trim().length > 0;
  const array = value => Array.isArray(value) ? value : [];
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (packet?.schemaVersion !== 1) add('error', null, 'Нужен schemaVersion: 1');
  if (!Array.isArray(packet?.sources) || !Array.isArray(packet?.claims)) add('error', null, 'Нужны массивы sources и claims');
  const sources = new Map();
  for (const s of array(packet?.sources)) {
    if (!object(s)) { add('error', null, 'Каждый источник должен быть объектом'); continue; }
    if (!filled(s.id) || sources.has(s.id)) add('error', null, `Повторный или пустой source.id: ${s.id}`);
    sources.set(s.id, s);
    if (!filled(s.title) || !filled(s.locator) || !filled(s.accessedAt)) add('error', null, `${s.id}: нужны title, locator и accessedAt для повторного нахождения документа`);
    if (s.url) {
      try { const url=new URL(s.url); if (!['https:','http:'].includes(url.protocol) || url.username || url.password) throw Error(); }
      catch { add('error',null,`${s.id}: URL должен быть HTTP(S) без учётных данных, либо пустым для офлайн-источника`); }
    }
    if (!['original', 'derivative', 'authored', 'unknown'].includes(s.form)) add('error', null, `${s.id}: неизвестный тип источника`);
    if (!filled(s.independenceGroup)) add('warning', null, `${s.id}: не установлено, независимо ли происхождение информации`);
  }
  const claimIds = new Set();
  for (const c of array(packet?.claims)) {
    if (!object(c)) { add('error', null, 'Каждое утверждение должно быть объектом'); continue; }
    if (!filled(c.id) || claimIds.has(c.id)) add('error', c.id, 'Повторный или пустой claim.id');
    claimIds.add(c.id);
    if (!filled(c.statement) || !array(c.personIds).length || !array(c.personIds).every(filled)) add('error', c.id, 'Нужны утверждение и непустые строки personIds');
    if (!['family-story', 'candidate', 'hypothesis', 'documented', 'concluded'].includes(c.status)) add('error', c.id, 'Неизвестный статус утверждения');
    for (const field of ['evidence', 'researchCoverage', 'conflicts']) if (array(c[field]).some(x => !object(x))) add('error', c.id, `Каждый элемент ${field} должен быть объектом`);
    const evidence = array(c.evidence).filter(object), coverage = array(c.researchCoverage).filter(object), conflicts = array(c.conflicts).filter(object);
    for (const field of ['evidence', 'researchCoverage', 'conflicts']) if (!Array.isArray(c[field])) add('error', c.id, `Нужен массив ${field}`);
    if (['documented', 'concluded'].includes(c.status) && !evidence.length) add('error', c.id, 'Документированное утверждение требует привязанных свидетельств');
    const groups = new Set();
    for (const e of evidence) {
      const s = sources.get(e.sourceId);
      if (!s) add('error', c.id, `Источник ${e.sourceId} отсутствует в sources`);
      else if (s.independenceGroup) groups.add(s.independenceGroup);
      if (!['primary', 'secondary', 'undetermined'].includes(e.information)) add('error', c.id, 'Не оценено происхождение конкретной информации');
      if (!['direct', 'indirect', 'negative'].includes(e.type)) add('error', c.id, 'Не указан тип свидетельства');
      if (!filled(e.reading) || !filled(e.reasoning)) add('error', c.id, 'Нужны раздельно прочтение и объяснение связи с утверждением');
      if (e.type === 'negative' && !filled(e.negativeScope)) add('error', c.id, 'Отрицательное свидетельство требует negativeScope: почему запись ожидалась и какое полное покрытие проверено');
    }
    if (evidence.length > 1 && groups.size < 2) add('warning', c.id, 'Несколько ссылок могут происходить из одного источника; их число не усиливает доказательство');
    for (const row of coverage) if (!filled(row.scope) || !filled(row.checkedAt) || !['found', 'not-found', 'blocked', 'not-searched'].includes(row.result)) add('error', c.id, 'В покрытии нужны scope, checkedAt и различимый результат проверки');
    for (const conflict of conflicts) {
      if (!filled(conflict.description) || !['open', 'resolved'].includes(conflict.status)) add('error', c.id, 'Некорректное описание противоречия');
      for (const id of array(conflict.sourceIds)) if (!sources.has(id)) add('error', c.id, `Противоречие ссылается на отсутствующий источник ${id}`);
      if (conflict.status === 'resolved' && !filled(conflict.resolution)) add('error', c.id, 'Разрешение противоречия требует объяснения');
    }
    if (c.status === 'concluded') {
      if (!coverage.length) add('error', c.id, 'Для вывода нужно описать охват исследования');
      if (!coverage.some(x => ['found', 'not-found'].includes(x.result))) add('error', c.id, 'Одни блокировки/непроверенные источники не подтверждают выполненное исследование');
      if (conflicts.some(x => x.status === 'open')) add('error', c.id, 'Открытое противоречие несовместимо с завершённым выводом');
      for (const key of ['text', 'reasoning', 'limitations', 'reviewedAt']) if (!filled(c.conclusion?.[key])) add('error', c.id, `Нет conclusion.${key}`);
    }
  }
  if (!array(packet?.claims).length) add('warning', null, 'Пакет пока не содержит утверждений');
  return {schemaVersion: 1,
    notice: 'Проверяется полнота и согласованность оформления. Это не установление родства, не оценка истинности и не сертификация соответствия GPS.',
    errors: issues.filter(x => x.severity === 'error').length,
    warnings: issues.filter(x => x.severity === 'warning').length, issues};
}
