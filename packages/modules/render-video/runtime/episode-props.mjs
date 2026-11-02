import { stat } from "node:fs/promises";
import path from "node:path";
import { assertProjectPath } from "../../../program-utils.mjs";

export const buildEpisodeProps = ({ renderPlan }) => ({
  episodeId: renderPlan.episodeId,
  fps: renderPlan.fps,
  width: renderPlan.width,
  height: renderPlan.height,
  durationMs: renderPlan.durationMs,
  visualStyle: renderPlan.visualStyle,
  renderDigest: renderPlan.renderDigest,
  ending: renderPlan.ending ? { ...renderPlan.ending } : null,
  ...(renderPlan.preview ? { preview: { ...renderPlan.preview } } : {}),
  audioTracks: renderPlan.audioTracks.map((track) => ({ ...track })),
  captions: renderPlan.captions.map((caption) => ({ ...caption })),
  templateRuns: renderPlan.templateRuns.map((run) => ({
    ...run,
    beatIds: [...run.beatIds]
  })),
  segments: renderPlan.segments.map((segment) => ({ ...segment })),
  transitions: renderPlan.transitions.map((transition) => ({ ...transition })),
  overlays: renderPlan.overlays.map((segment) => ({ ...segment }))
});

const audioSourceRoot = ({ workspaceRoot, systemRoot, file }) => (
  file.startsWith("packages/templates/") || file.startsWith("packages/features/") || (file.startsWith('local-media/background-music/') || file.startsWith('local-media/private-assets/'))
    ? systemRoot
    : workspaceRoot
);

export async function assertRenderPlanFiles({ root, systemRoot = root, renderPlan }) {
  for (const segment of [...renderPlan.segments, ...renderPlan.overlays]) {
    for (const asset of segment.assetRefs) {
      const file = path.join(root, asset.file);
      await assertProjectPath({ root, file, label: `${segment.id} 素材路径` });
      if (!(await stat(file)).isFile()) throw new Error(`${segment.id} 素材缺失: ${asset.requestId}`);
    }
  }
  for (const track of renderPlan.audioTracks) {
    const sourceRoot = audioSourceRoot({ workspaceRoot: root, systemRoot, file: track.file });
    const file = path.join(sourceRoot, track.file);
    await assertProjectPath({ root: sourceRoot, file, label: `${track.id} 音频路径` });
    if (!(await stat(file)).isFile()) throw new Error(`${track.id} 音频缺失`);
  }
}
