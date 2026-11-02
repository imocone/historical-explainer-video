import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {imageGenerationMetadata} from './image-provenance.mjs';
import {hashObject,sha256,atomicWriteData} from './program-utils.mjs';
import {importAuthoredImage,verifyAuthoredImage} from './authored-images.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAAGUlEQVR4nGMUNA5lIAUwkaSaYVQDcYBkDQAXZACrFYSv9wAAAABJRU5ErkJggg==','base64');
test('原生导入与历史API已成图沿同一合同保留真实来源，不提交服务',async t=>{
 const workspaceRoot=await mkdtemp(path.join(os.tmpdir(),'image-provenance-'));
 t.after(()=>rm(workspaceRoot,{recursive:true,force:true}));
 const sourceFile=path.join(workspaceRoot,'original.png');await writeFile(sourceFile,png);
 const job={prompt:'完整画面',transparent_background:false};
 const receipt=path.join(workspaceRoot,'original-generation.json');
 await atomicWriteData(receipt,{provider:'openai-images',state:'completed',model:'retained-model',job,
  jobDigest:hashObject(job),outputSha256:sha256(png)});
 const options={workspaceRoot,sourceFile,episodeId:'ep01',stageId:'p3',unitId:'B001',job,
  request:{requestId:'AR001',kind:'fullframe',sourceRefs:[],mustNotInvent:[],production:{panel:{lines:['完整画面']},groupRules:[]}},
  profile:{packageId:'visual-test',version:'1.0.0',profileId:'fullframe-image',profileDigest:'a'.repeat(64),referenceId:'style'}};
 const retained=await importAuthoredImage({...options,generationReceipt:receipt});
 assert.equal(retained.provider,'openai-images');assert.equal(retained.model,'retained-model');
 assert.equal(await verifyAuthoredImage({...options,asset:retained}),retained);
 const native=await importAuthoredImage(options);assert.equal(native.provider,'image-gen');
 assert.equal((await readFile(sourceFile)).equals(png),true);
 await assert.rejects(imageGenerationMetadata({job:{...job,prompt:'另一请求'},sourceFile,receipt}),/原参数/);
 await writeFile(sourceFile,'changed');
 await assert.rejects(imageGenerationMetadata({job,sourceFile,receipt}),/原参数/);
});
