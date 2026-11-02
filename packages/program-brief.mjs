import { mkdir } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import {
  assertProjectPath,
  atomicWriteData,
  hashObject,
  readData,
  withoutProducer
} from "./program-utils.mjs";
import { getEpisodePaths } from "./workspace-paths.mjs";

const episodeDirectories = (paths) => [
  paths.production,
  paths.input,
  paths.p0,
  paths.p1,
  paths.p2,
  paths.p3,
  paths.p4,
  paths.p4,
  paths.output
];

export const assertAcceptedProgramPlan = (plan) => {
  const producer = plan?._producer;
  const expectedProducer = plan?.programForm === "historical-documentary"
    ? "plan-historical-documentary"
    : "plan-program";
  if (!producer
    || producer.moduleId !== expectedProducer
    || producer.nodeId !== expectedProducer) {
    throw new Error("program.yaml 缺少 P0 正式策划生产者");
  }
  const business = withoutProducer(plan);
  if (producer.outputSha256 !== hashObject(business)) {
    throw new Error("program.yaml 的 P0 正式策划输出摘要不一致");
  }
  return business;
};

export const programCommonProjection = (plan) => ({
  schemaVersion: plan.schemaVersion,
  ...(plan.referenceProgram ? { referenceProgram: structuredClone(plan.referenceProgram) } : {}),
  programId: plan.programId,
  programForm: plan.programForm,
  ...(plan.programForm === "historical-explainer"
    ? { explainerType: plan.explainerType }
    : {}),
  seriesTitle: plan.seriesTitle,
  audience: plan.audience,
  ...(plan.programForm === "historical-explainer" && plan.maxDurationSeconds !== undefined
    ? { maxDurationSeconds: plan.maxDurationSeconds }
    : {}),
  ...(plan.programForm === "historical-documentary"
    ? { storyWorld: structuredClone(plan.storyWorld) }
    : {})
});

export const programEpisodeProjection = (episode, programForm) => ({
  episodeId: episode.episodeId,
  ...(episode.referenceVideoIds ? { referenceVideoIds: [...episode.referenceVideoIds] } : {}),
  episodeTitle: episode.episodeTitle,
  ...(programForm === "historical-documentary"
    ? {
        episodeConcept: episode.episodeConcept,
        episodeThroughline: episode.episodeThroughline,
        storyOutline: structuredClone(episode.storyOutline)
      }
    : {
        episodeQuestion: episode.episodeQuestion,
        episodeAnswer: episode.episodeAnswer
      }),
  episodeCreativeBrief: episode.episodeCreativeBrief,
  episodeScope: episode.episodeScope,
  episodeBenefit: episode.episodeBenefit
});

export const narrationEpisodeProjection = (episodeBrief) => ({
  schemaVersion: episodeBrief.schemaVersion,
  ...(episodeBrief.referenceProgram ? {
    referenceProgram: structuredClone(episodeBrief.referenceProgram),
    referenceVideoIds: [...episodeBrief.referenceVideoIds]
  } : {}),
  episodeId: episodeBrief.episodeId,
  programId: episodeBrief.programId,
  programForm: episodeBrief.programForm,
  ...(episodeBrief.programForm === "historical-explainer"
    ? { explainerType: episodeBrief.explainerType }
    : {}),
  seriesTitle: episodeBrief.seriesTitle,
  episodeTitle: episodeBrief.episodeTitle,
  ...(episodeBrief.maxDurationSeconds !== undefined
    ? { maxDurationSeconds: episodeBrief.maxDurationSeconds }
    : {}),
  ...(episodeBrief.programForm === "historical-documentary"
    ? {
        episodeConcept: episodeBrief.episodeConcept,
        episodeThroughline: episodeBrief.episodeThroughline,
        storyWorld: structuredClone(episodeBrief.storyWorld),
        storyOutline: structuredClone(episodeBrief.storyOutline)
      }
    : {
        episodeQuestion: episodeBrief.episodeQuestion,
        episodeAnswer: episodeBrief.episodeAnswer
      }),
  episodeCreativeBrief: episodeBrief.episodeCreativeBrief,
  episodeScope: episodeBrief.episodeScope,
  episodeBenefit: episodeBrief.episodeBenefit,
  audience: episodeBrief.audience
});

export const episodeBriefBusiness = ({
  common,
  episode
}) => ({
  schemaVersion: common.schemaVersion,
  ...(common.referenceProgram ? {
    referenceProgram: structuredClone(common.referenceProgram),
    referenceVideoIds: [...episode.referenceVideoIds]
  } : {}),
  episodeId: episode.episodeId,
  programId: common.programId,
  programForm: common.programForm,
  ...(common.programForm === "historical-explainer"
    ? { explainerType: common.explainerType }
    : {}),
  seriesTitle: common.seriesTitle,
  episodeTitle: episode.episodeTitle,
  ...(common.maxDurationSeconds !== undefined
    ? { maxDurationSeconds: common.maxDurationSeconds }
    : {}),
  ...(common.programForm === "historical-documentary"
    ? {
        episodeConcept: episode.episodeConcept,
        episodeThroughline: episode.episodeThroughline,
        storyWorld: structuredClone(common.storyWorld),
        storyOutline: structuredClone(episode.storyOutline)
      }
    : {
        episodeQuestion: episode.episodeQuestion,
        episodeAnswer: episode.episodeAnswer
      }),
  episodeCreativeBrief: episode.episodeCreativeBrief,
  episodeScope: episode.episodeScope,
  episodeBenefit: episode.episodeBenefit,
  audience: common.audience
});

export const episodeBriefProducer = ({ business }) => ({
  moduleId: business.programForm === "historical-documentary"
    ? "plan-historical-documentary"
    : "plan-program",
  nodeId: business.programForm === "historical-documentary"
    ? "plan-historical-documentary"
    : "plan-program",
  outputSha256: hashObject(business)
});

export const expectedEpisodeBrief = ({
  plan,
  episodeId
}) => {
  const sourceEpisode = plan.episodes.find((episode) => episode.episodeId === episodeId);
  if (!sourceEpisode) throw new Error(`当前节目策划不再包含单集 ${episodeId}`);
  const common = programCommonProjection(plan);
  const episode = programEpisodeProjection(sourceEpisode, plan.programForm);
  const business = episodeBriefBusiness({ common, episode });
  return {
    brief: {
      ...business,
      _producer: episodeBriefProducer({ business })
    },
    common,
    episode
  };
};

const prepareEpisodeBriefs = async ({
  root,
  systemRoot,
  plan
}) => {
  const business = assertAcceptedProgramPlan(plan);
  const schemaPath = path.join(systemRoot, "contracts", "episode-brief.schema.json");
  const validate = new Ajv2020({ allErrors: true, strict: false })
    .compile(await readData(schemaPath));
  const briefs = business.episodes.map((episode) => {
    const { brief } = expectedEpisodeBrief({
      plan: business,
      episodeId: episode.episodeId
    });
    if (!validate(brief)) {
      const errors = (validate.errors ?? [])
        .map((item) => `${item.instancePath || "/"} ${item.message}`)
        .join("; ");
      throw new Error(`episode-brief ${episode.episodeId} 合同失败: ${errors}`);
    }
    return {
      episodeId: episode.episodeId,
      paths: getEpisodePaths(root, episode.episodeId),
      brief
    };
  });
  for (const item of briefs) {
    for (const directory of episodeDirectories(item.paths)) {
      await assertProjectPath({ root, file: directory, label: "剧集阶段目录" });
    }
    await assertProjectPath({ root, file: item.paths.episodeBrief, label: "P0 单集任务路径" });
  }
  return briefs;
};

export const materializeEpisodeBriefs = async (options) => {
  const briefs = await prepareEpisodeBriefs(options);
  for (const item of briefs) {
    await Promise.all(episodeDirectories(item.paths)
      .map((directory) => mkdir(directory, { recursive: true })));
    await (options.write ?? atomicWriteData)(item.paths.episodeBrief, item.brief);
  }
  return briefs.map((item) => item.episodeId);
};
