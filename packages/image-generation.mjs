import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteData, hashObject, readData, sha256 } from './program-utils.mjs';
import { runtimeValue } from './runtime-config.mjs';

export function imageBackend() {
  const value = runtimeValue('IMAGE_PROVIDER', 'builtin');
  if (!['builtin', 'openai'].includes(value)) throw new Error('IMAGE_PROVIDER 只支持 builtin 或 openai');
  return value;
}

export const isGeneratedImage = asset => ['image-gen', 'openai-images'].includes(asset?.provider);

export async function imageGenerationMetadata({ job, sourceFile, receipt }) {
  if (!receipt) return {provider:'image-gen'};
  const saved = typeof receipt === 'string' ? await readData(receipt) : receipt;
  if (saved.provider !== 'openai-images' || saved.state !== 'completed' || !saved.model
    || saved.jobDigest !== hashObject(job) || saved.outputSha256 !== sha256(await readFile(sourceFile))) {
    throw new Error('图片须对应原参数和已完成的真实API结果');
  }
  return {provider:saved.provider, model:saved.model, ...(saved.requestId ? {requestId:saved.requestId} : {})};
}

export async function generateApiImage({ job, directory, size = '2048x1152', authorizePaidImages = false,
  apiKey, model, fetchImpl = globalThis.fetch }) {
  if (!job?.prompt?.trim() || typeof job.transparent_background !== 'boolean') throw new Error('须提供原图片入口返回的完整job');
  const receiptPath = path.join(directory, 'generation.json');
  const output = path.join(directory, 'image.png');
  let saved;
  try { saved = await readData(receiptPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (saved) {
    if (saved.jobDigest !== hashObject(job) || saved.size !== size) throw new Error('原图片API记录属于另一请求，保留原目录');
    if (saved.state !== 'completed') throw new Error('原图片API调用失败或结果未知，保留原记录，不自动再次提交');
    await imageGenerationMetadata({job, sourceFile:output, receipt:saved});
    return {output, receiptPath, provider:saved.provider, model:saved.model};
  }
  if (!authorizePaidImages) throw new Error('图片API需要当前明确的付费许可；仅配置服务或密钥不构成授权');
  apiKey ??= runtimeValue('OPENAI_API_KEY');
  model ??= runtimeValue('OPENAI_IMAGE_MODEL', 'gpt-image-2.5-sunburst');
  if (!apiKey) throw new Error('请先在本机 .env 设置 OPENAI_API_KEY');
  const references = job.referenced_image_paths ?? [];
  if (!Array.isArray(references) || references.length > 5) throw new Error('原图片调用最多携带5张本地参考');
  const inputs = await Promise.all(references.map(async file => {
    const bytes = await readFile(file);
    const mime = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[path.extname(file).toLowerCase()];
    if (!mime) throw new Error('图片API参考须为PNG、JPEG或WebP');
    return {file, bytes, mime};
  }));
  const parameters = {model, prompt:job.prompt, size, quality:'high', n:1, output_format:'png',
    background:job.transparent_background ? 'transparent' : 'opaque'};
  const endpoint = inputs.length ? 'edits' : 'generations';
  const headers = {Authorization:`Bearer ${apiKey}`};
  let body;
  if (inputs.length) {
    body = new FormData();
    for (const [key,value] of Object.entries(parameters)) body.append(key, String(value));
    for (const input of inputs) body.append('image[]', new Blob([input.bytes], {type:input.mime}), path.basename(input.file));
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(parameters);
  }
  await mkdir(directory, {recursive:true});
  const intent = {provider:'openai-images', state:'submitting', model, size, jobDigest:hashObject(job), job,
    references:inputs.map(({file,bytes}) => ({file,sha256:sha256(bytes)}))};
  // Exclusive creation prevents another process from dispatching the same call.
  await writeFile(receiptPath, JSON.stringify(intent), {flag:'wx',mode:0o600});
  let requestId;
  try {
    const response = await fetchImpl(`https://api.openai.com/v1/images/${endpoint}`, {
      method:'POST', headers, body, signal:AbortSignal.timeout(900000)
    });
    requestId = response.headers?.get('x-request-id') ?? undefined;
    if (!response.ok) {
      const state = [400,401,403,404,422].includes(response.status) ? 'failed' : 'unknown';
      await atomicWriteData(receiptPath, {...intent,state,httpStatus:response.status,...(requestId ? {requestId} : {})});
      throw new Error(`图片API返回HTTP ${response.status}${requestId ? `，请求${requestId}` : ''}；保留记录，不自动重投`);
    }
    const result = await response.json();
    const bytes = Buffer.from(result.data?.[0]?.b64_json ?? '', 'base64');
    if (result.data?.length !== 1 || bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a') throw new Error('图片API未返回唯一PNG原图');
    await writeFile(output, bytes, {flag:'wx'});
    await atomicWriteData(receiptPath, {...intent,state:'completed',outputSha256:sha256(bytes),...(requestId ? {requestId} : {})});
    return {output, receiptPath, provider:intent.provider, model};
  } catch (error) {
    const current = await readData(receiptPath);
    if (current.state === 'submitting') await atomicWriteData(receiptPath, {...intent,state:'unknown',...(requestId ? {requestId} : {})});
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [jobFile, directory, ...args] = process.argv.slice(2);
    const sizeIndex = args.indexOf('--size');
    if (!jobFile || !directory || (sizeIndex >= 0 && (!args[sizeIndex+1] || args[sizeIndex+1].startsWith('--')))
      || args.some((arg,index) => arg !== '--authorize-paid-images' && arg !== '--size' && !(sizeIndex >= 0 && index === sizeIndex+1)))
      throw new Error('用法: node packages/image-generation.mjs <job.json> <本单结果目录> [--size 2048x1152] [--authorize-paid-images]');
    const source = await readData(path.resolve(jobFile));
    console.log(JSON.stringify(await generateApiImage({job:source.job ?? source,directory:path.resolve(directory),
      ...(sizeIndex >= 0 ? {size:args[sizeIndex+1]} : {}),authorizePaidImages:args.includes('--authorize-paid-images')})));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
