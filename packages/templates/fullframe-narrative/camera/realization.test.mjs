import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, cp, readFile, writeFile, stat, rm} from 'node:fs/promises';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import {fileSha256} from '../../../program-utils.mjs';
import {deriveMotionCameras} from './p4-runtime.mjs';
import {FULLFRAME_RENDER_POLICY} from '../render-policy.mjs';
import {renderFullframeRealization} from './realization.mjs';

const exec = promisify(execFile);
const realization = new URL('./realization.mjs', import.meta.url).href;
// Use sibling processes so resource supervision does not own the other CLI.
const withQueueHeld = async (run, inspection = false) => {
  const media = new URL('../../../modules/render-video/runtime/media-process.mjs', import.meta.url).href;
  const holder = spawn(process.execPath, ['--input-type=module', '-e', `
    import {withMediaResources} from ${JSON.stringify(media)};
    await withMediaResources(async()=>{
      process.send('holding'); await new Promise(resolve=>process.once('message',resolve));
    },{inspection:${inspection}}); process.disconnect();
  `], {stdio: ['ignore', 'ignore', 'inherit', 'ipc']});
  const ended = once(holder, 'exit');
  let ready = false;
  try {
    await Promise.race([
      once(holder, 'message', {signal: AbortSignal.timeout(10000)}),
      ended.then(() => { throw new Error('queue holder exited before acquiring the queue'); })
    ]);
    ready = true;
    await run();
    assert.equal(holder.exitCode, null);
    assert.equal(holder.signalCode, null);
  } finally {
    if (ready && holder.connected) holder.send('release'); else holder.kill();
    await ended;
  }
};
const fixture = async t => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'camera-queue-'));
  t.after(() => rm(workspaceRoot, {recursive: true, force: true}));
  const systemRoot = fileURLToPath(new URL('../../../../', import.meta.url));
  const visual = path.join(systemRoot, 'visuals/modern-editorial');
  const manifest = JSON.parse(await readFile(path.join(visual, 'visual-package.json'), 'utf8'));
  await cp(path.join(visual, manifest.masterReference.path), path.join(workspaceRoot, 'source.png'));
  const motion = {type: 'push-in', speedRatio: 1, startViewport: {x: 0, y: 0, width: 1, height: 1},
    routeWaypoints: [], semanticEndViewport: {x: .15, y: .1, width: 2 / 3, height: 2 / 3},
    safeEndViewport: {x: .15, y: .1, width: 2 / 3, height: 2 / 3}, startFrame: 0, endFrame: 60, runtimeEndFrame: 60};
  Object.assign(motion, deriveMotionCameras({motion, fps: 60, motionPolicy: FULLFRAME_RENDER_POLICY.motion}));
  return {workspaceRoot, systemRoot, directory: path.join(workspaceRoot, 'camera'), views: [{
    assetId: 'fixture', file: 'source.png', sha256: await fileSha256(path.join(workspaceRoot, 'source.png')),
    viewingWindow: {startFrame: 0, endFrame: 60}, props: {motion}
  }]};
};
const run = options => exec(process.execPath, ['--input-type=module', '-e', `
  import {renderFullframeRealization} from ${JSON.stringify(realization)};
  console.log(JSON.stringify(await renderFullframeRealization(${JSON.stringify(options)})));
`], {timeout: 10000}).then(({stdout}) => JSON.parse(stdout));

test('static camera feedback completes during video work; concurrent callers share the same result', {timeout: 40000}, async t => {
  const options = await fixture(t);
  await withQueueHeld(async () => {
    const [first, second] = await Promise.all([run(options), run(options)]);
    assert.deepEqual(first, second);
    assert.ok((await stat(first[0].routeMap.file)).size > 0);
    assert.equal(await fileSha256(first[0].routeMap.file), first[0].routeMap.sha256);
  });
});

test('cached camera feedback bypasses both queues and still rejects a changed source', {timeout: 40000}, async t => {
  const options = await fixture(t), expected = await renderFullframeRealization(options);
  const cache = expected[0].routeMap.file, before = await stat(cache);
  await withQueueHeld(async () => {
    await withQueueHeld(async () => {
      assert.deepEqual(await run(options), expected);
      assert.equal((await stat(cache)).mtimeMs, before.mtimeMs);
      await writeFile(path.join(options.workspaceRoot, 'source.png'), 'changed source');
      await assert.rejects(run(options), /成图字节已变化/);
    }, true);
  });
});

test('dynamic camera previews still wait for video resources', {timeout: 40000}, async t => {
  const options = await fixture(t);
  // Select a real view and reach public-resource preparation. Its missing
  // render asset stops the job after the queue, without compiling a video.
  options.views[0].props.asset = {file: 'missing-render-source.png'};
  options.views[0].props.visualStyle = {shared: {fonts: {}}, p4: {}};
  let pending, settled = false;
  await withQueueHeld(async () => {
    await assert.rejects(run({...options, clipAssetId: 'absent'}), /缺少本次全画幅预览对象/);
    pending = run({...options, clipAssetId: 'fixture'}).then(
      () => { settled = true; assert.fail('missing render asset must fail'); },
      error => { settled = true; return error; }
    );
    await delay(400);
    assert.equal(settled, false, 'dynamic work cannot enter before the heavy queue is released');
  });
  assert.match((await pending).message, /ENOENT.*missing-render-source\.png/s);
});
