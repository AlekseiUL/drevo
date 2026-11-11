import { readFile, rm, cp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const viewer = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skill = path.resolve(viewer, '../skills/family-tree-studio');
const demo = path.join(viewer, '.demo');
const [action = 'dev', ...extra] = process.argv.slice(2);
if (!['dev', 'build', 'preview'].includes(action)) throw Error('Поддерживаются dev, build, preview');
const input = JSON.parse(await readFile(path.join(skill, 'assets/viewer/data/family.json'), 'utf8'));
if (input.fictional !== true || input.demo !== true) throw Error('Демонстрационная сборка требует явно вымышленных данных');
async function nodeCommand(file, args = []) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], { stdio: 'inherit' });
    const stop = () => child.kill('SIGTERM'); process.once('SIGINT', stop); process.once('SIGTERM', stop);
    child.once('error', reject);
    child.once('exit', code => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); code === 0 ? resolve() : reject(Error(`Команда завершилась с кодом ${code}`)); });
  });
}
// This folder is always disposable and never accepts a user's case data.
await rm(demo, { recursive: true, force: true });
await nodeCommand(path.join(skill, 'scripts/create-project.mjs'), ['--out', demo]);
if (action === 'build') {
  await nodeCommand(path.join(demo, 'scripts/build.mjs'));
  await rm(path.join(viewer, 'dist'), { recursive: true, force: true });
  await cp(path.join(demo, 'dist'), path.join(viewer, 'dist'), { recursive: true });
  console.log('Демонстрационный сайт: viewer/dist/');
} else await nodeCommand(path.join(demo, 'scripts/serve.mjs'), extra);
