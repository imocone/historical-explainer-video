---
name: author-beat
description: 在 Author 工位按已选 Template Package 的真实步骤依赖创作并反向复核正文正式结果；全画幅按章节联合创作并逐Beat交付，单Beat返工独立执行；连续讲解按templateRun整章只创作一次。需要把正式工作单交给所选正文模板创作、校验并形成候选稿时使用；不拥有任何模板专属方法，不重新选择模板，讲解的代码编排与所需素材制作沿所选模板执行，地图推演沿其专门方法。
---

# 正文作者模块

## 位置与单位

`author（each-author-unit）`调用本Module；`body-template`装配已选Template，`beat-feature`装配已启用Feature。

Module拥有编排、唯一候选和提交；节点只是执行位置。Director选择Template，Engine装配；只核对`authorUnit.templateId`与唯一实现一致，不重新选择。

讲解与全画幅统一以章节（`templateRun`／TR）派工、提交、接纳和统计正文进度，每章由一位全新独立上下文正文子代理负责，最多三章并行，不跨章复用作者。章内保留两种成果粒度：全画幅逐Beat保存`treatment`（`kind: beat`），讲解整章保存一份`treatment`（`kind: template-run`）。全画幅首次创作将同章多个待创作Beat签进同一单的`inputs.authorBatch.members`，共同设计和生图，一次提交逐Beat结果；没有该字段时沿原单Beat路线。只创作本单所选成员，局部返工不扩成整章重作。B2完成后交回主代理按章节接纳、刷新进度；本章成功接纳后结束使用本作者，下一章由主代理新建作者，具体调度见[Director的P3入口](../../../director/references/p3.md#正文按章节并行)。

## 先辨明本单任务

**正文返工。** `currentTreatment`提供当前正式设计，`currentFeatureResults`提供当前单位已有功能，`repairBeatIds`限定获准范围，`p3BodyRedesign.reason`交接修改意见。只处理对应当前单位的意见及实际依赖，保留原值中未受影响的画面、Cue和功能。同Beat只有某张图失败时保留其它合格图；连续讲解沿用整组上下文，不把所选Beat扩成整组重作。恢复已完成步骤的原结果，从实际失效步骤继续；只提交本单位这一份修订候选，其它单位不重验、不重新接纳。全画幅单Beat返工可参考`templateContext.paragraph`内的同章合格设计，但只写所选Beat；章节成员不是共同重作许可。

**仅修Feature。** 工作单用`repairFeatureIds`指定仅修功能时，在该功能的正式调用位置恢复指定功能及其真实依赖，沿用其它已交付结果，完成后进入B2；sound-effects直接按本Module声明位置恢复，不重新执行Template画面创作。候选只提交指定Feature结果，省略未改的`treatment`；原Preflight和Engine从工作单`currentTreatment`补齐完整设计。显式提交不同设计或未指定Feature仍会被拒绝。

**引文收口。** 正文单位全部接纳后，工作单`inputs.authorPhase=quotes`时，只执行`fullframe-narrative/callout/AUTHOR.md`的批量收口节，提交`{items}`。程序补齐真实回执与来源元数据，写入工作单允许的`authorQuotes`，随后进入B2；不执行B1、正文设计或Feature，不改已接纳正文。

引文恢复先读当前来源记录和候选，接续已完成取材。此相位只需本入口、引文方法和输出合同，进入B2再读提交说明。预留引文未全部收口前，正文计数已满不代表P3完成。

## 入口前提

被派为正文作者时，本任务是执行已有Module与所选Template，不是创建或维护Skill；直接从本入口和下面的正式任务视图进入，不重新执行主代理的Understanding、Visual Director及领单调度节点。作者仍须按本单完整理解口播、语义、导演方向和模板要求的全片语境，再自主完成创作。

每单取得当前正式任务视图：首次或恢复运行`node packages/p3-task-view.mjs <workOrderPath>`；主代理已交付同一当前工作单的完整视图时直接消费，不重复调用。只从`status`、该视图和`candidatePath`建立现场：联合单逐成员读取其`inputs`，单Beat单读取当前单位；分别取得各自cues、按cue投递的语义、导演方向、相邻输入和来源；核对`taskDigest / allowedWrite / outputContract`、装配与Schema。全画幅作者先按模板方法完整理解`templateContext.episodeContext`中的正式全片口播和导演安排，再消费当前单位及`priorVisuals`的同章已成画面、运动意图和转场；已完整读取且未变化的全片语境不重复加载。其他模板按各自输入方法执行。参考范围不扩大当前单位内容写权。来源只用本单C、投递F/R/E或合法SA；越界失败。

引文相位的视图只展开参考视频身份、来源和定位。其全文与分段仍在同一当前`workOrderPath`的`inputs.referenceVideos`；按视图中的视频ID和引文方法分批读取这些已绑定材料，不打印整份工作单，不另读旧单或用磁盘新版本替换已绑定正文。此读取不改变任务输入、写入边界或正式来源身份。

任务视图的`resolvedRules / outputContract`只列现行原文件路径和摘要。新作者首次使用、摘要变化或当前上下文已不含完整规则时，按路径完整读取；同章已完整读取且未变化的规则和Schema沿用，不逐Beat重读，不把其它作者已读过当作自己已掌握。不能只凭路径、标题或压缩摘要执行尚未掌握的方法。根入口点名的方法或包内组件到第一个消费步骤再完整读取，不批量打开全部方法、Validator或源码。Template和Feature中对规则／方法的“完整读取”均按本段执行；当前工作单业务输入仍每单读取。不得用记忆、旧故事板、其它候选、备份或历史会话补写。输入、装配或交付边界不一致时停止或返回真实上游。

文件读取或正式视图命令已成功完成且无警告时，可以省略终端工具外层的耗时、chunk等包装，返回完整stdout正文及其中的业务结果。此精简不裁剪业务JSON字段，也不改变图片、音视频、测量、卡点、预演或生图工具的原交付；输入身份、来源、预算、素材路径、远端任务编号和状态按原合同保留。命令失败、仍在运行或带警告时，保留退出状态、会话／进程标识及完整警告和错误。按单次函数返回的合计量分批，合计量包括同次全部工具结果；长文按连续行段取得完整正文。遇到截断只补实际缺失行段，不重新打印已完整持有的整份文件；不以省输出为由漏掉尚未读取的方法、合同或业务输入。

## 正文创作路线

```text
B1 执行当前唯一Template；画面形成后按开关执行独立音效Feature
→ B2 汇总、核对、提交
→ 主代理串行接纳，结束使用本章作者，为下一章新建作者
```

B是Module父路线，Template根拥有画面子步骤及步内动作；原cue-sync仍在Template声明位置调用。独立音效由本Module在画面交付后调用，完成后回到B2。

已装配`sound-effects`时，先按当前Template完成原有画面创作、预演与复看，取得可用画面、原声窗口和Cue，再由同一执行者进入该Feature的AUTHOR.md，按本章完整推进设计声音、制作并返回B2。音乐收放意图随原声音结果交给background-music解析，选曲仍归原输入；选声与卡点不归Template，也不另派作者。只返工音效时以原画面为只读输入，直接进入Feature；声音失败只修声音，保留有效画面及其锁。未装配时跳过该包规则、制声、结果要求和音效轨。

所选Feature的只读专业参考随原任务视图的`featureContexts`投递，联合单共享顶层参考；到该Feature调用位置按其方法消费。原预演播放旁白、实际已选BGM和当前声音，供用户查看与听；不新增联合试听或听审通过步骤，不宣称执行者已完成听感验收。BGM选择不归音效包。

## B1：完成画面后调用独立音效

只执行当前装配的Template：

- `fullframe-narrative`按模板根共同设计所选章内各Beat的画面与相机，逐Beat测量、复核及完成解说框；每个Beat保留独立`treatment`及`cue-sync`结果。画面完成返回本Module后，对联合单全部获准成员一起进入已装配的音效包，先设计章内听觉推进，再把结果写回对应item；不得逐Beat独立选声后机械拼接。单Beat返工结合所投递章节语境，只修本Beat的声音。全部获准成员交齐后进入B2。
- `vox-explainer`对整个`template-run`执行所选模板根入口的步骤、预演、复看及Cue调用，完成后返回本Module；对整个讲解章进入已装配的音效包一次，交一份整章音效，再进入B2，不按moment另建交付。

其它Template按自己的根入口执行。本Module不复制专业方法；未装配Feature不执行，每个交付单位的每个已装配Feature只保留一份最终`featureResults.<featureId>`，联合单写在对应Beat的item内。

Template必须把`viewerOutcome / mustShow`及`albumPlan / roleInAlbum / relationFromPrevious / relevantRecurringElements`落实到自己的现有结果；语义承接不自动建立同场景、人物、道具或相机连续性，也不复制Director字段。

两种正文模板均可按各自方法沿正式来源入口补查；由程序追加原来源清单，刷新任务视图后消费，保留原工作单与候选。联合单各成员共用视图顶层的`inputs.sourceAssets`，不能沿用签发单内的旧来源副本漏掉本次追加。

本单作者按当前工作单事实、Director观看任务和同章真实相邻结果完整形成正式字段、Cue、坐标、相机、提示词与连续性。需要改变前置结果时，由Template修正实际失效内容并确认当前结果，保留仍有效的后续内容。

按Template根的交付边界原子写回同一`candidatePath`；联合创作的内部编号不要求分次落盘或响应。作者源码、图件与构建可在本单`scratchPath`中迭代，正式候选保持唯一。上一镜参考、测量与卡点结果必须先读再创作依赖字段。脚本执行作者已设计的绘制、动画、计算和序列化，不代替作者形成或批量补写语义与设计。

只在Template根指定的位置调用原`cue-options.mjs`，按模板方法传入已成稿的候选，并整体消费结果；全画幅只消费`templateContext.cueOptions`。动作集合、调用点和失败返回由Template拥有，`cue-sync`只形成绑定。

子流程未完成留在B1；完成后每个交付单位只有一份合法`treatment`及每个已装配Feature的一份结果。联合单在同一候选使用`result.items=[{beatId,treatment,featureResults?}]`，成员与顺序须完整对应工作单，不另建逐Beat候选。

## B2：汇总、核对并提交

最终候选保留当前`taskDigest`，`result`封装本单结果原值：全画幅联合单使用上述逐Beat`{items}`，其它正文任务使用B1的`treatment / featureResults?`；仅修Feature只使用指定`featureResults`；引文收口使用`{items}`。

无Feature时省略`featureResults`。问题返回实际拥有它的Template／Feature步骤，不得只贴着Validator点名字段修改；B2不得新增开放内容。成立后保持失败即停地串联：

完整读取[单次交付与接纳](references/submit-sequence.md)，运行本包原B2入口。程序只执行本单Preflight并返回交付路径；正文子代理交回后，由主代理沿原Engine串行Accept和Status。引文收口仍由主代理执行同一B2与接纳链。子代理的写入范围保持在本单候选和素材。
Preflight整理已选Cue的机械顺序，原合同通过才写回候选；它与Accept核对正式候选及Template/Feature合同。联合单逐Beat核对来源、Cue和锁，完整通过后按章节原子接纳，分别保存各Beat独立成果；失败时保留候选与已成图片，修正实际失败项。候选首次创建后按实际步骤局部补写，不重复输出完整工作单、候选或读写脚本。

本作者只处理所分配章节。未接纳时，按主代理交回的具体问题沿原单修正并重新提交；成功接纳后不再领取下一章。原作者不可用时，由主代理确认其停止写入，再让新独立上下文作者接续本章原单、候选及有效成果，不重签或重做。其它节点交回Director，不预写或跨阶段。

不得用分号或无条件换行越过失败。合法上游缺口改用互斥的`candidate.returnTo`，只从`allowedReturnTargets`选择真实节点并写`reason / cueRefs`，不运行结果Preflight；系统或工具故障时停止。

## 边界

- 不拥有Template方法，不选择Template，不改Beat或`templateRun`。
- 不选择或自行重抄Visual Package。vox-explainer的普通讲解沿本模板方法用代码与组件编排全动效，按需配合生图素材；地图推演及其图片沿本模板的专门方法制作。讲解作者在同一候选完成画面、必要素材和动作设计；其它模板保持各自媒体边界。人物、内容、布局和关系归当前任务与Template。
- 不手写服务商、模型、状态、技术参数或`_producer`；讲解图片入口回填的真实文件与来源随候选保留。
