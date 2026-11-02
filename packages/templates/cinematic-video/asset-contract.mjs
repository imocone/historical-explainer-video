import { hashObject } from "../../program-utils.mjs";
import { videoWindow } from "./timing.mjs";
import { VIDEO_SPEC } from "../../video-spec.mjs";
export const VIDEO_GENERATION = Object.freeze({ model: "seedance2.0fast_vip", resolution: "720p", minSeconds: 4, maxSeconds: 15 });
export const buildImageRequests = ({ treatment, storyboard, cues }) => {
  videoWindow({ span: treatment, storyboard, cues });
  return [{ target: treatment, request: {
      requestId: "AR001", kind: "fullframe-image", required: true,
      purpose: treatment.storyChange,
      sourceRefs: [...treatment.sourceRefs], mustNotInvent: [...treatment.mustNotInvent],
      acceptanceCriteria: ["独立完整16:9起始画面，符合第一镜已定景别、主体关系与动作起态，具备该镜所需的环境与行动空间", "正片Visual画风一致，无文字水印和多时刻拼贴"],
      spec: { frameId: "A", firstFramePrompt: treatment.firstFramePrompt },
      production: {
        outputProfile: "opaque-fullframe-v1",
        groupRules: ["每张图只画一幅起始状态，不提前画出未来动作或最终结果。"],
        panel: { title: "剧情视频首图", lines: [treatment.firstFramePrompt,
          `禁止补造：${treatment.mustNotInvent.join("；") || "无额外项"}`,
          "服从正片Visual画风；完整16:9单一场面，不绘制字幕、标题、伪字、水印。"], requiredTokens: [treatment.firstFramePrompt] },
        framing: { coordinateSpace: "normalized", safeRect: { x: 0, y: 0, width: 1, height: 1 },
          startFocus: { x: .5, y: .5 }, revealFocus: { x: .5, y: .5 }, source: "region-map" }
      }
    } }];
};

export const videoPromptFor = (span, part, visual) => {
  if (!visual?.id || !visual.stylePrompt?.trim()) throw new Error("视频动态请求缺少节目已选Visual的正片画风");
  const start = part.index > 1
    ? part.connection?.type === "cut"
      ? "参考@Video 1的绘画风格，以明确剪切进入本次设计的新场面，只输出新增片段，不重播前片。新场面的人物、地点与动作以本次设计为准。"
      : `将@Video 1向后延长${part.generationSeconds}秒，从其结尾状态继续，只输出新增片段，不重演已有过程。沿用该视频的绘画风格、人物外观与动作方向。`
    : "从首帧开始，沿用首帧的绘画风格与人物外观。";
  const seconds = (frames) => Number((frames / VIDEO_SPEC.fps).toFixed(3));
  const bodyStart = seconds(part.headHandleFrames);
  const bodyEnd = seconds(part.headHandleFrames + part.bodyFrameCount);
  const handles = [
    part.headHandleFrames ? `开头0至${bodyStart}秒自然延续首镜已有活动和运镜，作为入场余量` : null,
    `本次${bodyStart}至${bodyEnd}秒承载正文设计的活动`,
    part.tailHandleFrames ? `其后至${seconds(part.frameCount)}秒继续末镜已有活动和运镜，作为接出余量` : null
  ].filter(Boolean).join("；");
  return `${start}\n时间安排：${handles}。余量保持原方向和速度感，不站定等待，不重复动作，不增添新事件。\n${part.videoPrompt}\n画风贯穿全部镜头。不生成字幕、标题、水印或人物台词。`;
};

export const videoRequestFor = ({ episodeId, span, part, firstFrameSha256, previousPartSha256, previousGeneration, visual }) => {
  if (part.index > 1 && (previousGeneration
    ? previousPartSha256 || ![previousGeneration.projectId, previousGeneration.nodeId, previousGeneration.resourceId].every(value => typeof value === "string" && value)
    : !/^[a-f0-9]{64}$/u.test(previousPartSha256 ?? ""))) throw new Error("接续生成缺少唯一的前组原生成对象或剪片摘要");
  return {
  episodeId, spanId: span.id, partIndex: part.index, firstFrameSha256, prompt: videoPromptFor(span, part, visual),
  ...(part.index > 1 ? previousGeneration ? { previousGeneration } : { previousPartSha256 } : {}),
  designDigest: hashObject({ shots: part.shots, videoPrompt: part.videoPrompt,
    ...(part.connection ? { connection: part.connection } : {}),
    mustNotInvent: span.mustNotInvent, visual: { id: visual.id, stylePrompt: visual.stylePrompt } }),
  frameCount: part.frameCount, model: VIDEO_GENERATION.model, resolution: VIDEO_GENERATION.resolution, seconds: part.generationSeconds
  };
};

export const videoRequestBusinessKey = ({ episodeId, spanId, partIndex, firstFrameSha256, previousPartSha256, previousGeneration, designDigest, frameCount, seconds, model, resolution }) =>
  hashObject({ episodeId, spanId, partIndex, firstFrameSha256, previousPartSha256, previousGeneration, designDigest, frameCount, seconds, model, resolution });
