import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validate } from "./validate.mjs";

const fixture = () => {
  const { result } = JSON.parse(readFileSync(new URL("./examples/golden.json", import.meta.url)));
  const context = {
    openerNarration: result.flashbackLine,
    cues: [{ id: 1 }, { id: 2 }],
    understanding: { relations: [{ id: "R001" }] },
    bodyStoryboard: {
      beats: ["B001", "B002", "B003"].map((id) => ({ id, treatment: null })),
      templateRuns: [{
        beatIds: ["B001", "B002", "B003"],
        treatment: { templateId: "vox-explainer", scene: { markup: "<svg></svg>", animation: "" } }
      }]
    }
  };
  return { result, context };
};

test("片头不回查正文来源覆盖，包括无图片请求的空间讲解", () => {
  assert.deepEqual(validate(fixture()), []);
});

test("取消重复回查仍保留P1原句与引用身份", () => {
  const input = fixture();
  input.result.flashbackLine += "改写";
  input.result.flashbackShots[0].bodyRefs = ["B999"];
  input.result.flashbackShots[0].sourceRefs = ["C999"];
  const errors = validate(input);
  assert(errors.some((error) => error.includes("逐字使用P1")));
  assert(errors.some((error) => error.includes("正文不存在的 Beat: B999")));
  assert(errors.some((error) => error.includes("未知Cue: C999")));
});

test("来源资产没有使用权限仍拒绝交给外部生产", () => {
  const input = fixture();
  input.result.flashbackShots[0].sourceRefs = ["SA001"];
  input.context.sourceAssets = [{ id: "SA001", rightsStatus: "unknown" }];
  assert(validate(input).some((error) => error.includes("来源资产权利状态不可用")));
});
