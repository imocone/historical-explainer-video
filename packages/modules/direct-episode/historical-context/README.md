# 历史视觉考据组件

所属责任方：`direct-episode`。把故事的时期、地域、人物和活动转成作者能用的样貌、衣装、环境依据。导演根调用本组件完成考据步骤，组件不划章节、不切Beat、不设计构图，也不替下游生图。

## 输入、产出和消费者

| 边界 | 实际内容 |
|---|---|
| 输入 | 当前导演工作单、完整Cue与Understanding、已保存的章节候选、现有来源资产；缺口所需的实际原文和原图 |
| AI工作 | 按[研究方法](research-method.md)确定所画事件的时空和人物年龄，寻找并看本人原图，分别选择衣装与环境依据，写清支持范围及合理复原 |
| 程序工作 | `publish`解析材料引用、复用已有SA并登记原件与资料；`bind`将资料按Cue交集绑定到同一导演候选 |
| 稳定结果 | 原`制作/input/source-assets.yaml`中的材料和历史视觉资料；原`directorBrief.mustShow`中的对应范围与来源提示 |
| 第一消费者 | 导演后续Beat与观看要求设计，随后是原任务视图投递的正文作者；作者使用见[共同方法](../references/period-appearance-method.md) |
| 失败 | 材料缺失、引用／权利无效、当前任务变化、Cue或修订范围不符，在候选写入前报告具体对象；保留现场，由导演根修复输入或恢复原件 |

## 执行

先完整读取[研究方法](research-method.md)，只研究本次实际入画的对象，取得并查看必要原件。没有需要时代复原的对象时，直接进入导演后续设计。

在当前工作单的`scratchPath`中保存唯一`historical-context/research.json`，仅存本次AI已经作出的研究选择及已取得材料。每次publish都交付本单可写范围的完整研究快照：首次形成完整批次；后续只调查和修改实际缺口，保留其它有效contexts与材料，已有材料用sourceAssetId复用，不把一条增量当完整资料覆盖。恢复时研究输入缺失，可从候选引用的资料正文恢复本单可写范围及原材料引用，无须重查。原图与事实笔记分别登记，笔记的使用权不能替原图放行。

```sh
node packages/modules/direct-episode/historical-context/handoff.mjs publish <workOrderPath> <scratchPath>/historical-context/research.json
```

返回`source`是本次完整资料的SA、路径和摘要；`contexts`与`sourceAssets`为实际登记结果，材料key已被解析成SA。程序从当前scratch登记资料，供正式消费者读取的原件和资料都在本集来源库。重放同一研究输入复用原件和资料SA，中断时沿已登记项继续。

接着绑定同一导演候选：

```sh
node packages/modules/direct-episode/historical-context/handoff.mjs bind <workOrderPath> <返回的资料SA>
node packages/p3-task-view.mjs <workOrderPath>
```

`bind <工作单> <新资料SA>`将本次完整资料分配到工作单可写范围。已分配过资料的导演候选，在拆合镜头、调整范围或恢复时，保留涉及的`【历史视觉依据 SA…】`行，运行`bind <工作单>`。程序沿候选已分配的所有有效资料重算Cue交集，不因某个章节用了新资料而清掉其它章的依据。提示中的「适用Cue」用来找到资料里对应的context，分配只覆盖其中一部分时另标「分配Cue」。作者按实际分配范围读取资料正文和原件。

有正式字幕重分任务时，程序对照旧、新字幕的正文位置。正文相同就重算Cue范围，复用原件，并按需登记更新了范围的资料。多个语境合进同一条字幕后，资料保留各自对应的文字位置，后续再次拆分仍能分开。文字确实改动时，导演核对受影响的依据，再交接新的研究结果。

局部返工的publish只接受工作单`returnRequest.cueRefs`内的新研究；bind可复用已有整集资料，只读取与可写Cue相交的context及其依据，只更新可写Beat，保留其它页面及其既有依据。修改研究时重新publish，再用新SA绑定；旧来源保留，不覆盖已有图片或其它章的资料。候选变化后原规划与封存按既有摘要合同失效，由导演根在原步骤重算；本组件不操作锁、不取得封存或接纳权。

## 研究输入

机器合同见[research.schema.json](research.schema.json)。字段只承载组件当前需要的选择，不是公开导演结果Schema，也没有“已审查”等自证字段。

- `taskDigest`来自当前工作单；`title`说明本批资料内容。
- `materials`每项用一个本批`key`，引用已有`sourceAssetId`，或提供scratch内`file`及原来源的`mediaType / sourceCitation / creator / date / rightsStatus / usageNotes`。相对文件路径相对research.json。`usageNotes`绑定原图对象、时期、可参考部位与限制。
- `contexts`按实际描绘事件的`cueRange`组织，写`period / place / occasion`及整体`limits`。同一章可有多个时期，不按章号或人名猜时间。
- `people`按实际需要辨认的人物或人群写`subject / ageAndRole`；`likeness`与`clothing`分别写`features / evidence / limits`。`evidence`是materials的key；程序解析为SA。`likeness.basis`选择`portrait / photo / later-depiction / text-description / reconstruction / group`。前面三项选择了图像依据，必须真的提供原图文件；没有本人图像时，在limits说明查过的来源和复原范围，不虚构“无存世画像”。普通群众用group，不逐人查脸。
- `environment`按实际场所、器物或结构写`subject / features / evidence / limits`。图片和文献都可支持形制；无确切现场时区分同类参照与空间复原。
- 没有证据的某项可用空`evidence`并说明限制，程序不伪造来源。整体纯抽象时可以不调用组件；需要调用的既有恢复输入可用空contexts和`notApplicableReason`，程序不登记空资料。

同一人物跨章共享适用原件，跨年龄和身份分别写context；画像、活动衣装和环境各自引用实际支持它的材料，不能因同处一个context就互相代替。具体判断见研究方法，字段约束见Schema。

## 恢复与失败

有研究输入而尚无资料SA时重放publish。新资料已登记且尚未分配时带该SA运行bind，已经分配时按候选提示复用。原件缺失、内容或元数据变化由原来源责任方恢复；输入或范围不符回导演根核对。资料有误只修实际缺口，再publish、bind，保留有效原件与范围外依据。图纸正确而成图失真交原作者定点修图。

检索、读史料、看原图与适用性判断由AI完成；程序只保真登记和分配，不自记质量通过、不抓网页或调用付费服务。下游按[作者使用方法](../references/period-appearance-method.md)落实图纸、实际传图并对照成图。
