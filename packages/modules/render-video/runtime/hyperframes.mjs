import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, open as openFile, readFile, rm } from "node:fs/promises";
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

const runHyperframes = args => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [hyperframesCli, ...args], { env: hyperframesEnv, stdio: 'inherit' });
  child.once('error', reject);
  child.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`HyperFrames ${signal ?? `退出码 ${code}`}`)));
});

export const snapshotComposition = async ({ projectDirectory, frames, outputDirectory, fps = VIDEO_SPEC.fps }) => {
  await runHyperframes(["snapshot", projectDirectory, "--at", frames.map(frame => frame / fps).join(","),
    "--no-end", "--output", outputDirectory]);
  return outputDirectory;
};

export const renderComposition = options => render(options);

const render = async ({ projectDirectory, output, fps = VIDEO_SPEC.fps }) => {
  const html = await readFile(path.join(projectDirectory, 'capture/index.html'), 'utf8');
  const duration = Number(html.match(/<div[^>]*id="episode"[^>]*data-duration="([\d.]+)"/)?.[1]);
  if (!(duration > 0)) throw new Error('出片项目缺少有效时长');
  const scratch = await mkdtemp(path.join(os.tmpdir(), `media-session-${process.pid}-`));
  try {
    const picture = path.join(scratch, "picture.mp4");
    // drawElement capture can fail its first fidelity sample a quarter into a
    // long composition, discarding all captured frames. Use the native
    // screenshot path directly for formal output; keep FPS and quality intact.
    await runHyperframes(["render", projectDirectory, "--composition", "capture/index.html", "--output", picture,
      "--fps", String(fps), "--experimental-fast-capture=false"]);
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
