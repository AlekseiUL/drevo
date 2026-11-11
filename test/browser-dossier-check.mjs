// Full browser authoring against the real local server. Uses only a temporary fictional case.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {startDossierServer} from '../lib/dossier-server.mjs';
const args=process.argv.slice(2),option=key=>args.includes(key)?args[args.indexOf(key)+1]:null;
const {chromium}=await import(option('--playwright-module')?pathToFileURL(path.resolve(option('--playwright-module'))).href:'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=await mkdtemp(path.join(tmpdir(),'drevo-authoring-'));
let app,browser,checks=0;const pass=label=>{checks++;console.log('PASS '+label);};
try {
 for(const name of ['case','evidence'])await writeFile(path.join(dir,`${name}.json`),await readFile(path.join(root,`templates/${name}.example.json`)));
 app=await startDossierServer(dir,{port:0});browser=await chromium.launch({headless:true,...(option('--channel')?{channel:option('--channel')}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const open=async()=>{await page.goto(app.url+'#person=sergey');await page.waitForFunction(()=>window.drevo?.getState().editable);};
 await open();await page.getByRole('button',{name:'Редактировать описание',exact:true}).click();
 await page.getByLabel('О человеке',{exact:true}).fill('Вымышленная история: сохраняется на диске.');await page.getByLabel('Жизнь и деятельность',{exact:true}).fill('1940–1950 — учебная работа в мастерской.');
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#editor-dialog').open);
 await page.reload();await page.waitForFunction(()=>window.drevo?.getState().editable);assert((await page.locator('#details').textContent()).includes('1940–1950'));pass('biography and activity saved through UI and reload');
 const add=async(name,file,description)=>{
  await page.getByRole('tab',{name:/Материалы/}).click();await page.getByRole('button',{name:'Прикрепить материал',exact:true}).click();
  await page.getByLabel('Название',{exact:true}).fill(name);await page.getByLabel('Описание',{exact:true}).fill(description);
  await page.getByLabel('Исходный файл',{exact:true}).setInputFiles(file);await page.getByRole('button',{name:'Сохранить в карточке',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#editor-dialog').open);
 };
 const assets=path.join(root,'skills/family-tree-studio/assets/viewer/public/assets/materials');
 await add('Учебная иллюстрация',path.join(assets,'gleb-workshop.png'),'Авторская иллюстрация, не историческое фото.');
 await page.getByRole('button',{name:'Открыть материал: Учебная иллюстрация',exact:true}).click();await page.locator('#material-body img').waitFor();assert(await page.locator('#material-body img').evaluate(img=>img.complete&&img.naturalWidth>100));
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Скачать исходный файл ↓',exact:true}).click()]);assert.equal(download.suggestedFilename(),'gleb-workshop.png');
 await page.getByRole('button',{name:'Закрыть материал',exact:true}).click();pass('image upload, visible preview and original download');
 await add('Учебный архивный документ',path.join(assets,'gleb-archive-card.pdf'),'PDF для проверки просмотра.');
 await page.getByRole('button',{name:'Открыть материал: Учебный архивный документ',exact:true}).click();
 const pdf=await page.locator('#material-body iframe').getAttribute('src');const pdfResponse=await page.request.get(new URL(pdf,app.url).href);assert.equal(pdfResponse.status(),200);assert.equal(pdfResponse.headers()['content-type'],'application/pdf');assert((await pdfResponse.body()).subarray(0,5).toString()==='%PDF-');
 // Native PDF rendering is asynchronous and not exposed as page DOM; allow it to paint for the visual artifact.
 await page.waitForTimeout(1800);
 await page.screenshot({path:path.join(tmpdir(),'drevo-local-dossier-pdf.png')});
 await page.getByRole('button',{name:'Закрыть материал',exact:true}).click();pass('PDF attachment opens in the real local viewer');
 await page.getByRole('tab',{name:/Находки/}).click();assert.equal(await page.locator('.finding-card').count(),1);await page.getByRole('button',{name:'Открыть находку и источники',exact:true}).click();assert((await page.locator('#evidence-body').textContent()).includes('Демонстрационный фрагмент 1'));await page.getByRole('button',{name:'Закрыть основания',exact:true}).click();pass('linked research finding opens its original evidence');
 await app.close();app=await startDossierServer(dir,{port:0});await open();await page.getByRole('tab',{name:/Материалы/}).click();assert.equal(await page.locator('.material-card').count(),2);pass('saved files survive server restart');
 await page.getByRole('button',{name:'Открыть материал: Учебная иллюстрация',exact:true}).click();await page.getByRole('button',{name:'Изменить описание',exact:true}).click();await page.getByLabel('Название',{exact:true}).fill('Исправленная подпись');await page.getByRole('button',{name:'Сохранить описание',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#editor-dialog').open);
 await page.getByRole('button',{name:'Открыть материал: Исправленная подпись',exact:true}).click();await page.getByRole('button',{name:'Изменить описание',exact:true}).click();await page.getByRole('button',{name:'Убрать из карточки',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#editor-dialog').open);assert.equal(await page.locator('.material-card').count(),1);assert.equal((await readdir(path.join(dir,'originals/dossier'))).length,2);pass('metadata edit and detach leave original files intact');
 await page.setViewportSize({width:390,height:844});await open();await page.getByRole('tab',{name:'Обзор',exact:true}).click();await page.getByRole('button',{name:'Редактировать описание',exact:true}).click();await page.getByLabel('О человеке',{exact:true}).fill('Черновик, который нельзя потерять.');
 const data=JSON.parse(await readFile(path.join(dir,'case.json'),'utf8'));data.title+=' changed elsewhere';await writeFile(path.join(dir,'case.json'),JSON.stringify(data));
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.locator('#editor-status.failed').waitFor();assert.equal(await page.getByLabel('О человеке',{exact:true}).inputValue(),'Черновик, который нельзя потерять.');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);await page.getByRole('button',{name:'Отменить изменения',exact:true}).click();pass('mobile editing and stale-version error preserve unsaved text');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,browserChecks:checks,fictionalOnly:true}));
} finally {if(browser)await browser.close();if(app)await app.close();await rm(dir,{recursive:true,force:true});}
