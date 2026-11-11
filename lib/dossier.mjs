import path from 'node:path';
import { readFile, lstat, mkdir, writeFile } from 'node:fs/promises';
import { materialType, materialPath, verifyMaterialBytes } from '../skills/family-tree-studio/assets/viewer/scripts/material-policy.mjs';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const array = x => Array.isArray(x) ? x : [];
const fields = {title:300,description:20000,date:100,sourceId:100,sourceLabel:1000,sourceUrl:4000,locator:2000,rights:2000,url:4000};
export function webURL(value) {
  if (!value) return '';
  const u = new URL(value);
  if (!['http:','https:'].includes(u.protocol) || u.username || u.password) throw Error('Нужна HTTP(S)-ссылка без учётных данных');
  return u.href;
}
export function cleanMaterialFields(input) {
  if (!object(input)) throw Error('Материал должен быть объектом');
  const result = {};
  for (const [key,limit] of Object.entries(fields)) {
    const value = input[key] ?? '';
    if (typeof value !== 'string' || value.length > limit || value.includes('\0')) throw Error(`Некорректное или слишком длинное поле ${key}`);
    result[key] = value.trim();
  }
  if (!result.title) throw Error('Укажите название материала');
  for (const key of ['url','sourceUrl']) result[key] = webURL(result[key]);
  return result;
}
export function originalPath(value) {
  if (typeof value !== 'string' || !value.startsWith('originals/') || value.includes('\\') || value.includes('\0') || value.split('/').some(x=>!x || x==='.' || x==='..')) throw Error('Файл материала должен находиться внутри originals/');
  return value;
}
export function validateDossiers(data,packet) {
  const issues=[], ids=new Set(), sources=new Set(array(packet?.sources).map(s=>s?.id));
  for (const p of array(data?.people)) {
    if (!p?.dossier) continue;
    try {
      const d=p.dossier;
      if (!object(d)) throw Error('Досье должно быть объектом');
      for (const key of ['biography','activity']) if (d[key]!=null && (typeof d[key]!=='string' || d[key].length>100000 || d[key].includes('\0'))) throw Error(`Некорректное поле ${key}`);
      if (d.visibility!=null && !['private','public'].includes(d.visibility)) throw Error('Неизвестная видимость досье');
      if (d.materials!=null && !Array.isArray(d.materials)) throw Error('materials должен быть массивом');
      for (const m of d.materials || []) {
        if (!object(m) || !/^[a-zA-Z0-9_-]{1,80}$/.test(m.id) || ids.has(m.id)) throw Error('У материалов должны быть уникальные ID');
        ids.add(m.id);cleanMaterialFields(m);
        if (m.sourceId && !sources.has(m.sourceId)) throw Error(`Неизвестный sourceId ${m.sourceId}`);
        for (const key of ['visibility','fileVisibility']) if (m[key]!=null && !['private','public'].includes(m[key])) throw Error(`Неизвестная ${key}`);
        if (m.file) {
          if (!object(m.file)) throw Error('file должен быть объектом');
          const f=m.file;originalPath(f.path);
          if (typeof f.name!=='string' || !f.name || f.name.length>240 || /[\\/\x00-\x1f]/.test(f.name)) throw Error('Нужно исходное имя файла без пути');
          const policy=materialType(f.name);
          if (path.extname(f.path).toLowerCase()!=='.'+policy.extension) throw Error('Расширения имени файла и оригинала расходятся');
          if (!Number.isSafeInteger(f.size) || f.size<1 || f.size>MAX_FILE_BYTES || !/^[a-f0-9]{64}$/.test(f.sha256)) throw Error('Нужны размер файла до 20 МиБ и SHA-256');
          if (f.mediaType!==policy.mediaType) throw Error('MIME файла не соответствует его формату');
        } else if (!m.url) throw Error('Нужен файл или ссылка материала');
      }
    } catch(e) {issues.push({severity:'error',claimId:null,message:`Досье ${p.id}: ${e.message}`});}
  }
  return issues;
}
export function claimCanBePublic(c,sources) {
  return c.tree?.visibility==='public' && c.evidence.every(e=>sources.get(e.sourceId)?.visibility==='public') && c.conflicts.every(x=>array(x.sourceIds).every(id=>sources.get(id)?.visibility==='public'));
}
export function projectDossier(person,claims,sources,publicMode,evidenceFor,included) {
  const d=person.dossier || {}, allowedText=!publicMode || d.visibility==='public';
  const materials=[];
  for (const m of d.materials || []) {
    if (publicMode && (m.visibility!=='public' || (m.sourceId && sources.get(m.sourceId)?.visibility!=='public'))) continue;
    const policy=m.file ? materialType(m.file.name) : {kind:'other',preview:'download'};
    const source=sources.get(m.sourceId);
    const out={id:m.id,...cleanMaterialFields(m),kind:policy.kind,preview:policy.preview};
    out.sourceLabel ||= source?.title || '';out.sourceUrl ||= webURL(source?.url || '');out.locator ||= source?.locator || '';
    // Approval of a caption does not release the attached original.
    if (m.file && (!publicMode || (m.fileVisibility==='public' && Boolean(m.rights?.trim())))) {
      out.path=materialPath(`assets/materials/${m.id}.${policy.extension}`);
      out.fileName=m.file.name;out.size=m.file.size;out.sha256=m.file.sha256;out.mediaType=policy.mediaType;
    }
    materials.push(out);
  }
  return {biography:allowedText ? d.biography || '' : '',activity:allowedText ? d.activity || '' : '',materials,
    findings:claims.filter(c=>c.personIds.includes(person.id) && (!publicMode || (claimCanBePublic(c,sources) && c.personIds.every(id=>included.has(id))))).map(c=>evidenceFor(c,sources))};
}
export function materialBindings(data,family) {
  const originals=new Map(data.people.flatMap(p=>(p.dossier?.materials || []).map(m=>[m.id,m])));
  return family.persons.flatMap(p=>(p.dossier?.materials || []).filter(m=>m.path).map(m=>({exportPath:materialPath(m.path),original:originals.get(m.id)?.file,material:m})));
}
export async function readOriginal(base,file) {
  originalPath(file.path);
  let current=base;
  for (const part of file.path.split('/')) {
    current=path.join(current,part);const stat=await lstat(current);
    if (stat.isSymbolicLink()) throw Error('Ссылки на внешние оригиналы не поддерживаются; прикрепите копию файла');
  }
  const stat=await lstat(current);
  if (!stat.isFile() || stat.size>MAX_FILE_BYTES) throw Error('Нужен обычный файл до 20 МиБ');
  const bytes=await readFile(current);
  verifyMaterialBytes(bytes,file.name,{size:file.size,sha256:file.sha256});
  return bytes;
}
export async function copyDossierAssets(base,data,family,destination) {
  for (const binding of materialBindings(data,family)) {
    if (!binding.original) throw Error('Оригинал материала отсутствует');
    const bytes=await readOriginal(base,binding.original);
    const target=path.join(destination,binding.exportPath);
    await mkdir(path.dirname(target),{recursive:true,mode:0o700});
    await writeFile(target,bytes,{flag:'wx',mode:0o600});
  }
}
