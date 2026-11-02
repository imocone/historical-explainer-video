#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { readData, stableStringify } from "../../program-utils.mjs";

const fail = (message) => {
  throw new Error(message);
};

export const deriveAuthorWorkspaceRoot = ({ workOrder, candidatePath }) => {
  const relativeCandidate = workOrder.candidatePath;
  if (typeof relativeCandidate !== "string" || path.isAbsolute(relativeCandidate)) {
    fail("工作单 candidatePath 必须是节目工作区内的相对路径");
  }
  const parts = relativeCandidate.split("/").filter(Boolean);
  let workspaceRoot = path.resolve(candidatePath);
  for (let index = 0; index < parts.length; index += 1) workspaceRoot = path.dirname(workspaceRoot);
  if (path.resolve(workspaceRoot, relativeCandidate) !== path.resolve(candidatePath)) {
    fail("候选路径与工作单 candidatePath 不一致");
  }
  return workspaceRoot;
};

export const completeTreatmentCandidate = ({ candidateResult, context }) => {
  if (!(context.repairFeatureIds?.length > 0)
    || !candidateResult || typeof candidateResult !== "object"
    || Array.isArray(candidateResult) || Object.hasOwn(candidateResult, "treatment")) return false;
  if (!context.currentTreatment || typeof context.currentTreatment !== "object"
    || Array.isArray(context.currentTreatment)) fail("功能返工缺少工作单锁定的原设计");
  candidateResult.treatment = structuredClone(context.currentTreatment);
  return true;
};

const formatAjvErrors = (errors = []) => errors
  .map((error) => `${error.instancePath || "/"} ${error.message}`)
  .join("; ");

export const validateSchema = async (schemaPath, value, label) => {
  const schema = await readData(schemaPath);
  const validate = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true }).compile(schema);
  if (!validate(value)) fail(`${label} 合同失败: ${formatAjvErrors(validate.errors)}`);
};

const importResource = async (systemRoot, source) => {
  if (typeof source !== "string" || !source) fail("工作单装配资源缺少 source");
  const file = path.resolve(systemRoot, source);
  await readFile(file);
  return import(pathToFileURL(file).href);
};

const resource = (implementation, role) => {
  const match = (implementation.resources ?? []).find((item) => item.role === role);
  if (!match) fail(`${implementation.packageId} 缺少装配资源 ${role}`);
  return match;
};

const defaultTemplatePolicy = async ({ systemRoot, templateImplementation, loadResource }) => {
  const policyResource = (templateImplementation.resources ?? [])
    .find((item) => item.role === "cuePolicy");
  return policyResource ? loadResource(systemRoot, policyResource.source) : null;
};

/**
 * Return source-scope errors for an Author treatment without coupling the
 * Engine to the command-line preflight entry point.
 */
export const treatmentSourceScopeErrors = ({ result, context }) => {
  const semantic = context.semanticContext ?? {};
  const allowed = new Set([
    ...(semantic.facts ?? []).map((item) => item.id),
    ...(semantic.relations ?? []).map((item) => item.id),
    ...(semantic.evidence ?? []).map((item) => item.id),
    ...(context.cues ?? []).map((cue) => `C${String(cue.id).padStart(3, "0")}`)
  ]);
  const errors = [];
  for (const request of result.assetRequests ?? []) {
    for (const ref of request.sourceRefs ?? []) {
      if (!ref.startsWith("SA") && !allowed.has(ref)) {
        errors.push(`${request.requestId} 引用了当前创作单位范围外的语义: ${ref}`);
      }
    }
  }
  return errors;
};

/**
 * Validate the shared business part of an author-beat treatment candidate.
 *
 * Workflow/working-order checks, controller projection, module acceptance,
 * storyboard validation, producer metadata, and writes intentionally stay at
 * their respective Preflight or Accept callers.
 */
export const validateTreatmentCandidate = async ({
  candidateResult,
  context,
  systemRoot,
  workspaceRoot,
  episodeId,
  task,
  moduleValidatorSource,
  templateImplementation,
  featureImplementations = [],
  loadResource = (source) => importResource(systemRoot, source),
  loadTemplatePolicy = null,
  services = {},
  treatmentSchemaPath = null,
  treatmentLabel = "candidate.result.treatment",
  featureResultLabel = (featureId) => `candidate.result.featureResults.${featureId}`
}) => {
  completeTreatmentCandidate({ candidateResult, context });
  await validateSchema(
    path.join(systemRoot, "contracts", "author-result.schema.json"),
    candidateResult,
    "candidate.result"
  );

  const repairFeatures = context.repairFeatureIds ?? [];
  const featureOnly = repairFeatures.length > 0;
  const treatment = candidateResult.treatment;
  if (featureOnly && stableStringify(treatment) !== stableStringify(context.currentTreatment)) fail("功能返工不得改写已交付画面设计");
  if (featureOnly && Object.keys(candidateResult.featureResults ?? {}).some(id => !repairFeatures.includes(id))) fail("功能返工不得改写未指定功能");
  const featureResults = candidateResult.featureResults ?? {};
  if (!featureOnly) await validateSchema(
    treatmentSchemaPath ?? path.resolve(systemRoot, resource(templateImplementation, "outputSchema").source),
    treatment,
    treatmentLabel
  );

  const moduleValidator = await loadResource(moduleValidatorSource);
  const errors = featureOnly ? [] : [...moduleValidator.validate({ result: treatment, context })];
  if (!featureOnly) errors.push(...treatmentSourceScopeErrors({ result: treatment, context }));

  const templateValidator = await loadResource(
    resource(templateImplementation, "validator").source
  );
  if (!featureOnly) errors.push(...templateValidator.validate({
    result: treatment,
    context: { ...context, featureResults }
  }));
  const resolvedWorkspaceRoot = typeof workspaceRoot === "function"
    ? workspaceRoot()
    : workspaceRoot;
  if (!featureOnly && !errors.length && typeof templateValidator.validateAcceptance === "function") {
    errors.push(...await templateValidator.validateAcceptance({
      result: treatment,
      context,
      services: {
        systemRoot,
        workspaceRoot: resolvedWorkspaceRoot,
        episodeId,
        task,
        ...services,
        candidateResult
      }
    }));
  }

  const policy = loadTemplatePolicy
    ? await loadTemplatePolicy()
    : await defaultTemplatePolicy({
        systemRoot,
        templateImplementation,
        loadResource: (root, source) => loadResource(path.resolve(root, source))
      });
  for (const implementation of featureImplementations) {
    const featureId = implementation.packageId;
    if (featureOnly && !repairFeatures.includes(featureId)) continue;
    const featureResult = featureResults[featureId];
    if (!featureResult) {
      errors.push(`已启用功能缺少候选结果: ${featureId}`);
      continue;
    }
    await validateSchema(
      path.resolve(systemRoot, resource(implementation, "outputSchema").source),
      featureResult,
      featureResultLabel(featureId)
    );
    const validator = await loadResource(resource(implementation, "validator").source);
    const featureContext = { ...context, treatment, featureResults, templatePolicy: policy };
    errors.push(...validator.validate({ result: featureResult, context: featureContext }));
    if (typeof validator.validateRuntime === "function") {
      errors.push(...await validator.validateRuntime({ result: featureResult, context: featureContext,
        services: {systemRoot, workspaceRoot:resolvedWorkspaceRoot, episodeId, task} }));
    }
  }

  return {
    errors,
    moduleValidator,
    templateValidator,
    treatment,
    featureResults,
    templatePolicy: policy
  };
};
