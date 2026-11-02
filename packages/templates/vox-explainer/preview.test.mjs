import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {previewOutputDirectory} from './preview.mjs';

test('同名节目、同集同段的默认预演互不覆盖，同一节目仍可复用', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'vox-preview-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const systemRoot = path.join(directory, 'system');
  const workspaceRoot = path.join(directory, 'a', '节目');
  const first = previewOutputDirectory({systemRoot, workspaceRoot});
  const second = previewOutputDirectory({systemRoot, workspaceRoot: path.join(directory, 'b', '节目')});
  assert.notEqual(first, second);
  assert.equal(previewOutputDirectory({systemRoot, workspaceRoot}), first);
  for (const [root, content] of [[first, '节目A'], [second, '节目B']]) {
    await mkdir(path.join(root, 'projects', 'ep01-TR001'), {recursive: true});
    await writeFile(path.join(root, 'projects', 'ep01-TR001', 'scene.js'), content);
    await writeFile(path.join(root, 'ep01-TR001.mp4'), content);
  }
  assert.equal(await readFile(path.join(first, 'projects', 'ep01-TR001', 'scene.js'), 'utf8'), '节目A');
  assert.equal(await readFile(path.join(first, 'ep01-TR001.mp4'), 'utf8'), '节目A');
  assert.equal(await readFile(path.join(second, 'ep01-TR001.mp4'), 'utf8'), '节目B');
  const outputDirectory = path.join(directory, 'chosen');
  assert.equal(previewOutputDirectory({systemRoot, workspaceRoot, outputDirectory}), outputDirectory);
});
