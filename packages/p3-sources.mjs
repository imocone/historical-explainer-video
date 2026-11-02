import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {assertProjectPath, atomicWrite, atomicWriteData, hashObject, readData, sha256, withProjectLock} from './program-utils.mjs';
import {getEpisodePaths} from './workspace-paths.mjs';
import {deriveCandidateWorkspaceRoot} from './templates/fullframe-narrative/task-contract.mjs';
import {validateSchema} from '../engine/runtime/schema.mjs';

const systemRoot = fileURLToPath(new URL('../', import.meta.url));
const schema = path.join(systemRoot, 'contracts/source-assets.schema.json');

export const sourcesExtend = (before, after) => Array.isArray(before) && Array.isArray(after)
  && new Set(after.map(item => item.id)).size === after.length
  && before.every(item => after.some(next => next.id === item.id && hashObject(next) === hashObject(item)));

export async function readP3Sources({workspaceRoot, workOrder}) {
  const file = getEpisodePaths(workspaceRoot, workOrder.subject.id).sourceAssets;
  await assertProjectPath({root: workspaceRoot, file, label: 'P3来源清单'});
  const document = await readData(file);
  await validateSchema(schema, document, 'P3来源清单');
  if (!sourcesExtend(workOrder.inputs.sourceAssets ?? [], document.assets))
    throw new Error('原来源已改变或删除；保留候选，沿原next核对实际受影响内容');
  return document.assets;
}

export async function registerP3Source({workOrderPath, source}) {
  const file = path.resolve(workOrderPath);
  const workOrder = await readData(file);
  const {taskDigest, ...base} = workOrder;
  if (hashObject(base) !== taskDigest || workOrder.stageId !== 'p3'
    || !(workOrder.moduleId === 'direct-episode'
      || (workOrder.moduleId === 'author-beat' && workOrder.inputs.authorPhase !== 'quotes'
        && ['fullframe-narrative', 'vox-explainer'].includes(workOrder.inputs.authorUnit?.templateId))))
    throw new Error('补查登记需要当前P3导演或正文作者工作单');
  const workspaceRoot = deriveCandidateWorkspaceRoot({workOrder,
    candidatePath: path.join(path.dirname(file), path.basename(workOrder.candidatePath))});
  const expected = path.join(workspaceRoot, path.dirname(workOrder.candidatePath), 'work-order.yaml');
  if (file !== expected) throw new Error('只能使用当前正式工作单路径');
  return withProjectLock({root: workspaceRoot, lock: path.join(workspaceRoot, '制作/.workflow-write.lock'),
    label: 'P3补查来源写入', execute: async () => {
    if (hashObject(await readData(file)) !== hashObject(workOrder)) throw new Error('当前工作单已改变');
    const assets = await readP3Sources({workspaceRoot, workOrder});
    const {file: sourceFile, ...metadata} = source;
    const bytes = await readFile(path.resolve(sourceFile));
    if (!bytes.length) throw new Error('补查资料为空');
    const digest = sha256(bytes);
    const extension = path.extname(sourceFile).toLowerCase();
    if (!/^\.[a-z0-9]{1,8}$/u.test(extension)) throw new Error('资料文件须有明确扩展名');
    const relativeFile = `sources/research-${digest}${extension}`;
    const existing = assets.find(item => item.sha256 === digest && item.path === relativeFile
      && Object.entries(metadata).every(([key, value]) => item[key] === value));
    if (existing) return existing;
    let number = 1;
    while (assets.some(item => item.id === `SA${String(number).padStart(3, '0')}`)) number++;
    const asset = {...metadata, id: `SA${String(number).padStart(3, '0')}`, path: relativeFile, sha256: digest};
    const document = {schemaVersion: '1.0', assets: [...assets, asset]};
    await validateSchema(schema, document, 'P3补查来源');
    const paths = getEpisodePaths(workspaceRoot, workOrder.subject.id);
    const target = path.join(paths.input, relativeFile);
    await assertProjectPath({root: workspaceRoot, file: target, label: 'P3补查资料'});
    await atomicWrite(target, bytes);
    await atomicWriteData(paths.sourceAssets, document);
    return asset;
  }});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [workOrderPath, sourceFile] = process.argv.slice(2);
  if (!workOrderPath || !sourceFile) throw new Error('用法: node packages/p3-sources.mjs <工作单> <资料描述JSON>');
  registerP3Source({workOrderPath, source: await readData(path.resolve(sourceFile))})
    .then(asset => console.log(JSON.stringify(asset)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
