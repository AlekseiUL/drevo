import { mkdir, readdir, cp, readFile, writeFile, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateFamily, layoutFamily, publicFamily, contained } from '../assets/viewer/scripts/model.mjs';

import { verifyMaterialBytes } from '../assets/viewer/scripts/material-policy.mjs';

const template = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/viewer');
const options = new Map();
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  if (!['--out', '--data', '--assets-dir'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Аргументы: --out <новая-папка> [--data <family.json>] [--assets-dir <public-root>]');
  if (options.has(args[i])) throw Error(`Повторный параметр: ${args[i]}`);
  options.set(args[i], args[i + 1]);
}
if (!options.has('--out')) throw Error('Укажите новую папку через --out');
const destination = path.resolve(options.get('--out'));
if (destination === template || destination.startsWith(template + path.sep) || template.startsWith(destination + path.sep)) throw Error('Папка проекта не должна пересекаться с шаблоном');
const input = JSON.parse(await readFile(options.get('--data') ? path.resolve(options.get('--data')) : path.join(template, 'data/family.json'), 'utf8'));
validateFamily(input); const model = layoutFamily(publicFamily(input));
const assets = new Map();
for (const person of model.persons) {
  if (person.photo) assets.set(person.photo.path, [...(assets.get(person.photo.path) || []), {}]);
  for (const material of person.dossier.materials) if (material.path) assets.set(material.path, [...(assets.get(material.path) || []), material]);
}
const assetBytes = new Map();
// Without --assets-dir, explicit input may be completed by copying its files before build.
// The bundled example, by contrast, is immediately usable and carries only its referenced files.
if (options.has('--assets-dir') || !options.has('--data')) {
  const assetsRoot = await realpath(options.get('--assets-dir') || path.join(template, 'public'));
  if (!(await stat(assetsRoot)).isDirectory()) throw Error('--assets-dir должен указывать на папку public');
  for (const [asset, references] of assets) {
    const source = await realpath(path.join(assetsRoot, asset));
    if (!contained(assetsRoot, source) || !(await stat(source)).isFile()) throw Error('Материал указывает за пределы --assets-dir');
    const bytes = await readFile(source);
    for (const reference of references) verifyMaterialBytes(bytes, asset, reference);
    assetBytes.set(asset, bytes);
  }
}
let contents = [];
try { contents = await readdir(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (contents.length) throw Error('Папка не пуста: существующие файлы не перезаписываются');
await mkdir(destination, { recursive: true });
for (const entry of ['src', 'scripts', 'package.json', 'README.md', 'LICENSE', '.gitignore']) await cp(path.join(template, entry), path.join(destination, entry), { recursive: true });
for (const dir of ['fonts', 'icons']) await cp(path.join(template, 'public/assets', dir), path.join(destination, 'public/assets', dir), { recursive: true });
for (const [asset, bytes] of assetBytes) { await mkdir(path.dirname(path.join(destination, 'public', asset)), { recursive: true }); await writeFile(path.join(destination, 'public', asset), bytes); }
await mkdir(path.join(destination, 'data')); await mkdir(path.join(destination, 'private/originals'), { recursive: true });
await writeFile(path.join(destination, 'data/family.json'), JSON.stringify(input, null, 2) + '\n');
console.log(`Создан проект: ${destination}\nСледующий шаг: npm run dev в папке проекта.`);
