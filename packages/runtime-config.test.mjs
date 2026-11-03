import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { runtimeEnvironment, runtimePath, runtimeCommand, captionerRuntime, ttsVoice, systemRoot } from './runtime-config.mjs';
import { loadTtsContract } from './modules/synthesize-narration/run.mjs';
import { miniMaxPayload } from './modules/synthesize-narration/minimax.mjs';

test('进程配置覆盖本机文件，路径以系统根解析，读取不修改进程环境', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'runtime-config-'));
  t.after(() => rm(directory, {recursive:true, force:true}));
  const envFile = path.join(directory, '.env');
  await writeFile(envFile, 'MINIMAX_VOICE_ID=local-voice\nNLM_BIN="tools with spaces/nlm"\nLOCAL_ONLY=local\n');
  const before = process.env.LOCAL_ONLY;
  const options = {envFile, environment:{MINIMAX_VOICE_ID:'account-voice'}};
  assert.equal(ttsVoice(options), 'account-voice');
  assert.equal(runtimeCommand('NLM_BIN', 'nlm', options), path.join(systemRoot, 'tools with spaces/nlm'));
  assert.equal(runtimePath('MISSING', '', options), '');
  assert.equal(runtimeEnvironment(options).LOCAL_ONLY, 'local');
  assert.equal(process.env.LOCAL_ONLY, before);
});

test('配置音色实际进入原MiniMax请求，公共默认不绑定个人音色', async t => {
  const previous = process.env.MINIMAX_VOICE_ID;
  t.after(() => previous === undefined ? delete process.env.MINIMAX_VOICE_ID : process.env.MINIMAX_VOICE_ID = previous);
  process.env.MINIMAX_VOICE_ID = 'fixture-account-voice';
  const contract = await loadTtsContract();
  const payload = miniMaxPayload({text:'当前正文。', contract});
  assert.equal(payload.voice_setting.voice_id, 'fixture-account-voice');
  const empty = {envFile:path.join(tmpdir(), `missing-config-${process.pid}`), environment:{}};
  assert.equal(ttsVoice(empty), 'male-qn-jingying');
});

test('词级时间默认用项目Python，显式工具目录和解释器仍优先', () => {
  const options = {envFile:path.join(tmpdir(), `missing-captioner-config-${process.pid}`), environment:{}};
  assert.deepEqual(captionerRuntime(options), {root:systemRoot, python:path.join(systemRoot,'.venv/bin/python')});
  const root = path.join(tmpdir(), 'custom captioner');
  assert.deepEqual(captionerRuntime({...options, environment:{VIDEO_CAPTIONER_ROOT:root}}),
    {root, python:path.join(root,'.venv/bin/python')});
  const python = path.join(root, 'custom python');
  assert.deepEqual(captionerRuntime({...options, environment:{VIDEO_CAPTIONER_ROOT:root,VIDEO_CAPTIONER_PYTHON:python}}),
    {root, python});
  assert.equal(captionerRuntime({...options, environment:{XIAOXINXIXN_PYTHON:python}}).python, python);
});

test('Python入口使用指定解释器和原参数，不依赖调用目录', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'runtime-python-'));
  t.after(() => rm(directory, {recursive:true, force:true}));
  const executable = path.join(directory, 'python fixture');
  await writeFile(executable, `#!${process.execPath}\nconsole.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));\n`, {mode:0o755});
  const {stdout} = await promisify(execFile)(process.execPath, [path.join(systemRoot, 'packages/runtime-config.mjs'), 'python', '-B', 'script.py', 'argument with spaces'], {
    cwd:directory, env:{...process.env, XIAOXINXIXN_PYTHON:executable}
  });
  assert.deepEqual(JSON.parse(stdout), {args:['-B','script.py','argument with spaces'], cwd:systemRoot.replace(/\/$/, '')});
  const captioner = await promisify(execFile)(process.execPath, [path.join(systemRoot, 'packages/runtime-config.mjs'),
    'captioner','transcribe','audio with spaces.mp3','--word-timestamps'], {
    cwd:systemRoot, env:{...process.env,VIDEO_CAPTIONER_ROOT:directory,VIDEO_CAPTIONER_PYTHON:executable}
  });
  assert.deepEqual(JSON.parse(captioner.stdout), {args:['-m','videocaptioner','transcribe','audio with spaces.mp3','--word-timestamps'],cwd:await realpath(directory)});
});
