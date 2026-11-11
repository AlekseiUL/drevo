import { readFile, writeFile, mkdir, rename, lstat, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { projectCase, diffFamily, digest } from './projection.mjs';
import { copyDossierAssets } from './dossier.mjs';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const readJSON = async file => JSON.parse(await readFile(file,'utf8'));
async function exists(file) { try { await lstat(file); return true; } catch (e) { if (e.code==='ENOENT') return false; throw e; } }
async function plain(file,kind) {
  const stat = await lstat(file);
  if (stat.isSymbolicLink() || (kind==='directory' ? !stat.isDirectory() : !stat.isFile())) throw Error(`Ожидался обычный ${kind}: ${file}`);
}
async function atomicJSON(file,value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600}); await rename(temp,file); }
  finally { await rm(temp,{force:true}); }
}
async function withStore(caseDir,task) {
  const base = await realpath(path.resolve(caseDir));
  const repository = await realpath(root);
  if (base===repository || base.startsWith(repository+path.sep)) throw Error('Рабочее семейное дело должно находиться вне публичного репозитория; скопируйте учебные примеры в отдельную папку');
  for (const file of ['case.json','evidence.json']) await plain(path.join(base,file),'file');
  const store = path.join(base,'.drevo');
  try {
    await mkdir(store,{mode:0o700});
    await atomicJSON(path.join(store,'format.json'),{format:'drevo-tree-store',version:1});
  } catch (e) { if (e.code!=='EEXIST') throw e; }
  await plain(store,'directory');
  await plain(path.join(store,'format.json'),'file');
  const format = await readJSON(path.join(store,'format.json'));
  if (format.format!=='drevo-tree-store' || format.version!==1) throw Error('Неизвестный формат .drevo; существующая папка не изменена');
  const lock = path.join(store,'lock');
  try { await mkdir(lock,{mode:0o700}); } catch (e) { if (e.code==='EEXIST') throw Error('Дело занято другой операцией. Если процесс аварийно завершился, проверьте его и удалите только пустую .drevo/lock'); throw e; }
  try {
    const revisions = path.join(store,'revisions');
    await mkdir(revisions,{recursive:true,mode:0o700}); await plain(revisions,'directory');
    return await task({base,store,revisions});
  } finally { await rm(lock,{recursive:true,force:true}); }
}
function revisionPath(store,id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw Error('Неверный идентификатор версии');
  return path.join(store.revisions,id);
}
async function revision(store,id) {
  const dir = revisionPath(store,id);
  await plain(dir,'directory');
  await plain(path.join(dir,'family.json'),'file');
  await plain(path.join(dir,'receipt.json'),'file');
  const family = await readJSON(path.join(dir,'family.json')), receipt = await readJSON(path.join(dir,'receipt.json'));
  if (receipt.familyHash!==digest(family)) throw Error('Сохранённая версия дерева изменена вручную; автоматическая замена остановлена');
  return {family,receipt,dir};
}
async function current(store) {
  const file = path.join(store.store,'current.json');
  if (!(await exists(file))) return {state:null,family:null,hash:digest(null)};
  await plain(file,'file');
  const state = await readJSON(file);
  if (state.schemaVersion!==1 || !Array.isArray(state.history)) throw Error('Неверное состояние текущего дерева');
  const saved = state.revisionId ? await revision(store,state.revisionId) : {family:null};
  return {state,family:saved.family,hash:digest(state)};
}
async function inputs(store) {
  const [data,packet] = await Promise.all([readJSON(path.join(store.base,'case.json')),readJSON(path.join(store.base,'evidence.json'))]);
  return {data,packet,caseHash:digest(data),evidenceHash:digest(packet)};
}

export async function previewTree(caseDir,options={}) {
  return withStore(caseDir, async store => {
    const input = await inputs(store), old = await current(store);
    const selected = {public:options.public===true,includeHypotheses:options.includeHypotheses===true};
    const projected = projectCase(input.data,input.packet,selected);
    const proposal = {schemaVersion:1,id:randomUUID(),createdAt:new Date().toISOString(),options:selected,
      caseHash:input.caseHash,evidenceHash:input.evidenceHash,previousStateHash:old.hash,
      family:projected.family,diff:diffFamily(old.family,projected.family),warnings:projected.warnings};
    await atomicJSON(path.join(store.store,'tree-preview.json'),proposal);
    return proposal;
  });
}
export async function applyTree(caseDir) {
  return withStore(caseDir, async store => {
    const proposalFile = path.join(store.store,'tree-preview.json');
    if (!(await exists(proposalFile))) throw Error('Сначала выполните tree-preview и просмотрите изменения');
    await plain(proposalFile,'file');
    const proposal = await readJSON(proposalFile), input = await inputs(store), old = await current(store);
    if (proposal.schemaVersion!==1 || proposal.caseHash!==input.caseHash || proposal.evidenceHash!==input.evidenceHash || proposal.previousStateHash!==old.hash) throw Error('Предпросмотр устарел: дело, свидетельства или дерево изменились. Выполните tree-preview заново');
    const projected = projectCase(input.data,input.packet,proposal.options);
    if (digest(projected.family)!==digest(proposal.family)) throw Error('Предпросмотр изменён; выполните tree-preview заново');
    const id = randomUUID(), dir = revisionPath(store,id), viewerDir = path.join(dir,'viewer');
    await mkdir(dir,{mode:0o700});
    try {
      const familyFile = path.join(dir,'family.json');
      await atomicJSON(familyFile,projected.family);
      const assetsDir=path.join(dir,'staging-assets');
      await mkdir(assetsDir,{mode:0o700});
      await copyDossierAssets(store.base,input.data,projected.family,assetsDir);
      await exec(process.execPath,[path.join(root,'skills/family-tree-studio/scripts/create-project.mjs'),'--out',viewerDir,'--data',familyFile,'--assets-dir',assetsDir],{maxBuffer:2*1024*1024});
      await exec(process.execPath,[path.join(viewerDir,'scripts/build.mjs')],{cwd:viewerDir,maxBuffer:2*1024*1024});
      await rm(assetsDir,{recursive:true,force:true});
      // Recheck after building: a concurrently edited research file must not slip into the reviewed change.
      const latest = await inputs(store);
      if (latest.caseHash!==input.caseHash || latest.evidenceHash!==input.evidenceHash) throw Error('Дело изменилось во время сборки; выполните tree-preview заново');
      const receipt = {schemaVersion:1,id,previewId:proposal.id,createdAt:new Date().toISOString(),options:proposal.options,caseHash:input.caseHash,evidenceHash:input.evidenceHash,familyHash:digest(projected.family)};
      await atomicJSON(path.join(dir,'receipt.json'),receipt);
      const history = [...(old.state?.history || []),...(old.state?.revisionId ? [old.state.revisionId] : [])];
      // The only live switch is this atomic pointer. Older complete viewers remain untouched.
      await atomicJSON(path.join(store.store,'current.json'),{schemaVersion:1,revisionId:id,history});
      return {revisionId:id,viewerDir,familyFile,diff:proposal.diff,warnings:projected.warnings};
    } catch (e) { await rm(dir,{recursive:true,force:true}); throw e; }
  });
}
export async function undoTree(caseDir) {
  return withStore(caseDir,async store => {
    const old = await current(store);
    if (!old.state?.revisionId) throw Error('Нет применённой версии для отката');
    const history = [...old.state.history], id = history.pop() || null;
    if (id) await revision(store,id);
    await atomicJSON(path.join(store.store,'current.json'),{schemaVersion:1,revisionId:id,history});
    return {revisionId:id,viewerDir:id ? path.join(revisionPath(store,id),'viewer') : null,
      notice:'Откат относится к отображению дерева. case.json, evidence.json, документы и все сохранённые версии остаются на месте.'};
  });
}
export function formatPreview(preview) {
  const rows = [`Предпросмотр ${preview.id}`,preview.options.public ? 'Режим: публичная проекция разрешённых данных (публикация не выполняется).' : 'Режим: частное локальное дерево.'];
  for (const [key,label] of [['people','Люди'],['connections','Связи']]) {
    const d = preview.diff[key];
    rows.push(`${label}: добавить ${d.added.length}, изменить ${d.updated.length}, убрать ${d.removed.length}`);
    const people = new Map(preview.family.persons.map(p=>[p.id,p.name]));
    const describe = item => item.name || `${people.get(item.a) || item.a} → ${people.get(item.b) || item.b} · ${item.type} · ${item.confidence}`;
    for (const change of d.details) {
      rows.push(`  ${change.before ? change.after ? '~' : '−' : '+'} ${describe(change.after || change.before)} [${change.id}]`);
      if (change.before && change.after) {
        const fields = [...new Set([...Object.keys(change.before),...Object.keys(change.after)])].filter(k=>digest(change.before[k] ?? null)!==digest(change.after[k] ?? null));
        rows.push(`    Изменяются поля: ${fields.join(', ')}; значения до/после — в diff.details.`);
      }
    }
  }
  rows.push(...preview.warnings.map(x=>`Замечание: ${x}`),'Полные поля и основания: .drevo/tree-preview.json. Для применения: tree-apply <папка-дела>.');
  return rows.join('\n');
}
