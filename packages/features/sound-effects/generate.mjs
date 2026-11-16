import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir, mkdtemp, readFile, writeFile, rename, rm} from 'node:fs/promises';
import {readData, hashObject, fileSha256, assertProjectPath, resolveContainedPath, sha256} from '../../program-utils.mjs';
import {readP3Sources} from '../../p3-sources.mjs';
import {assertSourceRightsForExternalProduction} from '../../source-rights.mjs';
import {getEpisodePaths} from '../../workspace-paths.mjs';
import {deriveAuthorWorkspaceRoot} from '../../modules/author-beat/candidate-validation.mjs';
import {runMediaProcess} from '../../modules/render-video/runtime/media-process.mjs';
import {pythonCommand, runtimeEnvironment} from '../../runtime-config.mjs';
import recordings from './recordings/catalog.json' with {type:'json'};

export const generateSound = async ({workOrderPath, recipePath}) => {
  const workOrder = await readData(workOrderPath);
  const {taskDigest, ...base} = workOrder;
  if (hashObject(base) !== taskDigest || workOrder.stageId !== 'p3' || workOrder.moduleId !== 'author-beat'
    || !workOrder.resolvedAssembly.slots.some(slot => slot.implementations.some(item => item.packageId === 'sound-effects')))
    throw new Error('制声需要已启用音效的当前P3作者工作单');
  const workspaceRoot = deriveAuthorWorkspaceRoot({workOrder,
    candidatePath:path.join(path.dirname(workOrderPath), path.basename(workOrder.candidatePath))});
  const recipe = await readData(recipePath);
  const scratch = path.resolve(workspaceRoot, workOrder.scratchPath);
  await assertProjectPath({root:scratch, file:path.resolve(recipePath), label:'本单声音配方'});
  let authoredSource;
  if (recipe.sourceFile !== undefined) {
    if (recipe.layers !== undefined) throw new Error('专用制声与分层配方只能选择一种');
    const sourceFile = path.resolve(path.dirname(recipePath), recipe.sourceFile);
    await assertProjectPath({root:scratch, file:sourceFile, label:'本单专用制声源码'});
    authoredSource = await readFile(sourceFile, 'utf8');
  }
  const source = fileURLToPath(new URL('./synthesize.py', import.meta.url));
  const sourceFiles = ['synthesize.py','build-library.py','lemo/sfx.py','lemo/ink_wash.py','lemo/watercolor.py'];
  const sourceIds = new Set();
  for (const layer of Array.isArray(recipe.layers) ? recipe.layers : []) {
    if (layer?.generator !== 'recording') continue;
    const {name, sourceAssetId} = layer.parameters ?? {};
    if (sourceAssetId !== undefined) {
      if (name !== undefined) throw new Error('实录只填写 name 或 sourceAssetId 其中之一');
      sourceIds.add(sourceAssetId);
      continue;
    }
    if (!Object.hasOwn(recordings, name)) throw new Error(`未登记实录音效: ${name}`);
    const file = `recordings/${recordings[name]}`;
    if (!sourceFiles.includes(file)) sourceFiles.push(file);
  }
  const inputRecordings = [];
  if (sourceIds.size) {
    const sources = await readP3Sources({workspaceRoot, workOrder});
    const {input} = getEpisodePaths(workspaceRoot, workOrder.subject.id);
    for (const id of sourceIds) {
      const source = sources.find(item => item.id === id && item.mediaType === 'audio');
      if (!source) throw new Error(`未登记本集实录音频: ${id}`);
      const label = `实录音频 ${id}`;
      assertSourceRightsForExternalProduction({rightsStatus:source.rightsStatus, label});
      const file = resolveContainedPath({directory:input, relativePath:source.path, label});
      await assertProjectPath({root:workspaceRoot, file, label});
      const bytes = await readFile(file);
      if (sha256(bytes) !== source.sha256) throw new Error(`${label}与登记文件不一致`);
      inputRecordings.push({source, bytes});
    }
  }
  const version = await Promise.all(sourceFiles.map(file => fileSha256(fileURLToPath(new URL(file, import.meta.url)))));
  const definition = {...recipe};
  if (authoredSource !== undefined) definition.sourceFile = 'authored.py';
  if (inputRecordings.length) definition.recordingSources = inputRecordings.map(({source}) => source);
  const identity = hashObject({recipe:definition, authoredSource, version});
  const file = path.posix.join(workOrder.subject.id, '制作/p3/assets/sound-effects', `${identity}.wav`);
  const destination = path.resolve(workspaceRoot, file);
  await assertProjectPath({root:workspaceRoot, file:destination, label:'音效资产'});
  await mkdir(path.dirname(destination), {recursive:true});
  const temporaryDirectory = await mkdtemp(path.join(path.dirname(destination), '.generate-'));
  const temporary = path.join(temporaryDirectory, 'sound.wav');
  try {
    if (authoredSource !== undefined) await writeFile(path.join(temporaryDirectory, 'authored.py'), authoredSource);
    // Synthesis reads the same bytes that were checked against the registered digest.
    for (const {source, bytes} of inputRecordings)
      await writeFile(path.join(temporaryDirectory, `${source.id}.audio`), bytes);
    const snapshot = path.join(temporaryDirectory, 'recipe.json');
    await writeFile(snapshot, JSON.stringify(definition));
    const {stdout} = await runMediaProcess(pythonCommand(), [source, snapshot, temporary],
      {capture:true, timeoutMs:120000, env:runtimeEnvironment()});
    const timing = JSON.parse(stdout.trim());
    // Save the executed source, not a live scratch dependency. A failed render
    // publishes neither an asset nor a misleading recipe beside it.
    if (authoredSource !== undefined) {
      await rename(path.join(temporaryDirectory, 'authored.py'), destination.replace(/\.wav$/, '.py'));
      definition.sourceFile = `${identity}.py`;
    }
    await writeFile(snapshot, JSON.stringify(definition, null, 2) + '\n');
    await rename(snapshot, destination.replace(/\.wav$/, '.json'));
    await rename(temporary, destination);
    return {file, sha256:await fileSha256(destination), ...timing};
  } finally { await rm(temporaryDirectory, {recursive:true, force:true}); }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [workOrderPath, recipePath] = process.argv.slice(2);
  if (!workOrderPath || !recipePath) throw new Error('用法: node generate.mjs <当前工作单> <声音配方JSON>');
  console.log(JSON.stringify(await generateSound({workOrderPath:path.resolve(workOrderPath), recipePath:path.resolve(recipePath)})));
}
