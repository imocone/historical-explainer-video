# Historical Explainer Video

**简体中文** | [English](README.en.md)

[![Checks](https://github.com/imocone/historical-explainer-video/actions/workflows/check.yml/badge.svg)](https://github.com/imocone/historical-explainer-video/actions/workflows/check.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

用 **Codex 或 Claude Code** 在本地制作历史解说和纪录片。你提供选题和资料，AI 与本地工具按阶段完成策划、口播、封面、配音、字幕、画面与片头，最后输出 MP4。可以逐阶段制作，也可以接着已有进度继续或局部修改。

**当前支持 macOS。** 需要自行登录所用的 AI 和外部服务；生图、配音等可能产生费用。先完成安装，再按当前阶段配置账号即可。

[安装](#1-安装) · [Codex / Claude](#2-选择-codex-或-claude-code) · [配置](#3-配置用到的服务) · [第一个节目](#4-做第一个节目) · [常见问题](#常见问题)

## 能做什么

- 历史解说与历史纪录片，按各自的方法策划和写作。
- 全画幅叙事、代码驱动的讲解动画、图解和地图。
- 横竖双封面、旁白、字幕、音效、片头与最终 MP4。
- HyperFrames Studio 预览、保存进度、局部返工。

| 阶段 | 交付 |
|---|---|
| P0 策划 | 节目方向、资料与单集安排 |
| P1 写作 | 正文口播、片头文案、平台文案与横竖双封面 |
| P2 音频 | 正式旁白与字幕 |
| P3 正文画面 | 故事板、实图、动画与镜头设计 |
| P4 片头与压片 | 片头与单集 `output/final.mp4` |

**剧情视频默认关闭，只有主动要求才制作。** P4 默认做片头并在最后压片；开源版没有 P5，平台发布由你自行处理。

## 1. 安装

先准备 [Homebrew](https://brew.sh/zh-cn/)，然后在“终端”依次运行：

```bash
brew install git node ffmpeg imagemagick uv
git clone https://github.com/imocone/historical-explainer-video.git
cd historical-explainer-video
npm run setup
```

需要 **Node.js 22.12 或更新版本**。安装过程会下载 Node 依赖、Python 环境和渲染用浏览器，需要联网。看到“安装完成”表示本地基础依赖已准备好。

安装会自动创建 `.env`，再次运行会保留已有配置。无需自己创建 Python 环境或安装 Python 包；安装也不会替你登录账号或调用付费生成服务。

## 2. 选择 Codex 或 Claude Code

两者使用同一份 `director/SKILL.md`，任选其一。**始终打开代码仓库 `historical-explainer-video`，节目成果另放目录。**

### Codex

安装并登录 [Codex](https://developers.openai.com/codex/)，把本仓库作为项目打开。当前 Codex 有原生生图工具时，保留 `.env` 中的 `IMAGE_PROVIDER=builtin`。

### Claude Code

没有安装时，可按 [Claude 官方说明](https://code.claude.com/docs/en/setup) 安装。项目的浏览器预览还需要 Google Chrome；已有的工具可以跳过：

```bash
brew install --cask claude-code google-chrome
claude
```

在仓库目录运行 `claude`，按提示完成登录并信任本项目。项目已附带 `/director` 技能和 `video-browser` MCP 配置，无需复制技能或手写 MCP；首次提示启用项目 MCP 时确认启用，进入 Claude 后用 `/mcp` 查看 `video-browser` 是否连接。

Claude 使用图片 API 生图。打开 `.env`：

```bash
open -a TextEdit .env
```

把下面两项改为自己的配置后保存：

```dotenv
IMAGE_PROVIDER=openai
OPENAI_API_KEY=填你自己的OpenAI_API_Key
```

Key 从 [OpenAI API 控制台](https://platform.openai.com/api-keys) 获取；账号须有可用 API 额度和图片模型权限。[图片 API](https://developers.openai.com/api/docs/guides/image-generation) 单独计费，Claude / ChatGPT / Codex 订阅不抵扣这笔费用。到实际生图阶段还要明确允许本次图片付费调用。只做 P0 时可以先不配置生图。

## 3. 配置用到的服务

**密钥与工具路径统一填本机 `.env`，不要填 `.env.example`。** 程序会自动读取，不需要每次 `export`；已设置的进程环境变量优先。`.env` 和登录状态不进入 Git。

| 什么时候需要 | 准备什么 |
|---|---|
| P0 先策划 | 已登录的 Codex 或 Claude Code；公开资料策划可以先开始 |
| 使用 NotebookLM 资料 | 安装已包含 `nlm`；先运行下方登录命令。纪录片路线需要 NotebookLM |
| P1 正文、P2 默认字幕作者 | 安装并登录 [Antigravity CLI（AGY）](https://antigravity.google/docs/getting-started?tab=cli)，两个宿主都需要 |
| P1 封面、P3 / P4 图片 | Codex 原生生图，或按上节配置 OpenAI 图片 API |
| P2 配音、有旁白的片头 | 在 `.env` 填 `MINIMAX_API_KEY`；`MINIMAX_VOICE_ID` 可保留公共默认音色，也可换成自己账号可用的音色 |
| 按需定位具体断言的出处 | 在 `.env` 填 `TYPESAFE_API_KEY`；已有 `~/.config/typesafe/api-key` 仍可用 |
| 备用字幕识别、有旁白片头取词级时间 | 安装支持必剪 / 剪映词级时间的 [VideoCaptioner](https://github.com/WEIFENG2333/VideoCaptioner)，在 `.env` 填 `VIDEO_CAPTIONER_ROOT` |
| 明确要求剧情视频 | 按[即梦安装与登录说明](packages/modules/produce-video-assets/references/canvas-cli.md)准备 CLI 与账号 |

MiniMax Key 可按[中国区官方说明](https://platform.minimax.cn/docs/guides/quickstart-preparation)获取。默认保留原中国区地址；海外账号在 `.env` 增加 `MINIMAX_API_HOST=https://api.minimax.io`，Key 与账号区域须对应。TypeSafe Key 在[官方控制台](https://console.typesafe.ai/)获取。

<details>
<summary>NotebookLM、AGY 与可选配乐的准备方法</summary>

NotebookLM 登录，在仓库目录运行：

```bash
node packages/runtime-config.mjs nlm login
```

按 [AGY 官方安装说明](https://antigravity.google/docs/getting-started?tab=cli)运行：

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

重新打开终端，运行 `agy` 并完成交互登录。它仍负责原流程的正文与默认字幕创作；切换主代理不会替换作者。

需要 VideoCaptioner 时，可按其[源码安装说明](https://github.com/WEIFENG2333/VideoCaptioner#开发)在相邻目录安装：

```bash
git clone https://github.com/WEIFENG2333/VideoCaptioner.git ../VideoCaptioner
(cd ../VideoCaptioner && uv sync)
```

然后在本仓库 `.env` 填 `VIDEO_CAPTIONER_ROOT=../VideoCaptioner`。它有独立的环境，不需要把其文件复制进本项目。

仓库不附个人默认背景音乐，不配置就没有正文配乐。需要时按[个人配乐说明](packages/features/background-music/library/README.md)添加有权使用的音乐。部分教学和片头音效为静音占位，详见[素材许可](THIRD_PARTY_NOTICES.md)。

</details>

遇到安装或配置问题，运行：

```bash
npm run setup -- --check
```

它检查本地依赖并显示配置状态，不登录、不调用生成服务。“本地环境检查通过”不代表外部账号已登录、API 有额度，或整片已经验收；无需每次制作前重复运行。

## 4. 做第一个节目

在仓库目录创建仓库外的节目目录：

```bash
mkdir -p ../my-program
cp scripts/request.example.yaml ../my-program/request.yaml
```

用编辑器打开 `../my-program/request.yaml`，把 `idea` 改成自己的选题；其它字段第一次可保留。此文件虽以 `.yaml` 结尾，内容使用 JSON，注意保留双引号和逗号。

在刚才打开本仓库的 Codex 或 Claude Code 中发送；首次访问节目目录时，按宿主提示允许该目录的读写：

```text
读取 director/SKILL.md，为 ../my-program 完成 P0。
```

P0 完成后会交付节目策划。确认要继续时，再说：

```text
为 ../my-program 的 ep01 完成 P1。
```

进入使用图片 API 的阶段时，另明确说“允许本次图片 API 付费生成”。后续可以指定 P2、P3、P4，或明确连续范围，例如“从 P2 做到 P4”。只要求 P0，就会在 P0 完成后停止。

查看示例委托的策划进度：

```bash
node engine/cli.mjs status --workspace ../my-program --program first-video --stage p0
```

成片在**节目目录内**的单集 `output/final.mp4`，导演完成后会返回准确路径。运行中的预览与修改也交给导演按当前阶段处理。

## 常用命令

日常优先直接告诉 Codex / Claude 要做哪个阶段、改哪一处。需要自己操作时，再展开下面的命令参考。

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

地图在正常预览和出片前自动准备画面，静止帧复用原图，保留原镜头、路线、标记与Cue动画。预览和出片按实际地图输入共用缓存，只补所需窗口的缺帧；地图、素材、字体或绘制实现变化时更新，损坏时重建，无需单独导出地图。Studio按输入版本保留编译项目；HY预演和捕获使用官方默认运行配置与生命周期。修改原候选后沿原预演入口更新现有预览；正式修改接纳后，再按正常入口更新预览和成片，旧MP4不会在后台自行覆盖。

Studio内移动、裁剪场景或字幕，只影响临时项目的播放与导出；正式设计仍回原作者修改。点进子场景与独立导出使用同一裁剪窗口。导出、缩略图、波形、响度分析和冻结帧等任务由HY原生处理。

### 命令范围与小样边界

`next / accept`必须显式指定阶段，只构造和执行当前阶段；`status`省略阶段时汇总节目或单集进度。本节点需要的上游交付缺失时停止当前生产；当前阶段交付齐备后按Director对应reference完成本次收尾；单阶段停止，明确指定的连续范围用`run --advance`继续到终点。用户明确要求修订或重生时使用本阶段现有专用入口。不得越过用户指定终点或改做全局`check`。

局部预览使用同一HY计划的正式时间轴窗口，读取所选部分的已交付素材。正文窗口不要求先完成片头；片头窗口加载其引用及入场交接所需的正文素材。Beat预览须连续，选中视频时须覆盖该视频全部成员。预览复用正式时间轴、相机、字幕与音轨，缺少实际依赖则停止，不生成素材或形成第二份清单。

## 外部副作用

导演按已有阶段授权连续完成制作。P1首次必要原生双封面沿原节点完成；选用图片API须有当前明确的图片付费许可。P2配音、P3画面、P4所选模板的片头TTS与剧情视频生成沿各自原入口执行；已有远端对象只恢复，失败或未知后的再次付费仍按原边界处理。P4最后本地压片不授权对外发布。

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

**Claude 找不到 `/director`？** 确认从代码仓库目录启动，重启会话；也可以直接发送“读取 director/SKILL.md，为指定目录完成 P0”。

**Claude 的 `video-browser` 没连接？** 先完成 `npm run setup`、安装 Google Chrome，再在 Claude 中用 `/mcp` 启用或重连项目服务器；按提示确认项目 MCP 信任。

**图片 API 返回 401 / 403？** 检查自己的 Key、API 额度和模型访问权限。失败或结果未知时保留原调用记录，按导演的原任务恢复，不删记录反复提交。

**为什么没有背景音乐或部分音效？** 个人音乐和不能公开分发的原声未附带；部分公开音效为静音占位。可以配置有权使用的素材。

**Windows / Linux 能用吗？** 当前安装入口只支持 macOS，其它系统尚未完成媒体工具适配。

## 参与、反馈与许可

使用问题到 [Issues](https://github.com/imocone/historical-explainer-video/issues)；提交修改看[贡献指南](CONTRIBUTING.md)。漏洞通过[私密安全报告](https://github.com/imocone/historical-explainer-video/security/advisories/new)提交，见[安全说明](SECURITY.md)。

代码和文档采用 [MIT](LICENSE)；字体、地图、纹理、音频及依赖保留各自许可，见[第三方许可与素材来源](THIRD_PARTY_NOTICES.md)。真实节目、成品和示例视频、密钥、登录状态、旧开发档案及受限原素材不随源码分发。

基础安装、包与资源检查、配置和图片授权测试已验证。外部服务的真实付费出片效果仍需在实际制作时验收。
