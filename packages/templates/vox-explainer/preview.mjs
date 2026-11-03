import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {mkdir, cp, writeFile} from 'node:fs/promises';
import {readData, assertProjectPath, hashObject} from '../../program-utils.mjs';
import {deriveAuthorWorkspaceRoot, validateTreatmentCandidate} from '../../modules/author-beat/candidate-validation.mjs';
import {projectP3TaskView} from '../../p3-task-view.mjs';
import {readP3Sources} from '../../p3-sources.mjs';
import {loadProgramVisualPackage} from '../../visual-package.mjs';
import {visualFontEntries, withVisualFontPaths} from '../../visual-fonts.mjs';
import {assetFile} from '../../runtime-config.mjs';
import {getEpisodePaths} from '../../workspace-paths.mjs';
import {VIDEO_SPEC, frameForMs, frameSpanForMs} from '../../video-spec.mjs';
import {resolveCueBindingsToFrames} from '../../cue-boundaries.mjs';
import {compileComposition} from '../../modules/render-video/runtime/compile.mjs';
import {scenePreviewProps} from '../../modules/render-video/runtime/scene-preview.mjs';
import {previewFeatureResults, candidateEffectTracks, specifiedMusicForWindow, candidateAudioContext} from '../../modules/render-video/runtime/candidate-audio.mjs';
import {launchComposition, snapshotComposition, renderComposition} from '../../modules/render-video/runtime/hyperframes.mjs';
import {createRenderPolicy, renderData} from './render-plan.mjs';

export const previewOutputDirectory = ({systemRoot, workspaceRoot, outputDirectory}) =>
  outputDirectory ?? path.join(systemRoot, 'tmp', 'vox-explainer-previews', hashObject(path.resolve(workspaceRoot)));

export async function preview({workOrderPath, candidatePath, outputDirectory, validateOnly = false, draft = false,
  exportVideo = false, stills = false, at = [], open = false, bgmSourceAssetId = null, muteEffects = false}) {
  const systemRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const [workOrder, candidate] = await Promise.all([readData(workOrderPath), readData(candidatePath)]);
  projectP3TaskView(workOrder);
  if (workOrder.moduleId !== 'author-beat' || workOrder.inputs.authorUnit?.templateId !== 'vox-explainer'
    || candidate.taskDigest !== workOrder.taskDigest || candidate.returnTo)
    throw new Error('预演需要当前Vox工作单及同一候选');
  const workspaceRoot = deriveAuthorWorkspaceRoot({workOrder, candidatePath});
  const implementations = workOrder.resolvedAssembly.slots.flatMap(slot => slot.implementations);
  const template = implementations.find(item => item.kind === 'template' && item.packageId === 'vox-explainer');
  if (!template) throw new Error('工作单未装配Vox模板');
  const sourceAssets = await readP3Sources({workspaceRoot, workOrder});
  const {errors, treatment} = await validateTreatmentCandidate({
    candidateResult: candidate.result, context: {...workOrder.inputs,
      sourceAssets, selectedTemplate: 'vox-explainer'},
    systemRoot, workspaceRoot, ...(!draft ? {task: workOrder, episodeId: workOrder.subject.id} : {}),
    moduleValidatorSource: workOrder.validator.source, templateImplementation: template,
    // Picture previsualization precedes post-picture Features. Validate what
    // has actually been delivered; final B2 still requires every selected one.
    featureImplementations: implementations.filter(item => item.kind === 'feature'
      && (workOrder.inputs.repairFeatureIds?.length || candidate.result.featureResults?.[item.packageId]))});
  if (errors.length) throw new Error(errors.join('；'));
  const {fps, width, height} = VIDEO_SPEC;
  const cues = workOrder.inputs.cues, startMs = cues[0].startMs, endMs = cues.at(-1).endMs;
  const durationInFrames = frameSpanForMs({startMs, endMs, fps});
  const featureResults = previewFeatureResults({inputs:workOrder.inputs, result:candidate.result});
  const actionTimings = resolveCueBindingsToFrames({bindingSet: featureResults['cue-sync'], cues,
    segmentStartMs: startMs, segmentEndMs: endMs, fps});
  const assetRefs = treatment.assetRequests.map(request => request.asset
    ? {...request.asset, requestId: request.requestId, kind: 'explainer-visual', mediaType: 'image'}
    : {requestId: request.requestId, kind: 'explainer-visual', mediaType: 'image', mimeType: 'image/png',
      width: 800, height: 600, file: `draft-${request.requestId}.svg`, draft: true});
  if (!draft && assetRefs.some(asset => asset.draft)) throw new Error('正式预演缺少图片');
  const policy = createRenderPolicy({fps, width, height});
  const rendered = renderData({treatment, actionTimings, assetRefs, durationInFrames, policy});
  if (validateOnly) return {message: 'Author/Cue/RenderData OK', moments: treatment.moments.length};
  const paths = getEpisodePaths(workspaceRoot, workOrder.subject.id);
  const [visual, narration] = await Promise.all([
    loadProgramVisualPackage(systemRoot, workspaceRoot, {roles: ['render']}), readData(paths.narrationPackage)]);
  const visualStyle = withVisualFontPaths(visual.renderTokens, visual.id);
  const font = visual.renderTokens.p4.subtitle.font;
  visualStyle.p4.subtitle = {...visualStyle.p4.subtitle, fontName: font.family,
    fontPublicPath: `visuals/${visual.id}/${font.file}`, fontWeight: font.weight, fontFormat: font.format, fontStyle: font.style};
  const outputRoot = previewOutputDirectory({systemRoot, workspaceRoot, outputDirectory});
  const name = `${workOrder.subject.id}-${workOrder.inputs.authorUnit.id}`;
  const projectDirectory = path.join(outputRoot, 'projects', name);
  await mkdir(projectDirectory, {recursive: true});
  const copy = async (source, relative) => {
    const target = path.join(projectDirectory, relative);
    await assertProjectPath({root: projectDirectory, file: target, label: '预演资源'});
    await mkdir(path.dirname(target), {recursive: true});
    await cp(source, target);
  };
  for (const asset of assetRefs) {
    if (asset.draft) await writeFile(path.join(projectDirectory, asset.file),
      `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${treatment.appearance.palette.paper}"/><text x="400" y="300" text-anchor="middle" font-size="56" fill="${treatment.appearance.palette.ink}">${asset.requestId}</text></svg>`);
    else {
      const file = path.resolve(workspaceRoot, asset.file);
      await assertProjectPath({root: workspaceRoot, file, label: '预演图片'});
      await copy(file, asset.file);
    }
  }
  for (const file of rendered.resourceFiles) await copy(path.join(systemRoot, file), file);
  for (const [, entry] of visualFontEntries(visual.renderTokens))
    await copy(assetFile(path.join(visual.directory, entry.file), {root: systemRoot}), `visuals/${visual.id}/${entry.file}`);
  await copy(assetFile(path.join(visual.directory, font.file), {root: systemRoot}), `visuals/${visual.id}/${font.file}`);
  const audio = path.resolve(paths.p2, narration.files.audio.path);
  await assertProjectPath({root: paths.p2, file: audio, label: '正式旁白'});
  await copy(audio, 'narration' + path.extname(audio));
  const segment = {id: name, templateId: 'vox-explainer', visualStyle, durationInFrames, actionTimings, startMs: 0,
    entranceLeadFrames: 0, runtimeTiming: {semanticFrameOffset: 0}, assetRefs, renderData: rendered};
  const audioContext = await candidateAudioContext({workspaceRoot,workOrder,sourceAssets});
  const audioTracks = muteEffects ? [] : await candidateEffectTracks({workOrder, result:candidate.result, segment, fps, audioContext,
    durationMs:durationInFrames / fps * 1000});
  audioTracks.push(...specifiedMusicForWindow({sourceAssetId:bgmSourceAssetId, sourceAssets,
    workOrder, result:candidate.result, segment, muteEffects, audioContext,
    episodeId:workOrder.subject.id, fromFrame:frameForMs({milliseconds:startMs,fps}),
    toFrame:frameForMs({milliseconds:endMs,fps}), fps, bodyEndMs:narration.durationMs ?? endMs}));
  for (const track of audioTracks) await copy(path.resolve(track.file.startsWith('packages/') || track.file.startsWith('local-media/background-music/') || track.file.startsWith('local-media/private-assets/') ? systemRoot : workspaceRoot, track.file), track.file);
  const originMs = frameForMs({milliseconds: startMs, fps}) * 1000 / fps;
  const props = scenePreviewProps({segment, captions: cues.map(cue => ({...cue,
    startMs: cue.startMs - originMs, endMs: cue.endMs - originMs})),
    audioFile: 'narration' + path.extname(audio), audioStartFrame: frameForMs({milliseconds: startMs, fps}),
    audioTracks,
    previewNotice: draft ? '草图预演 · 占位图不代表成品' : null});
  await compileComposition({props, projectDirectory});
  let output;
  if (stills) {
    const frames = (at.length ? at.map(seconds => Math.round(seconds * fps))
      : actionTimings.map(item => Math.min(durationInFrames - 1, item.frame + fps)));
    if (frames.some(frame => !Number.isInteger(frame) || frame < 0 || frame >= durationInFrames)) throw new Error('取帧时刻超出本段');
    output = path.join(outputRoot, name + '-stills');
    await snapshotComposition({projectDirectory, frames, outputDirectory: output});
  } else if (exportVideo) {
    output = path.join(outputRoot, name + '.mp4');
    await renderComposition({projectDirectory, output});
  } else await launchComposition(projectDirectory, {open});
  return {projectDirectory, output, durationSeconds: durationInFrames / fps};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const {values} = parseArgs({options: {'work-order': {type: 'string'}, candidate: {type: 'string'},
    'output-dir': {type: 'string'}, 'bgm-source': {type:'string'}, 'mute-effects': {type:'boolean'}, 'validate-only': {type: 'boolean'}, draft: {type: 'boolean'},
    export: {type: 'boolean'}, stills: {type: 'boolean'}, at: {type: 'string', multiple: true}}});
  if (!values['work-order'] || !values.candidate) throw new Error('需要 --work-order 和 --candidate');
  console.log(JSON.stringify(await preview({workOrderPath: path.resolve(values['work-order']), candidatePath: path.resolve(values.candidate),
    outputDirectory: values['output-dir'] && path.resolve(values['output-dir']), validateOnly: values['validate-only'],
    bgmSourceAssetId:values['bgm-source'], muteEffects:values['mute-effects'], draft: values.draft, exportVideo: values.export, stills: values.stills, at: values.at?.map(Number)}), null, 2));
}
