# Lemo来源与本项目适配

上游：<https://github.com/lemomo-ai/lemo-opuscar>，固定提交`f17136060781a0068a7951245a3aa7835a7230de`。

- `lemo/sfx.py`原样取自`core/audio/sfx.py`；`lemo/LICENSE`保留上游MIT原文。实际库构建调用其滤波、包络、噪声、norm、add及click/clack/whoosh/creak/thump/ding/pop，不是新写替代制声器。
- `build-library.py`的paper、woodtap、metal分别取自`styles/archive-lighttable/demo/mix.py`、`styles/impasto/demo/mix.py`、`styles/teardown/demo/mix.py`，仅改为通过S访问上游函数。库构建固定随机种子、48kHz双声道、留音量余量；成片消费生成的WAV，不需要本机Python。
- `lemo/ink_wash.py`提取`styles/ink-wash/demo/mix.py`的env_adsr及12个拟音函数，`lemo/watercolor.py`提取`styles/watercolor/demo/mix.py`的辅助函数及10个拟音函数。函数体保留上游实现，只适配导入、随机种子及房间脉冲初始化；不执行原样片的配乐、TTS或成片脚本。笔刷、水、布料、印章与持续过程可实际生成，不只在规则中列名。
- `DIRECTOR.md`第4、6、7节提供画声共同设计、材质选择和节奏方法；`TECHNIQUE.md`第2、3、6节及`core/render/events.mjs`提供声明声音事件、共享时间和离线混音的方法。产品拆解的落地事件从实际动作起点与时长派生，工程简报以同份film.json驱动画面与声音。
- 本项目保持正式旁白和单曲指定BGM，采用原Cue轴，不移植Lemo的作曲、TTS、音乐网格、画面渲染、环境底音默认、强制静音次数或整套mux流程。全画幅以原cue-sync动作加作者编排偏移定位；讲解scene.events拥有动作时间，eventTime与音效引用共用解析结果，静音保留画面，预览与P4共用现有PCM混音。

文件许可覆盖上述引入代码；本包WAV全部由这些程序生成，未复制第三方音频采样或演示片音乐。

解耦后保留全部原core/audio/sfx.py声音生成器；generate.mjs消费当前作者的配方，synthesize.py直接调用原函数和add，支持参数、时长、固定seed与分层。原入口也执行作者按本段动作编写的专用render函数，并保存实际源码与配方，不把固定生成器表当作能力上限。该接口与专用函数示例为本项目适配代码；方法来自上游工程简报样片的marker、magnet_snap、pop_off、landing、ship_horn等按动作编程的实践，并非自动匹配算法。共享render-video保留浮点叠加、实测真峰值和最终量化；不移植整套作曲或音乐网格。声音疏密、层次和长短由内容推进决定，不预设少量短点缀，也不照搬每动作必配声及固定静音次数。

共享render-video借鉴Lemo的旁白压缩、让位与最终响度处理，使用FFmpeg执行；完整母线先测量EBU响度，再作两遍处理及过采样峰值限制，最后裁出预览窗口。旁白和重点拟音动态控制指定音乐的混音电平，音乐原件及选择不改写；这些属于共享播放与成片职责，不属于音效包。J-cut保留下一段准备声，L-cut保留自然余韵；包根据真实内容决定是否使用。

整章声音设计方法同时学习工程简报样片按“问题、约束、比较、揭晓”组织声态的做法：撤声与回归也是表达。声音作者把音乐收放意图随原结果交付，background-music解析原单曲的增益包络，共享混音执行；不复制原样片旋律、调性、配器或音乐采样，不把自动让位冒充这一内容设计。
