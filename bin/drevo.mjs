#!/usr/bin/env node
import { readFile, writeFile, mkdir, readdir, copyFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRegistry, validateCase, buildPlan, formatPlan } from '../lib/planner.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readJSON = async file => JSON.parse(await readFile(file, 'utf8'));
const registry = async () => validateRegistry(await readJSON(path.join(root, 'registry/resources.json')));
const usage = `Древо 0.1.0 — инструменты генеалогического исследования

  node bin/drevo.mjs init <новая-папка-вне-репозитория>
  node bin/drevo.mjs plan <case.json> [--json]
  node bin/drevo.mjs audit <evidence.json> [--json]
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
  const allowedFlags = command === 'sources' ? ['--json', '--paid'] : ['plan', 'audit'].includes(command) ? ['--json'] : [];
  for (const arg of args) if (arg.startsWith('--') && !allowedFlags.includes(arg)) throw Error(`Неизвестный параметр: ${arg}`);
  const positional = args.filter(a => !a.startsWith('--'));
  const expected = ['init', 'plan', 'audit'].includes(command) ? 1 : 0;
  if (positional.length !== expected) throw Error(`Команда ${command} ожидает ${expected} аргумент(а).\n${usage}`);
  const json = args.includes('--json');
  if (command === 'help' || command === '--help' || command === '-h') console.log(usage);
  else if (command === 'init') await initializeCase(positional[0]);
  else if (command === 'plan') {
    const plan = buildPlan(await readJSON(positional[0]), await registry());
    console.log(json ? JSON.stringify(plan, null, 2) : formatPlan(plan));
  } else if (command === 'audit') {
    const {auditEvidence} = await import('../lib/evidence.mjs');
    const report = auditEvidence(await readJSON(positional[0]));
    console.log(json ? JSON.stringify(report, null, 2) : [report.notice, ...report.issues.map(x => `${x.severity.toUpperCase()} ${x.claimId || 'packet'}: ${x.message}`), `Ошибок: ${report.errors}; замечаний: ${report.warnings}`].join('\n'));
    if (report.errors) process.exitCode = 1;
  } else if (command === 'sources') {
    const r = await registry();
    const entries = args.includes('--paid') ? r.resources.filter(x => x.cost === 'paid') : r.resources;
    console.log(json ? JSON.stringify(entries, null, 2) : entries.map(x => `${x.id} · ${x.name} · ${x.cost} · ${x.verification.status}\n  ${x.url}\n  ${x.whenToUse}`).join('\n\n'));
  } else if (command === 'check') {
    const r = await registry();
    validateCase(await readJSON(path.join(root, 'templates/case.example.json')));
    console.log(`Реестр: ${r.resources.length} маршрутов, ${r.resources.filter(x => x.cost === 'paid').length} платных. Пример дела: валиден.`);
  } else throw Error(`Неизвестная команда: ${command}\n${usage}`);
} catch (error) {
  console.error(`Древо: ${error.message}`);
  process.exitCode = 1;
}
