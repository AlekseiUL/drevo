import path from 'node:path';

export const CERTAINTIES = new Set(['documented', 'reported', 'hypothesis', 'unknown']);
const IDENTIFIER = /^[a-zA-Z0-9_-]{1,80}$/;
const relationTypes = new Set(['parent-child', 'adoptive', 'guardian']);
const connectionTypes = new Set([...relationTypes, 'partner', 'sibling']);
const claimStatuses = new Set(['family-story', 'candidate', 'hypothesis', 'documented', 'concluded']);
const informationTypes = new Set(['primary', 'secondary', 'undetermined']);
const evidenceTypes = new Set(['direct', 'indirect', 'negative']);
const sourceForms = new Set(['original', 'derivative', 'authored', 'unknown']);
const text = value => typeof value === 'string' ? value : '';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
function validateEvidence(evidence, owner) {
  if (evidence == null) return;
  if (!Array.isArray(evidence)) throw Error(`Свидетельства должны быть массивом: ${owner}`);
  const ids = new Set();
  for (const claim of evidence) {
    if (!record(claim) || !nonempty(claim.claimId) || ids.has(claim.claimId) || !nonempty(claim.statement) || !claimStatuses.has(claim.status)) throw Error(`Некорректное утверждение: ${owner}`);
    ids.add(claim.claimId);
    if (claim.assertionLabel != null && typeof claim.assertionLabel !== 'string') throw Error(`Подпись исходного утверждения должна быть строкой: ${claim.claimId}`);
    if (!Array.isArray(claim.sources) || !Array.isArray(claim.conflicts)) throw Error(`Нужны sources и conflicts: ${claim.claimId}`);
    for (const source of claim.sources) {
      if (!record(source) || !nonempty(source.id) || !nonempty(source.title)) throw Error(`Некорректный источник: ${claim.claimId}`);
      for (const key of ['url', 'locator', 'reading', 'reasoning', 'negativeScope', 'accessedAt']) if (source[key] != null && typeof source[key] !== 'string') throw Error(`Некорректное поле источника ${key}`);
      if (source.information && !informationTypes.has(source.information)) throw Error('Неизвестный тип происхождения информации');
      if (source.type && !evidenceTypes.has(source.type)) throw Error('Неизвестный тип свидетельства');
      if (source.form && !sourceForms.has(source.form)) throw Error('Неизвестная форма источника');
    }
    for (const conflict of claim.conflicts) if (!record(conflict) || !nonempty(conflict.description) || !['open', 'resolved'].includes(conflict.status) || (conflict.resolution != null && typeof conflict.resolution !== 'string')) throw Error(`Некорректное противоречие: ${claim.claimId}`);
    if (claim.conclusion != null && (!record(claim.conclusion) || ['text', 'reasoning', 'limitations'].some(key => claim.conclusion[key] != null && typeof claim.conclusion[key] !== 'string'))) throw Error(`Некорректный вывод: ${claim.claimId}`);
  }
}
export function publicEvidence(evidence = []) {
  return evidence.map(claim => ({
    claimId: claim.claimId, statement: claim.statement, status: claim.status, assertionLabel: text(claim.assertionLabel),
    sources: claim.sources.map(source => ({ id: source.id, title: source.title, url: webLink(source.url), locator: text(source.locator), reading: text(source.reading), reasoning: text(source.reasoning), negativeScope: text(source.negativeScope), accessedAt: text(source.accessedAt), form: source.form || null, information: source.information || null, type: source.type || null })),
    conflicts: claim.conflicts.map(conflict => ({ description: conflict.description, status: conflict.status, resolution: text(conflict.resolution) })),
    conclusion: claim.conclusion ? { text: text(claim.conclusion.text), reasoning: text(claim.conclusion.reasoning), limitations: text(claim.conclusion.limitations) } : null,
  }));
}
function dateCaption(person, event) {
  const alternatives = person[event + 'YearCandidates'];
  const value = person[event + 'Date'] || (alternatives ? alternatives.join(' или ') : person[event + 'Year'] ? String(person[event + 'Year']) : '');
  return value ? (person[event + 'Approximate'] ? '≈ ' : '') + value : '';
}
function dateBounds(person, event) {
  if (person[event + 'Approximate']) return null; // An unspecified approximation has no defensible exact boundary.
  const date = person[event + 'Date'];
  if (date) return [date, date];
  const years = person[event + 'YearCandidates'] || (person[event + 'Year'] ? [person[event + 'Year']] : []);
  if (!years.length) return null;
  return [String(Math.min(...years)).padStart(4, '0') + '-01-01', String(Math.max(...years)).padStart(4, '0') + '-12-31'];
}
export function webLink(value) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : null; }
  catch { return null; }
}
export function photoPath(value) {
  if (typeof value !== 'string' || !/^assets\/photos\/[a-zA-Z0-9_./-]+\.(png|jpe?g|webp|avif)$/i.test(value) || value.split('/').some(part => part === '..' || part === '.')) throw Error('Фотография должна быть локальным растровым файлом внутри public/assets/photos/');
  return value;
}
export function validateFamily(input) {
  if (!input || !Array.isArray(input.persons) || !input.persons.length) throw Error('Нужен массив persons хотя бы с одним человеком');
  const known = new Set();
  for (const p of input.persons) {
    if (!IDENTIFIER.test(p.id) || known.has(p.id)) throw Error('Повторный или неверный идентификатор человека');
    if (!text(p.name).trim()) throw Error(`У ${p.id} отсутствует имя`);
    known.add(p.id);
    if (p.confidence && !CERTAINTIES.has(p.confidence)) throw Error(`Неверное основание у ${p.id}`);
    for (const key of ['birthYear', 'deathYear']) if (p[key] != null && (!Number.isInteger(p[key]) || p[key] < 1 || p[key] > 9999)) throw Error(`Некорректный ${key} у ${p.id}`);
    for (const key of ['birthDate', 'deathDate']) if (p[key]) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p[key]) || Number.isNaN(Date.parse(p[key])) || new Date(p[key]).toISOString().slice(0, 10) !== p[key]) throw Error(`Некорректная дата у ${p.id}`);
    }
    for (const event of ['birth', 'death']) {
      const alternatives = p[event + 'YearCandidates'], year = p[event + 'Year'], date = p[event + 'Date'];
      if (p[event + 'Approximate'] != null && typeof p[event + 'Approximate'] !== 'boolean') throw Error(`Признак приблизительности должен быть boolean: ${p.id}`);
      if (alternatives != null && (!Array.isArray(alternatives) || alternatives.length < 2 || new Set(alternatives).size !== alternatives.length || alternatives.some(y => !Number.isInteger(y) || y < 1 || y > 9999))) throw Error(`Некорректные альтернативные годы у ${p.id}`);
      if (alternatives && (year || date)) throw Error(`Укажите либо альтернативные годы, либо одну дату у ${p.id}`);
      if (date && year && Number(date.slice(0, 4)) !== year) throw Error(`Год расходится с точной датой у ${p.id}`);
    }
    if (p.lifeStatus === 'living' && (p.deathDate || p.deathYear || p.deathYearCandidates)) throw Error(`Живой человек имеет дату смерти: ${p.id}`);
    const born = dateBounds(p, 'birth'), died = dateBounds(p, 'death');
    if (born && died && born[0] > died[1]) throw Error(`Смерть раньше рождения: ${p.id}`);
    if (p.portrait?.kind && !['none', 'original', 'generated', 'selected'].includes(p.portrait.kind)) throw Error('Неизвестное происхождение фотографии');
    if (p.portrait?.path) photoPath(p.portrait.path);
    validateEvidence(p.evidence, p.id);
  }
  if (!known.has(input.rootPerson)) throw Error('rootPerson должен указывать на существующего человека');
  const recordIds = new Set();
  for (const key of ['families', 'relationships', 'connections']) if (input[key] != null && !Array.isArray(input[key])) throw Error(`${key} должен быть массивом`);
  for (const f of input.families || []) {
    if (!IDENTIFIER.test(f.id) || recordIds.has(f.id)) throw Error('Неверный идентификатор семьи');
    recordIds.add(f.id);
    const adults = f.parents || f.partners || [], kids = f.children || [];
    if (!Array.isArray(adults) || !adults.length || !Array.isArray(kids)) throw Error(`Неверный состав семьи ${f.id}`);
    if (new Set([...adults, ...kids]).size !== adults.length + kids.length) throw Error(`Повторный участник или родитель совпадает с ребёнком в ${f.id}`);
    for (const id of [...adults, ...kids]) if (!known.has(id)) throw Error(`Нет человека ${id}`);
    if (f.confidence && !CERTAINTIES.has(f.confidence)) throw Error('Неверное основание связи');
    if (f.relationshipType && !relationTypes.has(f.relationshipType)) throw Error('Неизвестный тип семейной связи');
  }
  for (const r of input.relationships || []) {
    if (!IDENTIFIER.test(r.id) || recordIds.has(r.id) || r.kind !== 'sibling' || !known.has(r.a) || !known.has(r.b) || r.a === r.b) throw Error('Некорректная связь братьев или сестёр');
    recordIds.add(r.id);
    if (r.confidence && !CERTAINTIES.has(r.confidence)) throw Error('Неверное основание связи');
  }
  const connections = new Set();
  for (const c of input.connections || []) {
    if (!record(c) || !IDENTIFIER.test(c.id) || recordIds.has(c.id) || !known.has(c.a) || !known.has(c.b) || c.a === c.b) throw Error('Некорректный идентификатор или участник связи');
    recordIds.add(c.id);
    if (!connectionTypes.has(c.type) || !CERTAINTIES.has(c.confidence)) throw Error(`Неизвестный тип или статус связи: ${c.id}`);
    const endpoints = ['partner', 'sibling'].includes(c.type) ? [c.a, c.b].sort() : [c.a, c.b];
    const identity = JSON.stringify([c.type, ...endpoints]);
    if (connections.has(identity)) throw Error('Повторное отношение: объедините утверждения в evidence одной связи');
    connections.add(identity);
    if (c.claimIds != null && (!Array.isArray(c.claimIds) || c.claimIds.some(id => !nonempty(id)) || new Set(c.claimIds).size !== c.claimIds.length)) throw Error('claimIds должен содержать уникальные идентификаторы');
    validateEvidence(c.evidence, c.id);
    if (c.evidence?.some(claim => c.claimIds && !c.claimIds.includes(claim.claimId))) throw Error(`Свидетельство не указано в claimIds: ${c.id}`);
  }
  return input;
}

// The public projection is explicit. Research notes, source files and references never cross it.
export function publicFamily(raw) {
  validateFamily(raw);
  const persons = raw.persons.map(p => ({
    id: p.id, name: p.name, aliases: Array.isArray(p.aliases) ? p.aliases.filter(x => typeof x === 'string') : [],
    birth: dateCaption(p, 'birth'),
    death: dateCaption(p, 'death'),
    lifeStatus: ['living', 'deceased'].includes(p.lifeStatus) ? p.lifeStatus : 'unknown',
    place: text(p.place), confidence: p.confidence || 'unknown', publicNote: text(p.publicNote),
    sourceLabel: text(p.sourceLabel),
    sources: (Array.isArray(p.publicSources) ? p.publicSources : []).filter(s => s && webLink(s.url)).map(s => ({ label: text(s.label) || 'Источник', url: webLink(s.url) })),
    evidence: publicEvidence(p.evidence || []),
    photo: p.portrait?.path && p.portrait.kind && p.portrait.kind !== 'none' ? { path: photoPath(p.portrait.path), kind: p.portrait.kind } : null,
  }));
  const families = (raw.families || []).map(f => ({ id: f.id, adults: f.parents || f.partners, children: f.children || [], type: f.relationshipType || 'parent-child', confidence: f.confidence || 'unknown', label: text(f.label) }));
  const siblings = (raw.relationships || []).map(r => ({ id: r.id, a: r.a, b: r.b, type: 'sibling', confidence: r.confidence || 'unknown' }));
  const edges = [];
  for (const f of families) {
    if (f.children.length) for (const a of f.adults) for (const b of f.children) edges.push({ id: `${f.id}-${a}-${b}`, a, b, type: f.type, confidence: f.confidence, family: f.id });
    else for (let i = 1; i < f.adults.length; i++) edges.push({ id: `${f.id}-${i}`, a: f.adults[0], b: f.adults[i], type: 'partner', confidence: f.confidence, family: f.id });
  }
  edges.push(...siblings);
  edges.push(...(raw.connections || []).map(c => ({ id: c.id, a: c.a, b: c.b, type: c.type, confidence: c.confidence, claimIds: c.claimIds || (c.evidence || []).map(e => e.claimId), evidence: publicEvidence(c.evidence || []) })));
  const edgeIds = new Set(), edgeKeys = new Set();
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) throw Error('Повторный идентификатор ребра'); edgeIds.add(edge.id);
    const endpoints = ['sibling', 'partner'].includes(edge.type) ? [edge.a, edge.b].sort() : [edge.a, edge.b];
    const key = JSON.stringify([edge.type, ...endpoints]);
    if (edgeKeys.has(key)) throw Error('Повторная связь между legacy-данными и connections'); edgeKeys.add(key);
    edge.claimIds ||= []; edge.evidence ||= [];
  }
  return { title: text(raw.title) || 'Семейное древо', demo: raw.demo === true, rootPerson: raw.rootPerson, persons, families, edges };
}

export function layoutFamily(model) {
  const groups = new Map(model.persons.map(p => [p.id, p.id]));
  const combine = ids => {
    const labels = new Set(ids.map(id => groups.get(id)));
    for (const [id, group] of groups) if (labels.has(group)) groups.set(id, groups.get(ids[0]));
  };
  for (const f of model.families) combine(f.adults);
  for (const e of model.edges) if (['sibling', 'partner'].includes(e.type)) combine([e.a, e.b]);
  // Align co-parents for layout only; do not invent a partnership edge between them.
  const coParents = new Map();
  for (const edge of model.edges) if (['parent-child', 'adoptive'].includes(edge.type)) { if (!coParents.has(edge.b)) coParents.set(edge.b, []); coParents.get(edge.b).push(edge.a); }
  for (const ids of coParents.values()) combine(ids);
  const levels = new Map([...groups.values()].map(id => [id, 0]));
  const vertical = model.edges.filter(e => !['sibling', 'partner'].includes(e.type));
  for (const e of vertical) if (groups.get(e.a) === groups.get(e.b)) throw Error('Родительская связь конфликтует с одним поколением');
  for (let step = 0; step <= levels.size; step++) {
    let changed = false;
    for (const e of vertical) {
      const a = groups.get(e.a), b = groups.get(e.b), needed = levels.get(a) + 1;
      if (levels.get(b) < needed) { levels.set(b, needed); changed = true; }
    }
    if (!changed) break;
    if (step === levels.size) throw Error('Обнаружен цикл родительских связей');
  }
  const rows = new Map();
  for (const p of model.persons) { const level = levels.get(groups.get(p.id)); if (!rows.has(level)) rows.set(level, []); rows.get(level).push(p); }
  const box = { width: 230, height: 170 }, horizontal = 296, verticalGap = 310;
  const width = Math.max(950, ...[...rows.values()].map(row => row.length * horizontal + 180));
  for (const [level, row] of rows) {
    row.sort((a, b) => groups.get(a.id).localeCompare(groups.get(b.id)) || a.id.localeCompare(b.id));
    row.forEach((p, index) => { p.x = (width - row.length * horizontal) / 2 + index * horizontal + 33; p.y = 140 + level * verticalGap; });
  }
  return { ...model, width, height: 140 + Math.max(...rows.keys()) * verticalGap + box.height + 220, box };
}

export function contained(base, file) { return file.startsWith(path.resolve(base) + path.sep); }
