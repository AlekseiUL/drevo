import { readFile, mkdir, copyFile, realpath, stat, mkdtemp, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicFamily, layoutFamily, contained } from './model.mjs';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function build() {
  const raw = JSON.parse(await readFile(path.join(projectRoot, 'data/family.json'), 'utf8'));
  const model = layoutFamily(publicFamily(raw));
  const staging = await mkdtemp(path.join(projectRoot, '.build-'));
  try {
    const copy = async (source, target) => { await mkdir(path.dirname(path.join(staging, target)), { recursive: true }); await copyFile(source, path.join(staging, target)); };
    for (const file of ['index.html', 'app.js', 'style.css']) await copy(path.join(projectRoot, 'src', file), file);
    for (const file of ['fonts/golos-0.ttf', 'fonts/golos-1.ttf', 'fonts/golos-2.ttf', 'icons/map-pin.svg']) await copy(path.join(projectRoot, 'public/assets', file), 'assets/' + file);
    for (const [source, target] of [['public/assets/fonts/OFL.txt', 'licenses/Golos-OFL.txt'], ['public/assets/icons/LICENSE-lucide.txt', 'licenses/Lucide.txt'], ['LICENSE', 'licenses/Viewer-MIT.txt']]) await copy(path.join(projectRoot, source), target);
    const publicRoot = await realpath(path.join(projectRoot, 'public'));
    for (const asset of new Set(model.persons.filter(p => p.photo).map(p => p.photo.path))) {
      const source = await realpath(path.join(publicRoot, asset));
      if (!contained(publicRoot, source) || !(await stat(source)).isFile()) throw Error('Фото указывает за пределы public/');
      await copy(source, asset);
    }
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(staging, 'tree.json'), JSON.stringify(model));
    await rm(path.join(projectRoot, 'dist'), { recursive: true, force: true });
    await rename(staging, path.join(projectRoot, 'dist'));
    console.log(`Собрано: ${model.persons.length} человек, ${model.edges.length} связей → dist/`);
    return model;
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}
if (process.argv[1] && await realpath(process.argv[1]) === await realpath(fileURLToPath(import.meta.url))) await build();
