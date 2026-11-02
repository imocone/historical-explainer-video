import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertProjectMutationTree, atomicWrite, atomicWriteData, fileSha256, readData, sha256, withProjectLock } from "../../../program-utils.mjs";
import { getPublicationPaths } from "../../../publication-paths.mjs";
import { imageGenerationMetadata } from '../../../image-provenance.mjs';

const recordPaths = ({ root, episodeId, variant, record }) => {
  if (!["youtube", "vertical"].includes(variant) || !/^[a-f0-9]{64}$/u.test(record)) throw new Error("必须点名当前画幅与记录指纹");
  const base = getPublicationPaths(root, episodeId, "release-main");
  const work = path.join(base.workRoot, "_work", "covers");
  const directory = path.join(work, variant, record);
  return { work, directory, state: path.join(directory, "generation.json"), prompt: path.join(directory, "prompt.txt"), source: path.join(directory, "source.png") };
};
const currentRecord = async (options) => {
  const files = recordPaths(options);
  await assertProjectMutationTree({ root: options.root, file: files.work, label: "封面自带生图交接" });
  const state = await readData(files.state);
  const prompt = (await readFile(files.prompt, "utf8")).replace(/\n$/u, "");
  if (!["imagegen", 'openai-images'].includes(state.provider) || state.variant !== options.variant
    || state.inputFingerprint !== options.record || state.replacedBy || sha256(prompt) !== state.promptSha256) {
    throw new Error("封面自带生图记录身份或原提示不一致");
  }
  return { files, state };
};

export async function begin({ root, episodeId, requests }) {
  if (!requests?.length || requests.length > 2 || new Set(requests.map(({ variant }) => variant)).size !== requests.length) throw new Error("同批只能包含互不重复的当前横竖画幅");
  const work = recordPaths({ root, episodeId, ...requests[0] }).work;
  await assertProjectMutationTree({ root, file: work, label: "封面自带生图批次" });
  await mkdir(work, { recursive: true });
  return withProjectLock({ root, lock: path.join(work, "produce-cover.lock"), label: "当前 P1 封面生产", execute: async () => {
    const records = [];
    for (const request of requests) {
      const record = await currentRecord({ root, episodeId, ...request });
      if (record.state.status !== "prepared") throw new Error("原工具调用已开始或已有结果，禁止重复提交");
      records.push(record);
    }
    for (const { files, state } of records) await atomicWriteData(files.state, { ...state, status: "tool-intent" });
    return { kind: "native-cover-batch-started", variants: requests.map(({ variant }) => variant) };
  } });
}

export async function deliver(options) {
  const work = recordPaths(options).work;
  await assertProjectMutationTree({ root: options.root, file: work, label: "封面自带生图结果" });
  return withProjectLock({ root: options.root, lock: path.join(work, "produce-cover.lock"), label: "当前 P1 封面生产", execute: async () => {
    const { files, state } = await currentRecord(options);
    if (!path.isAbsolute(options.source ?? "")) throw new Error("工具输出必须使用实际本地绝对路径");
    const digest = await fileSha256(options.source);
    if (state.status === "completed") {
      if (digest !== state.sourceSha256) throw new Error("原工具结果已交回，不能换成另一张图片");
      return { kind: "native-cover-result-retained", variant: options.variant };
    }
    if (state.status !== "tool-intent") throw new Error("仅可交回本次已开始的原工具调用");
    const bytes = await readFile(options.source);
    if (!bytes.length) throw new Error("工具图片为空");
    const generation = state.provider === 'openai-images'
      ? await imageGenerationMetadata({sourceFile:options.source,receipt:options.generationReceipt,
        job:{prompt:(await readFile(files.prompt,'utf8')).replace(/\n$/u,''),referenced_image_paths:state.referenceFiles,transparent_background:false}})
      : null;
    if (state.provider === 'openai-images' && generation?.provider !== 'openai-images') throw new Error('API封面须交回原API调用结果记录');
    await atomicWrite(files.source, bytes);
    await atomicWriteData(files.state, { ...state, status: "completed", sourceSha256: digest, ...(generation ? {generation} : {}) });
    return { kind: "native-cover-result-delivered", variant: options.variant };
  } });
}


if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [command, ...args] = process.argv.slice(2);
    const options = { requests: [] };
    for (let index = 0; index < args.length; index += 2) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("参数缺少值");
      if (args[index] === "--request") {
        const [variant, record, extra] = value.split(":");
        if (extra) throw new Error("request格式必须是画幅:指纹");
        options.requests.push({ variant, record });
      } else {
        const key = { "--workspace": "root", "--episode": "episodeId", "--variant": "variant", "--record": "record", "--source": "source", '--generation-receipt':'generationReceipt' }[args[index]];
        if (!key || options[key]) throw new Error("未知或重复参数");
        options[key] = value;
      }
    }
    if (!path.isAbsolute(options.root ?? "") || !/^ep[0-9]+$/u.test(options.episodeId ?? "")) throw new Error("必须提供绝对workspace与当前episode");
    if (!["begin", "deliver"].includes(command)) throw new Error("只支持begin或deliver");
    process.stdout.write(`${JSON.stringify(await ({ begin, deliver }[command](options)))}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
