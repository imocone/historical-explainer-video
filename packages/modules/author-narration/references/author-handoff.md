# 作者结果的确定性交接

供两个P1作者包在既有成稿与事实处理步骤使用。AI负责提示、创作与判断；程序负责原文提取、确定字段、现有机械校验和已有工作文件。命令从项目根执行，`<单>`为当前工作单绝对路径，`<路>`为1至3。程序不调用AGY、不补稿、不自动重试、不接纳。

## 三路首稿

每路首次请求前执行：

```bash
node packages/modules/author-narration/scripts/author-handoff.mjs start <单> <路>
```

仅`started:true`表示首次建立writing记录；已有记录只恢复原调用，不再次发起。将AGY原始stdout直接重定向到返回的`receiptPath`，stderr保存在同一本单目录；不要把response经过模型转写。按原包要求先发起三路互不相同的空白会话，再等待各自完整退出。解说每路一次返回“片头、正文、发布内容”三段，发布内容为完整publication JSON；纪录片每路仍返回片头与正文。取得终端会话后立即执行：

```bash
node packages/modules/author-narration/scripts/author-handoff.mjs session <单> <路> <终端sessionId>
```

执行者确认进程正常退出、JSON可解析、status=SUCCESS、response非空，且stderr没有未预期权限软拒绝后，传入原始JSON路径和实际退出码：

```bash
node packages/modules/author-narration/scripts/author-handoff.mjs receive <单> <路> <原始回包绝对路径> <实际退出码>
```

程序提取`conversation_id`及约定的完整结果，补齐当前工作单中的确定字段，运行现有Schema、Module和片头Validator；解说首稿同时执行完整publication合同，不能缺平台或画幅构思，纪录片首稿仍不要求publication。同一完整稿在response中逐字重复时只解析该稿，原回包保留；重复段有任何内容差异则停止。结果原子保存并标received；重复收取同一返回保持原文，首稿result之后不改写。解析歧义、调用未知或校验失败均保留现场，不自动重投。执行者区分封装问题、明确作者机械失败、内容任务冲突与未知结果；明确技术失败才用`mark <单> <路> failed <具体原因>`记录，内容不成立由选稿判断。其它外包装只可辨认边界，不改稿，不把解析限制当作事实错误。

三路分别保存在`scratchPath/author-1.json`至`author-3.json`，不轮流覆盖唯一候选或根作者身份。首稿`result`与作者ID只从原回包保存；未收到时为null，`factErrors`在所选稿事实处理前为null。明确失败记录failure，继续接收其余已发起结果，不自动补开新作者；未知不能标failed跳过。解说必须三路均为received才交回作者包判断整稿并择优，任一路failed均保留现场并报告三稿未齐，不从剩余稿中选择。用户明确授权后的解说单路重试只按下节执行。纪录片仍在三路均为received或明确failed、至少一稿可交付后交回原作者包选择。

### 用户授权后的解说单路重试

三路原调用均已结束、尚未选稿，且某一路明确失败、没有交付首稿时，只有用户明确授权重试该路才执行：

```bash
node packages/modules/author-narration/scripts/author-handoff.mjs retry <单> <路> --authorize-retry
```

程序在该路原记录中保留失败原因、进度及旧回包路径，返回独立的新`receiptPath`。只有`started:true`才发起同输入的新AGY会话；原样交清本次机械失败原因，不代改作品或换任务。stdout写入返回的新路径，stderr使用同名`.stderr.log`，旧文件保留；仍用session和receive交接。重复retry或start只恢复原重试，不再次发起。已收到的其它稿件不改写；未知、在途、已选稿或事实处理失败不适用。重试再次失败须停止，新重试仍需新的明确授权。当前材料尝试有单路重试时，P1原接纳收口保留三稿、失败记录及作者原始回包；普通未重试尝试仍按原方法清理。

## 锁定整稿

作者包已选择成立的同一路完整作品后执行：

```bash
node packages/modules/author-narration/scripts/author-handoff.mjs select <单> <路>
```

程序核对三路初始调用已结束、作者会话互不相同且所选稿未审事实；解说还须三路均已完整交付。先在所选工作稿的`selectedOpener`保存同一路号，再将原作者ID写入`agy-conversation-id.txt`、完整result原样写入唯一候选。首稿result保持不变；这只交接AI已经作出的选择，不评判作品、不accept。

解说选择时完整publication随正文、片头原样进入唯一候选，直接用mark从received进入reviewing，不再调用package-start/package-receive。纪录片仍先执行下节补写。写入中断且仍在首稿阶段时，用同一select恢复原选择，不能改选；进入reviewing／correcting／ready后恢复事实处理，不能重跑select覆盖后续结果。纪录片进入packaging／packaged后恢复原发布续写。

## 选中作者补写发布内容

仅纪录片普通／full选稿后按[发布内容作者方法](publication-author.md)，先用`package-start <单> <路>`记录本次续写；首次调用取得句柄后仍用`session`保存，已有进度只恢复。返回后执行`package-receive <单> <路> <原始回包> <实际退出码>`。程序验证同一作者，补齐确定字段，将publication并入唯一候选，原正文与片头逐字保留，进度从packaging进入packaged。首稿result不改。纪录片只有packaged才能进入reviewing；程序拒绝解说误入本补写步骤。

正文与片头定点返工先用candidate接收正文与片头，再用`publication <单> <原始回包> <实际退出码>`接收原会话补写的publication。仅改正文且发布内容原样保留时，candidate可直接接收“片头、正文、发布内容”三段完整返回，最后一段为完整publication JSON，无需再调用发布续写。只修改发布内容时，candidate直接接收publication JSON并继承工作单锁定的正文、片头。

## 选中稿的事实处理

只对选定稿使用下列命令维护现有进度：

```bash
node packages/modules/author-narration/scripts/author-handoff.mjs mark <单> <路> reviewing
node packages/modules/author-narration/scripts/author-handoff.mjs mark <单> <路> ready <实际事实清单JSON路径>
node packages/modules/author-narration/scripts/author-handoff.mjs mark <单> <路> correcting <实际事实清单JSON路径>
```

事实清单是AI本次判断的数组；首次核对完成时，无错误使用空数组并标ready，有错误用完整清单标correcting。该临时JSON只是传参，程序归入现有factErrors后可删除，不形成第二份审计交付。已有清单直接恢复，重复传参只接受同一内容，不能换写、清空或补建丢失的原清单，不重做整套核对；纠错后的原错误确认按[共享方法](publication-author.md#纠错后的原错误确认)执行。首次进入correcting时程序清空旧终端句柄，取得纠错调用的新句柄后仍用session命令记录；已有correcting只恢复原调用。

同一次原作者纠错完整返回后执行：

```bash
node packages/modules/author-narration/scripts/author-handoff.mjs correct <单> <原始回包绝对路径> <实际退出码>
```

程序更新唯一候选；普通／full同时保存所选工作稿ready进度，保留首次result和事实清单，定点不写三路进度。解说沿用现有机械检查；纪录片纠错仅原样封装，不独立重复机械复验，正式accept仍执行原合同。普通／full的ready只表示机械交接完成；各路线有原错误时，执行者按[共享方法](publication-author.md#纠错后的原错误确认)完成窄范围确认后才accept。写入中断只恢复同一次回包和原清单；明确调用失败时，普通／full用原mark保存failed与原因，定点保留原回执和候选并报告停止，不写三路进度。未知仍只恢复原调用，不能冒充明确失败跳过。

## 定点返工

定点返工不创建三路工作稿。有事实错误时，在发起纠错前将本次完整清单保存到当前scratchPath/fact-errors.json；本单未归入三路factErrors，故该纠错输入须保留到正式接纳收口，恢复时只消费原清单，不当作正式报告。历史解说`narration`首次创作开启新会话；`opener`、发布内容修订及纪录片定点返工从工作单`reusedNarrationMaterials.agyConversation`取得固定作者，缺失或无法恢复时停止。

首次返回使用`candidate <单> <原始回包绝对路径> <实际退出码>`。历史解说正文重写由程序把固定来源原样复制到本次材料目录，保留本次`author-task.md`并从回包写入新作者ID；后续发布续写和correct使用本次`scratchPath/agy-conversation-id.txt`，不得找回工作单中的旧作者。重复收取恢复同一返回，不另开会话。完整正文、片头及发布内容按上节交接，再进入一次事实核对。用户指定片头原句逐字保留，正文衔接由本次作者完成，程序不自动补回旧正文。

公开或本地正文的保存沿用`prepare-reference <workOrderPath> <正文JSON绝对路径>`；输入格式与追加方法见[直接读取正文](explainer-evidence-and-query.md#直接读取正文)。视频快照与正文使用同一个`reference-materials.json`。
