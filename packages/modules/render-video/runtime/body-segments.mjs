import { isExplainerTemplateId } from "../../../explainer-template-selection.mjs";

const templateRunMembershipFor = (storyboard, requireTreatment) => {
  const beats = storyboard.beats ?? [];
  const templateRuns = storyboard.templateRuns ?? [];
  if (!Array.isArray(templateRuns)) throw new Error("templateRuns 必须是数组");
  const beatIndexById = new Map(beats.map((beat, index) => [beat.id, index]));
  if (beatIndexById.size !== beats.length) throw new Error("Beat id 重复");
  const runIds = new Set();
  const membership = new Map();
  let previousRunEndIndex = -1;
  for (const run of templateRuns) {
    if (!run || typeof run !== "object" || Array.isArray(run)) {
      throw new Error("templateRun 必须是对象");
    }
    if (typeof run.id !== "string" || !/^TR\d{3}$/u.test(run.id)) {
      throw new Error("templateRun id 必须是 TR001 格式");
    }
    if (runIds.has(run.id)) throw new Error(`templateRun id 重复: ${run.id}`);
    runIds.add(run.id);
    const fullframe = run.templateId === "fullframe-narrative";
    if (!fullframe && !isExplainerTemplateId(run.templateId)) {
      throw new Error(`${run.id} 当前只能连续播放已登记讲解模板`);
    }
    if (!Array.isArray(run.beatIds) || run.beatIds.length < 1) {
      throw new Error(`${run.id} 必须至少包含一个 Beat`);
    }
    if (fullframe ? run.treatment !== null : requireTreatment(run.id) && run.treatment?.templateId !== run.templateId) {
      throw new Error(`${run.id} 缺少当前讲解模板的整段 treatment`);
    }
    const indexes = run.beatIds.map((beatId) => {
      const index = beatIndexById.get(beatId);
      if (index === undefined) throw new Error(`${run.id} 引用了未知 Beat: ${beatId}`);
      if (membership.has(beatId)) throw new Error(`${beatId} 重复属于多个 templateRun`);
      const beat = beats[index];
      if (beat.templateId !== run.templateId) {
        throw new Error(`${run.id}/${beatId} 模板身份不一致`);
      }
      if (!fullframe && beat.treatment !== null) {
        throw new Error(`${run.id}/${beatId} 不得保留成员级 treatment`);
      }
      return index;
    });
    for (let index = 1; index < indexes.length; index += 1) {
      if (indexes[index] !== indexes[index - 1] + 1) {
        throw new Error(`${run.id} 成员 Beat 必须按正文顺序连续排列`);
      }
    }
    if (indexes[0] <= previousRunEndIndex) {
      throw new Error(`${run.id} 必须按正文顺序登记且不得重叠`);
    }
    previousRunEndIndex = indexes.at(-1);
    run.beatIds.forEach((beatId) => membership.set(beatId, run));
  }
  for (const beat of beats) {
    const isExplainer = isExplainerTemplateId(beat.templateId);
    if (isExplainer && !membership.has(beat.id)) {
      throw new Error(`${beat.id} 讲解 Beat 必须且只能属于一个 templateRun`);
    }
    if (!isExplainer && beat.templateId !== "fullframe-narrative" && membership.has(beat.id)) {
      throw new Error(`${beat.id} 非讲解 Beat 不得属于 templateRun`);
    }
  }
  return membership;
};

export const bodySegmentDescriptorsFor = (storyboard, videoPlan = null, requireTreatment = () => true) => {
  const membership = templateRunMembershipFor(storyboard, requireTreatment);
  const beatById = new Map(storyboard.beats.map((beat) => [beat.id, beat]));
  const descriptors = [];
  for (const beat of storyboard.beats) {
    const video = videoPlan?.spans.find((span) => span.beatIds.includes(beat.id));
    if (video) {
      if (video.beatIds[0] !== beat.id) continue;
      const last = beatById.get(video.beatIds.at(-1));
      descriptors.push({
        id: video.id,
        templateId: videoPlan.templateId,
        beatIds: [...video.beatIds],
        cueRange: [beat.cueRange[0], last.cueRange[1]],
        treatment: video
      });
      continue;
    }
    const run = membership.get(beat.id) ?? null;
    if (run && isExplainerTemplateId(run.templateId)) {
      if (run.beatIds[0] !== beat.id) continue;
      const first = beatById.get(run.beatIds[0]);
      const last = beatById.get(run.beatIds.at(-1));
      descriptors.push({
        id: run.id,
        templateId: run.templateId,
        beatIds: [...run.beatIds],
        cueRange: [first.cueRange[0], last.cueRange[1]],
        treatment: run.treatment,
        templateRunId: run.id
      });
      continue;
    }
    if (isExplainerTemplateId(beat.templateId)) {
      throw new Error(`${beat.id} 讲解 Beat 缺少连续段`);
    }
    if (requireTreatment(beat.id) && beat.treatment?.templateId !== beat.templateId) {
      throw new Error(`${beat.id} 缺少当前模板的 Beat treatment`);
    }
    descriptors.push({
      id: beat.id,
      templateId: beat.templateId,
      beatIds: [beat.id],
      cueRange: [...beat.cueRange],
      treatment: beat.treatment
    });
  }
  return descriptors;
};
