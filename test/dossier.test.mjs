import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { startDossierServer } from '../lib/dossier-server.mjs';
import { projectCase } from '../lib/projection.mjs';
import { previewTree, applyTree } from '../lib/tree-store.mjs';
import { materialType } from '../skills/family-tree-studio/assets/viewer/scripts/material-policy.mjs';
const fixture=async()=>({data:JSON.parse(await readFile(new URL('../templates/case.example.json',import.meta.url),'utf8')),packet:JSON.parse(await readFile(new URL('../templates/evidence.example.json',import.meta.url),'utf8'))});
const hash=b=>createHash('sha256').update(b).digest('hex');
async function setup(t){
 const dir=await mkdtemp(path.join(os.tmpdir(),'drevo-dossier-')),f=await fixture();
 await writeFile(path.join(dir,'case.json'),JSON.stringify(f.data));await writeFile(path.join(dir,'evidence.json'),JSON.stringify(f.packet));
 let app=await startDossierServer(dir,{port:0});
 t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
 let session=await fetch(app.url+'api/session').then(r=>r.json());
 const post=async(endpoint,body,headers={})=>{const response=await fetch(app.url+endpoint,{method:'POST',headers:{'Content-Type':'application/json',Origin:new URL(app.url).origin,'X-Drevo-Token':session.token,...headers},body:JSON.stringify({caseVersion:session.caseVersion,...body})});const json=await response.json();if(response.ok)session.caseVersion=json.caseVersion;return {response,json};};
 return {...f,dir,get app(){return app;},get session(){return session;},post,restart:async()=>{await app.close();app=await startDossierServer(dir,{port:0});session=await fetch(app.url+'api/session').then(r=>r.json());}};
}
async function storedMaterial(dir,id='scan'){
 const bytes=Buffer.from('Синтетическая расшифровка\n'),file={path:`originals/dossier/${id}.txt`,name:'Учебная запись.txt',mediaType:materialType('x.txt').mediaType,size:bytes.length,sha256:hash(bytes)};
 await mkdir(path.join(dir,'originals/dossier'),{recursive:true});await writeFile(path.join(dir,file.path),bytes);
 return {id,title:'Учебный документ',description:'Только пример',rights:'MIT — учебный авторский текст',file};
}
test('dossier API saves biography/activity, backs up exact prior JSON, and survives server restart',async t=>{
 const s=await setup(t),before=await readFile(path.join(s.dir,'case.json'),'utf8');
 const {response,json}=await s.post('api/people/vera/dossier',{biography:'Описание жизни',activity:'1940–1960: учебная деятельность'});
 assert.equal(response.status,200);assert.equal(json.tree.persons.find(p=>p.id==='vera').dossier.activity,'1940–1960: учебная деятельность');
 const history=await readdir(path.join(s.dir,'working/dossier-history'));assert.equal(history.length,1);assert.equal(await readFile(path.join(s.dir,'working/dossier-history',history[0]),'utf8'),before);
 await s.restart();const tree=await fetch(s.app.url+'tree.json').then(r=>r.json());assert.equal(tree.persons.find(p=>p.id==='vera').dossier.biography,'Описание жизни');
});
test('upload, original byte download, range, metadata editing and detachment preserve the original',async t=>{
 const s=await setup(t),bytes=Buffer.from('Синтетическая запись\n');
 const add=await s.post('api/people/vera/materials',{title:'Архивная запись',locator:'Учебный лист 1',file:{name:'запись.txt',data:bytes.toString('base64')}});
 assert.equal(add.response.status,200);const item=add.json.tree.persons.find(p=>p.id==='vera').dossier.materials[0];assert.equal(item.preview,'text');assert.equal(item.sha256,hash(bytes));
 let response=await fetch(s.app.url+item.path);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 response=await fetch(s.app.url+item.path+'?download=1');assert.match(response.headers.get('content-disposition'),/^attachment/);
 response=await fetch(s.app.url+item.path,{headers:{Range:'bytes=0-3'}});assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,4);
 const edit=await s.post(`api/people/vera/materials/${item.id}`,{title:'Уточнённая подпись',description:'Прочтение'});assert.equal(edit.response.status,200);
 const original=JSON.parse(await readFile(path.join(s.dir,'case.json'),'utf8')).people.find(p=>p.id==='vera').dossier.materials[0].file;
 const remove=await s.post(`api/people/vera/materials/${item.id}/remove`,{});assert.equal(remove.response.status,200);assert.equal(remove.json.tree.persons.find(p=>p.id==='vera').dossier.materials.length,0);
 assert.deepEqual(await readFile(path.join(s.dir,original.path)),bytes);assert.equal((await fetch(s.app.url+item.path)).status,404);
});
test('invalid files, unsupported formats and unknown sources leave research unchanged',async t=>{
 const s=await setup(t),before=await readFile(path.join(s.dir,'case.json'),'utf8');
 for(const file of [{name:'x.png',data:Buffer.from('<script>bad</script>').toString('base64')},{name:'x.html',data:Buffer.from('text').toString('base64')},{name:'../x.txt',data:Buffer.from('text').toString('base64')},{name:'x.txt',data:'%%%%'}]){
   const r=await s.post('api/people/vera/materials',{title:'Bad',file});assert.equal(r.response.status,422);
 }
 const r=await s.post('api/people/vera/materials',{title:'Unknown',sourceId:'missing',file:{name:'x.txt',data:Buffer.from('text').toString('base64')}});assert.equal(r.response.status,422);
 assert.equal(await readFile(path.join(s.dir,'case.json'),'utf8'),before);assert.deepEqual(await readdir(path.join(s.dir,'originals/dossier')),[]);
});
test('editing requires a local origin, session token and current case version',async t=>{
 const s=await setup(t),old=s.session.caseVersion;
 for(const headers of [{Origin:'https://example.invalid'},{'X-Drevo-Token':''}]){
   const r=await s.post('api/people/vera/dossier',{biography:'bad',activity:''},headers);assert.equal(r.response.status,403);
 }
 const badHost=await new Promise((resolve,reject)=>{const request=http.get(s.app.url+'api/session',{headers:{Host:'evil.example'}},r=>{r.resume();resolve(r.statusCode);});request.on('error',reject);});assert.equal(badHost,403);
 assert.equal((await s.post('api/people/vera/dossier',{biography:'first',activity:''})).response.status,200);
 const stale=await s.post('api/people/vera/dossier',{caseVersion:old,biography:'stale',activity:''});assert.equal(stale.response.status,409);
 assert.equal(JSON.parse(await readFile(path.join(s.dir,'case.json'),'utf8')).people[0].dossier.biography,'first');
});
test('the server exposes only selected files and refuses symlinked originals',async t=>{
 const s=await setup(t);
 for(const target of ['case.json','evidence.json','originals/secret.txt','working/dossier-history','../package.json'])assert.equal((await fetch(s.app.url+target)).status,404);
 const item=await storedMaterial(s.dir);s.data.people[0].dossier={materials:[item]};await writeFile(path.join(s.dir,'case.json'),JSON.stringify(s.data));
 await rm(path.join(s.dir,item.file.path));await writeFile(path.join(s.dir,'secret.txt'),'Секрет');await symlink(path.join(s.dir,'secret.txt'),path.join(s.dir,item.file.path));
 const r=await fetch(s.app.url+'assets/materials/scan.txt');assert.equal(r.status,422);assert(!(await r.text()).includes('Секрет'));
});
test('all linked findings reach the dossier even when they do not create tree relations',async()=>{
 const {data,packet}=await fixture();const candidate=structuredClone(packet.claims[0]);candidate.id='unverified';candidate.status='candidate';candidate.tree={include:false};delete candidate.assertion;packet.claims.push(candidate);
 const result=projectCase(data,packet);assert.equal(result.family.connections.length,1);assert.equal(result.family.persons[0].dossier.findings.length,2);assert.equal(result.family.persons[0].dossier.findings[1].status,'candidate');
});
test('public person permission does not publish dossier text, captions or original files',async t=>{
 const s=await setup(t),item=await storedMaterial(s.dir);s.data.people[0].dossier={biography:'Частная история',activity:'Частная работа',materials:[item]};
 let p=projectCase(s.data,s.packet,{public:true}).family.persons[0];assert.equal(p.dossier.biography,'');assert.deepEqual(p.dossier.materials,[]);
 s.data.people[0].dossier.visibility='public';item.visibility='public';p=projectCase(s.data,s.packet,{public:true}).family.persons[0];assert.equal(p.dossier.biography,'Частная история');assert.equal(p.dossier.materials[0].path,undefined);assert.equal(p.dossier.materials[0].fileName,undefined);
 item.fileVisibility='public';p=projectCase(s.data,s.packet,{public:true}).family.persons[0];assert.equal(p.dossier.materials[0].path,'assets/materials/scan.txt');
 item.sourceId='demo-interview';delete s.packet.sources[0].visibility;p=projectCase(s.data,s.packet,{public:true}).family.persons[0];assert.deepEqual(p.dossier.materials,[]);assert.deepEqual(p.dossier.findings,[]);
});
test('tree apply packages only approved attachment bytes and fails without replacing old tree on tampering',async t=>{
 const s=await setup(t),item=await storedMaterial(s.dir);s.data.people[0].dossier={materials:[item]};await writeFile(path.join(s.dir,'case.json'),JSON.stringify(s.data));
 await previewTree(s.dir);const first=await applyTree(s.dir);const bytes=await readFile(path.join(first.viewerDir,'dist/assets/materials/scan.txt'));assert.equal(hash(bytes),item.file.sha256);
 await previewTree(s.dir,{public:true});const publicVersion=await applyTree(s.dir);await assert.rejects(readFile(path.join(publicVersion.viewerDir,'dist/assets/materials/scan.txt')),/ENOENT/);
 await previewTree(s.dir);await writeFile(path.join(s.dir,item.file.path),'Подмена');await assert.rejects(applyTree(s.dir),/изменил|сумма/);
 const current=JSON.parse(await readFile(path.join(s.dir,'.drevo/current.json'),'utf8'));assert.equal(current.revisionId,publicVersion.revisionId);
});

test('public findings never expose a private participant and credential URLs are rejected',async()=>{
 const {data,packet}=await fixture();data.people[1].tree.visibility='private';
 const tree=projectCase(data,packet,{public:true}).family;
 assert.deepEqual(tree.persons.map(p=>p.id),['vera']);assert.deepEqual(tree.persons[0].dossier.findings,[]);
 packet.sources[0].url='https://example-user:example-pass@example.invalid/record';
 assert.throws(()=>projectCase(data,packet,{public:true}),/учётных/);
});
test('edited public prose and captions become private without changing original file permissions',async t=>{
 const s=await setup(t),item=await storedMaterial(s.dir);item.visibility='public';item.fileVisibility='public';
 s.data.people[0].dossier={biography:'Прежний текст',activity:'',visibility:'public',materials:[item]};await writeFile(path.join(s.dir,'case.json'),JSON.stringify(s.data));await s.restart();
 await s.post('api/people/vera/dossier',{biography:'Новый ещё не просмотренный текст',activity:''});
 await s.post('api/people/vera/materials/scan',{title:'Новая подпись'});
 const d=JSON.parse(await readFile(path.join(s.dir,'case.json'),'utf8')).people[0].dossier;
 assert.equal(d.visibility,'private');assert.equal(d.materials[0].visibility,'private');assert.equal(d.materials[0].fileVisibility,'public');
});
