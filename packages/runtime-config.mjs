import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import {createHash} from 'node:crypto';

export const systemRoot = fileURLToPath(new URL('../', import.meta.url));
export const runtimeEnvFile = path.join(systemRoot, '.env');

// A local original is optional; the public resource is always usable by itself.
export function assetFile(file, {root = systemRoot} = {}) {
  const absolute = path.resolve(root, file);
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative) || relative.startsWith(`local-media${path.sep}`)) return absolute;
  if (!/\.(?:png|jpe?g|webp|wav|mp3|mp4|flac|otf|ttf|woff2)$/i.test(relative)) return absolute;
  const local = path.join(root, 'local-media/private-assets', relative);
  if (!existsSync(local)) return absolute;
  const actual = realpathSync(local), privateRoot = path.join(realpathSync(root),'local-media/private-assets');
  if (!actual.startsWith(privateRoot+path.sep)) throw new Error('本机素材不能链接到私有素材目录之外');
  return actual;
}

export const assetPath = (file, options) => path.relative(options?.root ?? systemRoot, assetFile(file, options)).split(path.sep).join('/');

export const assetRecords = records => Object.fromEntries(Object.entries(records).map(([key,record]) => {
  const file = assetPath(record.file);
  return [key, Object.freeze({...record,file,sha256:file.startsWith('local-media/private-assets/')
    ? record.sha256 : createHash('sha256').update(readFileSync(assetFile(record.file))).digest('hex')})];
}));

export function runtimeEnvironment({ environment = process.env, envFile = runtimeEnvFile } = {}) {
  let local = {};
  try { local = parseEnv(readFileSync(envFile, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('无法读取本机 .env 配置', { cause: error });
  }
  return { ...local, ...environment };
}

export function runtimeValue(name, fallback = '', options) {
  return String(runtimeEnvironment(options)[name] ?? '').trim() || fallback;
}

export function runtimePath(name, fallback = '', options) {
  const value = runtimeValue(name, fallback, options);
  if (!value) return '';
  if (value === '~') return homedir();
  return path.resolve(systemRoot, value.startsWith('~/') ? path.join(homedir(), value.slice(2)) : value);
}

export function runtimeCommand(name, fallback, options) {
  const value = runtimeValue(name, fallback, options);
  return value.includes('/') ? runtimePath(name, fallback, options) : value;
}

export const pythonCommand = options => runtimePath('XIAOXINXIXN_PYTHON', '.venv/bin/python', options);
export const notebookCommand = options => runtimeCommand('NLM_BIN', path.join(systemRoot, '.venv/bin/nlm'), options);

export function ttsVoice(options) {
  return runtimeValue('MINIMAX_VOICE_ID', 'male-qn-jingying', options);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  let python = pythonCommand(), cwd = systemRoot, prefix = [];
  if (command === 'nlm') {
    python = notebookCommand();
  } else if (command === 'captioner') {
    cwd = runtimePath('VIDEO_CAPTIONER_ROOT');
    if (!cwd) throw new Error('请先在本机 .env 设置 VIDEO_CAPTIONER_ROOT');
    python = runtimePath('VIDEO_CAPTIONER_PYTHON', path.join(cwd, '.venv/bin/python'));
    prefix = ['-m', 'videocaptioner'];
  } else if (command !== 'python') {
    throw new Error('用法: node packages/runtime-config.mjs python <脚本和参数> | captioner <参数> | nlm <参数>');
  }
  const child = spawn(python, [...prefix, ...args], { cwd, env: runtimeEnvironment(), stdio: 'inherit' });
  child.once('error', () => { console.error('本机工具未能启动，请运行 npm run setup -- --check'); process.exitCode = 1; });
  child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
