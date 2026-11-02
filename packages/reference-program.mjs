import { fileSha256, readData } from "./program-utils.mjs";

// The source directory belongs to the user. It contains media and transcripts, not programme plans.
export async function readReferenceVideos(descriptor, ids = null) {
  if (!descriptor?.path) throw new Error("参考节目清单路径缺失");
  const source = await readData(descriptor.path);
  if (!Array.isArray(source.videos) || !source.videos.length) throw new Error("参考节目清单没有视频");
  const videos = ids === null ? source.videos : ids.map(id => {
    const video = source.videos.find(item => item.id === id);
    if (!video) throw new Error(`参考节目没有指定视频: ${id}`);
    return video;
  });
  return Promise.all(videos.map(async video => {
    if (!video.transcript?.path || await fileSha256(video.transcript.path) !== video.transcript.sha256) {
      throw new Error(`参考口播文件缺失或已变化: ${video.id}`);
    }
    const transcript = await readData(video.transcript.path);
    if (typeof transcript.text !== "string" || !transcript.text.trim()) throw new Error(`参考口播为空: ${video.id}`);
    return { ...video, transcript: { ...video.transcript, text: transcript.text, ...(Array.isArray(transcript.segments) ? { segments: transcript.segments } : {}) } };
  }));
}

export async function episodeReferenceVideos(plan, episodeId) {
  if (!plan?.referenceProgram) return undefined;
  const episode = plan.episodes.find(item => item.episodeId === episodeId);
  return readReferenceVideos(plan.referenceProgram, episode.referenceVideoIds);
}
