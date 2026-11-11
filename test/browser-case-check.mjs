// Optional full case -> CLI -> browser -> edit -> undo check. Needs an existing Playwright installation.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const args=process.argv.slice(2), option=key=>args.includes(key)?args[args.indexOf(key)+1]:null;
const modulePath=option('--playwright-module');
const {chromium}=await import(modulePath?pathToFileURL(path.resolve(modulePath)).href:'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=await mkdtemp(path.join(tmpdir(),'drevo-case-browser-')), dir=path.join(temp,'case');
const cli=(...parameters)=>execFileSync(process.execPath,[path.join(root,'bin/drevo.mjs'),...parameters],{encoding:'utf8'});
let browser,server;
const stop=async()=>{ if(server && server.exitCode===null) {const done=new Promise(resolve=>server.once('exit',resolve));server.kill();await done;} };
const serve=async viewer=>{
  await stop();server=spawn(process.execPath,[path.join(viewer,'scripts/serve.mjs'),'--port','0'],{stdio:['ignore','pipe','pipe']});
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Viewer server timeout')),5000);
    server.once('error',e=>{clearTimeout(timer);reject(e);});
    server.stdout.on('data',chunk=>{const match=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+\//);if(match){clearTimeout(timer);resolve(match[0]);}});
  });
};
try {
  cli('init',dir);
  const data=JSON.parse(await readFile(path.join(root,'templates/case.example.json'),'utf8'));
  const packet=JSON.parse(await readFile(path.join(root,'templates/evidence.example.json'),'utf8'));
  data.people[0].notes='PRIVATE-NOTE-SHOULD-NOT-EXPORT';
  await writeFile(path.join(dir,'case.json'),JSON.stringify(data));await writeFile(path.join(dir,'evidence.json'),JSON.stringify(packet));
  const preview=JSON.parse(cli('tree-preview',dir,'--json'));
  assert.equal(preview.diff.connections.added.length,1);
  const first=JSON.parse(cli('tree-apply',dir,'--json'));
  browser=await chromium.launch({headless:true,...(option('--channel')?{channel:option('--channel')}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const open=async viewer=>{await page.goto(await serve(viewer));await page.waitForFunction(()=>window.drevo);};
  const person=async()=>{await page.locator('#search').fill('Вера');await page.locator('#matches button').first().click();};
  await open(first.viewerDir);await person();
  await page.locator('#details .evidence-button').first().click();
  const evidence=await page.locator('#evidence-body').textContent();
  assert(evidence.includes('Сергей был отцом Веры')&&evidence.includes('Демонстрационный фрагмент 1'));
  assert(evidence.includes('Для дерева: sergey → vera · parent-child'));
  assert.equal(await page.locator('#evidence-body a').getAttribute('href'),'https://example.invalid/drevo/demo-interview');
  assert(!JSON.stringify(await page.evaluate(()=>fetch('tree.json').then(r=>r.json()))).includes('PRIVATE-NOTE'));
  console.log('PASS CLI-generated relationship opens its exact citation in browser');
  data.people[0].name='Вера Сергеевна Учебная';await writeFile(path.join(dir,'case.json'),JSON.stringify(data));
  const change=JSON.parse(cli('tree-preview',dir,'--json'));assert.deepEqual(change.diff.people.updated,['vera']);
  const second=JSON.parse(cli('tree-apply',dir,'--json'));
  await open(second.viewerDir);await person();assert((await page.locator('#details').textContent()).includes('Вера Сергеевна Учебная'));
  console.log('PASS changed research becomes a new complete viewer');
  const undone=JSON.parse(cli('tree-undo',dir,'--json'));assert.equal(undone.revisionId,first.revisionId);
  await open(undone.viewerDir);await person();assert((await page.locator('#details').textContent()).includes('Вера Сергеевна Озёрная'));
  assert.equal(JSON.parse(await readFile(path.join(dir,'case.json'),'utf8')).people[0].name,'Вера Сергеевна Учебная');
  assert.deepEqual(errors,[]);
  console.log('PASS undo restores rendered state and preserves latest research');
  console.log(JSON.stringify({ok:true,browserChecks:3,fictionalOnly:true}));
} finally {if(browser)await browser.close();await stop();await rm(temp,{recursive:true,force:true});}
