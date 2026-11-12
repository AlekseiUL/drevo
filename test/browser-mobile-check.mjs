// Synthetic mobile browser checks; uses installed Playwright and never downloads a browser.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args=process.argv.slice(2), option=name=>args.includes(name)?args[args.indexOf(name)+1]:null;
const {chromium}=await import(option('--playwright-module')?pathToFileURL(path.resolve(option('--playwright-module'))).href:'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), temp=await mkdtemp(path.join(tmpdir(),'drevo-mobile-')), project=path.join(temp,'viewer');
let browser,server,checks=0;
const pass=label=>{checks++;console.log('PASS '+label);};
try {
  const created=spawnSync(process.execPath,[path.join(root,'skills/family-tree-studio/scripts/create-project.mjs'),'--out',project],{encoding:'utf8'});
  assert.equal(created.status,0,created.stderr);
  const fixture=JSON.parse(await readFile(path.join(project,'data/family.json'),'utf8'));
  server=spawn(process.execPath,[path.join(project,'scripts/serve.mjs'),'--port','0'],{stdio:['ignore','pipe','pipe']});
  const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Synthetic server did not start')),8000);server.once('error',reject);server.stdout.on('data',chunk=>{const match=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+\//);if(match){clearTimeout(timer);resolve(match[0]);}});});
  browser=await chromium.launch({headless:true,...(option('--channel')?{channel:option('--channel')}:{})});
  for(const [width,height] of [[320,844],[390,844],[768,844],[1440,844],[320,568],[740,390],[844,390]]) {
    const mobile=width<=800||(width<=950&&height<=500), viewportLabel=`${width}×${height}`;
    const context=await browser.newContext({viewport:{width,height},hasTouch:mobile,isMobile:mobile});
    const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);await page.waitForFunction(()=>window.drevo);
    const metrics=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,zoom:drevo.getState().zoom,
      search:document.getElementById('search').getBoundingClientRect().toJSON(),root:document.querySelector('.leaf.root').getBoundingClientRect().toJSON(),
      tools:document.querySelector('.tools').getBoundingClientRect().toJSON()}));
    assert(metrics.scroll<=metrics.width+1,`${width}: body overflows`);
    assert(metrics.search.x>=0&&metrics.search.right<=width+1,`${width}: search clipped`);
    assert(metrics.tools.x>=0&&metrics.tools.right<=width+1,`${width}: controls clipped`);
    if(mobile){assert(metrics.zoom>=.9);assert(metrics.root.width>=207);assert(metrics.root.x>=0&&metrics.root.right<=width);assert(metrics.root.bottom<metrics.tools.top);
      const targets=await page.locator('.zoom-tools button,#about').evaluateAll(nodes=>nodes.map(x=>({w:x.getBoundingClientRect().width,h:x.getBoundingClientRect().height})));assert(targets.every(x=>x.w>=44&&x.h>=44));}
    pass(`${viewportLabel}: readable initial family, search and controls fit`);
    await page.locator('#search').fill(fixture.persons.find(p=>p.id===fixture.rootPerson).name);
    await page.locator('#matches button').first().click();
    await page.waitForFunction(()=>!document.getElementById('details').hidden);
    const panel=await page.locator('#details').boundingBox(), close=await page.locator('#close-details').boundingBox();
    assert(panel.x>=0&&panel.x+panel.width<=width+1);
    if(mobile){assert(close.width>=44&&close.height>=44);assert.equal(await page.locator('#details').getAttribute('aria-modal'),'true');assert.equal(await page.locator('#search').evaluate(x=>x===document.activeElement),false);}
    await page.locator('#details .evidence-button').first().click();
    assert.equal(await page.locator('#evidence-dialog').evaluate(x=>x.open),true);
    const dialog=await page.locator('#evidence-dialog').boundingBox();assert(dialog.x>=0&&dialog.x+dialog.width<=width+1);
    await page.keyboard.press('Escape');assert.equal(await page.locator('#evidence-dialog').evaluate(x=>x.open),false);
    assert.equal((await page.evaluate(()=>drevo.getState())).selected,fixture.rootPerson);
    await page.locator('#close-details').click();
    pass(`${viewportLabel}: person sheet and nested evidence remain usable`);
    if(width===390){
      // Multiple native moves are essential: implicit capture can transfer after the first move.
      const cdp=await context.newCDPSession(page);
      const touch=(type,touchPoints=[])=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints});
      const camera=()=>page.evaluate(()=>{
        const state=drevo.getState(),matrix=new DOMMatrix(getComputedStyle(document.getElementById('world')).transform);
        return {left:state.left,top:state.top,zoom:state.zoom,selected:state.selected,visualLeft:matrix.e,visualTop:matrix.f,visualZoom:matrix.a};
      });
      const approximately=(actual,expected,label)=>assert(Math.abs(actual-expected)<.1,`${label}: expected ${expected}, got ${actual}`);
      const expectCamera=async(expected,label)=>{
        // CDP acknowledges a touch before Chromium necessarily dispatches its coalesced move.
        await page.waitForFunction(target=>{
          const state=drevo.getState();
          return ['left','top','zoom'].every(key=>target[key]==null||Math.abs(state[key]-target[key])<.1);
        },expected,{timeout:1000}).catch(()=>{});
        const actual=await camera();
        for(const key of ['left','top','zoom']) if(expected[key]!=null)approximately(actual[key],expected[key],`${label} ${key}`);
        approximately(actual.visualLeft,actual.left,`${label} rendered left`);approximately(actual.visualTop,actual.top,`${label} rendered top`);approximately(actual.visualZoom,actual.zoom,`${label} rendered zoom`);
        assert.equal(actual.selected,null,`${label}: gesture must not open a card`);
      };
      const rootPoint=async()=>{await page.evaluate(id=>drevo.center(id,1),fixture.rootPerson);const box=await page.locator('.leaf.root').boundingBox();return {x:box.x+box.width/2,y:box.y+box.height/2};};
      const origin=await rootPoint(),before=await camera();
      await touch('touchStart',[{...origin,id:1}]);
      for(let step=1;step<=12;step++){
        await touch('touchMove',[{x:origin.x+step*8,y:origin.y-step*7,id:1}]);
        await expectCamera({left:before.left+step*8,top:before.top-step*7,zoom:1},`continuous card pan step ${step}`);
      }
      await touch('touchEnd');await expectCamera({left:before.left+96,top:before.top-84},'pan released');
      pass('390px: every native touch move follows the finger after card capture transfers');

      const center=await rootPoint(),pinchStart=await camera();
      const worldX=(center.x-pinchStart.left)/pinchStart.zoom,worldY=(center.y-pinchStart.top)/pinchStart.zoom;
      await touch('touchStart',[{x:center.x-35,y:center.y,id:1},{x:center.x+35,y:center.y,id:2}]);
      let remaining,lifted;
      for(let step=1;step<=8;step++){
        const x=center.x+step*3,y=center.y-step*2,span=35+step*4;
        remaining={x:x-span,y:y-step*2,id:1};
        lifted={x:x+span,y:y+step*2,id:2};
        await touch('touchMove',[remaining,lifted]);
        const zoom=Math.hypot(span*2,step*4)/70;
        await expectCamera({zoom,left:x-worldX*zoom,top:y-worldY*zoom},`pinch step ${step}`);
      }
      // Lifting one finger keeps the other contact active and must not jump the view.
      // CDP touchEnd lists contacts being lifted, not the contacts that stay down.
      const beforeLift=await camera();await touch('touchEnd',[lifted]);await expectCamera(beforeLift,'one finger lifted');
      for(let step=1;step<=6;step++){
        await touch('touchMove',[{x:remaining.x+step*6,y:remaining.y+step*3,id:1}]);
        await expectCamera({left:beforeLift.left+step*6,top:beforeLift.top+step*3,zoom:beforeLift.zoom},`pan after pinch step ${step}`);
      }
      await touch('touchEnd');
      pass('390px: continuous pinch and one-finger continuation keep the view anchored');

      const cancelPoint=await rootPoint();await touch('touchStart',[{...cancelPoint,id:1}]);
      await touch('touchMove',[{x:cancelPoint.x+15,y:cancelPoint.y-12,id:1}]);await touch('touchCancel');
      assert.equal(await page.locator('#garden').evaluate(el=>el.classList.contains('dragging')),false);
      const restart=await rootPoint(),afterCancel=await camera();await touch('touchStart',[{...restart,id:1}]);
      for(let step=1;step<=3;step++){
        await touch('touchMove',[{x:restart.x-step*9,y:restart.y-step*5,id:1}]);
        await expectCamera({left:afterCancel.left-step*9,top:afterCancel.top-step*5,zoom:1},`new drag after cancel step ${step}`);
      }
      await touch('touchEnd');
      await page.waitForTimeout(500);await rootPoint();
      const tap=await page.locator('.leaf.root').boundingBox();await page.touchscreen.tap(tap.x+tap.width/2,tap.y+tap.height/2);
      assert.equal((await page.evaluate(()=>drevo.getState())).selected,fixture.rootPerson);
      pass('390px: cancelled touch resets the gesture and an ordinary tap still opens a card');
      await page.locator('#close-details').click();
      await page.setViewportSize({width:844,height:390});
      await page.waitForFunction(()=>{const card=document.querySelector('.leaf.root').getBoundingClientRect(),tools=document.querySelector('.tools').getBoundingClientRect();return card.bottom<tools.top&&card.y>100;});
      const landscape=await page.locator('.leaf.root').boundingBox();assert(landscape.width>=207);
      await page.setViewportSize({width,height});
      await page.waitForFunction(()=>{const card=document.querySelector('.leaf.root').getBoundingClientRect(),tools=document.querySelector('.tools').getBoundingClientRect();return card.bottom<tools.top&&card.y>200;});
      pass('390px: rotating to landscape and back keeps the focused family above controls');
    }
    await page.locator('#fit').click();
    const visible=await page.locator('.generation-caption').evaluateAll(nodes=>nodes.map(x=>x.getBoundingClientRect().x));assert(visible.every(x=>x>=0));
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log(JSON.stringify({ok:true,checks,fictionalOnly:true}));
} finally {await browser?.close();server?.kill();await rm(temp,{recursive:true,force:true});}
