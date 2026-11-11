#!/usr/bin/env node
import { readFile, writeFile, mkdir, readdir, copyFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRegistry, validateCase, buildPlan, formatPlan } from '../lib/planner.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readJSON = async file => JSON.parse(await readFile(file, 'utf8'));
const registry = async () => validateRegistry(await readJSON(path.join(root, 'registry/resources.json')));
const usage = `Древо 0.3.0 — инструменты генеалогического исследования

  node bin/drevo.mjs init <новая-папка-вне-репозитория>
  node bin/drevo.mjs plan <case.json> [--all] [--limit 3] [--paid] [--json]
  node bin/drevo.mjs audit <evidence.json> [--case <case.json>] [--json]
  node bin/drevo.mjs tree-preview <папка-дела> [--include-hypotheses] [--public] [--json]
  node bin/drevo.mjs tree-apply <папка-дела> [--json]
  node bin/drevo.mjs tree-undo <папка-дела> [--json]
  node bin/drevo.mjs dossier <папка-дела> [--port 4174] [--include-hypotheses]
  node bin/drevo.mjs sources [--paid] [--json]
  node bin/drevo.mjs check

Планировщик не выполняет веб-поиск и не оплачивает доступ.
Для исследования дайте агенту skills/genealogy-research/SKILL.md и браузер.
Для визуализации: npm run demo или skills/family-tree-studio/SKILL.md.
`;

async function initializeCase(target) {
  if (!target) throw Error('Укажите новую частную папку вне репозитория');
  const resolved = path.resolve(target);
  // Resolve existing ancestors to prevent accidentally creating a case through a symlink into the repository.
  let ancestor = path.dirname(resolved), tail = [path.basename(resolved)];
  while (true) {
    try { ancestor = await realpath(ancestor); break; }
    catch (e) { if (e.code !== 'ENOENT') throw e; tail.unshift(path.basename(ancestor)); ancestor = path.dirname(ancestor); }
  }
  const destination = path.join(ancestor, ...tail), canonicalRoot = await realpath(root);
  if (destination === canonicalRoot || destination.startsWith(canonicalRoot + path.sep)) throw Error('Семейное дело должно находиться вне публичного репозитория');
  await mkdir(path.dirname(destination), {recursive: true});
  // An existing directory is deliberately not reused or overwritten.
  await mkdir(destination, {mode: 0o700});
  const data = {schemaVersion: 1, title: 'Моя семейная история', goal: '', rootPersonId: null,
    regions: [], period: {from: null, to: null}, people: [], questions: [],
    constraints: {freeFirst: true, allowPaid: false, browserAvailable: false}, completedSearches: []};
  await writeFile(path.join(destination, 'case.json'), JSON.stringify(data, null, 2) + '\n', {mode: 0o600});
  await writeFile(path.join(destination, 'evidence.json'), JSON.stringify({schemaVersion: 1, sources: [], claims: []}, null, 2) + '\n', {mode: 0o600});
  await writeFile(path.join(destination, '.gitignore'), '*\n', {mode: 0o600});
  for (const dirname of ['originals', 'working', 'reports']) await mkdir(path.join(destination, dirname), {mode: 0o700});
  for (const entry of await readdir(path.join(root, 'templates'))) if (entry !== 'README.md' && /\.(md|csv)$/.test(entry)) await copyFile(path.join(root, 'templates', entry), path.join(destination, entry));
  await writeFile(path.join(destination, 'README.md'), `# Частное семейное дело\n\nНачните с intake.md и case.json. Документы храните в originals/, производные копии — в working/, итоги — в reports/.\n\nИнструкция для агента: ${path.join(root, 'skills/genealogy-research/SKILL.md')}\n\nЭта папка содержит частные материалы. Не добавляйте её в публичный репозиторий продукта.\n`, {mode: 0o600});
  console.log(`Создано частное дело: ${destination}\nЗаполните интервью и case.json. Вымышленные родственники в дело не добавлены.`);
}

try {
  const [command = 'help', ...args] = process.argv.slice(2);
  const flagsByCommand = {
    dossier:['--port','--include-hypotheses'],sources:['--json','--paid'],plan:['--json','--all','--paid','--limit'],audit:['--json','--case'],
    'tree-preview':['--json','--public','--include-hypotheses'],'tree-apply':['--json'],'tree-undo':['--json'],
  };
  const values = new Map(), positional = [];
  for (let i=0; i<args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    if (!(flagsByCommand[command] || []).includes(arg) || values.has(arg)) throw Error(`Неизвестный или повторный параметр: ${arg}`);
    if (['--case','--limit','--port'].includes(arg)) {
      if (!args[i+1] || args[i+1].startsWith('--')) throw Error(`Нужно значение ${arg}`);
      values.set(arg,args[++i]);
    } else values.set(arg,true);
  }
  const expected = ['init','plan','audit','tree-preview','tree-apply','tree-undo','dossier'].includes(command) ? 1 : 0;
  if (positional.length !== expected) throw Error(`Команда ${command} ожидает ${expected} аргумент(а).\n${usage}`);
  const json = values.has('--json');
  if (command === 'help' || command === '--help' || command === '-h') console.log(usage);
  else if (command === 'init') await initializeCase(positional[0]);
  else if (command === 'plan') {
    const plan = buildPlan(await readJSON(positional[0]), await registry(), {all:values.has('--all'),paid:values.has('--paid'),limit:values.has('--limit') ? Number(values.get('--limit')) : 3});
    console.log(json ? JSON.stringify(plan, null, 2) : formatPlan(plan));
  } else if (command === 'audit') {
    const {auditEvidence} = await import('../lib/evidence.mjs');
    const packet = await readJSON(positional[0]);
    const {auditCase} = await import('../lib/projection.mjs');
    const report = values.has('--case') ? auditCase(await readJSON(values.get('--case')),packet) : auditEvidence(packet);
    console.log(json ? JSON.stringify(report, null, 2) : [report.notice, ...report.issues.map(x => `${x.severity.toUpperCase()} ${x.claimId || 'packet'}: ${x.message}`), `Ошибок: ${report.errors}; замечаний: ${report.warnings}`].join('\n'));
    if (report.errors) process.exitCode = 1;
  } else if (['tree-preview','tree-apply','tree-undo'].includes(command)) {
    const {previewTree,applyTree,undoTree,formatPreview} = await import('../lib/tree-store.mjs');
    const result = command === 'tree-preview' ? await previewTree(positional[0],{public:values.has('--public'),includeHypotheses:values.has('--include-hypotheses')}) : command === 'tree-apply' ? await applyTree(positional[0]) : await undoTree(positional[0]);
    console.log(json ? JSON.stringify(result,null,2) : command === 'tree-preview' ? formatPreview(result) : `${result.notice || 'Версия дерева применена.'}\n${result.viewerDir ? `Viewer: ${result.viewerDir}\nЗапуск из его папки: npm run dev` : 'Текущее дерево отсутствует; сохранённые версии доступны в .drevo/revisions/.'}`);
  } else if (command === 'dossier') {
    const {startDossierServer} = await import('../lib/dossier-server.mjs');
    const app = await startDossierServer(positional[0],{port:values.has('--port') ? Number(values.get('--port')) : 4174,includeHypotheses:values.has('--include-hypotheses')});
    console.log(`Локальное семейное дело: ${app.url}\nОписание и прикреплённые материалы сохраняются в папке дела. Для остановки: Ctrl+C.`);
    for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{app.server.close();app.server.closeAllConnections();});
  } else if (command === 'sources') {
    const r = await registry();
    const entries = args.includes('--paid') ? r.resources.filter(x => x.cost === 'paid') : r.resources;
    console.log(json ? JSON.stringify(entries, null, 2) : entries.map(x => `${x.id} · ${x.name} · ${x.cost} · ${x.verification.status}\n  ${x.url}\n  ${x.whenToUse}`).join('\n\n'));
  } else if (command === 'check') {
    const r = await registry();
    const data = await readJSON(path.join(root, 'templates/case.example.json'));
    validateCase(data);
    const {projectCase} = await import('../lib/projection.mjs');
    projectCase(data,await readJSON(path.join(root, 'templates/evidence.example.json')));
    const routes = await readJSON(path.join(root,'registry/browser-routes.json'));
    for (const route of routes.routes) await readFile(path.join(root,route.routeFile),'utf8');
    console.log(`Реестр: ${r.resources.length} маршрутов, ${r.resources.filter(x => x.cost === 'paid').length} платных. Пример дела: валиден.`);
  } else throw Error(`Неизвестная команда: ${command}\n${usage}`);
} catch (error) {
  console.error(`Древо: ${error.message}`);
  process.exitCode = 1;
}
