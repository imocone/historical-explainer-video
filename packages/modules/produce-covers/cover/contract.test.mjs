import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import test from "node:test";

import { hashObject, sha256, readData } from "../../../program-utils.mjs";
import { getPublicationPaths } from "../../../publication-paths.mjs";
import { inspect, run, replaceGeneration } from "./run.mjs";
import { begin, deliver, generate } from "./builtin.mjs";
import { validateSchema } from "../../../../engine/runtime/schema.mjs";

const png = (width, height, color) => {
  const rendered = spawnSync("ffmpeg", [
    "-v", "error",
    "-f", "lavfi", "-i", `color=c=${color}:s=${width}x${height}`,
    "-frames:v", "1", "-c:v", "png", "-threads", "2", "-f", "image2pipe", "pipe:1"
  ], { maxBuffer: 32 * 1024 * 1024 });
  if (rendered.status !== 0) throw new Error(rendered.stderr.toString("utf8"));
  return rendered.stdout;
};

const widePng = png(1672, 941, "0x113355");
const verticalPng = png(900, 1200, "0x335511");
const publication = {
  schemaVersion: "7.0",
  episodeId: "ep01",
  targetId: "release-main",
  platforms: {
    youtube: {
      title: "幕府发令为何没人听",
      description: "幕府仍能发出命令，地方势力却开始公开拒绝。本集从权力、财政与武力三条线解释命令为何逐步失效。",
      tags: ["日本史", "幕末", "明治维新", "幕府", "权力转移"]
    },
    douyin: {
      title: "幕府发令为何没人听",
      body: "幕府仍然发令，各藩却公开拒绝。本集沿着财政、武力和拒令行动，讲清命令为何失去效力。",
      topics: ["日本史", "幕末", "明治维新"]
    },
    xiaohongshu: {
      title: "命令还在，权力为何已经走了",
      body: "幕府仍能发令，不等于地方还会服从。本集沿着财政、武力和公开拒令，讲清纸面权威怎样失去现实支撑。",
      topics: ["日本史", "幕末", "明治维新", "幕府", "历史故事"]
    }
  },
  covers: {
    youtube: {
      posterConcept: "幕府命令仍在而执行权已经离开中心，令旗承接纸面权威与现实失效的矛盾。",
      heroVisual: "手持令旗的幕府使者面对拒绝出兵的藩士",
      visibleText: ["幕府发令", "各藩为何不听", "幕末权力崩塌"]
    },
    vertical: {
      posterConcept: "幕府命令仍在而执行权已经离开中心，令旗承接纸面权威与现实失效的矛盾。",
      heroVisual: "幕府令旗",
      visibleText: ["幕府发令", "各藩为何不听", "幕末权力崩塌"]
    }
  }
};

const makeTask = async (root) => {
  const paths = getPublicationPaths(root, "ep01", "release-main");
  await mkdir(path.dirname(paths.finalVideo), { recursive: true });
  const styleReference = path.join(root, "style-reference.png");
  await writeFile(styleReference, verticalPng);
  return {
    taskDigest: "a".repeat(64),
    inputHashes: ["b".repeat(64)],
    moduleId: "produce-covers",
    nodeId: "produce-covers",
    outputPath: path.relative(root, paths.coverReceipt),
    inputs: {
      publication,
      coverAuthorDigest: "c".repeat(64)
    },
    context: {
      visualPackage: {
        id: "visual-test",
        version: "1.0.0",
        coverDigest: "d".repeat(64),
        profileId: "cover-test",
        stylePrompt: "成熟历史漫画，清楚墨线，克制哑光色面。",
        fontPrompt: "封面字体由当前Visual提供：Noto Sans SC，字形不从Cover样图继承。",
        references: [{
          id: "style-reference",
          absolutePath: styleReference,
          sha256: sha256(verticalPng),
          instruction: "参考图 1 只读取配色、线条与填色。"
        }]
      },
      coverPackages: {
        youtube: {
          id: "cover-test",
          version: "1.0.0",
          coverDigest: "e".repeat(64),
          references: [{ absolutePath: styleReference, sha256: sha256(verticalPng) }],
          rules: {
            schemaVersion: "1.0",
            designLanguage: "测试海报语言，以清楚图文层级组织本集语义。",
            typography: "使用端正中文印刷字，A为第一层级，B为第二层级，C为小标签。",
            youtubeComposition: "横版让文字占约三分之二宽度并靠近画面中央，可大面积覆盖主体物件。"
          }
        },
        vertical: {
          id: "vertical-cover-test",
          version: "1.0.0",
          coverDigest: "f".repeat(64),
          references: [{ absolutePath: styleReference, sha256: sha256(verticalPng) }],
          rules: {
            schemaVersion: "1.0",
            designLanguage: "测试竖版海报语言，真正中文竖排。",
            typography: "使用端正中文印刷字，A为第一层级，B为第二层级，C为小标签。",
            verticalComposition: "竖版让文字占约六成视觉面积并围绕光学中心组织，可大面积覆盖主体物件。"
          }
        }
      }
    }
  };
};

const nativeBatch = async (root, task, sources = {}) => {
  const batch = await run({ root, episodeId: "ep01", targetId: "release-main", task });
  assert.equal(batch.kind, "image-generation-batch");
  await begin({ root, episodeId: "ep01", requests: batch.requests });
  for (const request of batch.requests) {
    const source = path.join(root, `${request.variant}-tool.png`);
    await writeFile(source, sources[request.variant] ?? (request.variant === "youtube" ? widePng : verticalPng));
    await deliver({ root, episodeId: "ep01", ...request, source });
  }
  return { batch, receipt: await run({ root, episodeId: "ep01", targetId: "release-main", task }) };
};

test('可选API封面沿原双图交付，已完成恢复不重复生成且来源如实记录',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'api-covers-'));
  const previous=process.env.IMAGE_PROVIDER;
  process.env.IMAGE_PROVIDER='openai';
  try{
    const task=await makeTask(root);
    const batch=await run({root,episodeId:'ep01',targetId:'release-main',task});
    process.env.IMAGE_PROVIDER='builtin';
    const retainedBatch=await run({root,episodeId:'ep01',targetId:'release-main',task});
    assert(retainedBatch.requests.every(request=>request.backend==='openai'),'配置变化不改写原图片服务');
    let calls=0;
    for(const request of batch.requests){
      assert.equal(request.backend,'openai');
      const options={root,episodeId:'ep01',variant:request.variant,record:request.record,apiKey:'local-test-key',
        fetchImpl:async(url,{body})=>{
          calls++;assert(url.endsWith('/edits'));assert.equal(body.get('prompt'),request.prompt);
          return new Response(JSON.stringify({data:[{b64_json:(request.variant==='youtube'?widePng:verticalPng).toString('base64')}]}));
        }};
      await assert.rejects(generate(options),/付费许可/u);
      assert.equal((await readData(request.statePath)).status,'prepared');
      await generate({...options,authorizePaidImages:true});
      await generate({...options,apiKey:''});
    }
    assert.equal(calls,2);
    const receipt=await run({root,episodeId:'ep01',targetId:'release-main',task});
    for(const record of Object.values(receipt.generation)){
      assert.equal(record.provider,'openai-images');assert.equal(record.tool,'openai.images');assert(record.model);
    }
    await validateSchema(new URL('./cover-receipt.schema.json',import.meta.url).pathname,receipt,'API封面');
  }finally{
    if(previous===undefined)delete process.env.IMAGE_PROVIDER;else process.env.IMAGE_PROVIDER=previous;
    await rm(root,{recursive:true,force:true});
  }
});

test("封面本地处理取消后不检查下一画幅，也不改写已交回图片", { timeout: 20000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-covers-cancel-"));
  let child;
  try {
    const task = await makeTask(root);
    const batch = await run({ root, episodeId: "ep01", targetId: "release-main", task });
    await begin({ root, episodeId: "ep01", requests: batch.requests });
    for (const request of batch.requests) {
      const source = path.join(root, `${request.variant}-tool.png`);
      await writeFile(source, request.variant === "youtube" ? widePng : verticalPng);
      await deliver({ root, episodeId: "ep01", ...request, source });
    }
    const bin = path.join(root, "bin"), calls = path.join(root, "probe-calls");
    await mkdir(bin);
    await writeFile(path.join(bin, "ffprobe"), `#!${process.execPath}
      require('node:fs').appendFileSync(${JSON.stringify(calls)},'probe\\n');
      process.kill(process.ppid,'SIGINT');setInterval(()=>{},1000);
    `, { mode: 0o700 });
    const taskFile = path.join(root, "task.json");
    await writeFile(taskFile, JSON.stringify(task));
    for (const action of ["inspect", "run"]) {
      await rm(calls, { force: true });
      child = spawn(process.execPath, ["--input-type=module", "-e", `
        import {readFile} from 'node:fs/promises';
        import {${action} as execute} from ${JSON.stringify(new URL("./run.mjs", import.meta.url).href)};
        const task=JSON.parse(await readFile(${JSON.stringify(taskFile)},'utf8'));
        let code;try{await execute({root:${JSON.stringify(root)},episodeId:'ep01',targetId:'release-main',task})}catch(error){code=error.code}
        await new Promise(resolve=>setTimeout(resolve,300));
        process.send({code},()=>process.disconnect());
      `], { env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
        stdio: ["ignore", "ignore", "pipe", "ipc"] });
      let stderr = ""; child.stderr.on("data", data => { stderr += data; });
      const ended = once(child, "exit");
      const [result] = await Promise.race([once(child, "message"), ended.then(([code]) => {
        throw new Error(`${action}未交回取消结果 (${code}): ${stderr}`);
      })]);
      assert.equal(result.code, "MEDIA_CANCELLED");
      assert.equal((await ended)[0], 0, stderr);
      assert.equal(await readFile(calls, "utf8"), "probe\n", "取消不得启动下一画幅的媒体探测");
      for (const request of batch.requests) assert.equal((await readData(request.statePath)).status, "completed");
    }
    await assert.rejects(readData(getPublicationPaths(root, "ep01", "release-main").coverReceipt), { code: "ENOENT" });
  } finally {
    if (child?.exitCode === null) child.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  }
});

test("P1一项横版及两项竖版原文同批交给自带工具，不补系列名或集号，再由原模块收口", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-covers-batch-"));
  try {
    const task = await makeTask(root);
    task.inputs.publication = structuredClone(publication);
    task.inputs.publication.covers.youtube.visibleText = ["命令为何失效？"];
    task.inputs.publication.covers.vertical.visibleText = ["命令还在", "各藩不听了"];
    const sample = task.context.visualPackage.references[0];
    task.context.visualPackage.references = [];
    for (let index = 0; index < 4; index += 1) {
      const absolutePath = path.join(root, `visual-${index + 1}.png`);
      await writeFile(absolutePath, verticalPng);
      task.context.visualPackage.references.push({ ...sample, id: `visual-${index + 1}`, absolutePath,
        instruction: `参考图${index + 1}只读取画法。` });
    }
    for (const variant of ["youtube", "vertical"]) {
      const count = variant === "youtube" ? 2 : 3;
      task.context.coverPackages[variant].references = Array.from({ length: count }, () => ({ absolutePath: sample.absolutePath, sha256: sample.sha256 }));
    }
    assert.equal((await inspect({ root, episodeId: "ep01", targetId: "release-main", task })).authorizationRequired, undefined);
    const { batch, receipt } = await nativeBatch(root, task);
    assert.deepEqual(batch.requests.map(({ variant }) => variant), ["youtube", "vertical"]);
    for (const request of batch.requests) {
      assert.match(request.prompt, /Visual封面字体.*Noto Sans SC.*不从Cover样图继承/us);
      assert.match(request.prompt, request.variant === "youtube"
        ? /当前画幅构图.*约三分之二宽度.*靠近画面中央.*大面积覆盖主体物件/us
        : /当前画幅构图.*约六成视觉面积.*围绕光学中心.*大面积覆盖主体物件/us);
      assert.match(request.prompt, request.variant === "youtube"
        ? /【文字原文】1「命令为何失效？」/u
        : /【文字原文】1「命令还在」；2「各藩不听了」/u);
      assert.doesNotMatch(request.prompt, /幕末权力崩塌|C旁排入|上方系列标题C/u);
      assert.equal(request.referencedImagePaths.length, request.variant === "youtube" ? 3 : 4);
      assert.match(request.referencedImagePaths[0], /visual-reference-board\.png$/u);
      assert.match(request.prompt, /按2列.*原Visual参考图1至4/u);
      assert.deepEqual(request.referencedImagePaths.slice(1), task.context.coverPackages[request.variant].references.map(({ absolutePath }) => absolutePath));
      assert.equal((await readData(request.statePath)).status, "completed");
    }
    assert.equal(receipt.generation.youtube.provider, "imagegen");
    assert.equal(receipt.generation.vertical.tool, "image_gen.imagegen");
    assert.equal(receipt.generation.youtube.model, undefined);
    assert.equal(receipt.generation.youtube.providerTaskId, undefined);
    assert.equal(receipt.files.youtube.width, 2048);
    assert.equal(receipt.files.vertical.height, 2048);
    await validateSchema(path.resolve("packages/modules/produce-covers/cover/cover-receipt.schema.json"), receipt, "cover-receipt");
    assert.equal((await inspect({ root, episodeId: "ep01", targetId: "release-main", task })).valid, true);
    // A source rule digest change alone does not regenerate accepted covers.
    const changed = structuredClone(task);
    changed.context.visualPackage.coverDigest = "9".repeat(64);
    assert.equal((await inspect({ root, episodeId: "ep01", targetId: "release-main", task: changed })).valid, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("多张画风共用一张参考板，每个画幅只再带一张标准封面", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-covers-two-references-"));
  try {
    const task = await makeTask(root);
    const sample = task.context.visualPackage.references[0];
    task.context.visualPackage.references = [];
    for (let index = 0; index < 4; index += 1) {
      const absolutePath = path.join(root, `visual-${index + 1}.png`);
      await writeFile(absolutePath, verticalPng);
      task.context.visualPackage.references.push({ ...sample, id: `visual-${index + 1}`, absolutePath,
        instruction: `参考图${index + 1}只读取画法。` });
    }
    const batch = await run({ root, episodeId: "ep01", targetId: "release-main", task });
    assert.equal(batch.kind, "image-generation-batch");
    for (const request of batch.requests) {
      assert.equal(request.referencedImagePaths.length, 2);
      assert.match(request.referencedImagePaths[0], /visual-reference-board\.png$/u);
      assert.equal(request.referencedImagePaths[1], task.context.coverPackages[request.variant].references[0].absolutePath);
      assert.match(request.prompt, /按2列.*原Visual参考图1至4/u);
    }
    assert.equal(batch.requests[0].referencedImagePaths[0], batch.requests[1].referencedImagePaths[0]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("同批一张完成另一张未知时保留原结果，禁止自动重投和提前交付", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-covers-unknown-"));
  try {
    const task = await makeTask(root);
    const batch = await run({ root, episodeId: "ep01", targetId: "release-main", task });
    const starts = await Promise.allSettled(Array.from({ length: 8 }, () => begin({ root, episodeId: "ep01", requests: batch.requests })));
    assert.equal(starts.filter(({ status }) => status === "fulfilled").length, 1);
    await assert.rejects(begin({ root, episodeId: "ep01", requests: batch.requests }), /禁止重复提交/u);
    const source = path.join(root, "tool-wide.png");
    await writeFile(source, widePng);
    await deliver({ root, episodeId: "ep01", ...batch.requests[0], source });
    const status = await inspect({ root, episodeId: "ep01", targetId: "release-main", task });
    assert.equal(status.unknownExternal, true);
    assert.equal((await readData(batch.requests[0].statePath)).status, "completed");
    await assert.rejects(run({ root, episodeId: "ep01", targetId: "release-main", task }), /禁止自动重投/u);
    const receipt = getPublicationPaths(root, "ep01", "release-main").coverReceipt;
    await assert.rejects(readData(receipt), error => error.code === "ENOENT");
    const portrait = path.join(root, "tool-portrait.png");
    await writeFile(portrait, verticalPng);
    await deliver({ root, episodeId: "ep01", ...batch.requests[1], source: portrait });
    await run({ root, episodeId: "ep01", targetId: "release-main", task });
    assert.equal((await inspect({ root, episodeId: "ep01", targetId: "release-main", task })).valid, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("明确替换一幅未知记录时只交回该幅批次，保留另一幅未知对象", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-covers-replace-"));
  try {
    const task = await makeTask(root);
    const batch = await run({ root, episodeId: "ep01", targetId: "release-main", task });
    await begin({ root, episodeId: "ep01", requests: batch.requests });
    await replaceGeneration({ root, episodeId: "ep01", targetId: "release-main", task,
      variant: "youtube", record: batch.requests[0].record });
    assert.equal((await inspect({ root, episodeId: "ep01", targetId: "release-main", task })).readyToRun, true);
    const replacement = await run({ root, episodeId: "ep01", targetId: "release-main", task });
    assert.deepEqual(replacement.requests.map(({ variant }) => variant), ["youtube"]);
    assert.equal((await readData(batch.requests[0].statePath)).status, "superseded");
    assert.equal((await readData(batch.requests[1].statePath)).status, "tool-intent");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("只换字保留另一幅，当前原图及Visual字体进入受影响画幅提示", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-covers-text-edit-"));
  try {
    const task = await makeTask(root);
    const { receipt: baseline } = await nativeBatch(root, task);
    const revised = structuredClone(publication);
    revised.covers.youtube.visibleText[1] = "各藩已经拒绝";
    revised.coverTextEdit = { baselinePublicationSha256: hashObject(publication), sources: { youtube: baseline.files.youtube.sha256 } };
    const revisedTask = { ...task, taskDigest: "9".repeat(64), inputs: { ...task.inputs, publication: revised } };
    const { batch, receipt } = await nativeBatch(root, revisedTask);
    assert.equal(batch.requests.length, 1);
    assert.equal(batch.requests[0].variant, "youtube");
    assert.match(batch.requests[0].prompt, /现有封面上换字.*当前Visual的封面字体/us);
    assert.match(batch.requests[0].prompt, /Visual封面字体.*Noto Sans SC/us);
    assert.match(batch.requests[0].prompt, /保留全部场景/u);
    assert.doesNotMatch(batch.requests[0].prompt, /【Visual场景画法/u);
    assert.equal(batch.requests[0].referencedImagePaths.at(-1), getPublicationPaths(root, "ep01", "release-main").coverYoutube);
    assert.equal(receipt.files.vertical.sha256, baseline.files.vertical.sha256);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("已交付的API来源成品只本地复用，不需要API调用或恢复能力", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-covers-recorded-source-"));
  try {
    const task = await makeTask(root);
    const { receipt } = await nativeBatch(root, task);
    for (const variant of ["youtube", "vertical"]) {
      const { tool, ...record } = receipt.generation[variant];
      receipt.generation[variant] = { ...record, provider: "apimart", model: "gpt-image-2.5-ext",
        quality: "1k", providerTaskId: `completed-${variant}` };
    }
    const { _producer, ...business } = receipt;
    receipt._producer.outputSha256 = hashObject(business);
    await writeFile(getPublicationPaths(root, "ep01", "release-main").coverReceipt, JSON.stringify(receipt));
    assert.equal((await inspect({ root, episodeId: "ep01", targetId: "release-main", task })).valid, true);
    const retained = await run({ root, episodeId: "ep01", targetId: "release-main", task });
    assert.equal(retained.generation.youtube.providerTaskId, "completed-youtube");
    assert.equal(retained.files.youtube.sha256, receipt.files.youtube.sha256);
    await validateSchema(path.resolve("packages/modules/produce-covers/cover/cover-receipt.schema.json"), retained, "cover-receipt");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("原生画幅不符时不能裁切冒充封面，也不写出正式回执", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-covers-aspect-"));
  try {
    const task = await makeTask(root);
    await assert.rejects(nativeBatch(root, task, { youtube: verticalPng }), /禁止裁切冒充正式封面/u);
    const receipt = getPublicationPaths(root, "ep01", "release-main").coverReceipt;
    await assert.rejects(readData(receipt), error => error.code === "ENOENT");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Engine next交回双图工具批次，不把未生成封面当成程序正式交付", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-covers-engine-"));
  try {
    const task = await makeTask(root);
    const systemRoot = path.resolve(".");
    const directory = path.join(systemRoot, "packages/modules/produce-covers");
    const manifest = await readData(path.join(directory, "package.yaml"));
    const controller = await readData(path.join(directory, "controller.json"));
    const { executeCurrentTask } = await import("../../../../engine/runtime/execute.mjs");
    const current = { kind: "task", runner: "program", programPhase: "cover", taskDigest: task.taskDigest,
      taskId: "ep01/release-main/produce-covers/cover", invocation: { episodeId: "ep01", targetId: "release-main" },
      node: { id: "produce-covers" }, record: { directory, manifest,
        resourcesByPath: new Map([["controller.json", { content: controller }]]) },
      base: { stageId: "p1", workflowId: "narration", subject: { kind: "episode", id: "ep01" },
        inputs: task.inputs, resolvedAssembly: { slots: [] }, resolvedRules: [], entry: { sha256: "a".repeat(64) },
        outputContract: { source: "packages/modules/produce-covers/cover/cover-receipt.schema.json",
          sha256: sha256(await readFile(path.join(directory, manifest.outputSchema))) } },
      context: task.context, inputHashes: task.inputHashes,
      outputPath: getPublicationPaths(root, "ep01", "release-main").coverReceipt };
    const batch = await executeCurrentTask({ root: systemRoot, workspaceRoot: root, episodeId: "ep01",
      targetId: "release-main", stageId: "p1", current, preExecuted: [] });
    assert.equal(batch.kind, "image-generation-batch");
    assert.equal(batch.requests.length, 2);
    assert.deepEqual(batch.executed, []);
    await assert.rejects(readData(current.outputPath), error => error.code === "ENOENT");
    await assert.rejects(readData(path.join(root, "ep01/制作/p1/_work/program-execution.yaml")), error => error.code === "ENOENT");
  } finally { await rm(root, { recursive: true, force: true }); }
});
