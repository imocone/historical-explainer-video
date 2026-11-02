import { canUseSourceForExternalProduction } from "../../source-rights.mjs";
import { sha256 } from "../../program-utils.mjs";
import { openerCopyErrors } from "./copy-policy.mjs";
import {
  OPENER_RENDER_POLICY,
  openerNarrationShareForTreatment,
  openerTimelineForTreatment
} from "./render-policy.mjs";

export const validateOpenerNarration = (value) => openerCopyErrors(value);

const normalized = (value) => String(value ?? "").replace(/\s+/gu, "").trim();
const compact = (value) => normalized(value).replace(/[\p{P}\p{S}]/gu, "");
const visibleLength = (value) => Array.from(String(value ?? "").replace(/\s+/gu, "")).length;
const occurrenceCount = (value, needle) => {
  if (!needle) return 0;
  let count = 0;
  let cursor = 0;
  while (cursor <= value.length - needle.length) {
    const index = value.indexOf(needle, cursor);
    if (index < 0) break;
    count += 1;
    cursor = index + needle.length;
  }
  return count;
};

const semanticItemsFor = (context) => [
  ...(context.semanticContext?.facts ?? context.understanding?.facts ?? []),
  ...(context.semanticContext?.relations ?? context.understanding?.relations ?? []),
  ...(context.semanticContext?.evidence ?? context.understanding?.evidence ?? [])
];

const bodyStoryboardFor = (context) => context.bodyStoryboard ?? context.storyboard ?? {};

const screenText = (screenLines) => compact((screenLines ?? []).join(""));
const spokenText = (screenLines) => (screenLines ?? []).join("").replace(/\s+/gu, "").trim();
export const spokenSentencesForTreatment = (treatment) => [
  {
    target: "flashbackLine",
    text: spokenText([treatment?.flashbackLine])
  }
];

export const openerNarrationText = (treatment) => spokenSentencesForTreatment(treatment)
  .map(({ text }) => text)
  .join("\n");

export const normalizeProviderSentence = (value) => compact(value);

const validateScreenCopy = ({ errors, label, screenLines, highlight }) => {
  if (highlight !== null && highlight !== undefined) {
    const marker = String(highlight);
    const wholeLineOccurrences = (screenLines ?? [])
      .reduce((total, line) => total + occurrenceCount(String(line), marker), 0);
    if (wholeLineOccurrences === 0) {
      errors.push(`${label} highlight 必须出现在 screenLines 中`);
    } else if (wholeLineOccurrences !== 1) {
      errors.push(`${label} highlight 必须且只能完整出现在一条 screenLines 中一次`);
    }
  }
};

export function completeCandidate({ result, context }) {
  if (!Object.hasOwn(result, "flashbackLine")) result.flashbackLine = context.openerNarration;
}

export function validate({ result, context }) {
  const errors = [];
  if (result.templateId !== "episode-opener") errors.push("片头成果 templateId 必须是 episode-opener");
  const evidenceFields = ["textSha256", "durationMs", "audioSha256", "ttsFingerprint", "sentenceCues"]
    .filter((field) => result.narration?.[field] !== undefined);
  if (evidenceFields.length !== 0 && evidenceFields.length !== 5) {
    errors.push("片头口播的文本摘要、时长、音频摘要、TTS 指纹和句级卡点必须同时存在");
  }

  const flashbackLine = spokenText([result.flashbackLine]);
  const p1OpenerNarration = typeof context.openerNarration === "string"
    ? context.openerNarration
    : "";
  if (p1OpenerNarration && result.flashbackLine !== p1OpenerNarration) {
    errors.push("片头唯一口播必须逐字使用P1正式 openerNarration");
  }
  errors.push(...openerCopyErrors(flashbackLine));
  const narrationShare = openerNarrationShareForTreatment(result);
  if (narrationShare !== null
    && narrationShare > OPENER_RENDER_POLICY.narration.maxShareOfOpener + Number.EPSILON) {
    errors.push("片头TTS不得超过当前模板实际片头时段的80%");
  }

  const shots = result.flashbackShots ?? [];
  if (shots.length !== 3) errors.push("片头必须固定使用 O01/O02/O03 三张闪回画面");
  const expectedIds = ["O01", "O02", "O03"];
  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index];
    const expectedId = expectedIds[index];
    if (!shot) continue;
    if (shot.id !== expectedId) errors.push(`片头第 ${index + 1} 张闪回图必须是 ${expectedId}`);
    validateScreenCopy({
      errors,
      label: `片头闪回 ${expectedId}`,
      screenLines: shot.screenLines,
      highlight: shot.highlight
    });
    for (const line of shot.screenLines ?? []) {
      if (visibleLength(line) > 10) errors.push(`片头闪回 ${expectedId} screenLines 每行最多 10 个可见字符`);
    }
    const unsupportedScreenLine = (shot.screenLines ?? [])
      .find((line) => !String(result.flashbackLine ?? "").normalize("NFC").includes(line.normalize("NFC")));
    if (unsupportedScreenLine !== undefined) {
      errors.push(`片头闪回 ${expectedId} 的每条屏幕短标签必须分别来自 flashbackLine 原句`);
    }
  }

  const shotCopy = shots.map((shot) => screenText(shot.screenLines));
  if (new Set(shotCopy).size !== shotCopy.length) errors.push("三张片头闪回图不得机械重复屏幕文字");

  const sentences = spokenSentencesForTreatment(result);
  if (sentences.length !== 1 || !sentences[0].text) errors.push("片头必须只提供一条钩子口播");
  if (result.narration) {
    const narrationText = openerNarrationText(result);
    if (result.narration.textSha256 !== sha256(narrationText)) {
      errors.push("片头口播文本摘要必须由屏幕句顺序确定性生成");
    }
    const cues = result.narration.sentenceCues ?? [];
    if (cues.length !== 1) errors.push("片头句级卡点必须只对应唯一钩子口播");
    for (let index = 0; index < cues.length; index += 1) {
      const cue = cues[index];
      if (cue.target !== sentences[index]?.target) errors.push(`片头第 ${index + 1} 条句级卡点目标与口播句序不一致`);
      if (!Number.isInteger(cue.startMs) || !Number.isInteger(cue.endMs) || cue.endMs <= cue.startMs) {
        errors.push(`片头第 ${index + 1} 条句级卡点时间无效`);
      }
      if (index > 0 && cue.startMs < cues[index - 1].endMs) {
        errors.push(`片头第 ${index + 1} 条句级卡点与上一句重叠`);
      }
      if (Number.isInteger(result.narration.durationMs) && cue.endMs > result.narration.durationMs + 100) {
        errors.push(`片头第 ${index + 1} 条句级卡点超出正式音频`);
      }
    }
    try {
      openerTimelineForTreatment(result);
    } catch (error) {
      errors.push(error.message);
    }
  }

  const bodyStoryboard = bodyStoryboardFor(context);
  const bodyBeats = bodyStoryboard.beats ?? [];
  const bodyById = new Map(bodyBeats.map((beat) => [beat.id, beat]));
  const templateRunByBeatId = new Map((bodyStoryboard.templateRuns ?? []).flatMap((run) => (
    (run.beatIds ?? []).map((beatId) => [beatId, run])
  )));
  const completedTreatmentFor = (beat) => beat?.treatment
    ?? templateRunByBeatId.get(beat?.id)?.treatment
    ?? null;
  const semanticItems = semanticItemsFor(context);
  const semanticById = new Map(semanticItems.map((item) => [item.id, item]));
  const cueRefs = new Set((context.cues ?? []).map(({ id }) => `C${String(id).padStart(3, "0")}`));
  const sourceAssets = new Map((context.sourceAssets ?? []).map((item) => [item.id, item]));

  const validateBodyRefs = ({ label, bodyRefs }) => {
    if (!bodyById.size) return;
    for (const ref of bodyRefs ?? []) {
      const beat = bodyById.get(ref);
      if (!beat) errors.push(`${label} 引用了正文不存在的 Beat: ${ref}`);
      else if (!completedTreatmentFor(beat)) errors.push(`${label} 引用的正文 Beat 尚未完成 P3: ${ref}`);
    }
  };

  for (const shot of shots) {
    validateBodyRefs({ label: `片头闪回 ${shot.id}`, bodyRefs: shot.bodyRefs });
    for (const ref of shot.sourceRefs ?? []) {
      if (ref.startsWith("SA")) {
        const asset = sourceAssets.get(ref);
        if (!asset) errors.push(`片头闪回 ${shot.id} 引用未登记来源资产: ${ref}`);
        else if (!canUseSourceForExternalProduction(asset.rightsStatus)) {
          errors.push(`片头闪回 ${shot.id} 来源资产权利状态不可用: ${ref}`);
        }
      } else if (ref.startsWith("C")) {
        if (!cueRefs.has(ref)) errors.push(`片头闪回 ${shot.id} 引用未知Cue: ${ref}`);
      } else if (!semanticById.has(ref)) {
        errors.push(`片头闪回 ${shot.id} 引用未知语义: ${ref}`);
      }
    }
  }

  return errors;
}
