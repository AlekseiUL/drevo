import { createHash } from 'node:crypto';
import { validateCase } from './planner.mjs';
import { auditEvidence } from './evidence.mjs';
import { validateDossiers, projectDossier } from './dossier.mjs';
import { validateFamily, publicFamily, layoutFamily } from '../skills/family-tree-studio/assets/viewer/scripts/model.mjs';

const types = ['parent-child', 'adoptive', 'guardian', 'partner', 'sibling'];
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const arr = x => Array.isArray(x) ? x : [];
export const digest = x => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const confidence = status => ({'family-story':'reported', documented:'documented', concluded:'documented', hypothesis:'hypothesis'})[status] || 'unknown';
const conflicted = c => arr(c.conflicts).some(x => x.status === 'open');

/** Cross-file checks are structural; they do not establish identity or kinship. */
export function auditCase(data, packet) {
  const report = auditEvidence(packet);
  const add = (claimId, message) => report.issues.push({severity:'error', claimId, message});
  try { validateCase(data); } catch (e) { add(null, e.message); }
  const people = new Set(arr(data?.people).map(x => x?.id));
  const treeFlags = (flags, owner) => {
    if (flags == null) return;
    if (!object(flags) || (flags.include != null && typeof flags.include !== 'boolean') || (flags.visibility != null && !['private','public'].includes(flags.visibility))) add(null, `Некорректные настройки tree: ${owner}`);
  };
  treeFlags(data?.tree, 'case');
  for (const p of arr(data?.people)) treeFlags(p?.tree, p?.id);
  for (const s of arr(packet?.sources)) if (s?.visibility != null && !['private','public'].includes(s.visibility)) add(null, `Неизвестная visibility источника ${s.id}`);
  for (const c of arr(packet?.claims)) {
    if (!object(c)) continue;
    treeFlags(c.tree, c.id);
    for (const id of arr(c.personIds)) if (!people.has(id)) add(c.id, `Человек ${id} отсутствует в case.json`);
    const a = c.assertion;
    if (a == null) { if (c.tree?.include) add(c.id, 'Для включения в дерево нужна явная assertion'); continue; }
    if (!object(a)) { add(c.id, 'assertion должна быть объектом'); continue; }
    let refs = [];
    if (a.kind === 'relationship') {
      refs = [a.from, a.to];
      if (!types.includes(a.relationshipType) || a.from === a.to) add(c.id, 'Некорректный тип или участники assertion.relationship');
    } else if (a.kind === 'event') {
      refs = [a.personId];
      if (!['birth','death'].includes(a.event) || !object(a.value)) add(c.id, 'Для события нужны birth/death и value');
      else {
        const v = a.value;
        if (!['year','date','yearCandidates','place'].some(k => v[k] != null && v[k] !== '')) add(c.id, 'Пустое значение события');
        if (v.place != null && typeof v.place !== 'string') add(c.id, 'Место события должно быть строкой');
        try { validateFamily({rootPerson:'check', persons:[{id:'check',name:'Проверка', ...eventFields(a.event,v)}]}); }
        catch (e) { add(c.id,e.message); }
      }
    } else add(c.id, 'Неизвестный kind утверждения');
    for (const id of refs) if (!people.has(id) || !arr(c.personIds).includes(id)) add(c.id, `Участник assertion ${id} должен присутствовать в case.people и claim.personIds`);
  }
  report.issues.push(...validateDossiers(data,packet));
  report.errors = report.issues.filter(x => x.severity === 'error').length;
  report.warnings = report.issues.filter(x => x.severity === 'warning').length;
  return report;
}

function eventFields(event, value = {}) {
  const result = {};
  for (const [source,suffix] of [['year','Year'],['date','Date'],['yearCandidates','YearCandidates'],['approximate','Approximate']]) if (value[source] != null) result[event+suffix] = value[source];
  return result;
}
function assertionLabel(a) {
  if (!a) return '';
  if (a.kind === 'relationship') return `${a.from} → ${a.to} · ${a.relationshipType}`;
  const v = a.value;
  return `${a.event === 'birth' ? 'Рождение' : 'Смерть'}: ${v.approximate ? 'примерно ' : ''}${v.date || v.year || v.yearCandidates?.join(' или ') || 'дата неизвестна'}${v.place ? `; ${v.place}` : ''}`;
}
function evidenceFor(c, sources) {
  return {claimId:c.id, statement:c.statement, status:c.status, assertionLabel:assertionLabel(c.assertion),
    sources:c.evidence.map(e => {
      const s = sources.get(e.sourceId);
      return {id:s.id,title:s.title,url:s.url || '',locator:s.locator,reading:e.reading,reasoning:e.reasoning,information:e.information,type:e.type,negativeScope:e.negativeScope || '',form:s.form,accessedAt:s.accessedAt};
    }),
    conflicts:c.conflicts.map(x => ({description:x.description,status:x.status,resolution:x.resolution || ''})),
    conclusion:c.conclusion ? {text:c.conclusion.text || '',reasoning:c.conclusion.reasoning || '',limitations:c.conclusion.limitations || ''} : null};
}

export function projectCase(data, packet, options = {}) {
  const audit = auditCase(data,packet);
  if (audit.errors) throw Error(audit.issues.filter(x => x.severity === 'error').map(x => `${x.claimId || 'case'}: ${x.message}`).join('\n'));
  const warnings = audit.issues.filter(x => x.severity === 'warning').map(x => `${x.claimId || 'case'}: ${x.message}`);
  const publicMode = options.public === true;
  const sources = new Map(packet.sources.map(s => [s.id,s]));
  const people = data.people.filter(p => p.status !== 'candidate' && p.tree?.include !== false && (!publicMode || p.tree?.visibility === 'public'));
  const included = new Set(people.map(p => p.id));
  if (!included.has(data.rootPersonId)) throw Error('Корневой человек должен быть включён в дерево; для --public требуется его tree.visibility: public');
  const persons = people.map(p => ({id:p.id,name:p.name,aliases:p.aliases || [],confidence:publicMode ? 'unknown' : confidence(p.status),
    ...(publicMode ? {} : {...eventFields('birth',p.birth || {}), ...eventFields('death',p.death || {})}),
    place:publicMode ? '' : [p.birth?.place,p.death?.place].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' · '), evidence:[]}));
  const byId = new Map(persons.map(p => [p.id,p])), connections = new Map(), events = new Map(), withheldRelations = new Set(), withheldEvents = new Set();
  const relationKey = a => JSON.stringify([a.relationshipType,...(['partner','sibling'].includes(a.relationshipType) ? [a.from,a.to].sort() : [a.from,a.to])]);
  for (const c of packet.claims.filter(c => c.tree?.include === true)) {
    if (c.status === 'candidate') { warnings.push(`${c.id}: кандидат не включён в дерево`); continue; }
    if (publicMode && (c.tree?.visibility !== 'public' || c.evidence.some(e => sources.get(e.sourceId).visibility !== 'public') || c.conflicts.some(x => arr(x.sourceIds).some(id => sources.get(id)?.visibility !== 'public')))) { warnings.push(`${c.id}: утверждение или источник не разрешены для публичной версии`); continue; }
    if (publicMode && c.personIds.some(id=>!included.has(id))) { warnings.push(`${c.id}: участник утверждения не разрешён для публичной версии`); continue; }
    const a = c.assertion, refs = a.kind === 'event' ? [a.personId] : [a.from,a.to];
    if (refs.some(id => !included.has(id))) { warnings.push(`${c.id}: участник не включён; связь или событие пропущены`); continue; }
    if ((c.status === 'hypothesis' || conflicted(c)) && !options.includeHypotheses) {
      if (a.kind === 'relationship') withheldRelations.add(relationKey(a)); else withheldEvents.add(`${a.personId}:${a.event}`);
      warnings.push(`${c.id}: гипотеза/открытое противоречие — нужен --include-hypotheses; отношение или событие целиком отложено`); continue;
    }
    const proof = evidenceFor(c,sources);
    if (publicMode && /(?:file:\/\/|\/Users\/|\/home\/|[A-Za-z]:\\)/.test(JSON.stringify(proof))) throw Error(`${c.id}: публичное свидетельство содержит путь к частному файлу; замените его архивным шифром`);
    if (a.kind === 'event') {
      const key = `${a.personId}:${a.event}`;
      if (!events.has(key)) events.set(key,[]);
      events.get(key).push({claim:c,proof,value:a.value});
    } else {
      const endpoints = ['partner','sibling'].includes(a.relationshipType) ? [a.from,a.to].sort() : [a.from,a.to];
      const key = JSON.stringify([a.relationshipType,...endpoints]);
      if (!connections.has(key)) connections.set(key,{id:`edge-${digest(key).slice(0,20)}`,a:endpoints[0],b:endpoints[1],type:a.relationshipType,confidence:'unknown',claimIds:[],evidence:[]});
      const edge = connections.get(key);
      edge.claimIds.push(c.id); edge.evidence.push(proof);
      // An unresolved hypothesis stays visible, even beside a more confident assertion.
      edge.confidence = edge.evidence.some(x => x.status === 'hypothesis' || x.conflicts.some(y => y.status === 'open')) ? 'hypothesis' : edge.evidence.some(x => ['documented','concluded'].includes(x.status)) ? 'documented' : 'reported';
    }
  }
  for (const key of withheldRelations) connections.delete(key);
  for (const key of withheldEvents) {
    events.delete(key);
    const [id,event] = key.split(':'), person = byId.get(id);
    for (const suffix of ['Year','Date','YearCandidates','Approximate']) delete person[event+suffix];
    person.confidence = 'hypothesis';
    person.publicNote = `${person.publicNote || ''}${event === 'birth' ? 'Рождение' : 'Смерть'}: выбранные утверждения требуют проверки; событие отложено. `;
  }
  for (const [key,rows] of events) {
    const [id,event] = key.split(':'), person = byId.get(id);
    const dated = rows.filter(r => r.value.date || r.value.year || r.value.yearCandidates);
    if (dated.length) {
      const dates = [...new Set(dated.map(r => r.value.date).filter(Boolean))];
      const years = [...new Set(dated.flatMap(r => r.value.yearCandidates || (r.value.date ? [Number(r.value.date.slice(0,4))] : r.value.year ? [r.value.year] : [])))].sort((a,b)=>a-b);
      if (dates.length > 1 && years.length === 1) throw Error(`${id}/${event}: расходятся точные даты одного года; разрешите противоречие или явно запишите год вместо точной даты`);
      const next = years.length > 1 ? {yearCandidates:years} : dates.length === 1 ? {date:dates[0]} : {year:years[0]};
      if (dated.some(r => r.value.approximate)) next.approximate = true;
      const previous = Object.fromEntries(Object.entries(person).filter(([k])=>k.startsWith(event)));
      for (const k of Object.keys(previous)) delete person[k];
      Object.assign(person,eventFields(event,next));
      if (Object.keys(previous).length && JSON.stringify(previous) !== JSON.stringify(eventFields(event,next))) warnings.push(`${id}/${event}: сводная дата заменена выбранными утверждениями; проверьте предпросмотр`);
      if (years.length > 1) warnings.push(`${id}/${event}: сохранены альтернативные годы ${years.join(' / ')}`);
    }
    const places = [...new Set(rows.map(r=>r.value.place).filter(Boolean))];
    if (places.length) person.publicNote = `${person.publicNote || ''}${event === 'birth' ? 'Рождение' : 'Смерть'} — место по утверждениям: ${places.join(' / ')}. `;
    person.evidence.push(...rows.map(r=>r.proof));
    if (person.evidence.some(c => c.status === 'hypothesis' || c.conflicts.some(x => x.status === 'open'))) person.confidence = 'hypothesis';
    else if (publicMode && person.confidence !== 'hypothesis') person.confidence = person.evidence.every(c => ['documented','concluded'].includes(c.status)) ? 'documented' : 'reported';
  }
  for (const p of people) byId.get(p.id).dossier = projectDossier(p,packet.claims,sources,publicMode,evidenceFor,included);
  const family = {title:publicMode && data.tree?.visibility !== 'public' ? 'Семейное древо' : data.title, demo:data.fictional === true,
    rootPerson:data.rootPersonId, persons, families:[],relationships:[],connections:[...connections.values()].sort((a,b)=>a.id.localeCompare(b.id))};
  if (publicMode && /(?:file:\/\/|\/Users\/|\/home\/|[A-Za-z]:\\)/.test(JSON.stringify(family))) throw Error('Публичная версия содержит путь к частному файлу; проверьте разрешённые поля');
  validateFamily(family); layoutFamily(publicFamily(family));
  return {family,warnings};
}
export function diffFamily(before, after) {
  const compare = (oldRows = [],newRows = []) => {
    const old = new Map(oldRows.map(x=>[x.id,x])), next = new Map(newRows.map(x=>[x.id,x]));
    const added=[...next.keys()].filter(id=>!old.has(id)), removed=[...old.keys()].filter(id=>!next.has(id)), updated=[...next.keys()].filter(id=>old.has(id)&&digest(old.get(id))!==digest(next.get(id)));
    return {added,removed,updated,details:[...added.map(id=>({id,before:null,after:next.get(id)})),...removed.map(id=>({id,before:old.get(id),after:null})),...updated.map(id=>({id,before:old.get(id),after:next.get(id)}))]};
  };
  return {people:compare(before?.persons,after.persons),connections:compare(before?.connections,after.connections),metadataChanged:before?.title!==after.title || before?.rootPerson!==after.rootPerson};
}
