export const projectAuthorContext = ({ programPlan, episodeId }) => {
  const episode = programPlan?.episodes?.find((item) => item.episodeId === episodeId);
  if (!episode?.episodeTitle) throw new Error("纪录片片头缺少现行P0本集标题");
  if (!programPlan?.seriesTitle || !programPlan?.editorialDirection) {
    throw new Error("纪录片片头缺少现行P0节目世界设定");
  }
  return {
    episodeTitle: episode.episodeTitle,
    openerWorldContext: {
      seriesTitle: programPlan.seriesTitle,
      editorialDirection: programPlan.editorialDirection,
      ...(programPlan.storyWorld ? { storyWorld: structuredClone(programPlan.storyWorld) } : {}),
      episodeCreativeBrief: episode.episodeCreativeBrief,
      episodeScope: episode.episodeScope
    }
  };
};
