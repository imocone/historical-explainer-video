import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, open as openFile, readFile, rm, statfs } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { VIDEO_SPEC } from "../../../video-spec.mjs";
import { hyperframesCli, hyperframesEnv, loadStudioRuntime, studioBuildSignature } from "./browser-session.mjs";
import { runMediaProcess } from "./media-process.mjs";
import { runtimeValue } from "../../../runtime-config.mjs";

const exec = promisify(execFile);

export const stopComposition = projectDirectory => exec(process.execPath,
  [hyperframesCli, 'preview', projectDirectory, '--stop', '--json'], { env: hyperframesEnv, timeout: 15000 });

export const launchComposition = async (projectDirectory, { open = false } = {}) => {
  projectDirectory = path.resolve(projectDirectory);
  const key = createHash('sha256').update(projectDirectory.replace(/\\/g, '/')).digest('hex').slice(0, 16);
  const logPath = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'hyperframes', 'previews', `${key}.log`);
  await mkdir(path.dirname(logPath), { recursive: true });
  const lock = `${logPath}.launch-lock`;
  for (;;) {
    try { await exec('/usr/bin/shlock', ['-f', lock, '-p', String(process.pid)]); break; }
    catch (error) { if (error.code !== 1) throw error; await delay(100); }
  }
  try {
    const { scanActiveServers } = await loadStudioRuntime();
    const existing = (await scanActiveServers()).filter(server => path.resolve(server.projectDir) === projectDirectory);
    const signature = await studioBuildSignature();
    if (existing.length === 1) {
      const response = await fetch(`http://127.0.0.1:${existing[0].port}/__hyperframes_config`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
      if (response?.ok && (await response.json()).serverBuildSignature === signature)
        return reportStudio(projectDirectory, existing[0].port, logPath);
    }
    // Replace only stale adapters; ordinary content edits use the native watcher.
    await stopComposition(projectDirectory);
    return await startComposition(projectDirectory, logPath, open);
  } finally { await rm(lock, { force: true }); }
};

const reportStudio = (projectDirectory, port, logPath) => {
  const url = `http://localhost:${port}/#project/${encodeURIComponent(path.basename(projectDirectory))}`;
  const summary = `Studio ${url}\n日志 ${logPath}\n在内置浏览器普通标签页复用预览，不全屏、不最大化窗口；地址变化时在原标签导航，无标签时只打开一次。\n`;
  process.stdout.write(summary);
  return summary;
};

const startComposition = async (projectDirectory, logPath, open) => {
  const log = await openFile(logPath, 'a');
  let child;
  try {
    child = spawn(process.execPath, [fileURLToPath(new URL('./studio-server.mjs', import.meta.url)), '--launch', projectDirectory, logPath], {
      detached: true, env: hyperframesEnv, stdio: ['ignore', log.fd, log.fd, 'ipc']
    });
    const ended = once(child, 'exit');
    ended.catch(() => {});
    const server = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Studio启动超时')), 60000);
      const fail = error => { clearTimeout(timeout); reject(error); };
      child.once('error', fail);
      child.once('exit', code => fail(new Error(`Studio启动失败 (${code})；详情见 ${logPath}`)));
      child.once('message', message => {
        clearTimeout(timeout);
        message.error ? reject(new Error(message.error)) : resolve(message);
      });
    });
    if ((await ended)[0] !== 0) throw new Error('Studio后台交接失败');
    const summary = reportStudio(projectDirectory, server.port, logPath);
    if (open) await exec('/usr/bin/open', [summary.match(/http:\S+/)[0]], { timeout: 10000 });
    return summary;
  } catch (error) { child?.kill('SIGTERM'); throw error; }
  finally { await log.close(); }
};

const runHyperframes = (args, env = hyperframesEnv) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [hyperframesCli, ...args], { env, stdio: 'inherit' });
  child.once('error', reject);
  child.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`HyperFrames ${signal ?? `退出码 ${code}`}`)));
});

export const snapshotComposition = async ({ projectDirectory, frames, outputDirectory, fps = VIDEO_SPEC.fps }) => {
  await runHyperframes(["snapshot", projectDirectory, "--at", frames.map(frame => frame / fps).join(","),
    "--no-end", "--output", outputDirectory]);
  return outputDirectory;
};

export const renderComposition = options => render(options);

export function selectRenderWorkers({ mode = 'auto', duration, fps, width, height,
  freeDiskBytes, memoryPercent, totalMemoryBytes }) {
  if (!['auto', '1'].includes(mode)) throw new Error('RENDER_WORKERS 只能填写 auto 或 1');
  if (![duration, fps, width, height].every(value => Number.isFinite(value) && value > 0))
    throw new Error('压片缺少有效的时长、帧率或画面尺寸');
  // HY 0.8.223 estimates high-quality JPEG at RGBA / 4, with 10% disk headroom.
  // Reserve another 2 GiB for the encoded picture, audio and final mux.
  const estimatedBytes = Math.ceil(duration * fps) * width * height;
  const requiredBytes = Math.ceil(estimatedBytes / 0.9) + 2 * 1024 ** 3;
  const single = reason => ({ workers: 1, reason, requiredBytes });
  if (mode === '1') return single('本机指定省资源');
  if (!Number.isFinite(freeDiskBytes) || !Number.isFinite(memoryPercent)) return single('资源余量无法确认');
  if (freeDiskBytes < requiredBytes) return single('临时空间不足以保存全部画面');
  if (totalMemoryBytes <= 8 * 1024 ** 3 || memoryPercent < 25) return single('内存余量较少');
  return { workers: 'auto', reason: '空间和内存余量充足', requiredBytes };
}

const render = async ({ projectDirectory, output, fps = VIDEO_SPEC.fps }) => {
  const html = await readFile(path.join(projectDirectory, 'capture/index.html'), 'utf8');
  const root = html.match(/<div[^>]*id="episode"[^>]*>/)?.[0] ?? '';
  const dimension = name => Number(root.match(new RegExp(`data-${name}="([\\d.]+)"`))?.[1]);
  const [disk, memory] = await Promise.all([
    statfs(os.tmpdir()).catch(() => null),
    exec('/usr/bin/memory_pressure', ['-Q'], { timeout: 3000, maxBuffer: 65536 }).catch(() => null)
  ]);
  const selection = selectRenderWorkers({ mode: runtimeValue('RENDER_WORKERS', 'auto'),
    duration: dimension('duration'), width: dimension('width'), height: dimension('height'), fps,
    freeDiskBytes: disk ? disk.bavail * disk.bsize : NaN,
    memoryPercent: Number(memory?.stdout.match(/System-wide memory free percentage:\s*(\d+)%/)?.[1] ?? NaN),
    totalMemoryBytes: os.totalmem() });
  console.log(`压片方式：${selection.workers === 1 ? '单进程，边渲染边编码' : '自动并发'}（${selection.reason}）`);
  const scratch = await mkdtemp(path.join(os.tmpdir(), `media-session-${process.pid}-`));
  try {
    const picture = path.join(scratch, "picture.mp4");
    // drawElement capture can fail its first fidelity sample a quarter into a
    // long composition, discarding all captured frames. Use the native
    // screenshot path directly for formal output; keep FPS and quality intact.
    await runHyperframes(["render", projectDirectory, "--composition", "capture/index.html", "--output", picture,
      "--fps", String(fps), "--workers", String(selection.workers), "--experimental-fast-capture=false"],
    selection.workers === 1 ? { ...hyperframesEnv, PRODUCER_ENABLE_STREAMING_ENCODE: 'true',
      PRODUCER_STREAMING_ENCODE_DURATION_CAP_ENABLED: 'false' } : hyperframesEnv);
    const audio = VIDEO_SPEC.finalOutput.audio;
    try { await runMediaProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", picture, "-i", path.join(projectDirectory, "audio.wav"),
      "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", audio.bitrate,
      "-ar", String(audio.sampleRate), "-ac", String(audio.channels), "-movflags", "+faststart", output], {});
    } catch (error) {
      error.audioPlaybackFailure = true;
      throw error;
    }
    return output;
  } finally { await rm(scratch, { recursive: true, force: true }); }
};
