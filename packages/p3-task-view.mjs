#!/usr/bin/env node
import {isExplainerTemplateId} from './explainer-template-selection.mjs';
import {readP3Sources} from './p3-sources.mjs';

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { assertProjectPath, hashObject, readData, sha256 } from "./program-utils.mjs";
import { drawingStyleForTemplate, loadProgramVisualPackage } from "./visual-package.mjs";
import { deriveCandidateWorkspaceRoot } from "./templates/fullframe-narrative/task-contract.mjs";

const supportedModules = new Set(["understand-episode", "direct-episode", "author-beat"]);
const normalizeNarration = (value) => value.replace(/\s/gu, "");
const fail = (message) => {
  throw new Error(message);
};

const projectResource = ({ role, source, sha256 }) => ({
  ...(role ? { role } : {}),
  source,
  sha256
});

const projectAssembly = (assembly) => ({
  node: {
    id: assembly.node.id,
    moduleId: assembly.node.moduleId
  },
  module: {
    id: assembly.module.id,
    manifest: projectResource(assembly.module.manifest),
    controllerEntry: projectResource(assembly.module.controllerEntry)
  },
  slots: assembly.slots.map((slot) => ({
    id: slot.id,
    selection: structuredClone(slot.selection),
    implementations: slot.implementations.map((implementation) => ({
      packageId: implementation.packageId,
      kind: implementation.kind,
      majorVersion: implementation.majorVersion,
      resources: implementation.resources
        .filter(({ role }) => !["acceptanceRules", "validator", "runtimeResources"].includes(role))
        .map((resource) => implementation.kind === "template" && resource.role === "examples"
          ? { role: resource.role, source: resource.source }
          : projectResource(resource))
    }))
  }))
});

export const projectP3TaskView = (workOrder) => {
  if (!workOrder || typeof workOrder !== "object" || Array.isArray(workOrder)) {
    fail("P3 工作单必须是对象");
  }
  const { taskDigest, ...base } = workOrder;
  if (typeof taskDigest !== "string" || hashObject(base) !== taskDigest) {
    fail("work-order 自身内容已被改写");
  }
  const assembly = workOrder.resolvedAssembly;
  if (
    workOrder.stageId !== "p3" ||
    workOrder.runner !== "ai" ||
    !supportedModules.has(workOrder.moduleId) ||
    assembly?.node?.id !== workOrder.nodeId ||
    assembly?.node?.moduleId !== workOrder.moduleId ||
    assembly?.module?.id !== workOrder.moduleId ||
    !Array.isArray(assembly?.slots)
  ) {
    fail("任务视图只接受正式 P3 Understanding、Visual Director 或 Author 工作单");
  }
  if (
    !workOrder.inputs ||
    !Array.isArray(workOrder.inputs.cues) ||
    workOrder.inputs.cues.length === 0
  ) {
    fail("P3 工作单缺少连续 cues");
  }
  const isAuthor = workOrder.moduleId === "author-beat";
  const narration = workOrder.inputs.narration;
  if (!isAuthor && (!narration || typeof narration.content !== "string")) {
    fail("P3 工作单缺少正式口播正文");
  }
  const cueNarration = workOrder.inputs.cues.map((cue) => cue?.text ?? "").join("");
  if (!isAuthor && normalizeNarration(narration.content) !== normalizeNarration(cueNarration)) {
    fail("批准口播与字幕文字不同源，不能省略重复正文");
  }
  if (
    !Array.isArray(workOrder.resolvedRules) ||
    workOrder.resolvedRules.length === 0 ||
    !workOrder.outputContract?.content ||
    typeof workOrder.candidatePath !== "string" ||
    typeof workOrder.allowedWrite !== "string" ||
    !Array.isArray(workOrder.allowedReturnTargets)
  ) {
    fail("P3 工作单缺少模型执行合同");
  }

  const inputs = structuredClone(workOrder.inputs);
  if (isAuthor && inputs.authorPhase === "quotes") {
    // Keep the signed work order intact; read its source text in bounded portions.
    for (const video of inputs.referenceVideos ?? []) {
      if (video.transcript) {
        delete video.transcript.text;
        delete video.transcript.segments;
      }
    }
  }
  if (!isAuthor) delete inputs.narration.content;
  if (isAuthor) {
    // Remove only demonstrably identical representations, never unique unit input.
    const firstMember = inputs.authorBatch?.members?.[0]?.inputs;
    if (firstMember) {
      for (const [key, value] of Object.entries(firstMember)) {
        if (!["authorUnit", "templateContext"].includes(key)
          && JSON.stringify(inputs[key]) === JSON.stringify(value)) delete inputs[key];
      }
    }
    for (const beat of inputs.authorUnitBeats ?? []) {
      if (JSON.stringify(beat.cues) === JSON.stringify(inputs.cues)) delete beat.cues;
    }
    const unitBeat = inputs.authorUnitBeats?.length === 1 ? inputs.authorUnitBeats[0] : null;
    if (
      unitBeat &&
      inputs.beat &&
      Object.entries(inputs.beat).every(
        ([key, value]) => JSON.stringify(value) === JSON.stringify(unitBeat[key])
      )
    )
      delete inputs.beat;
  }
  return {
    taskDigest,
    subject: structuredClone(workOrder.subject),
    nodeId: workOrder.nodeId,
    moduleId: workOrder.moduleId,
    inputs,
    ...(!isAuthor
      ? {
          resourceInstructions:
            "按 source 读取现行 resolvedRules 与 outputContract；已在本任务完整读取且未变化的资源无需重复加载。业务输入以本视图 inputs 为准。"
        }
      : {}),
    resolvedRules: workOrder.resolvedRules.map(projectResource),
    resolvedAssembly: projectAssembly(assembly),
    outputContract: projectResource(workOrder.outputContract),
    allowedWrite: workOrder.allowedWrite,
    allowedReturnTargets: structuredClone(workOrder.allowedReturnTargets),
    candidatePath: workOrder.candidatePath,
    ...(isAuthor || workOrder.moduleId === "direct-episode" ? { scratchPath: workOrder.scratchPath } : {})
  };
};

const main = async () => {
  const [workOrderPath, ...args] = process.argv.slice(2);
  if (!workOrderPath) fail("用法: p3-task-view.mjs <workOrderPath>");
  const { values } = parseArgs({ args, options: { "reuse-references": { type: "string" } } });
  const reuseReferences = values["reuse-references"] ? JSON.parse(values["reuse-references"]) : null;
  if (reuseReferences && (typeof reuseReferences !== "object" || Array.isArray(reuseReferences)))
    fail("复用身份必须是referenceDigests的JSON对象");
  const workOrder = await readData(path.resolve(workOrderPath));
  const view = projectP3TaskView(workOrder);
  if (workOrder.moduleId === "direct-episode"
    || (workOrder.moduleId === "author-beat" && workOrder.inputs.authorPhase !== "quotes")) {
    const workspaceRoot = deriveCandidateWorkspaceRoot({workOrder,
      candidatePath: path.join(path.dirname(path.resolve(workOrderPath)), path.basename(workOrder.candidatePath))});
    view.inputs.sourceAssets = await readP3Sources({workspaceRoot, workOrder});
    // All members read the same current registry; do not retain stale snapshots beside it.
    for (const member of view.inputs.authorBatch?.members ?? []) delete member.inputs.sourceAssets;
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const currentDigests = new Map();
  const currentResource = async (resource) => {
    const file = path.resolve(root, resource.source);
    if (!currentDigests.has(file)) {
      currentDigests.set(file, (async () => {
        await assertProjectPath({ root, file, label: "P3现行执行资源" });
        const imageExample = resource.role === "examples" && /\.(png|jpe?g|webp)$/iu.test(file);
        return sha256(await readFile(file, imageExample ? undefined : "utf8"));
      })());
    }
    return projectResource({ ...resource, sha256: await currentDigests.get(file) });
  };
  view.resolvedRules = await Promise.all(
    view.resolvedRules.map((resource) => currentResource(resource))
  );
  view.outputContract = await currentResource(view.outputContract);
  if (workOrder.moduleId === "direct-episode") {
    const catalogs = new Map(await Promise.all(view.inputs.templates.map(async ({ id }) => {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id ?? "")) fail("导演目录缺少有效模板身份");
      const file = path.resolve(root, "packages/templates", id, "package.yaml");
      await assertProjectPath({ root, file, label: "导演现行模板目录" });
      const manifest = await readData(file);
      if (manifest.kind !== "template" || manifest.id !== id || !manifest.catalog) {
        fail(`导演现行模板目录不成立: ${id}`);
      }
      return [id, manifest.catalog];
    })));
    view.inputs.templates = [...catalogs].map(([id, catalog]) => ({ id, ...catalog }));
    for (const slot of view.resolvedAssembly.slots) {
      for (const implementation of slot.implementations) {
        const catalog = catalogs.get(implementation.packageId);
        if (!catalog || implementation.kind !== "template") continue;
        implementation.resources = implementation.resources.map(resource => resource.role === "catalog"
          ? { ...resource, sha256: hashObject(catalog) } : resource);
      }
    }
  }
  if (workOrder.moduleId === "author-beat") {
    if (workOrder.inputs.authorPhase !== "quotes" && workOrder.inputs.authorUnit?.templateId !== "vox-explainer") {
      const workspaceRoot = deriveCandidateWorkspaceRoot({ workOrder,
        candidatePath: path.join(path.dirname(path.resolve(workOrderPath)), path.basename(workOrder.candidatePath)) });
      const visual = await loadProgramVisualPackage(root, workspaceRoot, { roles: ["render"] });
      view.inputs.templateContext = { ...view.inputs.templateContext,
        visual: { id: visual.id, drawingStyle: structuredClone(drawingStyleForTemplate(visual.renderTokens, workOrder.inputs.authorUnit?.templateId)) } };
    }
    for (const slot of view.resolvedAssembly.slots) {
      for (const implementation of slot.implementations) {
        implementation.resources = await Promise.all(
          implementation.resources.map((resource) =>
            (["authorRules", "outputSchema"].includes(resource.role)
              || (resource.role === "examples" && implementation.kind !== "template"))
              ? currentResource(resource)
              : resource
          )
        );
        if (implementation.kind === 'feature' && workOrder.inputs.authorPhase !== 'quotes') {
          const directory = path.resolve(root, 'packages/features', implementation.packageId);
          const manifest = await readData(path.join(directory, 'package.yaml'));
          if (manifest.authorContextEntry) {
            const contextFile = path.resolve(directory, manifest.authorContextEntry);
            await assertProjectPath({root, file:contextFile, label:'P3功能作者参考入口'});
            const context = await import(pathToFileURL(contextFile).href);
            if (context.refreshAuthorReferences) {
              const reference = await context.refreshAuthorReferences({workOrder, workOrderPath,
                sourceAssets:view.inputs.sourceAssets});
              view.inputs.featureContexts = {...view.inputs.featureContexts, [implementation.packageId]:reference};
              // Batch members share the same chapter references; their local input remains intact.
              for (const member of view.inputs.authorBatch?.members ?? [])
                if (member.inputs.featureContexts) delete member.inputs.featureContexts[implementation.packageId];
            }
          }
        }
        if (implementation.kind === "template") {
          const manifestPath = path.resolve(root, "packages/templates", implementation.packageId, "package.yaml");
          await assertProjectPath({ root, file: manifestPath, label: "P3现行教材清单" });
          const manifest = await readData(manifestPath);
          if (manifest.kind !== "template" || manifest.id !== implementation.packageId) fail("P3现行教材所属模板不一致");
          const directory = path.dirname(manifestPath);
          // Quote batches keep their own inputs and have no body author unit.
          if (manifest.authorContextEntry && workOrder.inputs.authorPhase !== "quotes") {
            const contextFile = path.resolve(directory, manifest.authorContextEntry);
            await assertProjectPath({ root, file: contextFile, label: "P3模板作者参考入口" });
            const context = await import(pathToFileURL(contextFile).href);
            if (context.refreshAuthorReferences) {
              const references = await context.refreshAuthorReferences({ workOrder, workOrderPath });
              view.inputs = { ...view.inputs, ...references,
                templateContext: { ...view.inputs.templateContext, ...references.templateContext,
                  visual: { ...view.inputs.templateContext?.visual, ...references.templateContext?.visual } } };
              if (implementation.packageId === 'vox-explainer') delete view.inputs.templateContext.visual;
            }
            if (context.projectAuthorReferenceView) {
              const workspaceRoot = deriveCandidateWorkspaceRoot({ workOrder,
                candidatePath: path.join(path.dirname(path.resolve(workOrderPath)), path.basename(workOrder.candidatePath)) });
              Object.assign(view, context.projectAuthorReferenceView({ inputs: view.inputs, workspaceRoot,
                episodeId: workOrder.subject.id, reuseReferences }));
            }
          }
          const base = `${path.relative(root, directory).split(path.sep).join("/")}/`;
          const examples = await Promise.all((manifest.examples ?? []).map(async (source) => {
            const file = path.resolve(directory, source);
            await assertProjectPath({ root, file, label: "P3现行教材路径" });
            return path.relative(directory, file).split(path.sep).join("/");
          }));
          implementation.resources = [
            ...implementation.resources.filter(({ role }) => role !== "examples"),
            { role: "examples", base, files: examples }
          ];
          view.resourceInstructions = "直接消费本视图 inputs，不再打印整份工作单。按 author-beat/SKILL.md 的读取规则，从 source 读取现行规则与输出合同；教材路径由 examples.base 与 files 中的相对路径拼接。仅省略已成功完成且无警告的终端读取外层包装，完整正文、业务字段、警告错误及未结束进程的身份不可裁剪；不改变图片、音视频及其它业务工具的原交付。按同次全部工具结果的合计量分批。命令成功不代表正文完整返回，遇到 truncated 按实际缺失位置补读连续行段，不只补文件末尾。只有完整正文仍在当前上下文且未变化的资源才沿用；恢复时按当前步骤读取原入口及方法，已读摘要或刚完成的候选不能代替正文。";
        }
      }
    }
  }
  if (view.inputs.authorPhase === "quotes") {
    view.resourceInstructions = "引文相位读取 author-beat/SKILL.md、callout/AUTHOR.md 的收口路由及其历史引文方法、当前输出合同，进入B2时读原提交说明。referenceVideos保留来源身份及定位，不展开全文和分段；按已投递视频id从同一当前workOrderPath的inputs.referenceVideos分批完整读取transcript.text，按需读取原segments。恢复先读当前来源记录和候选，补齐未读材料，不加载正文设计或后续整集审计的方法。";
  }
  if (view.inputs.authorBatch) view.resourceInstructions += " 联合单逐Beat的完整业务输入见authorBatch.members[].inputs；顶层省略与首个成员相同的局部副本。";
  if (view.referenceDigests) view.resourceInstructions += " 刷新本章任务视图且本章作者仍完整持有同版全片语境与本章前序画面参考时，将本视图referenceDigests原样转为JSON，交给p3-task-view.mjs的--reuse-references参数，省略重复副本。reusedReferences列明省略范围；当前单位输入、episodeContext.currentPosition及新增、变化的priorVisuals仍须读取。新作者首次读取或上下文缺失时省略复用参数取得全文，不沿用其它作者的referenceDigests。B2只执行当前候选的Preflight并返回交付路径；主代理沿原Engine串行接纳，本章成功接纳后结束使用本章作者，下一章新建独立上下文作者。当前单任务视图完整消费一次。";
  process.stdout.write(`${JSON.stringify(view)}\n`);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
