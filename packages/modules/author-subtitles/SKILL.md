---
name: author-subtitles
description: 执行或恢复当前P2 author-subtitles字幕工作单，默认AGY按完整句子成稿、自查修正，Codex验收；AGY不可用或失败时Codex接手。同源时间保真，不重做TTS、不改口播、不翻译、不手写时间。
---

# P2字幕

路线：**Codex准备时间底稿 → AGY成稿 → AGY自查修正 → Codex验收并交付**。第2、3步在同一次AGY调用中顺序完成；AGY不可用或失败时按接手分支返回对应步骤。两种作者共用[字幕制作方法](references/subtitle-authoring.md)，工作单和candidatePath始终唯一。

## 1. Codex准备当前音频的时间

读取工作单、`scriptPackage`、`ttsResult`，核对正式正文、同一剧集与音频摘要。工作文件只放在本单`scratchPath`。返工单有`reusedSubtitleTiming`时先用下面的`prepare`恢复本单已固定的同源时间证据，不搜索历史目录。普通任务在原生词级时间有效且没有已核实同步错误时同样运行：

```bash
node packages/modules/author-subtitles/build-candidate.mjs prepare <work-order.yaml>
```

返回`route: video-captioner-asr`表示已恢复`raw-asr.srt`，后续使用返回的弃用原因与模型参数执行云端分支，禁止再次转录。原生分支输出`raw-word.srt`供复核。仅在没有可恢复证据且原生时间缺失、无效，或发现日期被压成几十毫秒、相关话语未被时段覆盖等真实问题时，说明具体原因，改由现有VideoCaptioner对同一音频取时间：

```bash
node packages/runtime-config.mjs captioner transcribe <当前音频绝对路径> -o <scratch/raw-asr.srt绝对路径> --format srt --asr bijian --language zh --word-timestamps --quiet
```

只提交一次。已有同一音频摘要的成功结果就恢复，不再转录。BIJIAN明确失败后改用JIANYING仍须用户明确授权。不得安装模型、重新合成或手改识别回执；零时长标点可以保留，正文词必须有实测时段。

完成结果是本单可读的raw-word.srt或raw-asr.srt及其真实来源参数，第2步读取它生成候选。身份不符、时间缺失或远端结果未知时停在本步；时间证据改变后原候选及复核失效，须从第2步重建。

## 2. AGY写入完整候选

先按当前外部CLI规则核对模型：`agy --output-format json models`，使用`gemini-3.8-flash-high`。入口不存在、模型不可用或查询明确失败时进入接手分支，不换型号；仍在运行则等待。

Codex只把当前单的准确路径、准备结果与用户当前要求填入以下提示，不预写断点。专业方法只在引用文件维护：

```text
你是当前P2字幕作者，直接完成这一份字幕工作单，不再调用或委派其它代理。
工作单：<workOrderPath绝对路径>。
先完整读取 <当前仓库根目录>/packages/modules/author-subtitles/references/subtitle-authoring.md，再读取当前工作单的scriptPackage、ttsResult、candidatePath、scratchPath及输出合同。
同源时间已由Codex准备：<prepare返回的route、output、nativeTimingIssue、requestedModel、actualModel；无值项省略>。
按所读方法顺序完成成稿和自查：先用inspect/build把完整字幕写入candidatePath，此时不标记复核；再重新读取这个文件及inspect输出，全量检查语义、显示和声音对应。仅有具体问题时集中修正一次，再全量复检；仍有问题就交回具体位置和原因，不能无限试稿或生成多份择优。
你只可写本单candidatePath和方法允许的scratchPath文件。原稿、音频、时间证据、系统和正式成果只读；不重投ASR/TTS，不安装模型，不调用next/accept，不读其它剧集或历史会话。
只有当前候选全部检查完成才按方法写agy:subtitle-review；重建后重新检查。Codex会独立读取候选验收，完成宣称不能代替文件内容。最终回复候选路径、条数、实际自查/修正结果和未解决问题/能力限制，不创建报告。
用户当前补充要求：<仅有则逐字附上>。
```

提示中的仓库绝对路径按当前仓库根替换。把实际提示写入本单`scratchPath/agy-task.md`，供AGY及同单恢复读取；不复制候选或时间记录。在仓库目录执行，`AGY_PROMPT`取该文件全文，stdout/stderr分别写本单`scratchPath/agy-result.json`和`agy-stderr.log`：

```bash
agy -p "$AGY_PROMPT" --model gemini-3.8-flash-high --effort high --dangerously-skip-permissions --output-format json --print-timeout 10m
```

通过exec启动后保留session_id，分段取回直到退出。一单首次调用新会话；恢复先读候选、回执及conversation_id：已审候选进入第4步，未审继续当前步骤，仍运行只恢复原调用，不重复提交。

本步结果是candidatePath中的完整、未标记复核候选，第3步从该文件读取。构建失败按具体错误修正，同一错误修后仍失败则接手；缺少真实时间返回第1步。

## 3. AGY自查并修正当前候选

AGY按共用方法完整检查第2步文件。无具体问题即结束；发现问题则集中修正一次，覆盖同一候选，再全量复检。这里计的是一次集中返工，不是限制inspect/build命令次数；不要求凑足轮数。修后仍有问题或能力不足时停止AGY作者工作，交由Codex接手，不发起第二次AGY试稿。

完成结果是同一候选的最终cues及唯一agy:subtitle-review，由第4步读取。重建清除旧标记，修订后未重新查完不得交付；stdout或自称完成不算结果。

### AGY失败时的接手分支

未安装、模型不可用、调用失败、回执无效、关键工具被拒或具体交付不合格时，Codex简要说明后直接接手，不重复询问授权。慢、无输出、仍运行不算失败；先确认AGY进程及写入结束，不能确认则恢复原调用，不并发改候选。远端文本结果未知但本地写入已确认结束时按已批准规则接手，不重投AGY；此例外不适用于TTS/ASR、付费或发布。

保留有效时间及候选，Codex按同一方法接续第2、3步，只修具体问题并重新全量检查，实际完成后记录唯一codex:subtitle-review。输入缺失、漏读或时间无法对应不能靠换执行者消除；仍无法关闭就留在真实责任处报告，不启动另一轮盲目试稿。

## 4. Codex验收并交付

AGY交付须已退出，回执可解析、status=SUCCESS、response非空、stderr无关键拒绝且写入未越界；失败后已由Codex接手完成的，不再要求失败回执变为成功。Codex读取当前候选，按共用方法核对全文语义、显示、同步及工作单Schema/Validator。AGY成稿由Codex独立验收，合格保留其标记；发现具体问题进入接手分支，修后重新验收。越界写入先查清并恢复影响。

由Codex执行原有accept，成功结果是正式subtitle-correction，首个消费者是finalize-narration；拒绝时返回上述具体责任，不改系统求通过。接纳后按status → next → status让收口程序交付narration.srt和narration-package.yaml，停止于P2完成。AGY不执行正式接纳，P3只读取正式交付。
