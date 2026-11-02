import assert from "node:assert/strict";
import test from "node:test";

import { createMiniMaxTtsService } from "./minimax.mjs";

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
