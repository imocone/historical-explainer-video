# 流畅，可以攒出来

成品视频不随仓库分发。本例保留教学源码、图件和时序；需要动态预览时，沿本例已有构建入口在本机生成。配套旁白仅为同长度静音占位，构建程序优先读取本机保留的原声。已有完整原片保留在本机的local-media/private-assets/对应路径。

完整样片（仅本机保留） · [画面](art.mjs) · [动画](animation.js) · [播放模型](model.mjs)

83.9秒，1920×1080，60fps，含旁白、公共字幕和原创声音设计。这是独立样片，不代表任何剧集的正式接纳。

卡住的骑行画面被拆成时间片，倒回同一到达记录后，先储存余量，再展开成连续画面。两种开播策略并排比较，最后让余量耗尽，交代等待的代价与缓冲的边界。

**0.8秒，原片完整帧。** 先看骑行者、车、道路与周围层次怎样组成同一画面，再看下面的身体局部。图片直接取自`buffer-film.mp4`，时刻以该片开始为零点。

![缓冲原片0.8秒1920×1080完整帧](frames/frame-0.8s.png)

**骑行局部，从左到右为0.8、1.3、1.8秒。** 每格均从1920×1080原帧的同一像素范围`x=930, y=350, width=400, height=400`裁取，未改变姿态或重画。上身前倾、手与车把、臀部与座位先形成适合骑行的姿态，腿脚再随踏动改变轮廓；双腿前后遮挡、车轮及围巾配合变化。局部用于看构形与接触，整幅分量仍以上面的完整帧判断。

![缓冲原片0.8、1.3、1.8秒骑行局部过程，左至右排列](frames/rider-process-0.8-1.3-1.8s.png)

对应实现：`art.mjs`的`movie`（42—59行）先画骑行体块、衣物与车架的关系；`animation.js`的`paintMovie`（38—57行）由`played`求脚的位置、腿的路径、鞋与车轮等当前状态。上身和手把接触主要由既定形体保持，不是动态上肢求解；这组图例提供身体与器物的构形、接触及联动手艺，不把骑行姿态、运动幅度或场景推广到其它行动。

## 按需参考

- `art.mjs`与`animation.js`：同一骑行形象在完整画面、时间片、队列和胶片之间转换，镜头与对象分别编排。人物动作可跨题参考：先看骑行展开及播放、卡住的实际片段，再查`movie`的身体姿态、手与车把的接触，及`paintMovie`怎样由同一播放进度求脚的位置、双腿轮廓、鞋和车轮运动；按本题重新设计姿态与器物，不沿用骑行模型。
- `model.mjs`与`arrivals.json`：同一到达记录生成两种播放安排，驱动画面、余量、读数和等待状态；`audio.py`沿同一记录安排声音。
- `build.mjs`与`film.jsx`：使用当前模板的appearance、真实Cue接口、scene、renderData、渲染器和公共字幕；图像与字幕由同一HyperFrames时钟定位。

这些是本题的制作决定。其它作品按自身目标选择素材与编排。

## 复现

在项目根目录使用保留的混音构建，产物写入`tmp/vox-buffering-demo/`：

```bash
node packages/templates/vox-explainer/examples/buffering/build.mjs
node packages/templates/vox-explainer/examples/buffering/build.mjs preview
node packages/templates/vox-explainer/examples/buffering/build.mjs render
```

可在动作后指定输出目录。入口会校验treatment与示意模型，预演和导出使用项目现有HyperFrames；它是样例复现工具，正式创作沿当前工作单交付。

`narration.json`保留旁白，`timing.json`保留当前时间安排，`assets/narration.wav`包含旁白与音乐。`audio.py`保留声音制作源码；需要重新研究声音时，在macOS已有Tingting与FFmpeg的环境中运行，输出另存为`tmp/vox-buffering-audio/`，不会覆盖本例：

```bash
/Users/imoconeice/.local/bin/python packages/templates/vox-explainer/examples/buffering/audio.py
```

## 示意与依据

12格各代表一秒视频，不代表真实视频帧、编码包或网络协议。立即开播会等待，延后两秒开播在这段有限记录中连续播放；缓冲不增加带宽，也不能保证持续吞吐不足或断网时无限顺畅。此策略不代表所有播放器的实现。

概念依据：[MDN媒体缓冲与时间范围](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Audio_and_video_delivery/buffering_seeking_time_ranges)、[MDN waiting事件](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/waiting_event)。本例插画由SVG绘制，旁白由本地Tingting合成，音乐与动作音由程序合成。
