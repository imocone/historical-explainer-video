import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

// Test-only support. The holder and inspected CLI must be siblings: supervision tracks descendants.
export async function withRenderQueueHeld(run) {
  const media = new URL('./media-process.mjs', import.meta.url).href;
  const holder = spawn(process.execPath, ['--input-type=module', '-e', `
    import {withMediaResources} from ${JSON.stringify(media)};
    await withMediaResources(async()=>{
      process.send('holding');await new Promise(resolve=>process.once('message',resolve));
    });process.disconnect();
  `], {stdio: ['ignore', 'ignore', 'inherit', 'ipc']});
  const ended = once(holder, 'exit');
  let ready = false;
  try {
    await Promise.race([
      once(holder, 'message', {signal: AbortSignal.timeout(30000)}),
      ended.then(() => { throw new Error('占队进程在就绪前退出'); })
    ]);
    ready = true;
    await run();
    assert.equal(holder.exitCode, null, '检查完成前，占队进程须仍在运行');
    assert.equal(holder.signalCode, null, '检查不得终止占队进程');
  } finally {
    if (ready && holder.connected) holder.send('release');
    else holder.kill();
    await ended;
  }
}
