import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runMediaProcess, withMediaResources } from './media-process.mjs';
import {withRenderQueueHeld} from './media-test-helpers.test.mjs';

const gone = async pid => {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
    await delay(20);
  }
  assert.fail(`本次任务仍有遗留进程 ${pid}`);
};

test('image inspections finish while another CLI holds the render queue', {timeout: 90000}, async () => {
  const module = new URL('./media-process.mjs', import.meta.url).href;
  await withRenderQueueHeld(async () => {
    const {stdout} = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
      import {runMediaProcess,withMediaResources} from ${JSON.stringify(module)};
      import assert from 'node:assert/strict';
      const result=await runMediaProcess(process.execPath,['-e','console.log("inspected")'],
        {inspection:true,capture:true});
      assert.equal(result.stdout.trim(),'inspected');
      await assert.rejects(withMediaResources(()=>assert.fail('资源超限不得执行'),
        {inspection:true,maxRssBytes:1}),error=>error.code==='MEDIA_RESOURCE_STOPPED');
      await assert.rejects(runMediaProcess(process.execPath,['-e','setInterval(()=>{},1000)'],
        {inspection:true,capture:true,timeoutMs:100}),/超时/);
      console.log('verified');
    `], {timeout: 30000});
    assert.equal(stdout.trim(), 'verified');
  });
});

test('slow process snapshots complete; resource excess and unavailable snapshots still stop', { timeout: 45000 }, async () => {
  const module = new URL('./media-process.mjs', import.meta.url).href;
  for (const mode of ['slow', 'over-limit', 'unavailable']) {
    const script = `
      import cp from 'node:child_process';
      import {syncBuiltinESMExports} from 'node:module';
      import {promisify} from 'node:util';
      import assert from 'node:assert/strict';
      const mode=${JSON.stringify(mode)}, exec=cp.execFile;
      let first=true;
      cp.execFile=(file,args,options,callback)=>{
        if ((file==='/bin/ps'||file==='ps') && first) {
          first=false;
          const delayed='setTimeout(()=>{require("node:child_process").execFile("/bin/ps",'
            +JSON.stringify(args)+',(error,out,err)=>{process.stdout.write(out);process.stderr.write(err);process.exitCode=error?1:0})},'
            +(mode==='unavailable'?11000:3200)+')';
          return exec(process.execPath,['-e',delayed],options,callback);
        }
        return exec(file,args,options,callback);
      };
      cp.execFile[promisify.custom]=(...args)=>new Promise((resolve,reject)=>
        cp.execFile(...args,(error,stdout,stderr)=>error?reject(error):resolve({stdout,stderr})));
      syncBuiltinESMExports();
      const {withMediaResources,runMediaProcess}=await import(${JSON.stringify(module)});
      if (mode==='slow') {
        const result=await runMediaProcess(process.execPath,['-e','console.log("completed")'],{capture:true});
        assert.equal(result.stdout.trim(),'completed');
      } else {
        await assert.rejects(withMediaResources(()=>assert.fail('不得在监督失败后执行任务'),
          mode==='over-limit'?{maxRssBytes:1}:{}), error=>error.code==='MEDIA_RESOURCE_STOPPED'
            && (mode==='over-limit'?/占用超过/:/读取进程状态超过10秒/).test(error.message));
      }
      console.log('verified');
    `;
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { timeout: 25000 });
    assert.equal(stdout.trim(), 'verified', mode);
  }
});

test('capture waits for stdio close and keeps the resource stop code', { timeout: 10000 }, async () => {
  await assert.rejects(withMediaResources(() => assert.fail('资源停止后不得执行任务'), {
    inspect: async () => { throw new Error('模拟资源停止'); }
  }), error => error.code === 'MEDIA_RESOURCE_STOPPED' && error.message === '模拟资源停止');
  const tail = `setTimeout(()=>{require('node:fs').writeSync(1,'tail-out');require('node:fs').writeSync(2,'tail-err')},120)`;
  const result = await runMediaProcess(process.execPath, ['-e', `
    require('node:fs').writeSync(1,'head-out');require('node:fs').writeSync(2,'head-err');
    require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(tail)}],{stdio:['ignore',1,2]});
    process.exit(0);
  `], { capture: true });
  assert.equal(result.stdout, 'head-outtail-out');
  assert.equal(result.stderr, 'head-errtail-err');
});

test('capture preserves binary bytes and split UTF8 characters', { timeout: 10000 }, async () => {
  const bytes = Buffer.from([137, 80, 78, 71, 0, 255, 128, 10]);
  const binary = await runMediaProcess(process.execPath, ['-e', `process.stdout.write(Buffer.from(${JSON.stringify([...bytes])}))`],
    { capture: true, encoding: null });
  assert.deepEqual(binary.stdout, bytes);
  const text = await runMediaProcess(process.execPath, ['-e', `
    const bytes=Buffer.from('中文');process.stdout.write(bytes.subarray(0,2));
    setTimeout(()=>process.stdout.write(bytes.subarray(2)),40);
  `], { capture: true });
  assert.equal(text.stdout, '中文');
  await assert.rejects(runMediaProcess(process.execPath, ['-e', 'process.stdout.write(Buffer.alloc(4096))'],
    { capture: true, encoding: null, maxBuffer: 1024 }), /缓冲上限/);
});

test('an old observer cannot remove a replacement lease', { timeout: 5000 }, async () => {
  const module = new URL(`./media-process.mjs?observer-test=${process.pid}`, import.meta.url);
  const identity = createHash('sha256').update(module.href).digest('hex').slice(0, 16);
  const lease = path.join(os.tmpdir(), `media-work-${identity}.json`), marker = lease + '.owner.json';
  let observer;
  try {
    await writeFile(lease, String(process.pid));
    await writeFile(marker, 'replacement owner');
    observer = spawn(process.execPath, ['--input-type=module', '-e', `
      import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';
      const read=fs.readFile;
      // Simulate the old PID read completing after another CLI has taken over.
      fs.readFile=(file,...args)=>file===${JSON.stringify(lease)}?Promise.resolve('1'):read(file,...args);
      syncBuiltinESMExports();
      process.argv=[process.execPath,${JSON.stringify(fileURLToPath(module))},'--watch-owner','1'];
      await import(${JSON.stringify(module.href)});process.send('ready');
    `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    const ended = once(observer, 'exit');
    await once(observer, 'message');
    observer.send({ pid: 1, children: [], scratch: [] });
    observer.disconnect();
    assert.equal((await ended)[0], 0);
    assert.equal(await readFile(lease, 'utf8'), String(process.pid));
    assert.equal(await readFile(marker, 'utf8'), 'replacement owner');
  } finally {
    if (observer?.exitCode === null) observer.kill('SIGKILL');
    await rm(lease, { force: true }); await rm(marker, { force: true });
  }
});

test('timeout cleans detached descendants that ignore graceful termination', { timeout: 10000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'media-timeout-'));
  const file = path.join(directory, 'pids.json');
  try {
    await assert.rejects(runMediaProcess(process.execPath, ['--input-type=module', '-e', `
      import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs';
      const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{detached:true,stdio:'ignore'});
      writeFileSync(${JSON.stringify(file)},JSON.stringify([process.pid,child.pid]));
      process.on('SIGTERM',()=>{});setInterval(()=>{},1000);
    `], { timeoutMs: 500, capture: true }), /超时/);
    for (const pid of JSON.parse(await readFile(file, 'utf8'))) await gone(pid);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a stalled command and a resource violation stop without heavy allocations', { timeout: 10000 }, async () => {
  let entered = false;
  await assert.rejects(withMediaResources(() => { entered = true; }, { maxRssBytes: 1 }), /占用超过/);
  assert.equal(entered, false);
  await assert.rejects(runMediaProcess(process.execPath, ['-e', "console.log('x'.repeat(4096));setInterval(()=>{},1000)"], { capture: true, maxBuffer: 1024 }), /缓冲上限/);
  await assert.rejects(runMediaProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 3000, stallMs: 150 }), /没有进度/);
  let samples = 0;
  await assert.rejects(withMediaResources(() => runMediaProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)']), {
    intervalMs: 50, inspect: async () => { if (++samples > 2) throw new Error('模拟内存不足'); }
  }), /模拟内存不足/);
  assert.equal((await runMediaProcess(process.execPath, ['-e', "console.log('recovered')"], { capture: true })).stdout.trim(), 'recovered');
});

test('separate CLI jobs serialize; a killed owner is reclaimed safely', { timeout: 15000 }, async () => {
  const module = new URL('./media-process.mjs', import.meta.url).href;
  const start = code => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `import {withMediaResources,runMediaProcess} from ${JSON.stringify(module)};${code}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    const ended = once(child, 'exit');
    let error = ''; child.stderr.on('data', data => { error += data; });
    return { child, ended, error: () => error };
  };
  const first = start(`await withMediaResources(async()=>{console.log('start');await new Promise(r=>setTimeout(r,700));console.log('end')})`);
  await once(first.child.stdout, 'data');
  let secondStarted = false;
  const second = start(`await withMediaResources(()=>{console.log('second')})`);
  second.child.stdout.on('data', () => { secondStarted = true; });
  await delay(150); assert.equal(secondStarted, false);
  assert.equal((await first.ended)[0], 0, first.error());
  assert.equal((await second.ended)[0], 0, second.error());
  const abandoned = start(`
    import {mkdtemp,writeFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
    await withMediaResources(async session=>{
      const scratch=await mkdtemp(path.join(os.tmpdir(),'media-session-'+process.pid+'-'));
      await session.track({pid:process.pid},scratch);await writeFile(path.join(scratch,'marker'),'owned');
      await runMediaProcess(process.execPath,['-e','console.log(JSON.stringify({pid:process.pid,scratch:'+JSON.stringify(scratch)+'}));setInterval(()=>{},1000)']);
    });
  `);
  const { pid: browserPid, scratch } = JSON.parse(String((await once(abandoned.child.stdout, 'data'))[0]).trim());
  await delay(100);
  abandoned.child.kill('SIGKILL'); await abandoned.ended;
  await gone(browserPid); // The observer cleans immediately, before another job starts.
  const marker = path.join(scratch, 'marker');
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await readFile(marker); await delay(20); }
    catch (error) { if (error.code === 'ENOENT') break; throw error; }
  }
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  await withMediaResources(async () => {});
  await gone(browserPid);
});
