# Historical Explainer Video

[![Checks](https://github.com/imocone/historical-explainer-video/actions/workflows/check.yml/badge.svg)](https://github.com/imocone/historical-explainer-video/actions/workflows/check.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

面向 **Codex 和 Claude Code** 的历史视频制作工作流。从节目策划、脚本、配音到画面、片头和 MP4 成片，按阶段完成，也可以从当前进度继续或局部返工。

[快速开始](#快速开始) · [配置外部服务](#配置外部服务) · [第一个节目](#第一个节目) · [常用命令](#常用命令)

## 能做什么

- **历史解说与历史纪录片**：按各自的方法完成策划和写作。
- **多种画面表达**：全画幅叙事、代码驱动的讲解动画、图解和地图。
- **完整制作交付**：正文、双封面、旁白、字幕、音效、片头和最终 MP4。
- **预览与修改**：使用 HyperFrames Studio 预览，保存制作进度，按实际修改范围返工。

## 制作流程

| 阶段 | 完成什么 |
|---|---|
| P0 策划 | 节目方向、资料与单集安排 |
| P1 写作 | 正文口播、片头文案、平台文案与横竖双封面 |
| P2 音频 | 正式旁白与字幕 |
| P3 正文画面 | 故事板、实图、动画与镜头设计 |
| P4 片头与压片 | 制作片头，最终交付 `output/final.mp4` |

**剧情视频默认关闭。** 只有明确要求时才启用 `video → video-assets`，并在 P4 最后压片。开源制作流程以 P4 成片结束，平台发布由使用者自行处理。

## 快速开始

当前支持 **macOS**，需要 Git、Homebrew 和 **Node.js 22.12+**。

```bash
brew install node ffmpeg imagemagick uv
git clone https://github.com/imocone/historical-explainer-video.git
cd historical-explainer-video
npm run setup
```

安装入口会安装锁定的Node依赖、仓库内`.venv`的Python依赖及HyperFrames浏览器，并在没有`.env`时从[配置示例](.env.example)创建本机配置。再次执行保留已有配置，不启动节目、不登录账号、不调用生图、配音或发布服务。

## 配置外部服务

外部服务使用你自己的账号，API费用由各服务商收取。按需要配置当前阶段用到的服务。

打开`.env`填写自己的MiniMax Key；音色默认使用官方列出的公共音色`male-qn-jingying`，也可改为自己账号可用的音色。密钥和个人工具路径只放本机`.env`，不提交Git。环境变量优先于该文件，相对路径以仓库根目录为准。正文与片头共用音色，各自的格式和卡点方法仍沿原合同。

公开安装不附个人默认背景音乐，不配置就无正文配乐。需要时按[个人配乐说明](packages/features/background-music/library/README.md)配置；节目已登记的选曲和显式关闭保持原规则。

其它服务按所用阶段准备，不需要为了开始P0先配置齐全部账号：

| 使用位置 | 需要准备 |
|---|---|
| P0/P1使用NotebookLM资料 | 安装已包含`nlm`；先用`node packages/runtime-config.mjs nlm login`登录 |
| P1正文作者、P2默认字幕作者 | 安装并登录AGY，按原作者包选择模型 |
| P1封面、P3/P4图片 | Codex默认原生imagegen；Claude可在`.env`选OpenAI图片API，首次生成需明确图片付费许可 |
| P2备用识别、有旁白片头取时间 | 安装支持必剪／剪映词级时间的VideoCaptioner，在`.env`填写其目录 |
| 具体断言的TypeSafe出处定位 | 设置进程环境`TYPESAFE_API_KEY`或原`~/.config/typesafe/api-key`；项目已包含该定位程序，无需私人脚本 |
| P4选择剧情视频 | 按[即梦安装与登录说明](packages/modules/produce-video-assets/references/canvas-cli.md)准备CLI与账号 |

需要排查环境时运行`npm run setup -- --check`；它只检查本地工具和配置，不查询服务或触发生产。此检查不是每次制作的必做步骤。当前仍需要表中外部工具与宿主能力，不能仅凭安装完成宣称P0—P4已实测通过。

### Claude Code

在仓库目录启动Claude Code，调用`/director`，或直接让它读取`director/SKILL.md`。项目与Codex共用这一份制作方法。

需要生图时，在`.env`设置提供方，并填入你自己的`OPENAI_API_KEY`：

```dotenv
IMAGE_PROVIDER=openai
OPENAI_API_KEY=
```

该API单独计费，需要在开始生成前明确授权；不共用Codex订阅。原生生图仍是默认选项。浏览器使用项目已配置的Playwright MCP，安装Google Chrome后，按Claude的项目MCP信任提示启用，用于Studio预览。完整工具对应见[宿主说明](director/references/hosts.md)。

## 第一个节目

节目放在代码仓外。例如：

```bash
mkdir -p ../my-program
cp scripts/request.example.yaml ../my-program/request.yaml
```

修改委托中的`idea`与约束，在 Codex 或 Claude Code 中打开本仓库并发送：

```text
读取 director/SKILL.md，为 ../my-program 完成 P0。
```

后续按需要继续指定阶段。程序入口示例：

```bash
node engine/cli.mjs status --workspace ../my-program --program first-video --stage p0
```

`.yaml`文件按当前合同保存JSON文本；示例只帮助建立委托，不是已完成节目。详细生产和返工命令如下。

## 常用命令

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

## 常见问题

**支持哪些系统？** 当前安装入口支持macOS，Node.js需要22.12或更新版本。

**Claude Code没有原生生图怎么办？** 按上面的配置接OpenAI图片API，使用自己的Key，并明确授权本次图片付费调用。

**为什么示例或片头没有声音？** 公开版使用可分发的运行资源，部分音频是静音占位。个人默认音乐与原声不随仓库分发，可以自行配置有权使用的素材。

**剧情视频会自动生成吗？** 默认关闭；只有明确要求时才启用。P4最后交付MP4，平台发布由使用者处理。

## 参与与反馈

使用问题通过 [Issues](https://github.com/imocone/historical-explainer-video/issues) 反馈；提交修改前查看 [贡献说明](CONTRIBUTING.md)。安全漏洞通过 [私密安全报告](https://github.com/imocone/historical-explainer-video/security/advisories/new) 提交，见 [安全说明](SECURITY.md)。

仓库基础检查只读取公开源码并运行本地模拟测试，不使用个人密钥、真实节目或付费服务。它不替代完整制作效果的验收。

## 开源范围与许可证

仓库保存可复用生产系统、教学源码、图例及运行必需的已许可资源。真实节目、成品与示例视频、个人密钥、登录状态、开发过程档案及不能公开分发的原素材只留本机，不进入 Git。

公开安装默认没有个人背景音乐；部分教学音频和片头音效使用静音占位。需要声音时自行配置有权使用的素材。

自有代码和文档采用 [MIT 许可证](LICENSE)。第三方字体、地图、纹理、音频及依赖按各自许可使用，见 [第三方许可与素材来源](THIRD_PARTY_NOTICES.md)。
