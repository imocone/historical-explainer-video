# 用实片学习全画幅观看

先看动作和关系，再判断镜头。这里用原创虚构图和中文配音比较已有推拉、平移、变速及接镜，没有新增运镜类型。可从[房间案例](../composition-room.md)、[接镜案例](../joint-reading.md)和[揭示卡](../../camera/methods/pan-reveal.md)按问题进入，不逐单重渲染教材。

## 同题对照

| 对照 | 保持什么相同 | 本组看到的收益与代价 |
|---|---|---|
| 冬营旧框／修正框 | 底图、话语、10秒窗口 | 旧末框裁掉双手和大半电报。修正取景与速度，让持续推近中的帽檐、脸、双手和电报关系保持可读；当前参数须沿原入口重新观看，不沿用旧停镜片的结论。 |
| 房间推近／平移／拉远 | 同一底图、迟疑任务、话语、8秒窗口 | 各选合适取景并保住两手、信和脸。推近加强间隙；平移主要改变位置；拉远增加房间但减弱动作细节。本例取推近，不据此排斥平移或拉远。 |
| 廊下恒速／持续变速 | 底图、解说、路线、起框及实际末框 | 比较4.5秒说到等候者时的显露，以及后半段持续移动中人门关系的可读时间。两片均运动至窗口结束，不能用停镜延长阅读。 |
| 码头接街市：叠化／闪黑 | 同一对图、相机设计与8秒Cue，不同字幕任务 | 普通货物流转用叠化；前单元告一段落再看街市时用闪黑。它是语义对照，不是同内容优劣比较。 |
| 室内外600ms／1600ms叠化 | 两图、相同等待任务、运镜设计、声音及8秒Cue | 比较人物与门墙遮混，短叠化仍须实际观看；不能用闪黑代替尚未解决的构图和阅读问题。 |

另有车队样片：从人手道具迁移到前后车辆与相连道路。图像没有演出车队持续移动，配音与已选姿态共同表达；它不证明今后正式生产已经改好。

## 不同内容的路线选择

虚构灯塔样片由三幅图及对应旁白形成，使用同一正式相机和渲染器。检修台与阶梯示范完整场景中的路线；灯芯片只验证局部素材上的定向推近，不作为完整源图生成范例。生产源图与最终取景仍按[构图方法](../../references/picture-construction-method.md)联合设计，不把三种运动排成轮换表。

| 片段 | 构图怎样支持运动 | 实际观看任务 |
|---|---|---|
| `transfer-supply` | 木箱、线缆和检修台沿左右相连，两端人物各有分量 | 先读送来器材的工人，再沿线缆把注意力交给接手者；横移保持尺度，落点继续读双手和灯具。 |
| `transfer-height` | 下方工人、连续阶梯与上方灯室构成纵向关系 | 从携带工具的人沿阶梯上移，让高处灯室进入，留下阅读工人与高度关系的时间。 |
| `transfer-wick` | 局部灯具素材中，灯芯、调节轮与手指已有可读分量 | 验证定向推近能否保住细小联系；不证明完整灯室到灯芯特写的运镜可行。 |

先看三片的连续观看，再回原图理解位置、分量与路线。速度变化与连续行程按这三段话语与实图安排，数字不向其它场面迁移。取材与事实均为虚构，不进入真实节目输入。

```text
VIEWING_STUDY_IDS=transfer-supply,transfer-height,transfer-wick node packages/templates/fullframe-narrative/examples/viewing/render.mjs <输出目录> video
```

三幅原图分别为[检修台](assets/motion-transfer/supply.png)、[阶梯](assets/motion-transfer/height.png)和[灯芯近景](assets/motion-transfer/wick.png)，由自带imagegen新生成。路线和语音时点保存在同一`data.mjs`，可沿原入口重建；独立样片与首次正式生产质量仍分别判断。

廊下两片以同一速度积分匹配实际末框，均持续运动。取样由原运行时形成；实际显露、手与姿态及情绪收益须配合当前参数的实片判断，不沿用旧停镜样片的坐标或结论。

## 重放

```text
# 默认启动Studio直接播放
node packages/templates/fullframe-narrative/examples/viewing/render.mjs <输出目录>
node packages/templates/fullframe-narrative/examples/viewing/render.mjs <输出目录> video
```

输出`index.html`、1920×1080／60fps有声MP4、输入及相机取样。在输出目录启动静态服务器后打开页面，可同步重播；同内容组声音只播左片，语义对照组分别播放。只取截图时末参数用`stills`；按需用`VIEWING_STUDY_IDS=ordinary-dissolve,ordinary-dip-to-black`选择项。

macOS需本地`Tingting`语音、`say`、ffmpeg／ffprobe及项目现有HY依赖；首次运行生成免费本地配音，并检查语音没有被Cue截断。重复运行复用相同文字和时点的配音。完整语音、静默段与字幕共同提供观看时间，不以音乐掩盖节奏。

`data.mjs`提交原treatment与actionTimings；`render.mjs`使用正式几何、时窗、RenderData、相机、A/B转场、字幕和HY Renderer。教学没有剧集生图回执，Schema仅豁免该回执字段，未修改生产Schema、Validator或Engine。旧冬营参数只保留为教学对照，不是兼容分支。

两张新图与办公室定点修图由imagegen完成，提示见[生成记录](assets/prompts.json)。办公室曾多出第三只手；修后保留托下巴和持信的两手。生产中按[实图落镜方法](../../camera/realization-method.md)结合实际画面落实表达与取景，有具体偏差时定点处理。人物、建筑、服装及数字均不作节目事实或固定画风。

码头与街市同样由自带imagegen生成，提示及参考关系见[普通承接素材记录](assets/transitions/prompts.json)。只补足原教材缺少的普通叠化正例，不增加生产步骤。

## 验证边界

现行数据已取消停镜并调整行程；既有停镜版视频不代表当前规则，须沿原入口重新渲染。几何与逐帧执行验证不代替调整后样片的完整观看。联合设计的专业方法已经回写原方法及案例，没有新增评分、审阅轮次、生产字段或门禁。正式P3的作者是否正确迁移方法、定稿锁与B2接纳、首次正式成片质量，本次均未验证；不刷新真实节目补证明。

借鉴[cinematic-camera](https://github.com/Liamrjohnston/remotion-motion-graphics-skill/blob/b860c7921f2220b9e2a84e815ba0ae7b10858f08/skills/cinematic-camera/SKILL.md)把信息次序、空间和阅读节奏共同组织的思路。其短动画速度、较大画布、停止再启动及审核流程未搬入。
