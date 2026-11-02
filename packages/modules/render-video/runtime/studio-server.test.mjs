import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { launchComposition } from './hyperframes.mjs';
import { hyperframesCli, hyperframesEnv, loadStudioRuntime } from './browser-session.mjs';
import { createStudioProject } from './studio-render.mjs';
import { runMediaProcess, withMediaResources } from './media-process.mjs';
import { promisify } from 'node:util';

test('a launched preview is reused across callers and edits and survives the next resource-supervised task', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'studio-detached-'));
  try {
    await writeFile(path.join(directory, 'index.html'), '<div data-composition-id="audit" data-duration="0.5" data-width="320" data-height="180"></div>');
    const module = new URL('./hyperframes.mjs', import.meta.url).href;
    const repeat = () => promisify(execFile)(process.execPath, ['--input-type=module', '-e',
      `import {launchComposition} from ${JSON.stringify(module)}; await launchComposition(${JSON.stringify(directory)});`],
    { env: hyperframesEnv, timeout: 15000 });
    const repeats = await Promise.all([repeat(), repeat()]);
    const summary = repeats[0].stdout;
    const url = summary.match(/http:\/\/localhost:\d+/)[0];
    assert.equal(repeats[1].stdout, summary, 'concurrent first launches return one Studio');
    const { scanActiveServers } = await loadStudioRuntime();
    assert.equal((await scanActiveServers()).filter(server => server.projectDir === directory).length, 1);
    const configuration = () => fetch(`${url}/__hyperframes_config`).then(response => response.json());
    const first = await configuration();
    assert.equal(await launchComposition(directory), summary);
    assert.equal((await configuration()).pid, first.pid, 'repeated launches retain the server');
    const previewUrl = `${url}/api/projects/${path.basename(directory)}/preview`;
    const before = await fetch(previewUrl);
    assert.equal(before.status, 200);
    await before.text();
    await writeFile(path.join(directory, 'index.html'), '<div data-composition-id="audit" data-duration="0.5" data-width="320" data-height="180">updated picture</div>');
    assert.equal(await launchComposition(directory), summary);
    let after, content;
    for (let attempt = 0; attempt < 20; attempt++) {
      after = await fetch(previewUrl);
      content = await after.text();
      if (content.includes('updated picture')) break;
      await delay(100); // HY batches file-change notifications before refreshing its preview.
    }
    assert.equal(after.status, 200);
    assert.match(content, /updated picture/);
    assert.notEqual(after.headers.get('etag'), before.headers.get('etag'), 'rendered preview cache follows the edit');
    assert.equal((await configuration()).pid, first.pid, 'content edits must not restart Studio');
    await withMediaResources(async () => {
      await runMediaProcess(process.execPath, ['-e', ''], { capture: true });
      await delay(1100);
    });
    assert.equal((await fetch(url, { signal: AbortSignal.timeout(3000) })).status, 200);
  } finally {
    await promisify(execFile)(process.execPath, [hyperframesCli, 'preview', directory, '--stop', '--json'], { env: hyperframesEnv, timeout: 10000 });
    await rm(directory, { recursive: true, force: true });
  }
});

test('native defaults: HY inherits the caller environment without project tuning', () => {
  assert.deepEqual(hyperframesEnv, { ...process.env });
});

test('native defaults: Studio jobs retain the native implementations and supplied options', () => {
  const calls = [];
  const native = { adapter: { transformPreviewHtml: input => input.html }, watcher: {}, app: {} };
  const methods = ['startRender', 'startBackgroundRemoval', 'generateThumbnail'];
  for (const name of methods) native.adapter[name] = options => { calls.push([name, options]); return name; };
  const original = { ...native.adapter };
  let projectOptions;
  const actual = createStudioProject({ createStudioServer(options) { projectOptions = options; return native; } }, '/tmp/native-film');
  assert.equal(actual, native);
  assert.deepEqual(projectOptions, { projectDir: '/tmp/native-film', projectName: 'native-film' });
  for (const name of methods) {
    assert.equal(actual.adapter[name], original[name]);
    const input = { fps: 24, quality: 'draft', workers: 3 };
    assert.equal(actual.adapter[name](input), name);
    assert.equal(calls.at(-1)[1], input);
  }
});
