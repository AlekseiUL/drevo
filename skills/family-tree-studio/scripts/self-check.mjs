import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { validateFamily, publicFamily, layoutFamily } from '../assets/viewer/scripts/model.mjs';

const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(tmpdir(), 'drevo-new-viewer-'));
const project = path.join(scratch, 'example');
const demo = JSON.parse(await readFile(path.join(skill, 'assets/viewer/data/family.json'), 'utf8'));
let count = 0, server;
function check(name, fn) { fn(); count++; console.log('PASS ' + name); }
function command(file, args = [], shouldPass = true) {
  const r = spawnSync(process.execPath, [file, ...args], { encoding: 'utf8' });
  if (shouldPass) assert.equal(r.status, 0, r.stderr); else assert.notEqual(r.status, 0);
  return r;
}
const dataFile = path.join(project, 'data/family.json');
const save = value => writeFile(dataFile, JSON.stringify(value));
const buildFile = path.join(project, 'scripts/build.mjs');
try {
  check('fictional example is marked', () => assert(demo.fictional === true && demo.demo === true));
  check('all people preserved, no invented link to candidate', () => { const m = publicFamily(demo); assert.equal(m.persons.length, 9); assert(!m.edges.some(e => e.a === 'candidate' || e.b === 'candidate')); });
  check('cards do not overlap', () => {
    const m = layoutFamily(publicFamily(demo));
    for (let i = 0; i < m.persons.length; i++) for (const b of m.persons.slice(i + 1)) { const a = m.persons[i]; assert(!(a.x < b.x + m.box.width && a.x + m.box.width > b.x && a.y < b.y + m.box.height && a.y + m.box.height > b.y)); }
  });
  check('unknown participant rejected', () => { const x = structuredClone(demo); x.families[0].children.push('absent'); assert.throws(() => validateFamily(x)); });
  check('duplicate identities rejected', () => { const x = structuredClone(demo); x.persons.push(x.persons[0]); assert.throws(() => validateFamily(x)); });
  check('parent cycle rejected', () => { const x = structuredClone(demo); x.families.push({ id: 'cycle', parents: ['mira'], children: ['l1'] }); assert.throws(() => layoutFamily(publicFamily(x))); });
  check('invalid calendar date rejected', () => { const x = structuredClone(demo); x.persons[0].birthDate = '2001-02-29'; assert.throws(() => validateFamily(x)); });
  check('living and deceased conflict rejected', () => { const x = structuredClone(demo); x.persons[0].lifeStatus = 'living'; assert.throws(() => validateFamily(x)); });
  check('approximate year remains approximate', () => { const x = structuredClone(demo); x.persons[0].birthApproximate = true; assert.equal(publicFamily(x).persons[0].birth, '≈ 1935'); });
  check('competing years remain alternatives', () => { const x = structuredClone(demo); delete x.persons[0].birthYear; x.persons[0].birthYearCandidates = [1934, 1936]; assert.equal(publicFamily(x).persons[0].birth, '1934 или 1936'); });
  check('mixed date/year impossible chronology rejected', () => { const x = structuredClone(demo); delete x.persons[0].birthYear; x.persons[0].birthDate = '2003-02-20'; assert.throws(() => validateFamily(x)); });
  check('date ordering within one year checked', () => { const x = structuredClone(demo); delete x.persons[0].birthYear; delete x.persons[0].deathYear; x.persons[0].birthDate = '2000-11-01'; x.persons[0].deathDate = '2000-02-01'; assert.throws(() => validateFamily(x)); });
  check('uncertain year interval is not forced to January', () => { const x = structuredClone(demo); x.persons[0].birthYear = 2000; delete x.persons[0].deathYear; x.persons[0].deathDate = '2000-06-20'; assert.doesNotThrow(() => validateFamily(x)); });
  check('conflicting precise and alternative dates rejected', () => { const x = structuredClone(demo); x.persons[0].birthYearCandidates = [1934, 1936]; assert.throws(() => validateFamily(x)); });
  check('unknown relationship type rejected', () => { const x = structuredClone(demo); x.families[0].relationshipType = 'unclassified'; assert.throws(() => validateFamily(x)); });
  check('guardianship and adoption survive projection', () => { const x = structuredClone(demo); x.families[0].relationshipType = 'guardian'; x.families[1].relationshipType = 'adoptive'; const m = publicFamily(x); assert(m.edges.some(e => e.type === 'guardian')); assert(m.edges.some(e => e.type === 'adoptive')); });
  check('hypothesis survives projection', () => assert(publicFamily(demo).edges.some(e => e.confidence === 'hypothesis')));
  check('private fields stay private', () => { const x = structuredClone(demo); x.persons[0].notes = 'SECRET_SENTINEL'; x.persons[0].source = { path: 'private/SECRET_SENTINEL.pdf' }; x.persons[0].references = ['SECRET_SENTINEL']; assert(!JSON.stringify(publicFamily(x)).includes('SECRET_SENTINEL')); });
  check('only web links survive projection', () => { const x = structuredClone(demo); x.persons[0].publicSources = [{ url: 'javascript:alert(1)' }, { url: 'file:///private/test' }, { url: 'https://example.org/record', label: 'Source' }]; assert.equal(publicFamily(x).persons[0].sources.length, 1); });
  check('photo traversal rejected', () => { const x = structuredClone(demo); x.persons[0].portrait = { kind: 'original', path: 'assets/photos/../../private/test.png' }; assert.throws(() => validateFamily(x)); });
  check('external photo rejected', () => { const x = structuredClone(demo); x.persons[0].portrait = { kind: 'original', path: 'https://example.org/photo.jpg' }; assert.throws(() => validateFamily(x)); });
  check('project generator accepts empty destination', () => command(path.join(skill, 'scripts/create-project.mjs'), ['--out', project]));
  check('project generator rejects occupied destination', () => command(path.join(skill, 'scripts/create-project.mjs'), ['--out', project], false));
  const privateFixture = structuredClone(demo); privateFixture.persons[0].notes = 'SECRET_SENTINEL';
  await save(privateFixture);
  check('standalone build succeeds', () => command(buildFile));
  const output = JSON.parse(await readFile(path.join(project, 'dist/tree.json'), 'utf8'));
  check('build contains public projection only', () => assert(!JSON.stringify(output).includes('SECRET_SENTINEL')));
  await mkdir(path.join(project, 'public/assets/photos'), { recursive: true });
  await writeFile(path.join(project, 'private/private-photo.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=', 'base64'));
  await symlink(path.join(project, 'private/private-photo.png'), path.join(project, 'public/assets/photos/linked.png'));
  const linked = structuredClone(demo); linked.persons[0].portrait = { kind: 'original', path: 'assets/photos/linked.png' }; await save(linked);
  check('symlink to private photo cannot be published', () => command(buildFile, [], false));
  await save(demo);
  server = spawn(process.execPath, [path.join(project, 'scripts/serve.mjs'), '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const address = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Server startup timed out')), 5000);
    server.once('error', error => { clearTimeout(timeout); reject(error); });
    server.stdout.on('data', chunk => { const result = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+\//); if (result) { clearTimeout(timeout); resolve(result[0]); } });
  });
  const responses = await Promise.all(['', 'tree.json', 'data/family.json', 'private/private-photo.png', 'scripts/model.mjs', 'licenses/Viewer-MIT.txt'].map(file => fetch(address + file)));
  check('server serves only built artifacts', () => assert.deepEqual(responses.map(r => r.status), [200, 200, 404, 404, 404, 200]));
  console.log(JSON.stringify({ ok: true, checks: count, fictionalOnly: true }));
} finally {
  if (server && server.exitCode === null) { const ended = new Promise(resolve => server.once('exit', resolve)); server.kill(); await ended; }
  await rm(scratch, { recursive: true, force: true });
}
