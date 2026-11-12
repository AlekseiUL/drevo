import http from 'node:http';
import path from 'node:path';
import { readFile, writeFile, mkdir, rename, lstat, realpath, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { projectCase, digest } from './projection.mjs';
import { publicFamily, layoutFamily } from '../skills/family-tree-studio/assets/viewer/scripts/model.mjs';
import { materialType, materialDisposition, verifyMaterialBytes } from '../skills/family-tree-studio/assets/viewer/scripts/material-policy.mjs';
import { MAX_FILE_BYTES, cleanMaterialFields, materialBindings, readOriginal, verifyPortraitAssets } from './dossier.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const template=path.join(root,'skills/family-tree-studio/assets/viewer');
const fail=(status,message)=>Object.assign(Error(message),{status});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const BODY_LIMIT=Math.ceil(MAX_FILE_BYTES*4/3)+512*1024;
async function plain(file,directory=false) {const s=await lstat(file);if(s.isSymbolicLink() || (directory?!s.isDirectory():!s.isFile()))throw Error('Нужен обычный файл или каталог без символической ссылки');}
async function privateDirectory(base,relative) {
  let dir=base;
  for(const part of relative.split('/')) {dir=path.join(dir,part);try{await mkdir(dir,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}await plain(dir,true);}
  return dir;
}
async function loadCase(base,options) {
  await plain(path.join(base,'case.json'));await plain(path.join(base,'evidence.json'));
  const [raw,sourceRaw]=await Promise.all([readFile(path.join(base,'case.json'),'utf8'),readFile(path.join(base,'evidence.json'),'utf8')]);
  const data=JSON.parse(raw),packet=JSON.parse(sourceRaw);
  const {family}=projectCase(data,packet,{includeHypotheses:options.includeHypotheses===true});
  await verifyPortraitAssets(base,data,family);
  const tree=layoutFamily(publicFamily(family));
  return {data,packet,raw,sourceRaw,family,tree,caseVersion:digest([data,packet])};
}
async function jsonBody(req) {
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))throw fail(415,'Нужен JSON-запрос');
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>BODY_LIMIT){req.resume();throw fail(413,'Файл должен быть не больше 20 МиБ');}chunks.push(chunk);}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail(400,'Некорректный JSON');}
  if(!body || typeof body!=='object' || Array.isArray(body))throw fail(400,'Нужен JSON-объект');return body;
}
function sendJSON(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
function bytesResponse(req,res,bytes,type,fileName='',download=false) {
  const headers={'Content-Type':type,'Accept-Ranges':'bytes'};
  if(fileName)headers['Content-Disposition']=materialDisposition(fileName,download);
  if(req.headers.range){
    const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);let start=0,end=bytes.length-1;
    if(!m || (!m[1]&&!m[2])){res.writeHead(416,{'Content-Range':`bytes */${bytes.length}`});res.end();return;}
    if(m[1]){start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));}else start=Math.max(0,bytes.length-Number(m[2]));
    if(!Number.isSafeInteger(start)||start>end||start>=bytes.length){res.writeHead(416,{'Content-Range':`bytes */${bytes.length}`});res.end();return;}
    res.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':end-start+1});res.end(req.method==='HEAD'?undefined:bytes.subarray(start,end+1));
  }else{res.writeHead(200,{...headers,'Content-Length':bytes.length});res.end(req.method==='HEAD'?undefined:bytes);}
}
async function mutation(base,options,body,personId,operation,materialId) {
  const lock=path.join(base,'.dossier-lock');
  try{await mkdir(lock,{mode:0o700});}catch(e){if(e.code==='EEXIST')throw fail(409,'Дело сейчас изменяется. Повторите после завершения сохранения.');throw e;}
  let newFile=null,committed=false;
  try {
    const before=await loadCase(base,options);
    if(body.caseVersion!==before.caseVersion)throw fail(409,'Дело изменилось в другой вкладке или программе. Обновите данные перед сохранением; ваш текст ещё не записан.');
    const person=before.data.people.find(p=>p.id===personId);
    if(!person || !before.tree.persons.some(p=>p.id===personId))throw fail(404,'Человек не найден в текущем дереве');
    person.dossier ||= {};person.dossier.materials ||= [];
    if(operation==='dossier') {
      for(const key of ['biography','activity']) {
        if(typeof body[key]!=='string' || body[key].length>100000 || body[key].includes('\0'))throw fail(422,'Описание должно быть текстом до 100 000 символов');
        if ((person.dossier[key] || '')!==body[key]) person.dossier.visibility='private';
        person.dossier[key]=body[key];
      }
      // An omitted selection preserves the current cover during an ordinary text edit.
      if (Object.hasOwn(body,'portraitMaterialId')) person.dossier.portraitMaterialId=body.portraitMaterialId;
    }else if(operation==='remove') {
      const index=person.dossier.materials.findIndex(m=>m.id===materialId);if(index<0)throw fail(404,'Материал не найден');
      person.dossier.materials.splice(index,1); // Original bytes and historical metadata are deliberately retained.
      if (person.dossier.portraitMaterialId===materialId) person.dossier.portraitMaterialId=null;
    }else if(operation==='edit') {
      const item=person.dossier.materials.find(m=>m.id===materialId);if(!item)throw fail(404,'Материал не найден');
      const next=cleanMaterialFields({...item,...body});
      if (Object.entries(next).some(([key,value])=>(item[key] || '')!==value)) item.visibility='private';
      Object.assign(item,next);
    }else {
      const item={id:`m-${randomUUID()}`,...cleanMaterialFields(body),visibility:'private',fileVisibility:'private'};
      if(body.file && item.url)throw fail(422,'Выберите файл или внешнюю ссылку');
      if(body.file) {
        const file=body.file;
        if(typeof file.name!=='string' || !file.name || file.name.length>240 || /[\\/\x00-\x1f]/.test(file.name))throw fail(422,'Некорректное имя файла');
        if(typeof file.data!=='string' || file.data.length>Math.ceil(MAX_FILE_BYTES*4/3)+4 || file.data.length%4!==0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data))throw fail(422,'Некорректные данные файла');
        const bytes=Buffer.from(file.data,'base64');if(bytes.toString('base64')!==file.data)throw fail(422,'Некорректная кодировка файла');if(!bytes.length || bytes.length>MAX_FILE_BYTES)throw fail(413,'Нужен непустой файл до 20 МиБ');
        const policy=verifyMaterialBytes(bytes,file.name);
        await privateDirectory(base,'originals/dossier');
        const relative=`originals/dossier/${item.id}.${policy.extension}`;
        newFile=path.join(base,relative);await writeFile(newFile,bytes,{flag:'wx',mode:0o600});
        item.file={path:relative,name:file.name,mediaType:policy.mediaType,size:bytes.length,sha256:sha(bytes)};
      }else if(!item.url)throw fail(422,'Выберите файл или укажите ссылку');
      person.dossier.materials.push(item);
    }
    // Validate the complete next state before replacing the research file.
    const {family}=projectCase(before.data,before.packet,{includeHypotheses:options.includeHypotheses===true});
    await verifyPortraitAssets(base,before.data,family);
    const tree=layoutFamily(publicFamily(family));
    const [rawNow,sourcesNow]=await Promise.all([readFile(path.join(base,'case.json'),'utf8'),readFile(path.join(base,'evidence.json'),'utf8')]);
    if(rawNow!==before.raw || sourcesNow!==before.sourceRaw)throw fail(409,'Исследовательские файлы изменились во время сохранения. Обновите данные и повторите.');
    const history=await privateDirectory(base,'working/dossier-history');
    const transaction=randomUUID();await writeFile(path.join(history,`${transaction}.case.json`),before.raw,{flag:'wx',mode:0o600});
    const target=path.join(base,'case.json'),temp=path.join(base,`.case-${transaction}.tmp`);
    try{await writeFile(temp,JSON.stringify(before.data,null,2)+'\n',{flag:'wx',mode:0o600});await rename(temp,target);committed=true;}finally{await rm(temp,{force:true});}
    return {caseVersion:digest([before.data,before.packet]),tree};
  }finally{if(newFile&&!committed)await rm(newFile,{force:true});await rm(lock,{recursive:true,force:true});}
}

export async function startDossierServer(caseDir,options={}) {
  const base=await realpath(path.resolve(caseDir)), repository=await realpath(root);
  if(base===repository || base.startsWith(repository+path.sep))throw Error('Редактируемое семейное дело должно находиться вне публичного репозитория');
  await plain(base,true);await loadCase(base,options);
  const port=options.port ?? 4174;if(!Number.isInteger(port)||port<0||port>65535)throw Error('Неверный номер порта');
  const token=randomBytes(32).toString('hex');let queue=Promise.resolve();
  const csp="default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',csp);
    try {
      const expected=`127.0.0.1:${server.address().port}`,origin=`http://${expected}`;
      if(req.headers.host!==expected)throw fail(403,'Недопустимый адрес сервера');
      if(req.headers['sec-fetch-site']==='cross-site')throw fail(403,'Запрос с другого сайта запрещён');
      const url=new URL(req.url,origin), pathname=decodeURIComponent(url.pathname);
      if(req.method==='POST') {
        const supplied=Buffer.from(String(req.headers['x-drevo-token'] || '')),secret=Buffer.from(token);
        if(req.headers.origin!==origin || supplied.length!==secret.length || !timingSafeEqual(supplied,secret))throw fail(403,'Сохранение доступно только из локальной карточки');
        const match=/^\/api\/people\/([a-zA-Z0-9_-]+)\/(dossier|materials)(?:\/([a-zA-Z0-9_-]+)(\/remove)?)?$/.exec(pathname);
        if(!match || (match[2]==='dossier'&&match[3]))throw fail(404,'Команда не найдена');
        const body=await jsonBody(req), operation=match[2]==='dossier'?'dossier':match[4]?'remove':match[3]?'edit':'add';
        const task=queue.then(()=>mutation(base,options,body,match[1],operation,match[3]));queue=task.catch(()=>{});
        sendJSON(res,200,await task);return;
      }
      if(!['GET','HEAD'].includes(req.method))throw fail(405,'Метод не поддерживается');
      if(pathname==='/api/session' || pathname==='/tree.json') {
        const current=await loadCase(base,options);
        const payload=pathname==='/tree.json'?current.tree:{editable:true,token,caseVersion:current.caseVersion,
          people:current.tree.persons.map(p=>({id:p.id,dossier:{biography:p.dossier.biography,activity:p.dossier.activity,portraitMaterialId:p.dossier.portraitMaterialId,materials:p.dossier.materials}})),
          sources:current.packet.sources.map(s=>({id:s.id,title:s.title}))};sendJSON(res,200,payload);return;
      }
      if(pathname.startsWith('/assets/materials/')) {
        const current=await loadCase(base,options),binding=materialBindings(current.data,current.family).find(b=>'/'+b.exportPath===pathname);
        if(!binding)throw fail(404,'Материал не найден');
        const bytes=await readOriginal(base,binding.original),policy=materialType(binding.original.name);
        res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'");
        bytesResponse(req,res,bytes,policy.mediaType,binding.original.name,url.searchParams.has('download') || policy.preview==='download');return;
      }
      const staticFiles={'/':['src/index.html','text/html; charset=utf-8'],'/index.html':['src/index.html','text/html; charset=utf-8'],'/app.js':['src/app.js','text/javascript; charset=utf-8'],'/style.css':['src/style.css','text/css; charset=utf-8'],'/assets/icons/map-pin.svg':['public/assets/icons/map-pin.svg','image/svg+xml']};
      staticFiles['/feedback.js']=['src/feedback.js','text/javascript; charset=utf-8'];
      staticFiles['/feedback.css']=['src/feedback.css','text/css; charset=utf-8'];
      staticFiles['/feedback-config.json']=['src/feedback-config.json','application/json; charset=utf-8'];
      for(let i=0;i<3;i++)staticFiles[`/assets/fonts/golos-${i}.ttf`]=[`public/assets/fonts/golos-${i}.ttf`,'font/ttf'];
      staticFiles['/licenses/Viewer-MIT.txt']=['LICENSE','text/plain; charset=utf-8'];
      staticFiles['/licenses/Golos-OFL.txt']=['public/assets/fonts/OFL.txt','text/plain; charset=utf-8'];
      staticFiles['/licenses/Lucide.txt']=['public/assets/icons/LICENSE-lucide.txt','text/plain; charset=utf-8'];
      const file=staticFiles[pathname];if(!file)throw fail(404,'Файл не найден');
      bytesResponse(req,res,await readFile(path.join(template,file[0])),file[1]);
    }catch(e){if(!res.headersSent)sendJSON(res,e.status || 422,{error:e.message});else res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {server,url:`http://127.0.0.1:${server.address().port}/`,close:()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}
