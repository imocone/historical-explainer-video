---
name: author-subtitles
description: 执行或恢复当前P2 author-subtitles字幕工作单，由主代理直接按完整句子成稿、复核并正式交付。同源时间保真，不重做TTS、不改口播、不翻译、不手写时间。
---

# P2字幕

路线：**准备同源词级时间 → 主代理成稿 → 主代理从候选复核与修正 → 正式接纳与收口**。成稿与复核共用[字幕制作方法](references/subtitle-authoring.md)，全程使用当前工作单和唯一candidatePath。

## 1. Codex准备当前音频的时间

读取工作单、`scriptPackage`、`ttsResult`，核对正式正文、同一剧集与音频摘要。工作文件只放在本单`scratchPath`。同单已有可用云端结果时，按该结果的实际来源继续。需要首次准备时间或从返工单`reusedSubtitleTiming`恢复时间时，运行：

```bash
node packages/modules/author-subtitles/build-candidate.mjs prepare <work-order.yaml>
```

返回`route: video-captioner-asr`表示已恢复`raw-asr.srt`，按返回的弃用原因与模型参数继续。原生分支直接使用工作单`ttsResult.nativeTiming`，需要查看完整词级时间时才追加`--export-native-srt`。只有原生时间缺失、无效或已确认与声音错位，且没有可恢复的可用时间时，才说明具体原因并由VideoCaptioner必剪对同一音频取词级时间。当前音频是工作单中`ttsResult.rawAudio.path`相对本集P2目录的文件。正文、剧集或音频身份核对失败时先解决该问题。

```bash
node packages/runtime-config.mjs captioner transcribe <当前音频绝对路径> -o <scratch/raw-asr.srt绝对路径> --format srt --asr bijian --language zh --word-timestamps --quiet
```

只提交一次。已有成功结果就复用。远端状态未知时只恢复同一任务，无法确认原任务时停下。BIJIAN明确失败后改用JIANYING仍须用户明确授权。云端也无法取得可信时间时，保留配音和已有回执，报告时间轴缺失或无法对齐的具体位置。P2不安装本地模型、不重新合成取时间、不手改识别回执。零时长标点可以保留，正文词必须有实测时段。

完成结果是工作单中的有效原生词级时间，或本单raw-asr.srt及其真实来源参数，第2步按返回来源生成候选。身份不符、时间缺失或远端结果未知时停在本步；时间证据改变后原候选及复核失效，须从第2步重建。

## 2. 主代理写入完整候选

完整读取[字幕制作方法](references/subtitle-authoring.md)。以第1步返回的时间路线和实际模型参数运行原inspect，结合口播上下文判断必要断点和合并，再用build写入唯一候选。断句、折行、文本和同步疑点的常规检查由主代理直接完成。

同单恢复先读现有候选及原时间证据。此前已发出的AGY作者调用仍在写入时，只恢复并等待原调用，确认它不再写入后才继续。同源且已由原作者完整复核的候选进入第4步，按实际执行者保留标记并核对原回执；候选未完成或原调用失败时复用有效证据，从实际缺口继续。远端文本结果未知而本地写入已确认结束时也可接续，不重投AGY；该处理不适用于TTS、ASR、付费或发布。

## 3. 从候选复核并修正

从文件按共用方法完整核对当前候选的语义、实际折行和同源时间。按共用方法处理口播差异：局部一两字漏读照常接纳，整句口播错误才报告。发现字幕问题就集中修正并重新检查全部候选。完成后在同一候选记录唯一的 `codex:subtitle-review`。构建失败回到具体断点或合并位置；缺少同源时间回第1步，无法对齐时交回具体位置和证据缺口。

已有同源证据、主代理检查后仍有明确的疑难，并且能指出AGY可提供哪项独立专业判断时，才按当前外部CLI共同规则与AGY规则作定点只读咨询。例如，古文引句存在两种合理句读并会改变字幕边界，可以给出原文、上下文及两个方案，要求返回判断依据。只交解决该处所需材料，禁止写入、转派及调用TTS/ASR。主代理核对其意见与原证据，自己修订和复核候选。缺失的音频证据返回第1步，咨询意见不能替代实测时间。

## 4. 正式接纳与收口

读取当前最终候选，按工作单Schema和Validator走原accept。此前由AGY完成的候选还须核对实际退出、回执可解析、status=SUCCESS、response非空、stderr无关键拒绝、写入未越界，并由主代理按共用方法验收。若有问题由主代理修正和重新复核，记录实际执行者。原调用失败而已由主代理接手完成时，以当前候选和主代理的实际复核为准。

接纳成功结果是正式subtitle-correction，首个消费者是finalize-narration。接纳后按status → next → status让收口程序交付narration.srt和narration-package.yaml，停止于P2完成。P3只读取正式交付。
