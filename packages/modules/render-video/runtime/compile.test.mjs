import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileComposition } from "./compile.mjs";
import { resolveCrossBeatRuntimeTiming } from "./transitions.mjs";
import { runMediaProcess, withMediaResources } from "./media-process.mjs";
import { mixCompositionAudio } from "./audio-mix.mjs";
import { collectAuthoredMedia } from "../../../authored-media.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { assertAudioTracks } from "./render-contracts.mjs";
import { openerAudioTracksForTreatment } from "../../../templates/episode-opener/audio-policy.mjs";
import { openerTimelineForTreatment } from "../../../templates/episode-opener/render-policy.mjs";

test("the opener's amplified fading sound effect passes through the plan and PCM mixer", async () => {
  let tracks;
  for (const endMs of [3000, 4920, 6760]) {
    const treatment = { flashbackShots: [{ id: "O01" }, { id: "O02" }, { id: "O03" }],
      narration: { durationMs: endMs + 116, sentenceCues: [{ target: "flashbackLine", startMs: 120, endMs }] } };
    const durationMs = openerTimelineForTreatment(treatment).durationFrames / 60 * 1000;
    tracks = openerAudioTracksForTreatment({ treatment }).map(({ startFrame, endFrame, ...track }) =>
      ({ ...track, startMs: startFrame / 60 * 1000, endMs: endFrame / 60 * 1000 }));
    const validate = audioTracks => assertAudioTracks({ audioTracks, durationMs,
      segments: [{ segmentType: "opener", startMs: 0, endMs: durationMs }] });
    assert.doesNotThrow(() => validate(tracks));
    const effect = tracks.find(track => track.id === "opener-strips-inertia");
    for (const volume of [0, -1, NaN, Infinity])
      assert.throws(() => validate([{ ...effect, volume }]), /音量无效/);
    assert.throws(() => validate([{ ...tracks.at(-1), volume: 2.8 }]), /音量无效/);
    assert.throws(() => validate([{ ...effect, id: "opener-narration", kind: "narration", volume: 1 }]), /淡入淡出/);
    assert.throws(() => validate([{ ...effect, fadeOutFrames: 1000 }]), /超过自身时长/);
  }
  const effect = tracks.find(track => track.id === "opener-strips-inertia");
  const directory = await mkdtemp(path.join(os.tmpdir(), "hy-opener-sfx-"));
  try {
    const source = path.join(directory, "source.wav");
    await runMediaProcess("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "aevalsrc=0.05:d=1:s=48000",
      "-ac", "2", "-c:a", "pcm_s16le", source]);
    const sampleAt = (wav, seconds) => wav.readInt16LE(wav.indexOf(Buffer.from("data")) + 8 + Math.floor(seconds * 48000) * 4);
    const input = sampleAt(await readFile(source), .2);
    const file = await mixCompositionAudio({ projectDirectory: directory,
      props: { fps: 60, audioTracks: [{ ...effect, file: "source.wav", startMs: 0, endMs: 1000 }] },
      timeline: { fromFrame: 0, toFrame: 60, anchorMs: 0 } });
    const output = await readFile(file);
    assert.ok(Math.abs(sampleAt(output, .2) / input - 2.8) < .01, "PCM preserves the designed gain above unity");
    assert.ok(Math.abs(sampleAt(output, .95) / sampleAt(output, .2) - 1 / 3) < .01, "the final six frames fade out");
    assert.equal(sampleAt(output, .99), 0, "the effect ends silently");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("an opener's still reference does not require unrelated pictures or camera motion", async () => {
  const asset = { file: "local.png", sha256: "a".repeat(64) };
  const storyboard = { beats: [{ id: "B001", templateId: "fullframe-narrative", cueRange: [1, 1],
    treatment: { templateId: "fullframe-narrative", assetRequests: [
      { requestId: "AR001", kind: "fullframe-image", asset },
      { requestId: "AR002", kind: "fullframe-image", asset: null }
    ] } }] };
  const media = await collectAuthoredMedia({ storyboard, cues: [{ id: 1, startMs: 0, endMs: 5000, text: "静帧引用验证。" }],
    segmentIds: new Set(["opener"]), assetReferences: [{ segmentId: "B001", sourceRequestId: "AR001" }] });
  assert.equal(media.items.length, 1);
  assert.equal(media.items[0].requestId, "AR001");
  assert.equal(media.items[0].file, asset.file);
});

test("a partial opener mix bounds a delayed looping music track", { timeout: 15000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hy-opener-audio-"));
  try {
    await copyFile(new URL("../../../templates/documentary-opener/audio/memory-piano.wav", import.meta.url), path.join(directory, "memory.wav"));
    await copyFile(new URL("../../../templates/documentary-opener/audio/memory-piano.wav", import.meta.url), path.join(directory, "music.wav"));
    const file = await mixCompositionAudio({ projectDirectory: directory,
      props: { fps: 60, audioTracks: [
        { file: "memory.wav", startMs: 0, endMs: 10500, volume: 0.3, fadeOutFrames: 138 },
        { file: "music.wav", startMs: 9500, endMs: 18000, loop: true, volume: 0.2, fadeInFrames: 60 }
      ] }, timeline: { fromFrame: 0, toFrame: 630, anchorMs: 10500 } });
    const probe = JSON.parse((await runMediaProcess("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", file],
      { capture: true, timeoutMs: 3000 })).stdout);
    assert.equal(Number(probe.format.duration), 10.5);
    assert.ok((await stat(file)).size < 2.1 * 1024 * 1024, "the finite window must not produce an unbounded WAV");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("video instances keep their own nodes and hold the requested final frame", { timeout: 120000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hy-video-instances-"));
  try {
    await promisify(execFile)("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
      "testsrc2=size=320x180:rate=60:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(directory, "source.mp4")]);
    await writeFile(path.join(directory, "white.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><path fill="white" d="M0 0H1920V1080H0Z"/></svg>');
    const video = { id: "video", templateId: "cinematic-video", segmentType: "body", startFrame: 0,
      startMs: 0, endMs: 2000, durationInFrames: 120, entranceLeadFrames: 0,
      assetRefs: [{ file: "source.mp4", mediaType: "video" }], renderData: { headHandleFrames: 0 } };
    const next = { id: "next", renderMode: "asset-media", segmentType: "body", startFrame: 120,
      startMs: 2000, endMs: 3000, durationInFrames: 60, entranceLeadFrames: 0,
      assetRefs: [{ file: "white.svg", mediaType: "image" }], renderData: {} };
    const props = { episodeId: "video-instances", width: 1920, height: 1080, fps: 60, durationMs: 3000,
      visualStyle: { shared: { fonts: {} }, p4: { subtitle: {} } }, captions: [], audioTracks: [], overlays: [], ending: null,
      ...resolveCrossBeatRuntimeTiming({ segments: [video, next] }) };
    const original = structuredClone(props);
    const { timeline } = await withMediaResources(async () => {
      const result = await compileComposition({ props, projectDirectory: directory, audio: false });
      await delay(1100); // Include a resource sample before the next compilation.
      return result;
    });
    assert.deepEqual(props, original, "compilation must preserve the source plan");
    const body = timeline.scenes.find(scene => scene.segment.id === "video" && scene.role === "body");
    const boundary = timeline.scenes.find(scene => scene.role === "boundary");
    const bodyAsset = body.segment.assetRefs[0], boundaryAsset = boundary.segment.assetRefs[0];
    const bodyHtml = await readFile(path.join(directory, "compositions", body.id + ".html"), "utf8");
    assert.ok(bodyHtml.includes(`id="${bodyAsset.playback.id}"`), "the body must find its own video node");
    assert.notEqual(bodyAsset, boundaryAsset);
    assert.equal(bodyAsset.frozenStill, undefined, "the moving body must stay moving");
    assert.ok((await stat(path.join(directory, boundaryAsset.frozenStill))).size > 0, "the boundary holds a real source frame");

    const endingProps = { ...props, ...resolveCrossBeatRuntimeTiming({ segments: [video] }),
      ending: { afterSegmentId: "video", startMs: 2000, holdFrames: 30, fadeFrames: 30 } };
    const ending = await compileComposition({ props: endingProps, projectDirectory: directory, audio: false });
    const scene = ending.timeline.scenes[0];
    assert.equal(scene.segment.assetRefs[0].playback.endFrame, 119, "the ending must stop at the authored video window");
    const html = await readFile(path.join(directory, "compositions", scene.id + ".html"), "utf8");
    assert.match(html, /<img class="clip"[^>]*data-start="2" data-duration="1"/, "HY owns the timed still after native video ends");

    // A first body video can begin at a fractional second after an opener.
    // HyperFrames aligns it to a frame and passes the resulting seek to FFprobe.
    const startFrame = 296;
    const delayedVideo = { ...video, startFrame, startMs: startFrame / 60 * 1000,
      endMs: (startFrame + video.durationInFrames) / 60 * 1000 };
    const delayedProps = { ...props, durationMs: delayedVideo.endMs, ending: null,
      ...resolveCrossBeatRuntimeTiming({ segments: [delayedVideo] }) };
    await compileComposition({ props: delayedProps, projectDirectory: directory, audio: false });
    const index = await readFile(path.join(directory, "index.html"), "utf8");
    const start = Number(index.match(/id="scene-video"[^>]*data-start="([^"]+)"/)?.[1]);
    const seek = startFrame / 60 - start;
    assert.equal(seek, 0, "the video must begin on its exact frame, without a tiny seek");
    await promisify(execFile)("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time",
      "-of", "csv=p=0", "-read_intervals", `${seek}%+#1`, path.join(directory, "source.mp4")]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
