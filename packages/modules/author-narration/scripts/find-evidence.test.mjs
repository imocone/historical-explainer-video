import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findEvidence } from "./find-evidence.mjs";
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const references = [
  null,
  { source_id: "source-one", citation_number: 7, cited_text: "原文甲。", locator: "第3页" },
  { source_id: "source-empty", citation_number: 8, cited_text: " " },
  { source_id: " ", citation_number: 9, cited_text: "没有来源身份。" },
  { source_id: "source-two", citation_number: 12, cited_text: "原文乙。" },
  { source_id: "source-zero", citation_number: 0, cited_text: "编号零仍有原文。" },
  { source_id: "source-no-number", cited_text: "缺少引用号。" },
  { source_id: "source-no-text", citation_number: 15, cited_text: 4 }
];

test('项目出处定位调用原服务且沿用原缓存身份，不改写原引用',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'p1-evidence-http-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const before=process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY='local-test-key';
  t.after(()=>{if(before===undefined)delete process.env.TYPESAFE_API_KEY;else process.env.TYPESAFE_API_KEY=before;});
  let calls=0,request;
  await findEvidence({references},'当前命题',directory,async input=>{
    request={state:input.state,questions:{selection:{type:'choice',instructions:input.instructions,
      criteria:Object.fromEntries([...input.items.map(item=>[item.id,input.matchDescription]),['none',input.noneDescription]])}}};
  });
  const response={answers:{selection:{choice:'R5',probabilities:{R5:1}}},usage:{input_tokens:12,output_tokens:3}};
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls++;assert.equal(url,'https://api.typesafe.ai/v1/systemone');
    assert.equal(options.headers.Authorization,'Bearer local-test-key');
    assert.equal(options.headers['Content-Encoding'],'gzip');
    assert.deepEqual(JSON.parse(gunzipSync(options.body)),{...request,model:'jev-latest'});
    return new Response(JSON.stringify(response));
  });
  const result=await findEvidence({references},'当前命题',directory);
  assert.equal(result.selected.reference,references[4]);assert.equal(result.metrics.apiCalls,1);
  const hash=createHash('sha256').update(JSON.stringify(request)).digest('hex');
  assert.deepEqual(JSON.parse(await readFile(path.join(directory,hash+'.json'))),{requestSha256:hash,response});
  const cached=await findEvidence({references},'当前命题',directory);
  assert.deepEqual(cached.selected,result.selected);assert.equal(cached.metrics.cachedCalls,1);assert.equal(calls,1);
});

test("引用定位只交有效原文，保留稀疏R编号、原引用号和原对象", async () => {
  const query = { references };
  const original = structuredClone(query);
  let calls = 0;
  const result = await findEvidence(query, "当前命题", "unused-cache", async (input) => {
    calls += 1;
    assert.deepEqual(input.items.map(({ id }) => id), ["R2", "R5", "R6"]);
    assert.deepEqual(input.items.map(({ reference }) => reference.citation_number), [7, 12, 0]);
    assert.equal(input.items[0].reference, references[1]);
    assert.equal(input.items[1].reference, references[4]);
    assert.equal(input.state.references, input.items);
    return { decision: "R5", selected: input.items[1] };
  });
  assert.equal(calls, 1);
  assert.equal(result.selected.reference, references[4]);
  assert.deepEqual(query, original);
});

test("整批无有效文字引用时停止，不调用选择服务", async () => {
  const invalid = references.filter((_, index) => ![1, 4, 5].includes(index));
  await assert.rejects(findEvidence({ references: invalid }, "当前命题", "unused-cache", () => {
    assert.fail("无有效引用不得调用选择服务");
  }), /引用缺少可读 cited_text/u);
});

test("实际纪录片提示命令按原游标读混合引用，空页继续，无有效引用时报缺失", async (t) => {
  const prompt = await readFile(new URL("../../author-documentary-narration/references/documentary-author-prompt.md", import.meta.url), "utf8");
  const code = /node packages\/runtime-config\.mjs python -c '([\s\S]*?)' "<QUERY_ABS>"/u.exec(prompt)?.[1];
  assert.ok(code, "测试须消费现行提示中的实际读取命令");
  const directory = await mkdtemp(path.join(os.tmpdir(), "p1-cited-reading-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "query.json");
  const original = JSON.stringify({ references });
  await writeFile(file, original);
  const readBatch = (start, end) => spawnSync(process.execPath, ["packages/runtime-config.mjs", "python", "-B", "-c", code, file, String(start), String(end)], { encoding: "utf8" });
  const first = readBatch(0, 2);
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(JSON.parse(first.stdout), { start: 0, next: 2, total: 8,
    references: [{ source_id: "source-one", citation_number: 7, cited_text: "原文甲。" }] });
  const empty = readBatch(2, 4);
  assert.equal(empty.status, 0, empty.stderr);
  assert.deepEqual(JSON.parse(empty.stdout), { start: 2, next: 4, total: 8, references: [] });
  const last = readBatch(4, 8);
  assert.equal(last.status, 0, last.stderr);
  assert.deepEqual(JSON.parse(last.stdout), { start: 4, next: null, total: 8,
    references: references.slice(4, 6) });
  assert.equal(await readFile(file, "utf8"), original);
  await writeFile(file, JSON.stringify({ references: [references[2], references[3], references[6], references[7]] }));
  const missing = readBatch(0, 4);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /缺少可用引用/u);
});
