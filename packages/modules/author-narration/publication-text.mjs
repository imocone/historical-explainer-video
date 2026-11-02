export const publicationTextFor = (publication, { youtubeDescription } = {}) => {
  const { youtube, douyin, xiaohongshu } = publication.platforms;
  return [
    `EP${publication.episodeId.slice(2)} 发布文案`,
    "",
    "【YouTube】",
    youtube.title,
    "",
    youtubeDescription ?? youtube.description,
    "",
    `YouTube后台标签（单独填写）：${youtube.tags.join("、")}`,
    "",
    "【抖音】",
    douyin.title,
    "",
    douyin.body,
    "",
    douyin.topics.map((topic) => `#${topic}`).join(" "),
    "",
    "【小红书】",
    xiaohongshu.title,
    "",
    xiaohongshu.body,
    "",
    xiaohongshu.topics.map((topic) => `#${topic}`).join(" "),
    ""
  ].join("\n");
};
