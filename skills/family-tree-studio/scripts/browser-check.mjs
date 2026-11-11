// Optional end-to-end checks. Uses an already installed Playwright; never downloads a browser.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const args = process.argv.slice(2), option = key => args.includes(key) ? args[args.indexOf(key) + 1] : null;
const modulePath = option('--playwright-module');
let chromium;
try { ({ chromium } = await import(modulePath ? pathToFileURL(path.resolve(modulePath)).href : 'playwright')); }
catch { throw Error('Нужен установленный Playwright. Укажите --playwright-module <путь-к-index.mjs>; установка не выполняется.'); }
const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(path.join(tmpdir(), 'drevo-browser-check-')), project = path.join(temp, 'viewer');
const command = (file, parameters = []) => { const r = spawnSync(process.execPath, [file, ...parameters], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
let browser, server, checks = 0;
const passed = label => { checks++; console.log('PASS ' + label); };
try {
  command(path.join(skill, 'scripts/create-project.mjs'), ['--out', project]);
  const file = path.join(project, 'data/family.json'), fixture = JSON.parse(await readFile(file, 'utf8'));
  const paternal = fixture.connections.find(c => c.a === 'gleb' && c.b === 'mira');
  paternal.evidence[0].sources[0].title = '<img src=x onerror="window.__injected=true">';
  paternal.evidence[0].assertionLabel = 'Родитель: Глеб Листов → Мира Листова';
  paternal.evidence[0].sources[0].reading = '<script>window.__injected=true</script>';
  paternal.evidence[0].sources[0].url = 'javascript:window.__injected=true';
  paternal.evidence[0].sources.push({ id: 'safe-second', title: 'Другой вымышленный источник', url: 'https://example.invalid/safe', locator: 'Учебная страница 2', reading: 'Синтетическое прочтение', reasoning: 'Синтетическое объяснение', information: 'secondary', type: 'negative', negativeScope: 'Синтетический полный охват: страницы 1–20', form: 'derivative', accessedAt: '2026-11-11' });
  await writeFile(file, JSON.stringify(fixture));
  server = spawn(process.execPath, [path.join(project, 'scripts/serve.mjs'), '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Сервер не запустился')), 5000);
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.stdout.on('data', chunk => { const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+\//); if (match) { clearTimeout(timer); resolve(match[0]); } });
  });
  browser = await chromium.launch({ headless: true, ...(option('--channel') ? { channel: option('--channel') } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], external = []; page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (!request.url().startsWith(url) && !request.url().startsWith('data:')) external.push(request.url()); });
  const load = async () => { await page.goto(url); await page.waitForFunction(() => window.drevo); };
  const search = async value => { await page.locator('#search').fill(value); await page.locator('#matches button').first().click(); };
  const closeEvidence = async () => page.getByRole('button', { name: 'Закрыть основания', exact: true }).click();
  await load(); assert.equal(await page.locator('.leaf').count(), 9);
  assert(await page.locator('[data-connection-line="home-gleb-mira"]').evaluate(el => el.classList.contains('documented')));
  assert(await page.locator('[data-connection-line="home-vera-mira"]').evaluate(el => el.classList.contains('hypothesis'))); passed('independent parent evidence states');
  await search('Мира');
  await page.locator('#details').getByRole('button', { name: 'Почему эта связь: Глеб Листов — Мира Листова', exact: true }).click();
  const evidenceText = await page.locator('#evidence-body').textContent(); assert(evidenceText.includes('Где именно') && evidenceText.includes('Что прочитано') && evidenceText.includes('Как это связано'));
  assert(evidenceText.includes('Для дерева: Родитель: Глеб Листов → Мира Листова')); passed('typed assertion label is readable');
  assert(evidenceText.includes('Синтетический полный охват: страницы 1–20') && evidenceText.includes('Производная копия') && evidenceText.includes('2026-11-11')); passed('negative scope and source metadata visible');
  assert.equal(await page.locator('#evidence-body img, #evidence-body script').count(), 0);
  assert.equal(await page.evaluate(() => window.__injected || false), false);
  assert.deepEqual(await page.locator('#evidence-body a').evaluateAll(links => links.map(a => a.href)), ['https://example.invalid/safe']); passed('citation locator reading reasoning safe URLs and escaped HTML');
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#evidence-dialog').evaluate(el => el.open), false); assert.equal((await page.evaluate(() => drevo.getState())).selected, 'mira'); passed('Escape closes evidence and preserves selected person');
  await page.locator('#mode').selectOption('path'); await page.locator('#target').selectOption('t1');
  assert((await page.locator('#selection-note').textContent()).includes('не доказано'));
  assert((await page.locator('#detail-body .path-step .evidence-button').count()) > 0);
  await page.locator('#detail-body .path-step .evidence-button').first().click(); assert.equal(await page.locator('#evidence-dialog').evaluate(el => el.open), true); await closeEvidence(); passed('path retains hypothesis warning and evidence action');
  await page.locator('#target').selectOption('candidate'); assert((await page.locator('#selection-note').textContent()).includes('нет установленной')); passed('unconnected candidate is not attached');
  await page.locator('#close-details').click();
  const branch = page.locator('[data-connection="roots-l1-gleb"]'); await branch.focus(); await branch.press('Enter'); assert.equal(await page.locator('#evidence-dialog').evaluate(el => el.open), true); await closeEvidence(); passed('branch evidence works with keyboard');
  const point = await branch.evaluate(el => { const point = el.getPointAtLength(el.getTotalLength() * .5); const result = new DOMPoint(point.x, point.y).matrixTransform(el.getScreenCTM()); return { x: result.x, y: result.y }; });
  await page.mouse.click(point.x, point.y); assert.equal(await page.locator('#evidence-dialog').evaluate(el => el.open), true); assert((await page.locator('#evidence-subtitle').textContent()).includes('Леонид Листов')); await closeEvidence(); passed('branch evidence works by clicking its curve');
  await search('Леонид'); await page.getByRole('button', { name: 'Основания сведений: Леонид Листов', exact: true }).click(); assert((await page.locator('#evidence-body').textContent()).includes('Учебная книга, страница 12')); await closeEvidence(); passed('person event evidence opens from person panel');
  fixture.connections.find(c => c.a === 'vera' && c.b === 'mira').confidence = 'documented';
  await writeFile(file, JSON.stringify(fixture)); command(path.join(project, 'scripts/build.mjs')); await load(); await search('Мира');
  assert((await page.locator('#selection-note').textContent()).includes('неразрешённое противоречие'));
  await page.locator('#details').getByRole('button', { name: 'Почему эта связь: Вера Листова — Мира Листова', exact: true }).click();
  assert((await page.locator('#evidence-subtitle').textContent()).includes('по документу'));
  assert((await page.locator('#evidence-body .evidence-warning').textContent()).includes('неразрешённое противоречие')); await closeEvidence(); passed('documented connection cannot hide unresolved conflict');
  fixture.connections.find(c => c.a === 'l1' && c.b === 'gleb').type = 'guardian'; fixture.connections.find(c => c.a === 'l2' && c.b === 'gleb').type = 'adoptive';
  await writeFile(file, JSON.stringify(fixture)); command(path.join(project, 'scripts/build.mjs')); await load(); await search('Мира'); await page.locator('#mode').selectOption('ancestors');
  const ancestry = await page.evaluate(() => drevo.getState()); assert(!ancestry.people.includes('l1')); assert(ancestry.people.includes('l2')); passed('guardianship excluded from ancestry, adoption preserved');
  await page.locator('#close-details').click(); await search('семен'); assert.equal((await page.evaluate(() => drevo.getState())).selected, 'semen'); passed('search preserves e/yo behavior');
  const zoom = (await page.evaluate(() => drevo.getState())).zoom; await page.locator('#zoom-in').click(); assert((await page.evaluate(() => drevo.getState())).zoom > zoom); passed('zoom remains functional');
  await page.setViewportSize({ width: 390, height: 844 }); await load(); await search('Мира'); await page.locator('#details .evidence-button').first().click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  assert(await page.locator('#evidence-dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1)); passed('evidence drawer fits narrow viewport');
  assert.deepEqual(errors, []); assert.deepEqual(external, []); passed('no page errors or automatic external requests');
  console.log(JSON.stringify({ ok: true, browserChecks: checks, fictionalOnly: true }));
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) { const stopped = new Promise(resolve => server.once('exit', resolve)); server.kill(); await stopped; }
  await rm(temp, { recursive: true, force: true });
}
