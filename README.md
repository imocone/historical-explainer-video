# Historical Explainer Video

**简体中文** | [English](README.en.md)

[![Checks](https://github.com/imocone/historical-explainer-video/actions/workflows/check.yml/badge.svg)](https://github.com/imocone/historical-explainer-video/actions/workflows/check.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**把一个历史问题，做成一集有故事、有解释的完整视频。**

在 **Codex** 里提供选题、书籍或参考资料，按 P0–P4 完成策划、口播、封面、配音、字幕、分镜、画面、片头与本地压片。适合制作历史解说和纪录片的个人创作者。

[看画面如何表达](#画面示例) · [看完整节目](#成片展示) · [了解制作能力](#从资料到成片) · [安装](#1-安装) · [做第一个节目](#4-做第一个节目)

## 画面示例

**故事用场面讲，关系用动画拆。** 左侧来自已发布的《袁术称帝》，右侧选自讲解模板作品《平均工资，藏住了谁？》。

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="https://www.youtube.com/watch?v=xhhdzvd3pbI&t=18s"><img src=".github/assets/showcase/narrative-motion.gif" alt="叙事画面：粮车与仓廪的全画幅场景，镜头随旁白移动" width="100%"></a>
      <strong>叙事：让观众进入人物所处的世界</strong>
      <p>人物、粮车、仓廪与环境共同构成场面，再设计取景和运镜，承接口播中的身份、资源与处境。</p>
    </td>
    <td width="50%" valign="top">
      <a href="packages/templates/vox-explainer/examples/salary/README.md"><img src=".github/assets/showcase/explainer-motion.gif" alt="讲解模板示例：办公室里八个人的钱束依次转移，再重组为收入阶梯" width="100%"></a>
      <strong>讲解：把抽象关系一步步展开</strong>
      <p>同一笔工资在八个人之间重新分配，再从钱束变成收入阶梯。人物、物件与镜头接力，让观众看懂“平均数为什么代表不了多数人”。</p>
    </td>
  </tr>
</table>

动图为轻量、无声预览。点击左图观看有声成片，点击右图查看讲解作品的源码与制作说明。还支持地图、路线与图解，按内容需要选择。[叙事画面方法](packages/templates/fullframe-narrative/AUTHOR.md) · [讲解动画方法](packages/templates/vox-explainer/AUTHOR.md)

## 从资料到成片

### 先想清楚讲什么，再决定怎么拍

从选题、指定书籍或参考节目出发，先形成节目方向、每集要回答的问题和必要材料，再进入写作。解说与纪录片分别使用自己的策划和写作方法；资料的出处、事实依据与允许重构的边界随制作保留。

例如《袁术称帝》，题目聚焦的是“有钱有兵，为什么盟友不听号令？”——后面的口播、场面和解释都围绕这个问题展开。[节目策划方法](packages/modules/plan-program/SKILL.md) · [纪录片策划方法](packages/modules/plan-historical-documentary/SKILL.md)

### 可以一段段做，也可以只改不满意的地方

用自然语言指定阶段或连续范围，Codex 按已有进度继续。正文、字幕、片头和正文画面有各自的返工入口，修改时保留仍有效的成果；画面制作中可通过 HyperFrames Studio 预览。

```text
为 ../my-program 完成 P0。
```

节目策划完成后，进入单集制作：

```text
为 ../my-program 的 ep01 完成 P1。
为 ../my-program 的 ep01 从 P2 做到 P4。
只调整 ep01 片头的画面，口播不变。
```

### 交付成片，也交付制作文档与发布材料

<table>
  <tr>
    <td width="70%" align="center" valign="top">
      <a href="https://www.youtube.com/watch?v=xhhdzvd3pbI&t=2s"><img src=".github/assets/showcase/opener.jpg" alt="袁术称帝片头：为什么称帝之后反而号令不了盟友？" height="220"></a><br>
      <strong>片头：把本集问题放到观众面前</strong>
    </td>
    <td width="30%" align="center" valign="top">
      <img src=".github/assets/showcase/yuan-shu-vertical.jpg" alt="袁术称帝竖版封面，与下方横版封面共同交付" height="220"><br>
      <strong>竖版封面</strong>
    </td>
  </tr>
</table>

下方成片入口展示横版封面；同一集同时交付竖版封面，方便准备不同平台的发布材料。

| 阶段 | 你拿到什么 |
|---|---|
| P0 策划 | 节目方向、资料与单集安排 |
| P1 写作 | 正文口播、片头文案、平台文案与横竖双封面 |
| P2 音频 | 正式旁白与字幕，包含专名读音处理 |
| P3 正文画面 | 分镜、全画幅叙事、讲解动画与镜头设计 |
| P4 片头与压片 | 片头与单集 `output/final.mp4` |

最终保留 **MP4、横竖双封面、发布文案、章节计时**，以及正式稿件、字幕、分镜、设计和来源记录。压片根据临时空间和内存情况选择并发，成功后自动清理制作素材与缓存，避免一集做完留下大量中间文件。

**剧情视频默认关闭，只有主动要求才制作。** 开源制作流程到 P4；平台发布在项目之外进行。压片后的素材清理意味着重新预演或压片需重新准备已删除素材，文档与发布材料仍可使用。

## 成片展示

本项目制作并已公开的节目。点击封面，在 YouTube 观看完整视频。

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="https://www.youtube.com/watch?v=xhhdzvd3pbI"><img src=".github/assets/showcase/yuan-shu.jpg" alt="袁术称帝：为什么号令不了盟友？" width="100%"></a>
      <a href="https://www.youtube.com/watch?v=xhhdzvd3pbI"><strong>▶ 袁术称帝：为什么号令不了盟友？</strong></a>
    </td>
    <td width="50%" valign="top">
      <a href="https://www.youtube.com/watch?v=JVIIlA-AvBw"><img src=".github/assets/showcase/song-gaozong.jpg" alt="宋高宗为什么离不开秦桧？" width="100%"></a>
      <a href="https://www.youtube.com/watch?v=JVIIlA-AvBw"><strong>▶ 宋高宗为什么离不开秦桧？</strong></a>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="https://www.youtube.com/watch?v=LHVS_zGPVvI"><img src=".github/assets/showcase/northern-wei.jpg" alt="北魏改革：前途分给了谁？" width="100%"></a>
      <a href="https://www.youtube.com/watch?v=LHVS_zGPVvI"><strong>▶ 北魏改革：前途分给了谁？</strong></a>
    </td>
    <td width="50%" valign="top">
      <a href="https://www.youtube.com/watch?v=Qvwd7P1AvsQ"><img src=".github/assets/showcase/liu-song.jpg" alt="萧道成：从平乱救宋到登基建齐" width="100%"></a>
      <a href="https://www.youtube.com/watch?v=Qvwd7P1AvsQ"><strong>▶ 萧道成：从平乱救宋到登基建齐</strong></a>
    </td>
  </tr>
</table>

## 1. 安装

**当前支持 macOS。** 需要自行登录所用的 AI 和外部服务；生图、配音等可能产生费用。先完成安装，再按当前阶段配置账号即可。

先准备 [Homebrew](https://brew.sh/zh-cn/)，然后在“终端”依次运行：

```bash
brew install git node ffmpeg imagemagick uv
git clone https://github.com/imocone/historical-explainer-video.git
cd historical-explainer-video
npm run setup
```

需要 **Node.js 22.12 或更新版本**。安装过程会下载 Node 依赖、Python 环境和渲染用浏览器，需要联网。看到“本地工具已就绪”表示本地基础依赖已准备好。

安装会自动创建 `.env`，再次运行会保留已有配置。无需自己创建Python环境、安装Python包或另装VideoCaptioner；安装不会替你登录账号或调用付费生成服务。

## 2. 使用 Codex

安装并登录 [Codex](https://developers.openai.com/codex/)，把本仓库作为项目打开。项目使用Codex原生生图和子代理，不需要图片API Key或客户端配置。**始终打开代码仓库 `historical-explainer-video`，节目成果另放目录。**

## 3. 登录与配音

默认成片需要登录Codex、安装并登录AGY，再填写自己的MiniMax配音Key。图片和词级时间工具不需要另外配置。

按[AGY官方说明](https://antigravity.google/docs/getting-started?tab=cli)安装：

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

重新打开终端，运行一次`agy`并登录。它负责正文与默认字幕创作。

打开安装时自动创建的本机配置：

```bash
open -a TextEdit .env
```

把`MINIMAX_API_KEY=`后面填成自己的Key。`MINIMAX_VOICE_ID`先保留默认，或改成自己账号可用的音色。Key从[MiniMax中国区控制台](https://platform.minimax.cn/)获取；海外账号另加`MINIMAX_API_HOST=https://api.minimax.io`，Key与区域须对应。密钥只填本机`.env`，不要填`.env.example`或发到聊天里；它不会进入Git。

这些账号可以按阶段准备：只做P0先登录Codex；P1前准备AGY，P2前填写配音Key。

<details>
<summary>按需配置：资料、配乐、剧情视频与已有工具</summary>

| 什么时候需要 | 准备什么 |
|---|---|
| 使用NotebookLM资料；纪录片路线需要 | 工具已随安装准备好，在仓库运行`node packages/runtime-config.mjs nlm login` |
| 按需定位具体断言出处 | 在`.env`填`TYPESAFE_API_KEY`，从[官方控制台](https://console.typesafe.ai/)获取；已有`~/.config/typesafe/api-key`仍可用 |
| 正文配乐 | 按[个人配乐说明](packages/features/background-music/library/README.md)放入有使用权的音乐并配置 |
| 明确要求剧情视频 | 按[即梦安装与登录说明](packages/modules/produce-video-assets/references/canvas-cli.md)准备CLI和账号 |
| 使用自己另装的VideoCaptioner | 才在`.env`填写`VIDEO_CAPTIONER_ROOT`，必要时指定`VIDEO_CAPTIONER_PYTHON`；默认使用项目安装版本 |
| 压片省资源 | 默认按视频长度、临时空间和内存选择并发；在`.env`填写`RENDER_WORKERS=1`可始终只开一个渲染进程，恢复自动用`RENDER_WORKERS=auto` |

公开版不附个人BGM，部分片头音效是静音占位，默认字幕使用随仓字体；不需要复制别人的私有素材或配置。详见[素材说明](THIRD_PARTY_NOTICES.md)。程序读取本机`.env`，进程环境变量优先；通常无需改工具路径或每次`export`。

</details>

遇到本地工具问题，运行：

```bash
npm run setup -- --check
```

它检查实际可用的本地工具，不登录或调用生成服务。结果会区分本地工具与账号准备；无需每次制作前重复运行。

## 4. 做第一个节目

在Codex中打开本仓库，直接发送下面的话，把方括号内换成自己的选题：

```text
读取 director/SKILL.md。
在 ../my-program 新建历史解说节目，选题是【自己的历史问题】。
从选题开始策划，为我完成 P0。
```

Director会准备节目目录和委托文件，不需要手工编辑JSON。已有资料可同时给出路径或链接；选择纪录片、按书或参考节目策划时也直接说清。首次访问仓库外的节目目录，按宿主提示允许该目录读写。

P0 完成后会交付节目策划。确认要继续时，再说：

```text
为 ../my-program 的 ep01 完成 P1。
```

后续可以指定 P2、P3、P4，或明确连续范围，例如“从 P2 做到 P4”。只要求 P0，就会在 P0 完成后停止。

查看进度或继续时，直接告诉Codex节目目录和阶段。

成片在**节目目录内**的单集 `output/final.mp4`，导演完成后会返回准确路径。运行中的预览与修改也交给导演按当前阶段处理。

压片检查通过并保存成片后，会自动清理本集制作图片、音频中间文件、中间视频和缓存；正式稿件、字幕、分镜、设计与来源记录，以及成片、双封面、发布文案和章节计时保留。压片失败不删，节目共用资料和其它集不动。清理后仍可查看文档和发布；要重新预演或压片，需要重新准备已删除素材。已有成片不会追溯清理。

## 常用命令

日常优先直接告诉 Codex 要做哪个阶段、改哪一处。需要自己操作时，再展开下面的命令参考。

<details>
<summary>进阶命令：进度、制作、返工与开关</summary>

`check`是用户明确要求项目审计或故障诊断时才运行的全局检查；单集生产只从当前阶段的`status`开始。

### 进度、连续执行与整阶段重跑

```bash
# 查看整个节目，或只看某集的各阶段进度
node engine/cli.mjs status --workspace <节目目录> [--episode <epNN>]
# 连续执行；Director消费原工作单并完成各阶段收尾
node engine/cli.mjs run --workspace <节目目录> --episode <epNN> --from p1 --to p4
node engine/cli.mjs run --workspace <节目目录> --episode <epNN> --pause
node engine/cli.mjs run --workspace <节目目录> --episode <epNN> --resume
# 全阶段重跑；之后继续原next或run。旧成果接纳替换前保留
node engine/cli.mjs reset --workspace <节目目录> --episode <epNN> --stage <p1|p2|p3|p4>
```

### 全局检查

```bash
node engine/cli.mjs check
node engine/cli.mjs check --workspace <节目目录>
```

### 节目策划与当前阶段执行

```bash
node engine/cli.mjs status --workspace <节目目录> --program <program-id> --stage p0
node engine/cli.mjs next --workspace <节目目录> --program <program-id> --stage p0
node engine/cli.mjs accept --workspace <节目目录> --program <program-id> --stage p0

# 用户调整P0时使用；中途改要求先更新同节目request.yaml，保留草稿和材料换单；已接纳则从program.yaml修订
node engine/cli.mjs next --workspace <节目目录> --program <program-id> --stage p0 --revise-program

node engine/cli.mjs status --workspace <节目目录> --episode <epNN> --stage <p1|p2|p3|p4>
node engine/cli.mjs next --workspace <节目目录> --episode <epNN> --stage <p1|p2|p3|p4>
# 当前runner为ai时提交候选并accept；正文交付实图及最终运镜，P4交付片头与实际视频
# P4最后的render是程序交付，无需accept
node engine/cli.mjs accept --workspace <节目目录> --episode <epNN> --stage <p1|p2|p3|p4>
```

综合解说的P0同时确定正文类型：`explainerType: general`为通用解说，`current-affairs`为时政解说。用户明确指定时写入同一`request.yaml`；未指定时P0按当前任务与材料判断，最终选择保存在`program.yaml`并交给P1。P1据此使用原通用方法或学习《王局拍案》的时政方法。类型独立于画风、封面与片头，纪录片不使用。改类型走上述P0修订入口；已有节目不自动补写或重做。

### 正文、片头与字幕返工

```bash
# 已完成P2只重做字幕，保留口播、配音并复用同源时间证据
node engine/cli.mjs next --workspace <节目目录> --episode <epNN> --stage p2 --revise-subtitles

# 用户要求修正现行P1片头时使用；同步调整正文开场与必要承接
node engine/cli.mjs next --workspace <节目目录> --episode <epNN> --stage p1 --revise-opener

# 用户要求重写现行P1正文时使用；按现行正文绑定的材料身份复用，不重跑Query
# 用户要求保留现行片头时，同时提供 --opener-text <原句>
node engine/cli.mjs next --workspace <节目目录> --episode <epNN> --stage p1 --revise-narration [--opener-text <原句>]

# 仅在AGY明确失败，或用户明确放弃一份完整但未接纳的正文返工稿，并再次授权重试时使用；沿用同一Query材料与锁定片头重新签发
node engine/cli.mjs next --workspace <节目目录> --episode <epNN> --stage p1 --revise-narration --replace-narration-revision [--opener-text <原句>]

# 用户要求从取材开始完整重做现行P1时使用；重新Query并按被选作者包形成新作者输入
node engine/cli.mjs next --workspace <节目目录> --episode <epNN> --stage p1 --rerun-narration

# 上次完整重跑需要放弃时使用；首次P1尚未接纳且当前尝试已明确放弃时也用同一入口换新材料尝试
# NotebookLM结果未知可在现有P1授权内直接换新；已有完整Query但后续成稿明确失败也可换新
node engine/cli.mjs next --workspace <节目目录> --episode <epNN> --stage p1 --rerun-narration --replace-full-rerun
```

### P3设计返工

P3正文统一按章节（TR）派工、提交、接纳和统计进度：主代理完成理解、导演和切分审计后负责调度与接纳，每章新建一位独立上下文子代理，最多三章并行，全画幅与讲解共用此分工。主代理按整集`status.authorSegments`的待办顺序选择`next --stage p3 --claim fullframe`或`--claim explainer`领单；两种claim各自只领取对应模板。谁完成就串行`accept --stage p3 --segment TR001`、查看整集`status`，成功接纳后结束使用本章作者，再为下一待办章节新建作者，不跨章复用。已领取章节保持原单，恢复用`next --stage p3 --segment TR001`。各命令仍须提供`--workspace`和`--episode`。详见[导演P3入口](director/references/p3.md#正文按章节并行)。

```bash
# 冻结Understanding和导演计划。--beat可重复，讲解组按整组展开；未完成P3可先执行指定返工，再恢复原普通正文工作单；省略Beat前须收口当前单
node engine/cli.mjs next --workspace <节目目录> --episode <epNN> --stage p3 --redesign-body [--beat <Beat ID> ...] [--revision-reason "具体修改意见"]
# 已启动的局部或全部返工使用普通 next --stage p3 续跑；同一作者保留仍有效图片

# 局部调整导演分页、观看职责或模板归属；拆合页须点名相关原Beat。保留其它有效成果
node engine/cli.mjs next --workspace <节目目录> --episode <epNN> --stage p3 --revise-director --beat <Beat ID> [--beat <Beat ID> ...] --revision-reason "具体修改意见"
# 只有明确放弃进行中的正文重作并转为导演修订时，再增加 --replace-body-redesign；普通next恢复同一修订
# 明确撤销未接纳的导演局部修订；保留已接纳成果，不执行下游。换范围时先撤销再发起
node engine/cli.mjs next --workspace <节目目录> --episode <epNN> --stage p3 --cancel-director-revision

# 只重作已接纳P3中的指定历史引文；正文、画面、相机、显示Cue和未选引文保持不变
node engine/cli.mjs next --workspace <节目目录> --episode <epNN> --stage p3 --revise-quotes --beat <Beat ID> [--beat <Beat ID> ...] --revision-reason "按现行史料原文方法重新核实出处"
```

### 正文图片与运镜修订

图片与最终运镜随P3原作者交付；片头图片、视频首图及实际视频在P4完成。局部修改用P3正文重设计或P4原作者返工入口，保留有效图片；不再单独编译素材计划、生成四宫格或维护图片清单。工具操作见`packages/authored-images.md`。

### P4素材与压片

P4默认按`opener → render`完成片头和压片。只有你明确要求剧情视频，才用`next --stage p4 --video on`启用原`video → video-assets`流程；`--video off`关闭并保留已有素材。普通next在素材齐备后最后压片，输出单集`output/final.mp4`；开源版没有P5或发布命令。

```bash
node engine/cli.mjs status --workspace <节目目录> --episode <epNN> --stage p4
node engine/cli.mjs next --workspace <节目目录> --episode <epNN> --stage p4
# 仅本次压片省资源；不修改长期配置
RENDER_WORKERS=1 node engine/cli.mjs next --workspace <节目目录> --episode <epNN> --stage p4
```

作者候选仍用原accept，最后render是程序交付，无需accept。指定节点操作仍用`--node`，不扩大当前授权范围。

### P1文案与封面修订

```bash
# 用户要求修改尚未发布的现行P1文案时使用；不授权再次付费或发布
node engine/cli.mjs next --workspace <节目目录> --episode <epNN> --target release-main --stage p1 --revise-publication
# 只改点名字段；可重复publication-field，未点名内容保留，本次意见随原工作单交接
node engine/cli.mjs next --workspace <节目目录> --episode <epNN> --target release-main --stage p1 --revise-publication --publication-field youtube.title --revision-reason "保留事件名，理顺标题语序"
# 保留认可画面、只换封面文字；可与平台字段合用，接纳后按本次授权编辑实际变化的画幅
node engine/cli.mjs next --workspace <节目目录> --episode <epNN> --target release-main --stage p1 --revise-publication --publication-field covers.youtube.visibleText --publication-field covers.vertical.visibleText --revision-reason "保留当前两张图，只修改标题文字"
# 用户明确要求三平台文案与封面内容全部重作时，两个选项合用，由原AGY作者联合完成一张工作单
node engine/cli.mjs next --workspace <节目目录> --episode <epNN> --target release-main --stage p1 --revise-publication --revise-cover
# 用户明确选择当前横竖Cover包登记的本集成品样图时，先对齐封面文字，再由普通next本地接纳；不生图、不付费
node engine/cli.mjs next --workspace <节目目录> --episode <epNN> --target release-main --stage p1 --adopt-cover-examples
# 用户明确指定本地横竖成图：JSON含youtube/vertical各自的source绝对路径与visibleText数组
node engine/cli.mjs next --workspace <节目目录> --episode <epNN> --target release-main --stage p1 --adopt-cover-images <指定双图JSON绝对路径>
# 只修所选画幅的表现；用户明确的定点修订覆盖本次自带生图，后续普通next只恢复原对象
node engine/cli.mjs next --workspace <节目目录> --episode <epNN> --target release-main --stage p1 --regenerate-cover --cover-variant vertical --revision-reason "修正顶部文字裁切，保留原文和人物"
# 用户接受现图、撤销待办重生；保留双图和文案，不生成或付费
node engine/cli.mjs next --workspace <节目目录> --episode <epNN> --target release-main --stage p1 --cancel-cover-regeneration
```

### Studio预览

命令只返回Studio地址，不自动打开系统浏览器。同一工程复用服务；由负责预览的会话复用一个内置浏览器普通标签页，保留当前窗口大小与会话侧栏，协作会话不各开一份。正式修改后地址若变化，在原标签导航到新地址。

浏览器操作按当前工具说明执行：

- 先查现有标签，按当前列表取得对应标签；确认没有时才打开一次。保留给用户的预览须在本轮标记保留，后续轮次继续操作后也按工具要求保留。
- 标签失效时先重新列出并取得现有标签；列表读取失败不等于标签为空。服务正常就不重启；确认标签已关闭且仍需本次预览时才重开一个，用户主动关闭后不自动重开。
- 播放、定位和检查默认不进入播放器或系统全屏，不最大化窗口。细节检查用后台截图或局部静帧；只有用户明确要求全屏时才切换，结束后恢复本次改变的展示状态。
- 导航、候选热更新或用户要求的展示调整后，重读页面状态；WebMCP工具发生变化时重新获取工具列表，按返回的当前标识操作，不沿用旧按钮状态、工具标识或页面句柄。
- 手机尺寸检查看的是完整画面的实际显示宽度，不是浏览器窗口宽度。保留窗口和侧栏，在预览区用Ctrl／Command加滚轮缩放画布；空间不足时调整Preview面板分隔条，必要时用普通滚轮平移画布。布局稳定后读取`preview-zoom-stage`的`getBoundingClientRect().width`，调到约390px并确认整幅画面没有裁切、没有被缩略导航等控件遮挡，再播放检查。切换章节后按实际画宽核对，不套用上一章的窗口尺寸或缩放百分比；完成后用Fit恢复画布，并恢复本次调整的分隔条。
- 按本章剩余时长安排连续观看，固定展示状态后不逐秒查询或重复截图；播放前确认当前章节和起点，播放后核对结束状态，只在具体问题处定位复看。P3讲解章节的正常尺寸和手机尺寸完整观看仍由本章作者完成，主会话不重复全量观看。

```bash
# HyperFrames Studio直接播放正式计划，可拖动定位；无需先导出MP4
npm run studio -- --workspace <节目目录> --episode <epNN>
# 只看正文或片头
npm run studio -- --workspace <节目目录> --episode <epNN> --part body
npm run studio -- --workspace <节目目录> --episode <epNN> --part opener

npm run studio -- --workspace <节目目录> --episode <epNN> --beat <Bxxx> [--beat <相邻Bxxx>]
# 只准备临时播放数据并打印路径，不启动Studio
npm run studio -- --workspace <节目目录> --episode <epNN> --beat <Bxxx> --prepare-only
```

地图在正常预览和出片前自动准备画面，静止帧复用原图，保留原镜头、路线、标记与Cue动画。预览和出片按实际地图输入共用缓存，只补所需窗口的缺帧；地图、素材、字体或绘制实现变化时更新，损坏时重建，无需单独导出地图。制作期间Studio按输入版本保留编译项目，HY负责预演和捕获的执行与生命周期；导出并发按本机资源选项选择。修改原候选后沿原预演入口更新现有预览；正式修改接纳后，再按正常入口更新预览和成片，旧MP4不会在后台自行覆盖。正式压片成功后按上文清理本集预演和缓存。

Studio内移动、裁剪场景或字幕，只影响临时项目的播放与导出；正式设计仍回原作者修改。点进子场景与独立导出使用同一裁剪窗口。导出、缩略图、波形、响度分析和冻结帧等任务由HY原生处理。

### 命令范围与小样边界

`next / accept`必须显式指定阶段，只构造和执行当前阶段；`status`省略阶段时汇总节目或单集进度。本节点需要的上游交付缺失时停止当前生产；当前阶段交付齐备后按Director对应reference完成本次收尾；单阶段停止，明确指定的连续范围用`run --advance`继续到终点。用户明确要求修订或重生时使用本阶段现有专用入口。不得越过用户指定终点或改做全局`check`。

局部预览使用同一HY计划的正式时间轴窗口，读取所选部分的已交付素材。正文窗口不要求先完成片头；片头窗口加载其引用及入场交接所需的正文素材。Beat预览须连续，选中视频时须覆盖该视频全部成员。预览复用正式时间轴、相机、字幕与音轨，缺少实际依赖则停止，不生成素材或形成第二份清单。

## 外部副作用

导演按已有阶段授权连续完成制作。P1首次必要原生双封面沿原节点完成。P2配音、P3画面、P4所选模板的片头TTS与剧情视频生成沿各自原入口执行；已有远端对象只恢复，失败或未知后的再次付费仍按原边界处理。P4最后本地压片不授权对外发布。

```bash
node engine/cli.mjs next --workspace <节目目录> --episode <epNN> --stage p2 --authorize-paid-tts
node engine/cli.mjs accept --workspace <节目目录> --episode <epNN> --stage p4 --node opener --authorize-paid-tts
```

开源版提供制作能力。NotebookLM、AGY、即梦等账号按所用阶段自行登录；成片的平台上传和发布由使用者自行处理。

## 文件入口

- 协作规则、任务读取路由和授权硬门：`AGENTS.md`
- 剧集生产循环：`director/SKILL.md`
- 唯一现行架构：`development/ARCHITECTURE.md`
- 本机可选历史档案：`development/CHANGELOG.md`，不随开源分发
- 正式流程：`workflow/program.yaml`、`workflow/narration.yaml`、`workflow/video.yaml`
- 控制程序：`engine/cli.mjs`、`engine/runtime.mjs`
- 测试命令：`package.json`

## 节目片头选择

片头与视觉包一样保存于节目级`program.yaml`，由P0正式接纳，P1与P4读取同一个选择。纪录片和解说都默认使用`opposed-opener`（逐段错层对冲片头）；可选`episode-opener`（经典三画面）、`documentary-opener`（回忆画流）、`crossfire-opener`（交叉对冲）及`glass-opener`（玻璃错层）。新节目可在`request.yaml`指定`openerTemplate`，未指定时P0写入默认值。

```yaml
# program.yaml中的节目级配置示意
openerTemplate: opposed-opener
```

以后要求更换时使用上面的P0 `--revise-program`入口，将`openerTemplate`改为所选ID并接纳；不新增另一份配置，也不按节目形式自动改选。只换片头保持正文策划和材料；现有片头文案不满足新模板时使用P1 `--revise-opener`，不因选择本身重做正文、配音或正文素材。已有节目不自动补写或迁移。

### 本集音效开关

导演计划形成后，沿已有next只更新音效选择，不推进制作或发布：

```bash
node engine/cli.mjs next --workspace <节目目录> --episode ep01 --stage p3 --sound-effects off
node engine/cli.mjs next --workspace <节目目录> --episode ep01 --stage p3 --sound-effects on
```

P4可使用相同参数。关闭保留已成音效资产和事件，但作者与渲染不装配音效包；重新开启复用有效声音，缺失的声音由原P3作者补齐。开关不改画面、Cue、旁白和BGM选择，也不自动发布。已有作者工作单仍在写入时先完成该单位，不在其执行中改变所选包。预览的`--mute-effects`只是试听静音，不代替此开关。

P4默认只有片头制作与最后压片；剧情视频仅在用户明确要求时启用（`next --stage p4 --video on`）。未启用时不派视频作者、不生成空方案、不调用视频服务。

</details>

## 更新

没有修改仓库代码时，在仓库目录运行：

```bash
git pull --ff-only
npm run setup
```

已有 `.env` 和仓库外的节目目录会保留。若提示本地代码冲突，先处理自己的修改，不要强制覆盖。

## 常见问题

**`brew` 或 `node` 找不到？** 先按 [Homebrew](https://brew.sh/zh-cn/) 的安装与终端提示完成配置，重新打开终端，再运行安装命令。`node --version` 应为 22.12 或更新版本。

**为什么没有背景音乐或部分音效？** 个人音乐和不能公开分发的原声未附带；部分公开音效为静音占位。可以配置有权使用的素材。

**Windows / Linux 能用吗？** 当前安装入口只支持 macOS，其它系统尚未完成媒体工具适配。

## 参与、反馈与许可

使用问题到 [Issues](https://github.com/imocone/historical-explainer-video/issues)；提交修改看[贡献指南](CONTRIBUTING.md)。漏洞通过[私密安全报告](https://github.com/imocone/historical-explainer-video/security/advisories/new)提交，见[安全说明](SECURITY.md)。

代码和文档采用 [MIT](LICENSE)；字体、地图、纹理、音频及依赖保留各自许可，见[第三方许可与素材来源](THIRD_PARTY_NOTICES.md)。真实节目、成品和示例视频、密钥、登录状态、旧开发档案及受限原素材不随源码分发。

基础安装、包与资源检查、配置和图片授权测试已验证。外部服务的真实付费出片效果仍需在实际制作时验收。
