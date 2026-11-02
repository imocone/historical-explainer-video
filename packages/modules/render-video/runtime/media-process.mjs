import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, rm, statfs, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile), context = new AsyncLocalStorage();
const identity = createHash('sha256').update(import.meta.url).digest('hex').slice(0, 16);
const leaseFile = path.join(os.tmpdir(), `media-work-${identity}.json`);
const rssLimit = Math.min(3 * 1024 ** 3, os.totalmem() / 4);
const resourceError = error => Object.assign(error, { code: 'MEDIA_RESOURCE_STOPPED' });
const sameProcess = (row, child) => row.pid === child.pid && row.started === child.started?.trim();
let queue = Promise.resolve();
const processes = async roots => {
  if (!roots.length) return [];
  // One bounded snapshot keeps ancestry and identity consistent under render load.
  let stdout;
  try {
    ({ stdout } = await exec('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,rss=,stat=,lstart='],
      { timeout: 10000, maxBuffer: 4 * 1024 * 1024 }));
  } catch (error) {
    if (error.killed && error.signal === 'SIGTERM')
      throw new Error('读取进程状态超过10秒，已停止本次媒体任务', { cause: error });
    throw error;
  }
  return descendants(stdout.trim().split('\n').filter(Boolean).map(line => {
    const [, pid, parent, group, rss, state, started] = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    return { pid: +pid, parent: +parent, group: +group, rss: +rss * 1024, state, started: started.trim() };
  }), roots);
};
const descendants = (rows, roots) => {
  const ids = new Set(roots);
  let size;
  do { size = ids.size; for (const row of rows) if (ids.has(row.parent)) ids.add(row.pid); } while (size !== ids.size);
  return rows.filter(row => ids.has(row.pid));
};
const killRows = rows => {
  for (const row of [...rows].reverse()) {
    if (row.pid < 2 || row.pid === process.pid || row.state.startsWith('Z')) continue;
    try { process.kill(row.group === row.pid ? -row.pid : row.pid, 'SIGKILL'); }
    catch (error) {
      if (error.code === 'ESRCH') continue;
      if (error.code === 'EPERM' && row.group === row.pid) {
        try { process.kill(row.pid, 'SIGKILL'); continue; } catch (cause) { if (cause.code === 'ESRCH') continue; }
      }
      throw new Error(`无法停止本次任务进程 ${row.pid} (${row.state})`, { cause: error });
    }
  }
};

const assertResources = async (owned, directory, maxRssBytes) => {
  if (owned.reduce((sum, row) => sum + row.rss, 0) > maxRssBytes)
    throw new Error(`本次渲染占用超过${Math.round(maxRssBytes / 1024 ** 2)}MB，已停止以保护电脑`);
  const disk = await statfs(directory);
  if (disk.bavail * disk.bsize < 2 * 1024 ** 3) throw new Error('磁盘可用空间不足2GB，已停止渲染');
  const { stdout } = await exec('/usr/bin/memory_pressure', ['-Q'], { timeout: 3000 });
  const percent = stdout.match(/System-wide memory free percentage:\s*(\d+)%/);
  if (!percent) throw new Error('无法读取系统内存余量，已停止渲染');
  if (+percent[1] < 15) throw new Error('系统内存余量低于15%，已停止渲染');
};

// Heavy work and image inspections each serialize across CLI invocations.
// Keep one in-process queue: supervision owns this process's descendants.
export async function withMediaResources(run, { directory = os.tmpdir(), inspection = false,
  maxRssBytes = rssLimit,
  intervalMs = 1000, inspect } = {}) {
  if (context.getStore()) return run(context.getStore());
  const activeLease = inspection ? leaseFile + '.inspection' : leaseFile;
  const markerFile = activeLease + '.owner.json';
  const previous = queue;
  let release;
  queue = new Promise(resolve => { release = resolve; });
  await previous;
  let owner, observer, finishing = false, locked = false, timer, polling, failure;
  const controller = new AbortController();
  try {
    for (;;) {
      try {
        // macOS shlock acquires atomically and reclaims a dead owner's PID lock.
        await exec('/usr/bin/shlock', ['-f', activeLease, '-p', String(process.pid)], { timeout: 3000 });
        locked = true;
        break;
      } catch (error) {
        if (error.code !== 1) throw error;
        await delay(250);
      }
    }
    let existing;
    try { existing = JSON.parse(await readFile(markerFile, 'utf8')); }
    catch (error) { if (!(error instanceof SyntaxError) && error.code !== 'ENOENT') throw error; }
    if (existing) {
      const rows = await processes((existing.children ?? []).map(child => child.pid));
      const roots = (existing.children ?? []).filter(child => rows.some(row => sameProcess(row, child)));
      killRows(descendants(rows, roots.map(child => child.pid)));
    }
    owner = { pid: process.pid, children: [], scratch: [] };
    let save = Promise.resolve();
    const remember = async rows => {
      const fresh = rows.filter(row => row.pid !== process.pid && !owner.children.some(child => sameProcess(row, child)));
      if (!fresh.length) return;
      owner.children.push(...fresh.map(row => ({ pid: row.pid, started: row.started })));
      if (observer?.connected) observer.send(owner, () => {});
      save = save.then(() => writeFile(markerFile, JSON.stringify(owner), { mode: 0o600 }));
      await save;
    };
    await writeFile(markerFile, JSON.stringify(owner), { mode: 0o600 });
    const session = { signal: controller.signal, track: async (child, scratch) => {
      controller.signal.throwIfAborted();
      if (scratch && !owner.scratch.includes(scratch)) {
        owner.scratch.push(scratch);
        if (observer?.connected) observer.send(owner, () => {});
        save = save.then(() => writeFile(markerFile, JSON.stringify(owner), { mode: 0o600 }));
        await save;
      }
      await remember(await processes([child.pid]));
    } };
    const sample = inspect ?? (async () => {
      const rows = await processes([process.pid, ...owner.children.map(child => child.pid)]);
      owner.children = owner.children.filter(child => rows.some(row => sameProcess(row, child)));
      const owned = descendants(rows, [process.pid, ...owner.children.map(child => child.pid)]);
      await remember(owned);
      await assertResources(owned, directory, maxRssBytes);
    });
    try { await sample(); } catch (error) { throw resourceError(error); }
    const failed = new Promise((_, reject) => { failure = reject; });
    failed.catch(() => {});
    // IPC disconnect also fires on SIGKILL. Cleanup must not depend on a future render.
    observer = spawn(process.execPath, [fileURLToPath(import.meta.url), '--watch-owner', String(process.pid)],
      { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const observerFailed = () => {
      if (finishing) return;
      const error = resourceError(new Error('本次媒体任务的进程监督意外退出'));
      controller.abort(error); failure(error);
    };
    observer.once('exit', observerFailed); observer.once('error', observerFailed);
    await remember(await processes([observer.pid]));
    const poll = () => polling ??= sample().catch(error => { resourceError(error); controller.abort(error); failure(error); }).finally(() => { polling = undefined; });
    timer = setInterval(poll, intervalMs);
    return await context.run(session, () => Promise.race([Promise.resolve().then(() => run(session)), failed]));
  } finally {
    try {
      finishing = true;
      clearInterval(timer);
      if (polling) await polling;
      controller.abort(new Error('渲染任务已结束'));
      if (owner) {
        const rows = await processes(owner.children.map(child => child.pid));
        const roots = owner.children.filter(child => rows.some(row => sameProcess(row, child)));
        killRows(descendants(rows, roots.map(child => child.pid)));
      }
    } finally {
      try { if (locked) { await rm(markerFile, { force: true }); await rm(activeLease, { force: true }); } }
      finally { release(); }
    }
  }
}

export const runMediaProcess = (command, args, { timeoutMs = 120000, stallMs = 0, capture = false, encoding = 'utf8', maxBuffer = 4 * 1024 * 1024, inspection = false, ...options } = {}) =>
  withMediaResources(async session => {
    session.signal.throwIfAborted();
    const child = spawn(command, args, { ...options, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = [];
    let outputBytes = 0, errorOutput = '', lastOutput = Date.now(), settled = false, stopReason;
    const exited = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => code === 0 ? resolve() : reject(stopReason ?? new Error(`${command} ${signal ?? `退出码 ${code}`}\n${errorOutput.slice(-2000)}`)));
    });
    // Register handlers before tracking: a very short command may already have exited.
    exited.catch(() => {});
    for (const [stream, target, stderr] of [[child.stdout, process.stdout, false], [child.stderr, process.stderr, true]]) {
      if (!capture) stream.pipe(target, { end: false });
      stream.on('data', data => {
        lastOutput = Date.now();
        if (stderr) errorOutput = (errorOutput + data).slice(-8192);
        else if (capture) {
          outputBytes += data.length;
          if (outputBytes > maxBuffer) {
            stopReason = new Error(`${command}输出超过缓冲上限，已停止本次任务`);
            stop().then(() => rejectStop(stopReason), rejectStop);
            return;
          }
          output.push(data);
        }
      });
    }
    let stopping;
    const stop = () => stopping ??= (async () => {
      await session.track(child).catch(() => {});
      killRows(await processes([child.pid]));
    })();
    const handlers = ['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => {
      const handler = () => {
        stopReason = Object.assign(new Error(`本次媒体任务已取消 (${signal})`), { code: 'MEDIA_CANCELLED' });
        stop().then(() => rejectStop(stopReason), rejectStop);
      };
      process.once(signal, handler);
      return [signal, handler];
    });
    let deadline, watchdog, rejectStop;
    const stopped = new Promise((_, reject) => { rejectStop = reject; });
    const abort = () => { stopReason = session.signal.reason; stop().then(() => rejectStop(stopReason), rejectStop); };
    session.signal.addEventListener('abort', abort, { once: true });
    try {
      await session.track(child);
      deadline = setTimeout(() => { stopReason = new Error(`${command}执行超时，已终止本次任务`); stop().then(() => rejectStop(stopReason), rejectStop); }, timeoutMs);
      if (stallMs) watchdog = setInterval(() => {
        if (Date.now() - lastOutput > stallMs) { stopReason = new Error(`${command}长时间没有进度，已终止本次任务`); stop().then(() => rejectStop(stopReason), rejectStop); }
      }, Math.min(1000, stallMs));
      await Promise.race([exited, stopped]);
      if (stopReason) throw stopReason;
      settled = true;
      const stdout = Buffer.concat(output, outputBytes);
      return { stdout: encoding === null ? stdout : stdout.toString(encoding), stderr: errorOutput };
    } finally {
      clearTimeout(deadline); clearInterval(watchdog);
      session.signal.removeEventListener('abort', abort);
      for (const [signal, handler] of handlers) process.removeListener(signal, handler);
      child.stdout.unpipe(process.stdout); child.stderr.unpipe(process.stderr);
      if (!settled) await stop();
    }
  }, {inspection});

// Studio's own export buttons also need a limit after the launch command exits.
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--watch-owner') {
  const ownerPid = Number(process.argv[3]);
  let children = [], scratch = [];
  process.on('message', owner => { if (owner.pid === ownerPid) { children = owner.children; scratch = owner.scratch ?? []; } });
  process.once('disconnect', async () => {
    try {
      const rows = await processes(children.map(child => child.pid));
      const roots = children.filter(child => rows.some(row => sameProcess(row, child)));
      killRows(descendants(rows, roots.map(child => child.pid)));
      for (const directory of scratch) {
        if (path.basename(directory).startsWith(`media-session-${ownerPid}-`)) await rm(directory, { recursive: true, force: true });
      }
      // shlock reclaims dead owners. These shared names may already belong to
      // another CLI; only that owner can remove them after acquiring the lease.
    } catch (error) { if (error.code !== 'ENOENT') process.exitCode = 1; }
    finally { process.exit(process.exitCode ?? 0); }
  });
}
