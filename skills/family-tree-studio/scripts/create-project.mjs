import { mkdir, readdir, cp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateFamily, layoutFamily, publicFamily } from '../assets/viewer/scripts/model.mjs';

const template = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/viewer');
const options = new Map();
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  if (!['--out', '--data'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Аргументы: --out <новая-папка> [--data <family.json>]');
  options.set(args[i], args[i + 1]);
}
if (!options.has('--out')) throw Error('Укажите новую папку через --out');
const destination = path.resolve(options.get('--out'));
if (destination === template || destination.startsWith(template + path.sep) || template.startsWith(destination + path.sep)) throw Error('Папка проекта не должна пересекаться с шаблоном');
const input = JSON.parse(await readFile(options.get('--data') ? path.resolve(options.get('--data')) : path.join(template, 'data/family.json'), 'utf8'));
validateFamily(input); layoutFamily(publicFamily(input));
let contents = [];
try { contents = await readdir(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (contents.length) throw Error('Папка не пуста: существующие файлы не перезаписываются');
await mkdir(destination, { recursive: true });
for (const entry of ['src', 'scripts', 'public', 'package.json', 'LICENSE', '.gitignore']) await cp(path.join(template, entry), path.join(destination, entry), { recursive: true });
await mkdir(path.join(destination, 'data')); await mkdir(path.join(destination, 'private/originals'), { recursive: true });
await writeFile(path.join(destination, 'data/family.json'), JSON.stringify(input, null, 2) + '\n');
console.log(`Создан проект: ${destination}\nСледующий шаг: npm run dev в папке проекта.`);
