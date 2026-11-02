# 一条近路，为什么让全城更堵？

成品视频不随仓库分发。本例保留教学源码、图件和时序；需要动态预览时，沿本例已有构建入口在本机生成。配套旁白仅为同长度静音占位，构建程序优先读取本机保留的原声。已有完整原片保留在本机的local-media/private-assets/对应路径。

原研究作品（仅本机保留） · [场景](scene.html) · [动画](animation.js) · [状态模型](model.mjs)

已有独立研究作品，约72秒，1920×1080、30fps，保留原旁白与字幕布局。

车流、道路耗时和比较图形来自同一状态；镜头从整个路网进入一个司机的选择，再回到集体结果。道路展开成耗时长度，关闭近路后重新分流。内容采用[布雷斯悖论的简化路网模型](https://www.cs.cornell.edu/home/kleinber/networks-book/networks-book-ch08.pdf)，车辆运动为示意。

按需要查看这些代码：

- `model.mjs`：从当前时间取得车流选择、计数和耗时，关键状态为65、80、85、65分钟。
- `animation.js`中的`model(t)`、`roads`和`cars`：共同状态怎样驱动对象与读数。
- `camera`、`pts`和`reference`：局部取景、整体比较和道路转为耗时图形的编排。

用已有音频重建到临时目录：

```bash
node packages/templates/vox-explainer/examples/braess/build.mjs
```

该入口使用包内`runAnimation`生成独立研究工程；正式作者、真实Cue、字幕与P4交付仍沿当前工作单执行。
