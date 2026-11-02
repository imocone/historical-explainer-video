import path from "node:path";
import { rename, rm } from "node:fs/promises";
import { VIDEO_SPEC, anchoredFrameForMs } from "../../../video-spec.mjs";
import { runMediaProcess } from "./media-process.mjs";

const envelopeExpression = (points, frame) => {
  let expression = '1';
  for (let index = points.length - 2; index >= 0; index--) {
    const a = points[index], b = points[index+1];
    const ramp = `${a.gain}+(${b.gain-a.gain})*((${frame})-${a.frame})/${b.frame-a.frame}`;
    expression = `if(lt((${frame}),${b.frame}),${ramp},${expression})`;
  }
  return `if(lt((${frame}),${points[0].frame}),1,${expression})`;
};

export const mixCompositionAudio = async ({ props, timeline, projectDirectory }) => {
  const { sampleRate, channels } = VIDEO_SPEC.finalOutput.audio;
  const duration = (timeline.toFrame - timeline.fromFrame) / props.fps;
  // Master the same complete bus before cropping a preview. A limiter started
  // in the middle of a hit would otherwise have different lookahead/state.
  const busEnd = Math.max(timeline.toFrame, Math.round((props.durationMs ?? 0) * props.fps / 1000),
    ...props.audioTracks.map(track => Math.ceil((track.endMs ?? 0) * props.fps / 1000)));
  const busDuration = busEnd / props.fps;
  const args = ["-hide_banner", "-loglevel", "info", "-y"];
  const filters = [], outputs = [];
  // A standalone opener retains its established voice/music levels. Body and
  // body-candidate playback use the shared programme finishing below.
  const finishing = props.audioTracks.some(track => track.kind === 'narration' && track.segmentType !== 'opener');
  const groups = {voice:[],music:[],effects:[],other:[]};
  for (const track of props.audioTracks) {
    const originalStart = anchoredFrameForMs({ milliseconds: track.startMs, anchorMs: timeline.anchorMs, fps: props.fps });
    const originalEnd = track.endMs == null ? busEnd
      : anchoredFrameForMs({ milliseconds: track.endMs, anchorMs: timeline.anchorMs, fps: props.fps });
    const start = Math.max(originalStart, 0), end = Math.min(originalEnd, busEnd);
    if (end <= start) continue;
    const index = outputs.length, offset = start - originalStart;
    if (track.loop) args.push("-stream_loop", "-1");
    const inputDuration = (offset + (track.sourceStartFrame ?? 0) + end - start) / props.fps;
    args.push("-threads", "2", "-t", String(inputDuration), "-i", path.join(projectDirectory, track.file));
    const sourceFrame = `floor(n*${props.fps}/${sampleRate})+${offset + (track.envelopeOffsetFrames ?? 0)}`;
    const dynamicsFrame = `n*${props.fps}/${sampleRate}+${offset + (track.envelopeOffsetFrames ?? 0)}`;
    const fadeIn = track.fadeInFrames ? `min(1,max(0,(${sourceFrame})/${track.fadeInFrames}))` : "1";
    const fadeOut = track.fadeOutFrames ? `min(1,max(0,(${(track.envelopeDurationFrames ?? originalEnd - originalStart) - 1}-(${sourceFrame}))/${track.fadeOutFrames}))` : "1";
    // Authored music gestures multiply the base envelope before automatic
    // dialogue ducking. Overlapping requests use the quieter value.
    const dynamics = (track.gainEnvelopes ?? []).reduce((value, points) =>
      `min(${value},${envelopeExpression(points, dynamicsFrame)})`, '1');
    const gain = `${track.volume ?? 1}*min(${fadeIn},${fadeOut})*(${dynamics})`;
    // Lemo add(): equal-power pan, preserving unity gain at centre.
    const left = track.pan ? Math.cos((track.pan + 1) * Math.PI / 4) * Math.SQRT2 : 1;
    const right = track.pan ? Math.sin((track.pan + 1) * Math.PI / 4) * Math.SQRT2 : 1;
    const delay = Math.round(start * sampleRate / props.fps);
    // The opposed opener's mono TTS must keep its original level in each ear;
    // FFmpeg's default mono-to-stereo rematrix would reduce it by about 3 dB.
    const opposedVoice = track.id === "opener-narration" && track.kind === "narration"
      && props.segments?.some(segment => segment.segmentType === "opener" && ["opposed-opener", "glass-opener"].includes(segment.templateId));
    const channelFilter = opposedVoice ? "pan=stereo|c0=FL+FC|c1=FR+FC" : "aformat=channel_layouts=stereo";
    const voiceCompression = finishing && track.kind === 'narration' && track.segmentType !== 'opener'
      ? ',acompressor=threshold=0.25:ratio=3.5:attack=4:release=80:makeup=1' : '';
    filters.push(`[${index}:a]aresample=${sampleRate},${channelFilter},atrim=start=${(offset + (track.sourceStartFrame ?? 0)) / props.fps}:duration=${(end - start) / props.fps},asetpts=PTS-STARTPTS,aeval='val(0)*${gain}*${left}|val(1)*${gain}*${right}'${voiceCompression},adelay=${delay}S|${delay}S[a${index}]`);
    outputs.push(`[a${index}]`);
    groups[track.kind === 'narration' ? 'voice' : track.kind === 'background-music' ? 'music'
      : track.kind === 'sound-effect' ? 'effects' : 'other'].push(`[a${index}]`);
  }
  const analysis = `apad,atrim=duration=${busDuration},ebur128=peak=true:framelog=verbose`;
  if (finishing) {
    for (const [group,inputs] of Object.entries(groups)) {
      if (!inputs.length) filters.push(`anullsrc=r=${sampleRate}:cl=stereo,atrim=duration=${busDuration}[${group}]`);
      else filters.push(`${inputs.join('')}${inputs.length === 1 ? 'anull' : `amix=inputs=${inputs.length}:normalize=0:dropout_transition=0`}[${group}]`);
    }
    // Shared finishing owns balance. The effects Feature never selects or writes music.
    filters.push('[voice]asplit=2[voiceMain][voiceControl]', '[effects]asplit=2[effectsMain][effectsControl]',
      '[voiceControl][effectsControl]amix=inputs=2:weights=1 0.5:normalize=0:dropout_transition=0[control]',
      '[music]equalizer=f=1600:t=q:w=1:g=-2.5[musicRoom]',
      '[musicRoom][control]sidechaincompress=threshold=0.025:ratio=5:attack=15:release=400:makeup=1[duckMusic]',
      `[voiceMain][effectsMain][duckMusic][other]amix=inputs=4:normalize=0:dropout_transition=0,${analysis}[mix]`);
  } else if (outputs.length) filters.push(`${outputs.join('')}amix=inputs=${outputs.length}:normalize=0:dropout_transition=0,${analysis}[mix]`);
  else { args.push('-f','lavfi','-i',`anullsrc=r=${sampleRate}:cl=stereo`); filters.push(`[0:a]${analysis}[mix]`); }
  const file = path.join(projectDirectory, "audio.wav");
  const temporary = path.join(projectDirectory, `.audio-mix-${process.pid}.wav`);
  const bus = path.join(projectDirectory, `.audio-bus-${process.pid}.wav`);
  const normalized = path.join(projectDirectory, `.audio-normalized-${process.pid}.wav`);
  try {
    const measured = await runMediaProcess("ffmpeg", [...args, "-filter_complex_threads", "1", "-filter_complex", filters.join(";"),
      "-map", "[mix]", "-t", String(busDuration), "-ar", String(sampleRate), "-ac", String(channels), "-threads", "2",
      "-c:a", "pcm_f32le", bus], {capture:true, timeoutMs:Math.max(120000,busDuration*1000)});
    const match = [...measured.stderr.matchAll(/Peak:\s*([+-]?[\d.]+|-[Ii]nf)\s*dBFS/g)].at(-1);
    if (!match) throw new Error('共享混音未取得真峰值，不能量化输出');
    const peak = Number(match[1]);
    // Leave an extra margin after downsampling; unity below the ceiling.
    // Measure the complete 48 kHz bus with the same EBU meter used at delivery.
    // loudnorm's first-pass dynamic path upsamples and measures different blocks;
    // using those values for its linear pass can overshoot on short previews.
    const summary = measured.stderr.split('Summary:').at(-1);
    const integrated = summary.match(/Integrated loudness:\s*I:\s*([+-]?[\d.]+)\s*LUFS\s*Threshold:\s*([+-]?[\d.]+)/);
    const range = summary.match(/Loudness range:\s*LRA:\s*([+-]?[\d.]+)/);
    if (finishing && (!integrated || !range)) throw new Error('完整声音母线缺少两遍响度测量');
    const canNormalize = finishing && Number.isFinite(peak) && integrated && range;
    if (canNormalize) {
      // Flush loudnorm before the oversampled limiter. In one filter graph its
      // dynamic fallback can lose the last partial block (71.7 ms in the real
      // narration demo), even though the input and requested output are longer.
      await runMediaProcess('ffmpeg', ['-hide_banner','-loglevel','error','-y','-i',bus,
        '-af',`loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${integrated[1]}:measured_TP=${peak}:measured_LRA=${range[1]}:measured_thresh=${integrated[2]}:offset=0:linear=true`,
        '-ar',String(sampleRate),'-ac',String(channels),'-c:a','pcm_f32le',normalized],
      {timeoutMs:Math.max(120000,busDuration*1000)});
    }
    const ceiling = finishing || peak > -1 ? `aresample=192000,alimiter=limit=0.84:level=false:latency=true,aresample=${sampleRate},` : '';
    await runMediaProcess('ffmpeg', ['-hide_banner','-loglevel','error','-y','-i',canNormalize ? normalized : bus,
      '-af',`${ceiling}atrim=start=${timeline.fromFrame/props.fps}:duration=${duration},asetpts=PTS-STARTPTS`,
      '-t',String(duration),'-ar',String(sampleRate),'-ac',String(channels),'-c:a','pcm_s16le',temporary],
    {timeoutMs:Math.max(120000,busDuration*1000)});
    await rename(temporary, file);
  } finally { await Promise.all([rm(temporary, {force:true}), rm(bus, {force:true}), rm(normalized, {force:true})]); }
  return file;
};
