# 七种效果与原运镜对照

这组完整范例使用三个自带imagegen生成的虚构场面，演示冬营、土路车队与窗边阅读。不是史料或真实剧集。作者可据当前旁白改编选择，底图与前景只是素材示例，不规定节目画风。

`data.mjs`交付七种逐图设计及一个A/B连续设计，经过正式treatment Schema、原Cue时窗和RenderData入口；预览直接调用正式HY Renderer。没有另一套效果或相机。`render.mjs`准备同源公开资源并输出1920×1080、60fps样片，另存当前输入与逐帧相机取样。

```text
# 默认启动Studio直接播放
node packages/templates/fullframe-narrative/examples/effects/render.mjs <输出目录>
node packages/templates/fullframe-narrative/examples/effects/render.mjs <输出目录> stills
node packages/templates/fullframe-narrative/examples/effects/render.mjs <输出目录> video
```

输出包括七种中档效果、三个同运镜无效果底片、低档与高档下雪、16秒A/B组合。可通过`EFFECT_STUDY_IDS=snow,emotion`只渲染指定项。除A/B组合外，每段十秒；`emotion`按示例Cue在1.8秒聚焦、5秒出现克制问号，底图人物的表情和姿态不变；实际人物和光源锚点随示例交付；A/B段由风雪营地进入室内，效果与图共同叠化。固定窗口用于效果比较，不是正式Beat的时长建议。

比较时看三个问题：关注是否有收益、主要对象是否仍清楚、运动是否自然。颜色、场景与旁白选择由当前作者决定；输出成功、相机一致和字段通过只证明执行，不能代替实际观看。当前样片没有配音，示例时点只展示效果与原Cue机制的对应。

三张底图各有自己的动作关系和镜框。冬营保住脸、双手与电报，办公室保住托下巴、持信与面部，车队保住前后车辆及相连道路；均在持续运动中保住各自表达。旧样片须按当前源图和参数重建。带配音的取景、节奏和接镜比较见[实片对照](../viewing/README.md)。
