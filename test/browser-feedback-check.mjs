// Real viewer + browser UI; receiver requests are intercepted, never delivered externally.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args=process.argv.slice(2),option=name=>args.includes(name)?args[args.indexOf(name)+1]:null;
const {chromium}=await import(option('--playwright-module')?pathToFileURL(path.resolve(option('--playwright-module'))).href:'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),temp=await mkdtemp(path.join(tmpdir(),'drevo-feedback-')),project=path.join(temp,'viewer');
let browser,server,checks=0;
const pass=label=>{checks++;console.log('PASS '+label);};
const configPath=path.join(project,'src/feedback-config.json');
const start=async config=>{
  if(server){server.kill();await once(server,'exit');server=null;}
  await writeFile(configPath,JSON.stringify(config));
  server=spawn(process.execPath,[path.join(project,'scripts/serve.mjs'),'--port','0'],{stdio:['ignore','pipe','pipe']});
  return new Promise((resolve,reject)=>{
    let stderr='';const timer=setTimeout(()=>reject(Error(`Synthetic server did not start: ${stderr}`)),8000);
    server.stderr.on('data',chunk=>stderr+=chunk);server.once('error',error=>{clearTimeout(timer);reject(error);});
    server.stdout.on('data',chunk=>{const match=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+\//);if(match){clearTimeout(timer);resolve(match[0]);}});
    server.once('exit',code=>{clearTimeout(timer);reject(Error(`Synthetic server exited (${code}): ${stderr}`));});
  });
};
try {
  const created=spawnSync(process.execPath,[path.join(root,'skills/family-tree-studio/scripts/create-project.mjs'),'--out',project],{encoding:'utf8'});
  assert.equal(created.status,0,created.stderr);
  const fixture=JSON.parse(await readFile(path.join(project,'data/family.json'),'utf8')),person=fixture.persons.find(p=>p.id===fixture.rootPerson);
  browser=await chromium.launch({headless:true,...(option('--channel')?{channel:option('--channel')}:{})});
  {
    const url=await start({enabled:false,ready:false}),context=await browser.newContext(),page=await context.newPage();
    const requests=[];page.on('request',request=>requests.push(request.url()));
    await page.goto(url);await page.waitForFunction(()=>window.drevo);await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('#add-information').count(),0);assert.equal(await page.locator('#feedback-dialog').count(),0);
    assert(requests.every(request=>request.startsWith(url)));pass('default public template makes no receiver requests and has no contribution form');await context.close();
  }
  for(const provider of ['formsubmit','webhook']) {
    const endpoint=provider==='formsubmit'?'https://formsubmit.co/ajax/synthetic-test-id':'https://receiver.example.invalid/family/inbox';
    const url=await start({enabled:true,ready:true,provider,endpoint,recipientName:'владельцу учебного дерева'});
    for(const [width,height] of [[320,740],[390,844],[844,390],[1440,900]]) {
      const siteURL=width===1440?`${url}nested/family/`:url;
      const context=await browser.newContext({viewport:{width,height},hasTouch:width<1000,isMobile:width<1000}),page=await context.newPage(),errors=[],requests=[];
      let mode='reject',release;
      page.on('pageerror',error=>errors.push(error.message));
      await context.route('**/*',async route=>{
        const request=route.request();
        if(siteURL!==url && request.url().startsWith(siteURL)){
          // Model a static host mounting the generated dist directory in a subpath.
          const response=await route.fetch({url:url+request.url().slice(siteURL.length)});await route.fulfill({response});return;
        }
        if(request.url().startsWith(url)){await route.continue();return;}
        assert.equal(request.url(),endpoint,'Unexpected outgoing request');
        assert.equal(request.method(),'POST');requests.push(request.postDataJSON());
        if(mode==='pending')await new Promise(resolve=>release=resolve);
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:mode==='reject'?false:true}),headers:{'access-control-allow-origin':new URL(url).origin}});
      });
      await page.goto(`${siteURL}?preview=private-test`);await page.waitForFunction(()=>window.drevo);
      await page.locator('#add-information').waitFor();
      // Open from the person sheet: the button must carry the current person.
      await page.locator('#search').fill(person.name);await page.locator('#matches button').first().click();
      await page.locator('.feedback-person-open').click();await page.locator('#feedback-name').fill('Вымышленный родственник');
      assert.equal(await page.locator('#feedback-person').inputValue(),person.id);
      await page.locator('#feedback-email').fill('relative@example.invalid');
      const memory='Вымышленное воспоминание для браузерной проверки.';
      await page.locator('#feedback-message').fill(memory);await page.locator('#feedback-source').fill('Учебный источник');
      if(option('--screenshots-dir') && provider==='formsubmit' && width===390){
        const output=path.resolve(option('--screenshots-dir'));await mkdir(output,{recursive:true});
        await page.locator('#feedback-dialog').evaluate(dialog=>dialog.scrollTop=0);
        await page.screenshot({path:path.join(output,'feedback-mobile.png')});
      }
      const geometry=await page.locator('#feedback-dialog').evaluate(dialog=>({rect:dialog.getBoundingClientRect().toJSON(),scroll:dialog.scrollWidth,client:dialog.clientWidth,viewport:innerWidth}));
      assert(geometry.rect.x>=0&&geometry.rect.right<=width+1);assert(geometry.scroll<=geometry.client+1,'Form must not overflow sideways');
      if(width<1000){const size=await page.locator('#feedback-name').evaluate(input=>parseFloat(getComputedStyle(input).fontSize));assert(size>=16,'Mobile text inputs must avoid focus zoom');}
      await page.locator('.feedback-submit').click();await page.locator('.feedback-status.failed').waitFor();
      assert.equal(requests.length,1);assert.equal(await page.locator('#feedback-message').inputValue(),memory);
      await page.locator('#close-feedback').click();await page.locator('.feedback-person-open').click();
      assert.equal(await page.locator('#feedback-message').inputValue(),memory);assert.equal(await page.locator('#feedback-person').inputValue(),person.id);
      const payload=requests[0];
      if(provider==='formsubmit'){assert.equal(payload['О ком'],person.name);assert.equal(payload.Воспоминание,memory);assert.equal(payload._url,`${siteURL}#person=${person.id}`);}
      else {assert.equal(payload.person.id,person.id);assert.equal(payload.person.name,person.name);assert.equal(payload.message,memory);assert.equal(payload.tree.url,`${siteURL}#person=${person.id}`);}
      assert(!JSON.stringify(payload).includes('private-test'));
      mode='pending';await page.locator('.feedback-submit').click();await page.waitForFunction(()=>document.getElementById('feedback-form').getAttribute('aria-busy')==='true');
      assert.equal(await page.locator('.feedback-submit').isDisabled(),true);assert.equal(await page.locator('#close-feedback').isDisabled(),true);
      await page.locator('#feedback-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
      // Wait for the intercepted request so releasing its response cannot race the event loop.
      for(let attempt=0;!release&&attempt<100;attempt++)await new Promise(resolve=>setTimeout(resolve,10));
      assert(release,'Receiver request not reached');assert.equal(requests.length,2,'Busy form must not issue a duplicate request');
      mode='accept';release();await page.locator('.feedback-status.success').waitFor();
      assert.equal(await page.locator('#feedback-message').inputValue(),'');assert.equal(await page.locator('#feedback-source').inputValue(),'');
      assert.equal(await page.locator('.feedback-submit').isDisabled(),false);
      await page.keyboard.press('Escape');assert.equal(await page.locator('#feedback-dialog').evaluate(dialog=>dialog.open),false);
      assert.equal(await page.locator('.feedback-person-open').evaluate(button=>button===document.activeElement),true);
      assert.deepEqual(errors,[]);pass(`${provider} ${width}×${height}${siteURL!==url?' subpath':''}: selected person, rejection/draft, single in-flight request, explicit success and usable dialog`);
      await context.close();
    }
  }
  console.log(JSON.stringify({ok:true,checks,fictionalOnly:true,externalMessagesSent:0}));
} finally {await browser?.close();server?.kill();await rm(temp,{recursive:true,force:true});}
