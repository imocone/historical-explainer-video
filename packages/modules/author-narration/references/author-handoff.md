# 作者结果的确定性交接

供两个P1作者包在既有成稿与事实处理步骤使用。AI负责提示、创作与判断；程序负责原文提取、确定字段、现有机械校验和已有工作文件。命令从项目根执行，`<单>`为当前工作单绝对路径，`<路>`为1至3。程序只按既定参数调用AGY并交接原回包，不补稿、不自动重试、不接纳。

## 三路首稿

普通三路首稿先按外部CLI规则查模型，把同一固定提示保存到本单材料目录，再并发执行三路：

```bash
node packages/modules/author-narration/scripts/author-handoff.mjs call <单> <路> <提示文件绝对路径>
```

三路首稿的`call`完成start、进程身份保存、[实时接收](#实时接收)与正常结果receive。每路只提交一次。已有记录返回`recover-existing-call`，需要核对时返回`inspect-call-result`。执行者保存外层终端句柄，按[原调用恢复](#原调用恢复)接着收取。

## 实时接收

已获准重试、补写、纠错或定点创作时，把原提示保存到本单材料目录，用同一`call`。回包路径优先使用已有进度给出的路径，其它单路调用在本单材料目录使用该次调用唯一的`.agy.json`路径。新作者省略末尾会话参数，续写使用固定原会话ID。

```bash
node packages/modules/author-narration/scripts/author-handoff.mjs call <单> <回包绝对路径> <提示文件绝对路径> [--conversation <原作者ID>]
```

路径已有回包或同一作者会话已有调用在运行时，恢复原调用。新发起后保存外层终端句柄。有路号的重试、补写或纠错，取得`call`报告的AGY PID后按原进度登记：

```bash
node packages/modules/author-narration/scripts/author-handoff.mjs session <单> <路> pid:<AGY进程号>
```

`call`持续接收AGY输出，每约60秒报告当前进度，最终回包一到就原样保存其中的`result`对象。原文字段与报错保留在同一回包。只有片段时，已收到的文字保存在同名`.partial.txt`，可供审阅。实际退出码、stderr和有文字可读的`reviewPath`随调用结果返回。路号模式自动交接首稿。回包路径模式用该步骤的既有交接动作，传入原始回包、实际退出码，命令末尾带`--recover-503 <本次原提示文件绝对路径>`，由程序决定是否需要核对503。以收取首稿为例：

```bash
node packages/modules/author-narration/scripts/author-handoff.mjs receive <单> <路> <原始回包绝对路径> <实际退出码> --recover-503 <原提示文件绝对路径>
```

### 原调用恢复

原调用仍在运行时，用保存的终端句柄查看同一个`call`的进度与已收到的文字。只有`pid:`时核对同一进程及原文件，必要时只读查看该进程的AGY会话记录。60分钟是本地等待上限。执行者看到成稿可先取回审阅。`call`在退出记录首行保存实际状态，空记录表示还未确认退出。实时输出出现会话冲突等异常时，退出记录同时保存原因，原文留供审阅。

进程已退出时，读取本路原`receiptPath`及对应stderr，核对实际退出码。完整成功回包用原入口收取，封装中断只重收同一回包。`recover-existing-call`表示已有记录。P1新调用的60分钟是本地等待上限，已发起的请求沿启动时的上限等待。超时或原回包不完整时保留原文件、退出状态及已有conversation_id。AGY退出码为3且原回包标记`finished_reason: print_timeout`时，可只读打开同一conversation_id核对该轮是否已中断。确认该轮已中断且未返回完整稿时按明确失败处理，无法确认结束时保持结果未知。`agy -p ... --conversation <ID>`会发出新一轮请求。恢复使用原记录及实际退出码。

遇到503，先取回`reviewPath`或同一会话已写出的回复，区分已有片段和完整成稿。正式收稿时，普通`call`自动核对；原`receive`、`candidate`、`publication`、`package-receive`和`correct`均用同一判断，可在末尾加`--recover-503 <本次原提示文件绝对路径>`。程序核对实际退出码、原stderr、原提示、容量报错和本轮完整原文，再运行该动作已有的交付校验。读取证据失败、退出异常、终止错误或出现权限诊断时，把可读原文交回审阅并核实状态。误标failed且仍未交稿的首稿也可恢复。

### 原回包收取与完整交付

程序提取`conversation_id`及约定的完整结果，补齐当前工作单中的确定字段，运行现有Schema、Module和片头Validator；解说首稿只收正文和片头；平台文案与封面构思在选稿后校验。同一完整稿在response中逐字重复时只解析该稿，原回包保留；重复段有任何内容差异则停止。结果原子保存并标received；重复收取同一返回保持原文，首稿result之后不改写。解析歧义、调用未知或校验失败均保留现场，不自动重投。执行者区分封装问题、明确作者机械失败、内容任务冲突与未知结果；明确技术失败才用`mark <单> <路> failed <具体原因>`记录，内容不成立由选稿判断。其它外包装只可辨认边界，不改稿，不把解析限制当作事实错误。

解说首稿的成功回包如果拼入使用工具前的过程说明，沿上述带本次原提示的`receive`命令收取同一回包。程序只在原stderr为空、本次原提示相同、原生会话的工具前言和最终答复逐字合成原回包时，取同轮最终答复交接；原回包保留。

三路分别保存在`scratchPath/author-1.json`至`author-3.json`，不轮流覆盖唯一候选或根作者身份。首稿`result`与作者ID只从原回包保存；未收到时为null，`factErrors`在所选稿事实处理前为null。明确失败记录failure，继续接收其余已发起结果，不自动补开新作者；未知不能标failed跳过。解说必须三路均为received才交回作者包判断整稿并择优，任一路failed均保留现场并报告三稿未齐，不从剩余稿中选择。用户明确授权后的解说单路重试只按下节执行。纪录片仍在三路均为received或明确failed、至少一稿可交付后交回原作者包选择。

### 用户授权后的解说单路重试

三路原调用均已结束、尚未选稿，且某一路明确失败、没有交付首稿时，只有用户明确授权重试该路才执行：

```bash
node packages/modules/author-narration/scripts/author-handoff.mjs retry <单> <路> --authorize-retry
```

程序在该路原记录中保留失败原因、进度及旧回包路径，返回独立的新`receiptPath`。只有`started:true`才用[同一个call](#实时接收)向新会话提交同输入，原样交清本次机械失败原因。用session和receive交接，重复retry或start只恢复原重试。已收到的其它稿件保留，未知、在途、已选稿或事实处理失败不适用。重试再次失败须停止，新重试仍需新的明确授权。接纳收口保留有原文的错误回包；当前材料尝试有单路重试时，同时保留三稿、失败记录、作者原始回包和被引用的章节修复回包。

用户明确弃用重试并取回原稿时，在重试本地进程结束、尚未选稿的同一工作单执行`receive <单> <路> <原回包> <退出码> --use-original --recover-503 <原提示文件>`。根据原提示与原回包逐字定位会话中的原轮次，仍须证明503之后已完整交稿，且通过原首稿校验。保留原始回包、重试回包和重试进度。原稿仍以本次首稿结果合同为准。

## 锁定整稿

作者包已选择成立的同一路完整作品后执行：

```bash
node packages/modules/author-narration/scripts/author-handoff.mjs select <单> <路>
```

程序核对三路初始调用已结束、作者会话互不相同且所选稿未审事实；解说还须三路均已完整交付。先在所选工作稿的`selectedOpener`保存同一路号，再将原作者ID写入`agy-conversation-id.txt`、完整result原样写入唯一候选。首稿result保持不变；这只交接AI已经作出的选择，不评判作品、不accept。

选定后进入发布续写。写入中断且仍在选稿阶段时，只用同一路`select`恢复。发布续写或事实核对已经开始时，按当前进度恢复。

## 选中作者补写发布内容

普通／full按[发布内容作者方法](publication-author.md)准备输入，再执行：

```bash
node packages/modules/author-narration/scripts/author-handoff.mjs package-start <单> <路>
node packages/modules/author-narration/scripts/author-handoff.mjs call <单> <上一步给出的回包绝对路径> <本次发布提示文件绝对路径> --conversation <所选作者原会话ID>
node packages/modules/author-narration/scripts/author-handoff.mjs package-receive <单> <同一回包绝对路径> <实际退出码> --recover-503 <同一提示文件绝对路径>
```

首次进入`packaging`时，用返回的回包路径发起调用，并用`session`记录句柄。在发出调用之前中断时，确认尚未发出后仍用这一回包路径首次调用。已有调用则恢复同一次。解说收稿核对同一路的原回包、原作者会话及锁定口播，合入publication，首稿`result`保持原样。候选已写而进度未更新时，用同一回包恢复；三平台文案与双封面构思交齐并进入`packaged`后才做事实核对。发布续写明确失败时保留原回包和锁定口播并报告，未知只恢复原调用。解说原会话已确认无法续接时保留锁定稿并报告。

解说发布回包仅有YouTube章节定位错误且用户同意定点修正时，原作者只回`chapterIndex`和`startText`，索引从0计数，定位摘自锁定正文的连续原字。给`package-receive`在`--recover-503`前加`--chapter-location <修复回包> <实际退出码> <修复提示文件>`；只调整这一处定位并按原合同收稿。

正文与片头定点返工先用candidate接收正文与片头，再用`publication <单> <原始回包> <实际退出码>`接收原会话补写的publication。仅改正文且发布内容原样保留时，作者只返回本次实际创作字段JSON，例如`{"narration":"完整新正文"}`；`candidate <单> <回包> <退出码> --reuse-publication`从工作单继承未返回的片头及完整publication，无需作者重抄或发布续写。片头改动仍由作者交付；用户锁定原句由程序继承。只修改发布内容时，candidate直接接收publication JSON并继承工作单锁定的正文、片头。

## 选中稿的事实处理

只对选定稿使用下列命令维护现有进度：

```bash
node packages/modules/author-narration/scripts/author-handoff.mjs mark <单> <路> reviewing
node packages/modules/author-narration/scripts/author-handoff.mjs mark <单> <路> ready <实际事实清单JSON路径>
node packages/modules/author-narration/scripts/author-handoff.mjs mark <单> <路> correcting <实际事实清单JSON路径>
```

事实清单是AI本次判断的数组，保存到当前`scratchPath/fact-errors.json`。无错误使用空数组并标ready，有错误用完整清单标correcting。原作者读取同一清单，保留到本次接纳收口。已有清单直接恢复，重复传参只接受同一内容，不能换写、清空或补建丢失的原清单，不重做整套核对；纠错后的原错误确认按[共享方法](publication-author.md#纠错后的原错误确认)执行。首次进入correcting时程序清空旧终端句柄，取得纠错调用的新句柄后仍用session命令记录；已有correcting只恢复原调用。

Codex在每项错误中写明正确事实及最短依据，并在`places`登记各处`{id,path,before}`。id为全清单唯一的正整数，path定位当前候选的正文、片头或发布文本，before从该字段逐字取能唯一定位的最小片段。同句需要一起改的错处登记为同一个片段，各片段不重叠。删除数组项时登记该项全文。同一错误涉及获准同时修改的YouTube简介与小红书正文，且共用正文逐字一致时，在错误项上标记`sharedDescription: true`，只登记YouTube简介的原句。

原作者只交各编号的替换文字。收稿程序从事实清单取路径及原文，按原候选定位并应用修改，同步共用文案，回执列出实际改动的原文与替换文字供确认。

同一次回包后执行：

```bash
node packages/modules/author-narration/scripts/author-handoff.mjs correct <单> <原始回包绝对路径> <实际退出码>
```

程序把精确片段应用到原候选，其余字节不变，返回实际edits供原错误确认；普通／full同时保存所选工作稿ready进度，保留首次result和事实清单，定点不写三路进度。解说沿用现有机械检查；纪录片纠错仅原样封装，不独立重复机械复验，正式accept仍执行原合同。普通／full的ready只表示机械交接完成；各路线有原错误时，执行者按[共享方法](publication-author.md#纠错后的原错误确认)完成窄范围确认后才accept。写入中断只恢复同一次回包和原清单；明确调用失败时，普通／full用原mark保存failed与原因，定点保留原回执和候选并报告停止，不写三路进度。未知仍只恢复原调用，不能冒充明确失败跳过。

## 定点返工

定点返工不创建三路工作稿。有事实错误时，在发起纠错前将本次完整清单保存到当前scratchPath/fact-errors.json；本单未归入三路factErrors，故该纠错输入须保留到正式接纳收口，恢复时只消费原清单，不当作正式报告。历史解说`narration`首次创作开启新会话；`opener`、发布内容修订及纪录片定点返工通常从工作单`reusedNarrationMaterials.agyConversation`取得固定作者，材料或身份缺失、摘要不符时停止。成片清理后由Engine签发的仅平台字段`publication-copy`单没有`reusedNarrationMaterials`时，只读本单现行正式稿与publication，以新的单路AGY处理本次字段；已有本单回包或会话时恢复本次作者，不再新开。其它材料缺失不适用此分支。已结束但会话失效时按下节重建，未知调用仍只恢复原对象。

首次返回使用`candidate <单> <原始回包绝对路径> <实际退出码>`。历史解说正文重写由程序把固定来源原样复制到本次材料目录，保留本次`author-task.md`并从回包写入新作者ID；后续发布续写和correct使用本次`scratchPath/agy-conversation-id.txt`，不得找回工作单中的旧作者。重复收取恢复同一返回，不另开会话。完整正文、片头及发布内容按上节交接，再进入一次事实核对。用户指定片头原句逐字保留，正文衔接由本次作者完成，程序不自动补回旧正文。

用户明确要求从已接纳交付恢复所选原稿、重新做最小纠错时，用既有正文返工单锁定该原稿片头。只读本单材料路径中保留的所选首稿与其定稿发布内容，以这套原稿为唯一底稿，保存本次硬伤清单并续接所选原作者。用`correct <单> <原始回包> <退出码> --restore-selected-draft <原路号>`交接。程序核对固定材料、原稿、原回包、作者与锁定片头，将本次短替换应用于原稿，保留作者任务和留存首稿，再走原接纳。该用法只适用于明确授权、已经接纳且仍留存的所选原稿。

定点返工只消费工作单固定材料，不调用`prepare-reference`。该命令仅供解说普通／full按[直接读取正文](explainer-evidence-and-query.md#直接读取正文)保存或追加同一`reference-materials.json`；返工仅为书目核读补入的原文，按[发布输入方法](publication-author.md#原文保存与固定正文)保存在本次`publication-input.md`，不改正文材料身份。

## 已结束但失效的作者会话

仅原调用已结束、已确认原会话无法续接，且当前稿、固定材料、事实清单和修改范围齐全时使用。解说普通／full的发布续写只由所选原作者完成，原会话无法续接时保留锁定稿并报告。

```bash
node packages/modules/author-narration/scripts/author-handoff.mjs rebuild-context <单> <具体失效原因> --previous-ended
```

完整读取返回的author-recovery.md，连同本次固定创作／续写／纠错提示交给一个新会话；它继续同一任务，不重选稿、不重取材、不重置一审一修。调用前保存本次提示，发起后保存终端句柄和原始回包，后续只恢复同一次。重复命令不批准再开会话。用原candidate／publication／package-receive／correct入口收取，程序核对恢复记录并绑定实际新作者；正式接纳时沿原材料目录保存新身份及原身份溯源。缺材料、明确创作失败、原调用仍在途或远端未知均不适用，不能借重建增加纠错次数。
