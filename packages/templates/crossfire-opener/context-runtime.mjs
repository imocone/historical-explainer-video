export const projectAuthorContext = ({ programPlan, episodeId }) => {
  const episodeTitle = programPlan?.episodes?.find(item => item.episodeId === episodeId)?.episodeTitle;
  if (!episodeTitle) throw new Error("交叉对冲片头缺少正式本集标题");
  return { episodeTitle };
};
