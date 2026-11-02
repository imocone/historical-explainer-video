import {readFile} from 'node:fs/promises';
import {hashObject, readData, sha256} from './program-utils.mjs';

// Existing API assets keep their actual origin. This module never submits images.
export const isGeneratedImage = asset => ['image-gen', 'openai-images'].includes(asset?.provider);

export async function imageGenerationMetadata({job, sourceFile, receipt}) {
  if (!receipt) return {provider:'image-gen'};
  const saved = typeof receipt === 'string' ? await readData(receipt) : receipt;
  if (saved.provider !== 'openai-images' || saved.state !== 'completed' || !saved.model
    || saved.jobDigest !== hashObject(job) || saved.outputSha256 !== sha256(await readFile(sourceFile))) {
    throw new Error('图片须对应原参数和已完成的真实API结果');
  }
  return {provider:saved.provider, model:saved.model, ...(saved.requestId ? {requestId:saved.requestId} : {})};
}
