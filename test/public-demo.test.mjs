import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

test('public demo refuses enabled forms or embedded recipient configuration before building', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'drevo-demo-boundary-'));
  try {
    const script = path.join(dir, 'viewer/scripts/demo.mjs');
    const template = path.join(dir, 'skills/family-tree-studio/assets/viewer');
    await mkdir(path.dirname(script), { recursive: true });
    await mkdir(path.join(template, 'src'), { recursive: true });
    await mkdir(path.join(template, 'data'), { recursive: true });
    await copyFile(new URL('../viewer/scripts/demo.mjs', import.meta.url), script);
    await writeFile(path.join(template, 'data/family.json'), JSON.stringify({ fictional: true, demo: true }));
    for (const config of [
      { enabled: true, ready: true, endpoint: 'https://example.invalid/feedback' },
      { enabled: false, ready: false, endpoint: 'https://example.invalid/feedback' },
      { enabled: false, ready: true },
      { enabled: false, ready: false, recipientName: 'Synthetic recipient' },
    ]) {
      await writeFile(path.join(template, 'src/feedback-config.json'), JSON.stringify(config));
      const result = spawnSync(process.execPath, [script, 'build'], { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Публичное демо требует выключенную форму без адресов получателей/);
      assert(!result.stdout.includes('Создан проект'));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
