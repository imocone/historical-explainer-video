# Lemo来源与本项目适配

上游：<https://github.com/lemomo-ai/lemo-opuscar>，固定提交`f17136060781a0068a7951245a3aa7835a7230de`。

- `lemo/sfx.py`原样取自`core/audio/sfx.py`；`lemo/LICENSE`保留上游MIT原文。实际库构建调用其滤波、包络、噪声、norm、add及click/clack/whoosh/creak/thump/pop。
- `build-library.py`的paper、woodtap、metal分别源自`styles/archive-lighttable/demo/mix.py`、`styles/impasto/demo/mix.py`、`styles/teardown/demo/mix.py`。正文使用本地调整的paper、metal、whoosh及ding配方，柔化摩擦或扫声、控制共鸣和余响。库构建固定随机种子、48kHz双声道、留音量余量；成片消费生成的WAV，不需要本机Python。
- `lemo/ink_wash.py`提取`styles/ink-wash/demo/mix.py`的env_adsr及12个拟音函数，`lemo/watercolor.py`提取`styles/watercolor/demo/mix.py`的辅助函数及10个拟音函数。函数体保留上游实现，只适配导入、随机种子及房间脉冲初始化；不执行原样片的配乐、TTS或成片脚本。笔刷、水、布料、印章与持续过程可实际生成，不只在规则中列名。
- `DIRECTOR.md`第4、6、7节提供画声共同设计、材质选择和节奏方法；`TECHNIQUE.md`第2、3、6节及`core/render/events.mjs`提供声明声音事件、共享时间和离线混音的方法。产品拆解的落地事件从实际动作起点与时长派生，工程简报以同份film.json驱动画面与声音。
- 本项目保持正式旁白和单曲指定BGM，采用原Cue轴，不移植Lemo的作曲、TTS、音乐网格、画面渲染、环境底音默认、强制静音次数或整套mux流程。全画幅以原cue-sync动作加作者编排偏移定位；讲解scene.events拥有动作时间，eventTime与音效引用共用解析结果，静音保留画面，预览与P4共用现有PCM混音。

文件许可覆盖上述引入代码；`library/`中的WAV由这些程序生成。

解耦后保留全部原core/audio/sfx.py声音生成器；generate.mjs消费当前作者的配方，synthesize.py直接调用原函数和add，支持参数、时长、固定seed与分层。原入口也执行作者按本段动作编写的专用render函数，并保存实际源码与配方，不把固定生成器表当作能力上限。该接口与专用函数示例为本项目适配代码；方法来自上游工程简报样片的marker、magnet_snap、pop_off、landing、ship_horn等按动作编程的实践，并非自动匹配算法。共享render-video保留浮点叠加、实测真峰值和最终量化；不移植整套作曲或音乐网格。声音疏密、层次和长短由内容推进决定，不预设少量短点缀，也不照搬每动作必配声及固定静音次数。

共享render-video借鉴Lemo的旁白压缩、让位与最终响度处理，使用FFmpeg执行。正文音效在独立音轨组内轻减存在感频段，并随旁白适度降低，保留动作和停顿中的设计。正文音乐继续消费作者的收放包络并随旁白自动让位。完整母线先测量EBU响度，再作两遍处理及过采样峰值限制，最后裁出预览窗口。J-cut保留下一段准备声，L-cut保留自然余韵；包根据真实内容决定是否使用。

整章声音设计方法同时学习工程简报样片按“问题、约束、比较、揭晓”组织声态的做法：撤声与回归也是表达。声音作者把音乐收放意图随原结果交付，background-music解析原单曲的增益包络，共享混音执行；不复制原样片旋律、调性、配器或音乐采样，不把自动让位冒充这一内容设计。

## 实录素材

两份录音来自 Joseph Sardin 的 BigSoundBank，按各原作页声明的[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)提供。`recordings/`保存48 kHz PCM裁切版，按动作或环境需要选用。两份均去除低端隆隆声、收敛高频、轻淡化边缘并保留混音余量。

| 素材 | 原作与截取范围 | 下载原件SHA-256 |
| --- | --- | --- |
| `heavy-wood-door.wav` | [Wooden barn door](https://bigsoundbank.com/wooden-barn-door-s0538.html)，6.36–7.98秒 | `5ef49e91b78e1199bc593e5641ac16dd343bac2c3307ac6e9656f73f3e3cdc81` |
| `shore-lap.wav` | [Small Waves, Froth and Beach](https://bigsoundbank.com/small-waves-froth-and-beach-s1447.html)，0–5.1秒 | `beebf5efaa72d25a4ab12ef3a1480ea0ff469cfe1d39586306c919bf55bcfb30` |

## 专业做法与开源实现

- Walter Murch 拆解《现代启示录》直升机段落时，让不同声音轮流取得注意力，保留场面的密度，也让重要声音听得清。Randy Thom 把人物如何听见空间、何时听见变化作为叙事选择。对本项目，先用实际旁白和配乐确定注意力在哪，再决定环境何时收住、动作何时入场。[Murch 原文](https://transom.org/wp-content/uploads/2005/04/200504.review.murch_.pdf) · [Thom 原文](https://people.willamette.edu/~gorr/classes/ids252Sp13/lectures/DesigningSoundRandyThom.pdf)
- Ken Burns 的《战争》从多处实录库挑时代与场景相符的声源，以已确定的对白和音乐平衡加入音效。本项目借用的是按镜头找相符的声音、按旁白留空间。用现有来源登记接入当次实际选中的录音。[制作团队访谈](https://www.mixonline.com/technology/ken-burns-war-383961)
- Freesound 的实现分别保存声音、描述、标签和许可，检索可按片长等条件缩小范围。Audacity 把片段中途的强弱变化和轨道总音量分开。本项目沿用已有来源清单、裁切和淡出，选声时看动作与许可，安排起落时用原时间轴。[Freesound 源码](https://github.com/MTG/freesound/blob/da3a786e2e5bdcaec1265b0798d4e212d2015720/sounds/models.py) · [检索接口](https://freesound.org/docs/api/resources_apiv2.html) · [Audacity 片段音量](https://www.audacityteam.org/manual/clips/clip-gain/)
- MMAudio 用视频和文字条件生成，并用同步特征贴合画面。FoleyCrafter 另外预测声音的起始时刻。两者可以为单个动作提供候选。它们的生成入口不消费本项目已定稿的旁白、历史边界与配乐取舍，现阶段整段配声仍交给原作者。[MMAudio 生成入口](https://github.com/hkchengrex/MMAudio/blob/974010a026c731054592d8f777218bd9d85a6c24/demo.py) · [FoleyCrafter 生成入口](https://github.com/open-mmlab/FoleyCrafter/blob/b4526d1586aaf044140b359295504452297f8c13/inference.py)
