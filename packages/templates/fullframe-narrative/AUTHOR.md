# 全画幅叙事

根据口播含义自由创作完整画面，构图、景别与运动服务观看。全画幅在整个实际运镜窗口持续运动，不能停镜；行程不足由作者联合调整构图、取景与路线。本模板拥有全画幅Beat的画面、实图、相机、转场、效果与解说框；章节组织共同创作，正式成果、媒体与局部修改仍归Beat。

根入口负责顺序、候选、锁和交接，专业判断归下列方法与组件：

| 使用时机 | 唯一职责与入口 |
|---|---|
| 联合设计 | [场面选择](references/scene-selection-method.md)决定画什么及A/B是否成立；[观看骨架](references/viewing-skeleton-method.md)落实逐图职责、来源和Cue |
| 联合设计 | [构图](references/picture-construction-method.md)安排完整画面；[相机](camera/design-method.md)安排观看路线与节奏；[共享转场](../../modules/render-video/references/narrative-transitions.md)按字幕选择叠化或闪黑并安排显露 |
| 首次写图纸 | [交付说明](references/picture-delivery-reference.md)形成唯一场面原文；人物造型按其链接进入人物方法 |
| 设计具体时期的人物、场所或器物 | 读取导演的[时代外观方法](../../modules/direct-episode/references/period-appearance-method.md)，消费已登记依据；缺少本图必要依据时沿[原来源入口](../../p3-sources.md)补查 |
| 选择动画效果 | [效果组件](effects/AUTHOR.md)负责效果、Cue与实图锚点 |
| 测量后、生图前 | [设计复核](references/picture-review-method.md)判断设计在实际取景与时窗中是否成立 |
| 取得实图 | [图片交付](../../authored-images.md)负责调用、导入与恢复；[实图落镜](camera/realization-method.md)负责表达、取景、节奏及定点修正 |
| 最终镜头成立后 | [解说框组件](callout/AUTHOR.md)负责三类判断、内容与引文预留，模板根绑定显示Cue后返回author-beat，由父Module完成后续编排 |

方法首次使用时完整读取；案例按当前难点读文并看图。完整保有且未变的材料与判断沿用，恢复只补缺失、新增和实际变化部分，不另写理解或验收报告。

## 输入与范围

完整读取`templateContext.episodeContext`的`cues / albumPlan / beats`及`currentPosition`，理解全片推进。有`inputs.authorBatch`时，读取全部成员局部输入，共同设计章内积累、转向与落点；单Beat修订参考`templateContext.paragraph.acceptedMembers`，只改当前范围。

同章前序画面由`templateContext.priorVisuals`提供，紧邻上一镜由`previousTreatment`提供。按播放顺序理解全部前序职责、场面、运动意图及入场设计，再按当前问题查看相关完整对象；长输出按单位分段，不截字段或只保留固定最近几拍。已持有同版参考时，可向任务视图原样传回`referenceDigests`作为`--reuse-references`；合读保有全文与本次新增内容，缺失原文则不传参数、重新取得完整视图。摘要不代替正文。

联合视图只省略同一输入副本：成员`authorUnitBeats`中的cues取本成员`inputs.cues`；缺省的`directionContext.albumPlan`取共享`episodeContext.albumPlan`；`priorCueIndex`中只列id的项取共享`episodeContext.cues`原文。不同文本和独有字段保留；材料缺失回原视图补齐，不凭索引补写。

章外只参考正式语义与导演意图，不读取其它章节实图或相机安排。共同参考不扩大本Beat的事实来源、Cue或写权。章首独立起镜，首图`cameraRelation=first`，不继承章外人物、道具末态或相机；章内连续性按交付与相机方法处理。

## 联合设计与测量

把本单所有成员的选场、图数、职责、源图、构图、Cue、运动、转场与效果放在同一次设计中调整。联合单先完成整章设计，再生图、落镜；程序逐Beat测量保存，不改变共同创作方式。各Beat保留自己的来源、窗口与结果，A/B各有画面与职责，不为求异改变成立选择。

按上表方法交付完整设计及画面、效果的`featureResults["cue-sync"]`。联合单在唯一`candidatePath`按所选成员顺序写`result.items=[{beatId,treatment,featureResults}]`；单Beat仍写`result.treatment / featureResults`，不把整章合成一个treatment。成员各自使用`AR001 / AR002`。可省略恒定`kind / required`，测量入口补齐`fullframe-image / true`，不覆盖显式值。

运行原测量入口：

```text
node packages/templates/fullframe-narrative/inspect-design.mjs <workOrderPath> <candidatePath> --save-feedback
node packages/templates/fullframe-narrative/inspect-design.mjs <workOrderPath> <candidatePath> --read-feedback <feedbackPath> --beat <Beat编号>
```

第一条测量当前候选并保存同次完整反馈，返回范围、失败及`feedbackPath`；第二条逐Beat读取，可重复`--beat`合读。首次设计须完整消费`inspectedBeatIds`中每个Beat的全部targets，包括局部修改带回的下一入场，再按设计复核方法判断。长输出按完整target分段，不重新测量来补打印；小结果可省略保存参数直接读stdout。

入口核对字段、来源、连续性、Cue和相机关系；`geometryPassed / cameraLockWritten`只证明可执行。`reviewAction=review-visible-composition`在生成前用于设计复核，生成后用于实图落实。生图前不锁最终镜头，不另开设计接纳。反馈绑定当前设计及前序接缝，变化后只重测实际影响；反馈不是第二候选。

测量或设计不成立时，按[相机失败归属](camera/design-method.md#测量不足时修什么)修正同一完整候选。修改观看任务时同步核对来源、Cue及实际影响；不删回骨架、不改阈值凑通过，也不绕开登记入口另取诊断。

## 实图与最终镜头

联合设计成立后，按图片交付入口一次prepare全部成员，依其[并发调用方法](../../authored-images.md#全画幅联合单的并发调用)提交当前无依赖的图片。需要前图的请求，在前图导入并查看后进入下一批；每张图直接导入所属Beat，保留其它已成结果。

按章内原Beat顺序执行实图落镜方法，落实已定表达、效果锚点、最终motion和相邻接缝。实图判断、动态片段的使用条件与返图处置均由该方法拥有，根入口不另排审图。当前范围全部镜头成立且最终相机锁有效后，再进入解说框。

## 解说框与Cue

执行解说框组件，完成三类判断、人物／术语内容与引文预留；引文由原quotes相位统一取证。模板根调用`cue-sync`，为实际框和预留引文绑定`show-callout`及真实`cueId + edge`。`target=<requestId>.callout.<索引>`，索引从0开始，如`AR002.callout.0`。

显示不早于所属画面可见起点，不改A起始或B进入边界。框沿组件固定生命周期独立显示，可跨Beat；重叠不顺延、截断或删框，框与Cue不反改画面相机。判断、内容及绑定一次写回同一候选，运行：

```text
node packages/templates/fullframe-narrative/lock-callouts.mjs <workOrderPath> <candidatePath>
```

入口核验Schema、Cue语义与时窗、组件结果及最终相机锁，联合单分别锁定成员。没有实际框也须交完整三类判断及原画面Cue；失败回实际责任方，不删应有内容凑容量。

## 局部修改与交付

直接修改同一完整候选，只修失败成员、叶图及实际依赖。接纳后的修改沿原正文返工入口，不重作整章；有效画面、框内容、Cue、查询回执及未变引文预留均保留。仅动作或语义时窗改变时重选Cue，可沿用`currentFeatureResults["cue-sync"]`中的未变绑定。

设计字段改变后重测以绑定当前结果，专业复核只覆盖影响：措辞核对含义与交付，来源核对支持关系，场面、构图、路线或时窗核对画面与接缝。`acceptanceCriteria`含义改变也须对照设计及来源；设计未变不重复测量。

联合单局部测量加`--beat <Beat编号>`，可重复指定；入口同时测量紧邻下一Beat的入场，其余成员不改写、不刷新锁。`--clip <Beat/AR编号>`只预览所属Beat，不与`--beat`并用，也不能代替接缝复核；单Beat单用`--clip <AR编号>`。局部ok只覆盖`inspectedBeatIds`，不能代替首次整章设计、实图落实或B2完整接纳。单Beat返工不扩大写权，依赖仍沿正式入口处理。

画面改变后核对原框的内容、锚点与时刻，仅改失效部分。最终设计或框结果改变时，用原`lock-callouts`确认完整结果；各入口允许保留已有框与`show-callout`，不要求删掉才能修图。

将同一候选的逐Beatitems或单Beat的`treatment + featureResults`返回`author-beat`，由父Module完成后续编排再进入B2。Preflight与Accept核对当前相机锁、框锁，失效回真实责任方；未变结果不重复反查。B2 Preflight失败即停，主代理接续Accept与status。
