import { constants } from 'node:fs';
import { access, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { runtimeEnvironment, runtimeValue, runtimePath, pythonCommand, notebookCommand, ttsVoice, systemRoot } from '../packages/runtime-config.mjs';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--check')) throw new Error('用法: npm run setup [-- --check]');
const checkOnly = args.includes('--check');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) throw new Error('需要 Node.js 22.12 或更新版本');
if (process.platform !== 'darwin') throw new Error('当前安装入口支持 macOS；其它系统尚未完成媒体工具适配');

const ready = (command, args) => spawnSync(command, args, { cwd: systemRoot, env: runtimeEnvironment(), stdio: 'ignore', timeout: 15000 }).status === 0;
const present = async file => access(file, constants.X_OK).then(() => true, () => false);
const installed = async command => command.includes('/') ? present(command)
  : (await Promise.all((runtimeEnvironment().PATH ?? '').split(path.delimiter).filter(Boolean).map(directory => present(path.join(directory, command))))).some(Boolean);
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: systemRoot, env: runtimeEnvironment(), stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(command)} 执行失败，停止安装；修正后重复原命令`);
};
let failures = 0;
const report = (label, ok, fix) => {
  console.log(`${ok ? '✓' : '缺少'} ${label}${ok ? '' : `：${fix}`}`);
  if (!ok) failures += 1;
};

for (const [label, command, flag] of [['FFmpeg', 'ffmpeg', '-version'], ['ffprobe', 'ffprobe', '-version'], ['ImageMagick', 'magick', '-version']]) {
  report(label, ready(command, [flag]), 'brew install ffmpeg imagemagick');
}
if (!checkOnly) {
  report('uv', ready('uv', ['--version']), 'brew install uv');
  if (failures) process.exit(1);
  try { await writeFile(path.join(systemRoot, '.env'), await readFile(path.join(systemRoot, '.env.example')), {flag:'wx', mode:0o600}); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  run('npm', ['ci']);
  // The repository environment is owned by this installer; explicit user tools remain unchanged.
  const localPython = path.join(systemRoot, '.venv/bin/python');
  if (!await present(localPython)) run('uv', ['venv', '--python', '3.11', path.join(systemRoot, '.venv')]);
  run('uv', ['pip', 'install', '--python', localPython, '-r', path.join(systemRoot, 'requirements.txt')]);
  const hyperframes = path.join(path.dirname(require.resolve('hyperframes/package.json')), 'bin/hyperframes.mjs');
  run(process.execPath, [hyperframes, 'browser', 'ensure']);
}

report('Python依赖', ready(pythonCommand(), ['-c', 'import PIL,numpy,scipy,soundfile,notebooklm_tools']), 'npm run setup；使用自定义Python时在该环境安装 requirements.txt');
let hyperframes;
try { hyperframes = path.join(path.dirname(require.resolve('hyperframes/package.json')), 'bin/hyperframes.mjs'); }
catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
report('HyperFrames浏览器', Boolean(hyperframes && ready(process.execPath, [hyperframes, 'browser', 'path'])), 'npm run setup');

// Availability only: do not log in, inspect credentials, query services or generate media.
console.log(`配音：${runtimeValue('MINIMAX_API_KEY') && ttsVoice() ? '已配置' : '填写 .env 中的 MINIMAX_API_KEY'}`);
console.log('图片：使用 Codex 原生生图，无图片 API 配置。');
console.log(`NotebookLM：${await installed(notebookCommand()) ? '工具已安装，使用前自行登录' : '运行 npm run setup 安装'}`);
console.log(`AGY：${await installed('agy') ? '工具已安装，使用前自行登录' : 'P1 正文与默认字幕需要；安装入口见 README'}`);
console.log(`TypeSafe：${runtimeValue('TYPESAFE_API_KEY') ? '已配置' : '需要出处定位时配置 .env 中的 TYPESAFE_API_KEY，或使用原个人配置'}`);
console.log(`VideoCaptioner：${runtimePath('VIDEO_CAPTIONER_ROOT') ? '已设置目录' : '需要备用识别或片头取时间时配置 VIDEO_CAPTIONER_ROOT'}`);
console.log('AGY、即梦及宿主生图／浏览器：按实际阶段安装和登录；本命令不调用。');
if (failures) process.exitCode = 1;
else console.log(checkOnly ? '本地环境检查通过。' : '安装完成。按 README 配置账号后开始节目。');
