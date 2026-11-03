import { readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { assertProjectMutationTree, assertProjectPath, fileSha256, hashObject, readData, withoutProducer } from '../../../program-utils.mjs';
import { getEpisodePaths } from '../../../workspace-paths.mjs';

export const MEDIA_RETENTION = 'documents-and-release';
const missing = error => { if (error.code === 'ENOENT') return null; throw error; };
const media = /\.(?:png|jpe?g|webp|gif|avif|heic|svg|bmp|tiff?|mp4|mov|webm|mkv|avi|m4v|mpeg|mpg|ts|wav|mp3|flac|m4a|aac|ogg|opus|aiff?|woff2?|ttf|otf)$/iu;
const transient = relative => relative.split(path.sep).some(part => ['_work', '.hyperframes', '.cache'].includes(part));
const remoteEvidence = new Set(['generation.json', 'tool-call.json', 'tts-intent.yaml', 'tts-result.yaml', 'opener-tts-intent.yaml', 'opener-tts-result.yaml']);

export async function readRetainedDelivery({ workspaceRoot, episodeId, verifyVideo = false }) {
  if (!episodeId) return null;
  const paths = getEpisodePaths(workspaceRoot, episodeId);
  await assertProjectPath({ root: workspaceRoot, file: paths.renderReceipt, label: '成片清理回执' });
  const receipt = await readData(paths.renderReceipt).catch(missing);
  if (receipt?.mediaRetention !== MEDIA_RETENTION) return null;
  if (receipt.episodeId !== episodeId || receipt.output !== path.relative(workspaceRoot, paths.finalVideo).split(path.sep).join('/')
    || receipt._producer?.moduleId !== 'render-video' || receipt._producer?.nodeId !== 'render'
    || receipt._producer.outputSha256 !== hashObject(withoutProducer(receipt)))
    throw new Error('成片清理回执身份或内容不符，保留素材');
  await assertProjectPath({ root: workspaceRoot, file: paths.finalVideo, label: '清理前正式成片' });
  const info = await stat(paths.finalVideo).catch(missing);
  if (!info?.isFile() || !info.size || (verifyVideo && await fileSha256(paths.finalVideo) !== receipt.sha256))
    throw new Error('正式成片缺失或与回执不符，保留素材，不自动重压');
  return receipt;
}

// Formal documents remain readable. New explicit work must still use its actual inputs.
export async function hasProductionWork({ workspaceRoot, episodeId, stageId }) {
  const base = path.join(getEpisodePaths(workspaceRoot, episodeId).production, stageId);
  await assertProjectPath({ root: workspaceRoot, file: base, label: '清理后的制作工作目录' });
  const visit = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(error => missing(error) ?? [])) {
      if (['restarts', 'held-work', 'history', 'archive'].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`制作工作目录不得包含符号链接: ${file}`);
      if (entry.isDirectory()) { if (await visit(file)) return true; }
      else if (file.split(path.sep).includes('_work') && (/^return-.*\.yaml$/u.test(entry.name)
        || ['work-order.yaml', 'candidate.yaml', 'restart.yaml', 'cover-regeneration.yaml'].includes(entry.name))) return true;
    }
    return false;
  };
  return visit(base);
}

export async function ownedPreviewHistories(projects, historyRoot) {
  const histories = [];
  for (const project of new Set(projects)) {
    // Native HY 0.8.223 binds this id to project.json#dir. Both sides must match.
    const idFile = path.join(project, '.hyperframes', 'history-id');
    await assertProjectPath({ root: project, file: idFile, label: '本集预演历史身份' });
    const id = (await readFile(idFile, 'utf8').catch(missing))?.trim();
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(id ?? '')) continue;
    const home = path.join(historyRoot, id);
    await assertProjectMutationTree({ root: historyRoot, file: home, label: '本集独占预演历史' });
    const record = await readData(path.join(home, 'project.json')).catch(missing);
    if (typeof record?.dir === 'string' && path.resolve(record.dir) === path.resolve(project)) histories.push(home);
  }
  return [...new Set(histories)];
}

export async function cleanupEpisodeMedia({ workspaceRoot, systemRoot, episodeId,
  historyRoot = path.join(os.homedir(), '.cache', 'hyperframes', 'history') }) {
  const receipt = await readRetainedDelivery({ workspaceRoot, episodeId, verifyVideo: true });
  if (!receipt) return { removedFiles: 0 };
  const paths = getEpisodePaths(workspaceRoot, episodeId);
  const work = path.join(paths.p4, '_work');
  const protectedFiles = new Set([paths.finalVideo, ...['cover-youtube.png', 'cover-vertical.png', 'publication.txt']
    .map(name => path.join(paths.output, name)), path.join(work, 'program-execution.yaml'), path.join(work, '.program-execution.lock')]);
  const publication = path.join(paths.production, 'p5', 'release-main');
  const files = [], directories = [], projects = [];
  const walk = async (directory, inheritedTransient = false) => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(error => missing(error) ?? [])) {
      const file = path.join(directory, entry.name);
      if (file === publication) continue; // Publishing owns its original upload identities and receipts.
      if (entry.isSymbolicLink()) throw new Error(`素材清理不得跟随符号链接: ${file}`);
      if (entry.isDirectory()) {
        if (entry.name === '.hyperframes') projects.push(directory);
        await walk(file, inheritedTransient || transient(path.relative(paths.episode, file)));
        directories.push(file);
        continue;
      }
      if (protectedFiles.has(file)) continue;
      const parts = path.relative(paths.episode, file).split(path.sep);
      const archived = parts.some(part => ['restarts', 'held-work', 'history', 'archive'].includes(part));
      if (!archived && parts.includes('_work') && (entry.name === 'work-order.yaml' || entry.name.endsWith('.lock')))
        throw new Error(`本集还有进行中的工作，成片保留，暂不清理: ${file}`);
      if ((inheritedTransient && !remoteEvidence.has(entry.name)) || media.test(entry.name)
        || entry.name === '.DS_Store' || /\.tmp(?:-\d+-[0-9a-f-]+)?$/u.test(entry.name)) files.push(file);
    }
  };
  await assertProjectMutationTree({ root: workspaceRoot, file: paths.episode, label: '本集素材清理树' });
  await walk(paths.episode);

  // The Vox preview owner namespaces its default output by programme and episode.
  const previewRoot = path.join(systemRoot, 'tmp', 'vox-explainer-previews', hashObject(path.resolve(workspaceRoot)));
  const previewTargets = [];
  for (const parent of [previewRoot, path.join(previewRoot, 'projects')]) {
    await assertProjectPath({ root: systemRoot, file: parent, label: '本集默认讲解预演目录' });
    for (const entry of await readdir(parent, { withFileTypes: true }).catch(error => missing(error) ?? [])) {
      if (!entry.name.startsWith(`${episodeId}-`)) continue;
      const file = path.join(parent, entry.name);
      await assertProjectMutationTree({ root: systemRoot, file, label: '本集默认讲解预演产物' });
      previewTargets.push(file);
      if (parent.endsWith(`${path.sep}projects`) && entry.isDirectory()) projects.push(file);
    }
  }
  const histories = await ownedPreviewHistories(projects, historyRoot);
  const [{ loadStudioRuntime }, { stopComposition }] = await Promise.all([import('./browser-session.mjs'), import('./hyperframes.mjs')]);
  const { scanActiveServers } = await loadStudioRuntime();
  for (const server of await scanActiveServers()) {
    const relative = path.relative(paths.episode, path.resolve(server.projectDir));
    const insideEpisode = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    if (insideEpisode || projects.some(project => path.resolve(project) === path.resolve(server.projectDir)))
      await stopComposition(server.projectDir);
  }
  // All paths are checked before the first deletion; no shared/global clean sweep.
  for (const file of files) await rm(file, { force: true });
  for (const file of previewTargets) await rm(file, { recursive: true, force: true });
  for (const home of histories) await rm(home, { recursive: true, force: true });
  for (const directory of directories) {
    if (!(await readdir(directory)).length) await rm(directory, { recursive: true });
  }
  console.log(`压片后清理完成：移除${files.length}个素材/缓存文件、${previewTargets.length}项讲解预演产物和${histories.length}份本集预演历史副本；正式文档与发布文件已保留。`);
  return { removedFiles: files.length, removedPreviews: previewTargets.length, removedHistories: histories.length };
}
