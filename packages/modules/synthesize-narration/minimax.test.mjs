import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createMiniMaxTtsService, miniMaxPayload } from "./minimax.mjs";
import { createOpenerMiniMaxTtsService } from '../author-bookend/validate.mjs';

const contract = {
  model: "speech-2.8-hd",
  voice: "voice",
  speechRate: 1.1,
  volume: 1,
  pitch: 0,
  emotion: "auto",
  languageBoost: "Chinese",
  sampleRate: 32000,
  rawFormat: "flac",
  channels: 1,
  subtitleGranularity: "word"
};

const response = (body, status) => ({
  ok: status >= 200 && status < 300,
  status,
  async text() {
    return JSON.stringify(body);
  }
});

test('MiniMax 保留原默认地址，本机配置可选择账号对应区域且环境优先', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'minimax-host-'));
  t.after(() => rm(directory, {recursive:true, force:true}));
  const envFile = path.join(directory, '.env');
  await writeFile(envFile, 'MINIMAX_API_HOST=https://api.minimax.io/\n');
  for (const factory of [createMiniMaxTtsService, createOpenerMiniMaxTtsService]) for (const [environment, file, expected] of [
    [{}, path.join(directory, 'missing'), 'https://api.minimaxi.com'],
    [{}, envFile, 'https://api.minimax.io'],
    [{MINIMAX_API_HOST:'https://api.minimax.cn'}, envFile, 'https://api.minimax.cn']
  ]) {
    let calls = 0;
    const actualContract = {...contract,rawFormat:factory === createMiniMaxTtsService ? 'flac' : 'mp3'};
    const service = factory({apiKey:'test-key', environment, envFile:file, fetchImpl:async (url, request) => {
      calls++; assert.equal(url, `${expected}/v1/t2a_v2`);
      assert.equal(request.headers.Authorization, 'Bearer test-key');
      assert.equal(JSON.parse(request.body).audio_setting.format,actualContract.rawFormat);
      return response({base_resp:{status_code:0},data:{status:2,audio:'0001'}},200);
    }});
    assert.deepEqual((await service.synthesize({text:'甲。',contract:actualContract})).audio, Buffer.from([0,1]));
    assert.equal(calls,1);
  }
  for (const factory of [createMiniMaxTtsService, createOpenerMiniMaxTtsService]) {
    const invalid = factory({apiKey:'test-key', envFile, environment:{MINIMAX_API_HOST:'https://invalid.example'},
      fetchImpl:async () => assert.fail('无效地址不得发送凭据')});
    await assert.rejects(invalid.synthesize({text:'甲。',contract}), error => error.code === 'local-preflight-failed');
  }
});

test("生僻姓名用供应商原生读音覆盖，正文和无关请求保持原样", () => {
  const text = "秦熺问相位，万俟卨承办。";
  const payload = miniMaxPayload({ text, contract });
  assert.equal(payload.text, text);
  assert.deepEqual(payload.pronunciation_dict, {
    tone: ["秦熺/(qin2)(xi1)", "万俟卨/(mo4)(qi2)(xie4)"]
  });
  assert.equal(payload.voice_setting.voice_id, contract.voice);
  assert.equal(payload.model, contract.model);
  assert.equal(Object.hasOwn(miniMaxPayload({ text: "甲。", contract }), "pronunciation_dict"), false);
});

test("MiniMax 只把确定未创建与远端结果未知区分开", async () => {
  const unauthorized = createMiniMaxTtsService({
    apiKey: "test-key",
    fetchImpl: async () => response({ message: "unauthorized" }, 401)
  });
  await assert.rejects(
    unauthorized.synthesize({ text: "甲。", contract }),
    (error) => error.code === "remote-task-not-created"
      && error.definitiveNoRemoteTask === true
  );

  const serverFailure = createMiniMaxTtsService({
    apiKey: "test-key",
    fetchImpl: async () => response({ message: "server error" }, 500)
  });
  await assert.rejects(
    serverFailure.synthesize({ text: "甲。", contract }),
    (error) => error.code === "remote-result-unknown"
      && error.definitiveNoRemoteTask === false
  );
});
