# P4纪录片回忆片头

## 路线

```text
DO1 从已完成正文画面选出五张回忆画面并新设计末景 → 自带生图交付末景 → 交付author-bookend H2
```

### DO1：选择本集画面并形成唯一候选

先完整读取工作单P1正式`openerNarration`、已完成正文`bodyStoryboard`、Understanding、`directionContext`、`templateContext`及已有来源资产，再执行[回忆片头方法](references/documentary-cold-open-standard.md)。以P1原句和正式本集标题为创作约束，不改写；正文已有实际图片，结合实图、画面描述与请求，选择五张最应景且适合迎面推进的完整场景，形成`memoryShots`。选择的是已完成图纸中的具体`bodyRefs + requestId`，不是按Beat号随机抽样或另写五张生图提示；未被剧情视频覆盖时，P4使用这些原请求的P3图片交付；被覆盖时，P4使用正式视频在原请求出现Cue上的定格，不补生该正文图。

整集进入方向帮助组织回忆的情绪与顺序。每项选择写出简短`selectionReason`并给出可见主体附近的归一化`focus`。末景`hero`不得选择、复制或改写P3现有图片请求，必须根据`templateContext.openerWorldContext`和本集内容新设计一张鸟瞰或俯视的节目世界全景，并填写`framing: wide / panorama`。

`hero`保存`id: D06`，并填写`visualBrief`、支持该设计的`bodyRefs / sourceRefs`、`mustNotInvent`、`focus`、`framing`和`selectionReason`；不得填写正文图片`requestId`。每一期都结合节目正式世界设定与本集生活重新自由选择鸟瞰位置、观看角度和画面构图，不按集数或固定序列套用方案，也不复用历集设计或成图。`visualBrief`完整交代主体、动作或状态、环境、可见结果和本期构图；地点、时代、城市或空间身份必须来自`openerWorldContext`及本集已定内容，具体形制、人物关系和事件必须有来源支持。选定Visual的画风由正常生产链注入。不得使用内置图、其它节目图或历集图片。D06只写入同一片头候选，按[作者图片交付](../../authored-images.md)由本作者使用自带生图生成一次，实际交付写入 `hero.asset`。

前五图不足仍报告当前正文图纸不足，不复制图片凑数，不以末景新增分支扩成重新生成五张。

完成条件：五张回忆图均有唯一可追溯的正文请求引用，所选图不重复、没有讲解卡片或脱离场景的图表；D06是依据节目正式世界设定为本期重新设计的鸟瞰全景，来源和不可补造项齐备。D06已在本候选交付实图；P4按原引用使用正文图片或视频定格及新增全景交付，作者保留正文实图，不改正文。

## 交付条件

按本模板业务方法、Schema和正反例核对同一候选，包含原文与标题、五图引用及职责、D06的新设计与来源禁造边界；发现问题在DO1修正。作者只需交付`templateId / memoryShots / hero`，程序从正式`templateContext.episodeTitle`补齐`episodeTitle`；渲染器从正式seriesTitle读取明确原典名（如有），居中溶现后单次切换至本集标题；不显示节目名或集数，作者不另拟这些名称、季号或副标题，不向候选增添字段。排版和动画由模板确定。成立后交回`author-bookend` H2核对交付边界并提交，Template不取得提交权。P1原句只作为本集进入观察与选图输入，不重复写入输出；本模板不生成TTS、不播放旁白，P4不改这句文字。
