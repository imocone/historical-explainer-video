import { execFile } from "node:child_process";
import { rmSync } from "node:fs";
import { lstat, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import puppeteer from "puppeteer-core";
import { withMediaResources } from "./media-process.mjs";

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
export const hyperframesCli = path.join(path.dirname(require.resolve("hyperframes/package.json")), "bin/hyperframes.mjs");
export const hyperframesEnv = { ...process.env };

export const studioBuildSignature = async () => {
  const files = ['browser-session.mjs', 'studio-server.mjs', 'studio-render.mjs', 'studio-composition.mjs'];
  const sources = await Promise.all([...files.map(file => readFile(new URL(file, import.meta.url))),
    readFile(path.resolve(path.dirname(hyperframesCli), '../package.json'))]);
  return createHash('sha256').update(Buffer.concat(sources)).digest('hex');
};

// Use the adapter and port discovery shipped with the pinned CLI; keep Studio's
// native rendering and its normal status/stop commands.
export const loadStudioRuntime = async () => {
  const directory = path.resolve(path.dirname(hyperframesCli), '../dist');
  const files = await readdir(directory);
  const server = files.find(file => /^studioServer-.*\.js$/.test(file));
  const preview = files.find(file => /^preview-.*\.js$/.test(file));
  const api = files.find(file => /^studio-api-.*\.js$/.test(file));
  const compiler = files.find(file => /^compiler-.*\.js$/.test(file));
  const source = preview && await readFile(path.join(directory, preview), 'utf8');
  const ports = source?.match(/import\s*\{[^}]*\bfindPortAndServe\b[^}]*\}\s*from\s*["']([^"']+)["']/)?.[1];
  if (!server || !ports || !api || !compiler) throw new Error('当前HY缺少Studio原生适配入口');
  return { ...await import(path.join(directory, server)), ...await import(path.resolve(directory, ports)),
    ...await import(path.join(directory, api)), ...await import(path.join(directory, compiler)) };
};

const bounded = async (operation, milliseconds) => {
  let timer;
  try { return await Promise.race([operation, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('浏览器操作超时')), milliseconds);
  })]); } finally { clearTimeout(timer); }
};

const alive = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== "ESRCH"; }
};

const removeAbandoned = async parent => {
  for (const name of await readdir(parent)) {
    if (!/^media-session-\d+-/.test(name)) continue;
    const directory = path.join(parent, name);
    try {
      const info = await lstat(directory);
      const marker = await lstat(path.join(directory, ".owner.json"));
      if (!info.isDirectory() || info.isSymbolicLink() || !marker.isFile() || marker.isSymbolicLink()
        || info.uid !== process.getuid() || marker.uid !== process.getuid()) continue;
      const owner = JSON.parse(await readFile(path.join(directory, ".owner.json"), "utf8"));
      if (!Number.isInteger(owner.pid) || owner.pid < 1 || !name.startsWith(`media-session-${owner.pid}-`) || alive(owner.pid)) continue;
      if (Number.isInteger(owner.browserPid) && owner.browserPid > 0 && alive(owner.browserPid)) {
        const { stdout } = await exec("ps", ["-p", String(owner.browserPid), "-o", "pgid=,command="]);
        const match = stdout.trim().match(/^(\d+)\s+(.+)$/);
        const profile = `--user-data-dir=${path.join(directory, "profile")}`;
        if (!match || Number(match[1]) !== owner.browserPid || !match[2].includes("chrome-headless-shell")
          || !(match[2].includes(`${profile} `) || match[2].endsWith(profile))) continue;
        try { process.kill(-owner.browserPid, "SIGKILL"); }
        catch (error) { if (error.code !== "ESRCH") throw error; }
      }
      await rm(directory, { recursive: true, force: true });
    } catch (error) {
      if (!(error instanceof SyntaxError) && !["ENOENT", "ESRCH", "EACCES"].includes(error.code)) throw error;
    }
  }
};

export const withBrowserSession = (run, options = {}) => withMediaResources(resources => browserSession(run, options, resources));

async function browserSession(run, { scratchParent = os.tmpdir() } = {}, resources) {
  await removeAbandoned(scratchParent);
  const directory = await mkdtemp(path.join(scratchParent, `media-session-${process.pid}-`));
  const owner = { pid: process.pid };
  const record = async () => {
    await writeFile(path.join(directory, ".owner.json.tmp"), JSON.stringify(owner));
    await rename(path.join(directory, ".owner.json.tmp"), path.join(directory, ".owner.json"));
  };
  await record();
  const controller = new AbortController();
  let browserProcess;
  const onExit = () => {
    if (browserProcess?.exitCode === null && browserProcess.signalCode === null) {
      try { process.kill(-owner.browserPid, "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") return; }
    }
    rmSync(directory, { recursive: true, force: true });
  };
  process.once("exit", onExit);
  let browserPromise, closing, killed = false;
  const killBrowser = () => {
    if (!killed && browserProcess?.exitCode === null && browserProcess.signalCode === null && Number.isInteger(owner.browserPid) && owner.browserPid > 1) {
      killed = true;
      try { process.kill(-owner.browserPid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  };
  const close = () => closing ??= (async () => {
    controller.abort();
    try {
      if (browserPromise) {
        const browser = await bounded(browserPromise, 17000);
        await bounded(browser.close(), 2000).catch(() => { killBrowser(); browser.disconnect(); });
      }
    } finally { killBrowser(); await rm(directory, { recursive: true, force: true }); }
  })();
  const abort = () => { controller.abort(resources.signal.reason); killBrowser(); };
  resources.signal.addEventListener('abort', abort, { once: true });
  const handlers = Object.entries({ SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }).map(([signal, code]) => {
    const handler = () => close().finally(() => process.exit(code));
    process.once(signal, handler);
    return [signal, handler];
  });
  try {
    return await run({ directory, signal: controller.signal,
      browser: () => browserPromise ??= (async () => {
        resources.signal.throwIfAborted();
        const { stdout } = await exec(process.execPath, [hyperframesCli, "browser", "path"], { env: hyperframesEnv, timeout: 15000 });
        const browser = await puppeteer.launch({ executablePath: stdout.trim(), headless: true,
          userDataDir: path.join(directory, "profile"), handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
          timeout: 15000, protocolTimeout: 15000,
          args: ["--no-sandbox", "--use-gl=angle", "--use-angle=default", "--disable-dev-shm-usage", "--force-gpu-mem-available-mb=256"] });
        try {
          browserProcess = browser.process();
          owner.browserPid = browserProcess.pid;
          await record();
          await resources.track(browserProcess, directory);
          if (closing || resources.signal.aborted) { killBrowser(); browser.disconnect(); throw new Error('浏览器启动已取消'); }
          return browser;
        } catch (error) { killBrowser(); browser.disconnect(); throw error; }
      })()
    });
  } finally {
    try { await close(); }
    finally {
      for (const [signal, handler] of handlers) process.removeListener(signal, handler);
      resources.signal.removeEventListener('abort', abort);
      process.removeListener("exit", onExit);
    }
  }
}
