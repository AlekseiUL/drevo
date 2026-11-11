import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { projectCase, auditCase } from '../lib/projection.mjs';
import { previewTree, applyTree, undoTree } from '../lib/tree-store.mjs';

const load = async name => JSON.parse(await readFile(new URL(`../templates/${name}.example.json`,import.meta.url),'utf8'));
const fixture = async () => ({data:await load('case'),packet:await load('evidence')});
const clone = x => structuredClone(x);
const claim = (packet,id,assertion,status='family-story') => ({...clone(packet.claims[0]),id,assertion,status,personIds:assertion.kind==='event'?[assertion.personId]:[assertion.from,assertion.to]});
async function caseFolder(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(),'drevo-v2-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const {data,packet}=await fixture();
  await writeFile(path.join(dir,'case.json'),JSON.stringify(data));
  await writeFile(path.join(dir,'evidence.json'),JSON.stringify(packet));
  return {dir,data,packet};
}

test('an explicit assertion projects a single sourced edge without inferring from patronymics',async()=>{
  const {data,packet}=await fixture();
  const result=projectCase(data,packet);
  assert.equal(result.family.connections.length,1);
  assert.equal(result.family.connections[0].a,'sergey');
  assert.equal(result.family.connections[0].b,'vera');
  assert.equal(result.family.connections[0].confidence,'reported');
  assert.match(result.family.connections[0].evidence[0].sources[0].locator,/Демонстрационный/);
  assert.equal(projectCase(data,{...packet,claims:[]}).family.connections.length,0);
  assert.ok(!JSON.stringify(result.family).includes('notes'));
});
test('unknown people, mismatched assertion references and untyped selected claims fail cross-audit',async()=>{
  const {data,packet}=await fixture();
  packet.claims[0].assertion.from='stranger';
  assert.ok(auditCase(data,packet).errors>0);
  assert.throws(()=>projectCase(data,packet),/stranger/);
  delete packet.claims[0].assertion;
  assert.throws(()=>projectCase(data,packet),/assertion/);
});
test('candidates and hypotheses are never silently promoted',async()=>{
  const {data,packet}=await fixture();
  packet.claims[0].status='hypothesis';
  assert.equal(projectCase(data,packet).family.connections.length,0);
  assert.equal(projectCase(data,packet,{includeHypotheses:true}).family.connections[0].confidence,'hypothesis');
  data.people[1].status='candidate';
  assert.equal(projectCase(data,packet,{includeHypotheses:true}).family.connections.length,0);
  assert.equal(projectCase(data,packet).family.persons.length,1);
});
test('each parent has its own confidence; co-parents are not an invented partnership',async()=>{
  const {data,packet}=await fixture();
  data.people.push({...clone(data.people[1]),id:'anna',name:'Анна Учебная'});
  packet.claims.push(claim(packet,'mother',{kind:'relationship',from:'anna',to:'vera',relationshipType:'parent-child'},'documented'));
  const family=projectCase(data,packet).family;
  assert.equal(family.connections.length,2);
  assert.deepEqual(family.connections.map(x=>x.confidence).sort(),['documented','reported']);
  assert.equal(family.families.length,0);
});
test('same edge merges citations with stable identity; open conflict stays hypothesis',async()=>{
  const {data,packet}=await fixture();
  const original=projectCase(data,packet).family.connections[0].id;
  const second=clone(packet.claims[0]); second.id='second'; second.status='documented';
  second.conflicts=[{description:'Разное отчество',status:'open',sourceIds:['demo-interview']}];packet.claims.push(second);
  const family=projectCase(data,packet,{includeHypotheses:true}).family;
  assert.equal(family.connections.length,1); assert.equal(family.connections[0].id,original);
  assert.equal(family.connections[0].confidence,'hypothesis'); assert.equal(family.connections[0].evidence.length,2);
});
test('contradictory event years survive as alternatives and approximate dates stay approximate',async()=>{
  const {data,packet}=await fixture();
  packet.claims.push(claim(packet,'born1',{kind:'event',personId:'sergey',event:'birth',value:{year:1917,approximate:true}}));
  packet.claims.push(claim(packet,'born2',{kind:'event',personId:'sergey',event:'birth',value:{year:1918}}));
  const person=projectCase(data,packet).family.persons.find(x=>x.id==='sergey');
  assert.deepEqual(person.birthYearCandidates,[1917,1918]);assert.equal(person.birthApproximate,true);assert.equal(person.birthYear,undefined);assert.equal(person.evidence.length,2);
  packet.claims[1].assertion.value={date:'1918-01-02'};packet.claims[2].assertion.value={date:'1918-02-02'};
  assert.throws(()=>projectCase(data,packet),/точные даты/);
});
test('cycles fail before a proposed tree is written',async()=>{
  const {data,packet}=await fixture();
  packet.claims.push(claim(packet,'reverse',{kind:'relationship',from:'vera',to:'sergey',relationshipType:'parent-child'}));
  assert.throws(()=>projectCase(data,packet),/цикл/);
});
test('public projection requires explicit permission for every person, claim and source',async()=>{
  const {data,packet}=await fixture();
  delete data.tree;
  assert.equal(projectCase(data,packet,{public:true}).family.title,'Семейное древо');
  delete packet.sources[0].visibility;
  assert.equal(projectCase(data,packet,{public:true}).family.connections.length,0);
  assert.equal(projectCase(data,packet).family.connections.length,1);
  delete data.people[0].tree;
  assert.throws(()=>projectCase(data,packet,{public:true}),/Корневой/);
});
test('public projection rejects local file paths, but local evidence retains offline locators',async()=>{
  const {data,packet}=await fixture();
  packet.sources[0].locator='/Users/example/private/document.pdf';packet.sources[0].url='';
  assert.throws(()=>projectCase(data,packet,{public:true}),/частному файлу/);
  assert.match(projectCase(data,packet).family.connections[0].evidence[0].sources[0].locator,/Users/);
});
test('preview/apply builds a complete viewer; second apply and two undos preserve original research',async t=>{
  const {dir,data}=await caseFolder(t);
  const originalEvidence=await readFile(path.join(dir,'evidence.json'),'utf8');
  await assert.rejects(applyTree(dir),/Сначала/);
  const firstPreview=await previewTree(dir);assert.equal(firstPreview.diff.connections.added.length,1);
  const first=await applyTree(dir);
  const bundle=JSON.parse(await readFile(path.join(first.viewerDir,'dist/tree.json'),'utf8'));
  assert.ok(bundle);
  await assert.rejects(applyTree(dir),/устарел/);
  data.people[0].name='Вера Учебная';await writeFile(path.join(dir,'case.json'),JSON.stringify(data));
  const next=await previewTree(dir);assert.deepEqual(next.diff.people.updated,['vera']);
  const second=await applyTree(dir);assert.notEqual(first.revisionId,second.revisionId);
  const undone=await undoTree(dir);assert.equal(undone.revisionId,first.revisionId);
  const empty=await undoTree(dir);assert.equal(empty.revisionId,null);
  assert.equal(await readFile(path.join(dir,'evidence.json'),'utf8'),originalEvidence);
  assert.equal(JSON.parse(await readFile(path.join(dir,'case.json'),'utf8')).people[0].name,'Вера Учебная');
  assert.ok(await readFile(path.join(second.viewerDir,'dist/index.html')));
});
test('stale and modified previews cannot change the current tree',async t=>{
  const {dir,data}=await caseFolder(t);
  await previewTree(dir);
  data.title='Изменённое дело';await writeFile(path.join(dir,'case.json'),JSON.stringify(data));
  await assert.rejects(applyTree(dir),/устарел/);
  const preview=await previewTree(dir);preview.family.persons[0].name='Подмена';
  await writeFile(path.join(dir,'.drevo/tree-preview.json'),JSON.stringify(preview));
  await assert.rejects(applyTree(dir),/изменён/);
});
test('an invalid subsequent claim leaves the previously built tree intact',async t=>{
  const {dir,packet}=await caseFolder(t);
  await previewTree(dir);const applied=await applyTree(dir);
  packet.claims[0].assertion.from='missing';await writeFile(path.join(dir,'evidence.json'),JSON.stringify(packet));
  await assert.rejects(previewTree(dir),/missing/);
  const state=JSON.parse(await readFile(path.join(dir,'.drevo/current.json'),'utf8'));
  assert.equal(state.revisionId,applied.revisionId);
  assert.ok(await readFile(path.join(applied.viewerDir,'dist/index.html')));
});
test('CLI applies only after preview and validates flag values',async t=>{
  const {dir}=await caseFolder(t);
  const cli=fileURLToPath(new URL('../bin/drevo.mjs',import.meta.url));
  const run=args=>execFileSync(process.execPath,[cli,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  const p=JSON.parse(run(['tree-preview',dir,'--json']));assert.equal(p.family.connections.length,1);
  const out=JSON.parse(run(['tree-apply',dir,'--json']));assert.ok(out.viewerDir);
  assert.throws(()=>run(['plan',path.join(dir,'case.json'),'--limit','nope']),/limit/);
  assert.throws(()=>run(['tree-preview',dir,'--wat']),/Неизвестный/);
});

test('public identity permission does not expose unapproved summary dates or places',async()=>{
  const {data,packet}=await fixture();
  data.people[1].birth.place='/Users/example/private/location.txt';
  const result=projectCase(data,packet,{public:true});
  const person=result.family.persons.find(x=>x.id==='sergey');
  assert.equal(person.birthYear,undefined);assert.equal(person.place,'');
  packet.claims.push(claim(packet,'public-birth',{kind:'event',personId:'sergey',event:'birth',value:{year:1918,place:'Учебное место'}}));
  assert.equal(projectCase(data,packet,{public:true}).family.persons.find(x=>x.id==='sergey').birthYear,1918);
  delete packet.sources[0].visibility;
  assert.equal(projectCase(data,packet,{public:true}).family.persons.find(x=>x.id==='sergey').birthYear,undefined);
  data.people[1].name='/Users/example/private/name';
  assert.throws(()=>projectCase(data,packet,{public:true}),/частному файлу/);
});
test('a selected hypothetical event is visible as hypothetical even on a documented person',async()=>{
  const {data,packet}=await fixture();data.people[1].status='documented';
  packet.claims.push(claim(packet,'maybe-birth',{kind:'event',personId:'sergey',event:'birth',value:{year:1917}},'hypothesis'));
  const person=projectCase(data,packet,{includeHypotheses:true}).family.persons.find(x=>x.id==='sergey');
  assert.equal(person.confidence,'hypothesis');assert.equal(person.evidence[0].assertionLabel,'Рождение: 1917');
});

test('omitting hypotheses cannot hide a selected conflict behind another confident claim',async()=>{
  const {data,packet}=await fixture();
  const uncertain=clone(packet.claims[0]);uncertain.id='conflicting';uncertain.status='documented';
  uncertain.conflicts=[{description:'Другая версия',status:'open',sourceIds:['demo-interview']}];packet.claims.push(uncertain);
  assert.equal(projectCase(data,packet).family.connections.length,0);
  assert.equal(projectCase(data,packet,{includeHypotheses:true}).family.connections[0].confidence,'hypothesis');
  packet.claims.push(claim(packet,'uncertain-event',{kind:'event',personId:'sergey',event:'birth',value:{year:1917}},'hypothesis'));
  const person=projectCase(data,packet).family.persons.find(x=>x.id==='sergey');
  assert.equal(person.birthYear,undefined);assert.equal(person.confidence,'hypothesis');
});
