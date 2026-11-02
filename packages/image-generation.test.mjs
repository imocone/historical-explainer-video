import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generateApiImage, imageGenerationMetadata} from './image-generation.mjs';
import {importAuthoredImage, verifyAuthoredImage} from './authored-images.mjs';
import {compileSchema} from '../engine/runtime/schema.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAAGUlEQVR4nGMUNA5lIAUwkaSaYVQDcYBkDQAXZACrFYSv9wAAAABJRU5ErkJggg==','base64');
const response = () => new Response(JSON.stringify({data:[{b64_json:png.toString('base64')}]}),
  {headers:{'content-type':'application/json','x-request-id':'local-test-request'}});
const job = {prompt:'完整场景',transparent_background:false};
const setup = async t => {
  const directory=await mkdtemp(path.join(os.tmpdir(),'image-api-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  return {directory,job,apiKey:'local-test-key',authorizePaidImages:true};
};

test('有Key但无付费许可零调用；完成记录恢复零调用且保留原模型',async t=>{
  const options=await setup(t);let calls=0;
  const fetchImpl=async(url,request)=>{
    calls++;assert.equal(url,'https://api.openai.com/v1/images/generations');
    const sent=JSON.parse(request.body);
    assert.equal(sent.prompt,job.prompt);assert.equal(sent.background,'opaque');assert.equal(sent.n,1);
    return response();
  };
  await assert.rejects(generateApiImage({...options,authorizePaidImages:false,fetchImpl}),/付费许可/u);
  assert.equal(calls,0);
  const result=await generateApiImage({...options,fetchImpl});
  const retained=await generateApiImage({...options,authorizePaidImages:false,apiKey:'',model:'changed',fetchImpl});
  assert.deepEqual(retained,result);assert.equal(calls,1);
  const metadata=await imageGenerationMetadata({job,sourceFile:result.output,receipt:result.receiptPath});
  assert.equal(metadata.provider,'openai-images');assert.equal(metadata.model,result.model);
  await assert.rejects(imageGenerationMetadata({job:{...job,prompt:'changed'},sourceFile:result.output,receipt:result.receiptPath}),/原参数/u);
  await writeFile(result.output,'tampered');
  await assert.rejects(generateApiImage({...options,fetchImpl}),/原参数/u);
  assert.equal(calls,1);
});

test('参考图片和透明要求进入实际编辑请求；未知结果恢复不重投',async t=>{
  const options=await setup(t),reference=path.join(options.directory,'reference.png');
  await writeFile(reference,png);
  const edited={...job,transparent_background:true,referenced_image_paths:[reference]};
  await generateApiImage({...options,job:edited,fetchImpl:async(url,{body})=>{
    assert.equal(url,'https://api.openai.com/v1/images/edits');
    assert.equal(body.get('background'),'transparent');assert.equal(body.get('prompt'),job.prompt);
    assert.deepEqual(Buffer.from(await body.get('image[]').arrayBuffer()),png);
    return response();
  }});
  let calls=0;
  const unknown={...options,directory:path.join(options.directory,'unknown'),fetchImpl:async()=>{calls++;throw new Error('local timeout');}};
  await assert.rejects(generateApiImage(unknown),/local timeout/u);
  assert.equal(JSON.parse(await readFile(path.join(unknown.directory,'generation.json'))).state,'unknown');
  await assert.rejects(generateApiImage(unknown),/不自动再次提交/u);
  assert.equal(calls,1);
});

test('API原图沿现有导入及校验链交付，原生资产合同继续有效',async t=>{
  const options=await setup(t);
  const result=await generateApiImage({...options,fetchImpl:async()=>response()});
  const input={workspaceRoot:options.directory,sourceFile:result.output,generationReceipt:result.receiptPath,
    episodeId:'ep01',stageId:'p3',unitId:'B001',job,
    request:{requestId:'AR001',kind:'fullframe',sourceRefs:[],mustNotInvent:[],production:{panel:{lines:['完整场景']},groupRules:[]}},
    profile:{packageId:'visual-test',version:'1.0.0',profileId:'fullframe-image',profileDigest:'a'.repeat(64),referenceId:'style'}};
  const asset=await importAuthoredImage(input);
  assert.equal(asset.provider,'openai-images');assert.equal(asset.model,result.model);
  assert.equal(await verifyAuthoredImage({...input,asset}),asset);
  const schema=JSON.parse(await readFile(new URL('../contracts/fullframe-treatment.schema.json',import.meta.url)));
  const assetSchema=Object.values(schema.$defs).find(value=>value.properties?.provider?.enum?.includes('openai-images'));
  assert(assetSchema,'须验证正式资产合同');
  const validate=compileSchema(assetSchema,'fullframe API asset');
  assert(validate(asset),JSON.stringify(validate.errors));
  const {model,...native}=asset;native.provider='image-gen';
  assert(validate(native),JSON.stringify(validate.errors));
  assert(!validate({...native,provider:'openai-images'}),'API资产不能冒充未知模型');
});
