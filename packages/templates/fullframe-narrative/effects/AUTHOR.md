# 全画幅有限动画与效果

作者按当前场面、旁白与全片语境选效果；程序不按关键词自动选择。先让画面和运镜成立，再决定效果的收益。不用时省略逐图`effects`。效果在原联合设计中形成，不增加创作步骤。

| 效果 | 使用场景 | 三档强度及参数 |
|---|---|---|
| `snow` 下雪 | 有依据的冬季室外、风雪行军 | 稀疏 → 有前后层次 → 更密、更大、更强漂移；`direction=calm / left / right`，省略为微风 |
| `foreground` 虚化前景 | 树林、冬营、从近处遮挡看向人物 | `preset=pine / foliage`按场景选枝叶，`side=left / right`选侧别，省略为左；强度改变覆盖和虚化，前景与原图产生移动差 |
| `emotion` 人物聚焦／疑问提示 | 旁白需要短暂把关注收向人物，或强调已有疑惑 | `symbol=focus`只聚焦，不加符号；确需疑问提示时选`question`。强度改变聚焦明暗或问号大小，不改变人物表情或姿态 |
| `fog` 雾 | 清晨、寒湿、低能见度 | `region=lower / full`，省略为低处；薄雾 → 清楚雾层 → 较厚，移动缓慢，保住主要动作 |
| `dust` 烟尘 | 干燥道路、行军、车队、已有烟尘的场面 | 低处团状烟尘与细密纹理，强度改变密度、厚度和漂移；不能制造旁白没有的炮击或火灾 |
| `soft-light` 柔光 | 窗边、夕照、回忆等已有合适光源的场景 | 必选`source=top-left / top-right`控制光束朝向，并用`anchorFocus`点明真实光源；实图锚点随原相机移动，强度改变光束，不整屏提亮 |
| `grain` 颗粒 | 胶片或纸面质感 | 细微 → 清楚 → 明显；只改变纹理，不抖动、不改运镜，不伪装成历史影像 |

雾、烟尘可选`direction=left / right`，省略向右；`region=lower / full`决定低处或全图，省略为低处。按表达选择效果组合与强度，避免各项争抢关注。人物聚焦／提示只在叙事需要时短暂出现；庄重段落优先无符号聚焦，精细物件应避开强雾、前景遮挡和强颗粒。

## 逐图交付

每项必交`type / intensity / timing / reason`，`intensity=low / medium / high`；理由说明场景或旁白为什么需要本项。

- `timing=scene`随所属图持续，含转场中已显露的部分；显示由原图片转场控制，不另做入退场淡化，不增加Cue绑定。
- `timing=cue`另交`durationMs`，通过原cue-sync绑定`target=<requestId>.effect.<effects数组索引>`、`action=show-effect`及真实`cueId + edge`。动作必须完整落在该图可见时窗，不能跨图；按测量反馈调整本项Cue、时长或选择。
- `emotion`必用`cue`，时长800—2400毫秒，另交`symbol / anchorFocus`。聚焦定位面部或主要反应部位，问号定位头顶；柔光的`anchorFocus`定位发光窗口等真实光源。先写目标描述，取得实图后再填坐标。

```json
"effects": [
  {"type":"snow","intensity":"low","timing":"scene","direction":"left","reason":"室外冬营正在降雪，保持人物清楚"},
  {"type":"foreground","intensity":"low","timing":"scene","preset":"pine","side":"left","reason":"从营地边的树后看向军官，增加近远距离"},
  {"type":"emotion","intensity":"medium","timing":"cue","durationMs":1600,"symbol":"focus","anchorFocus":"手持电报的军官面部","reason":"旁白在此转向他对命令的反应"}
]
```

第三项的目标为`AR001.effect.2`，动作是`show-effect`，Cue必须选本单真实ID。原画面与解说框绑定保留；全部选择写同一候选，沿原inspect-design和lock-callouts测量、锁定。

`sceneDescription`完整描述静态场面，包括人物表情、姿态、地面积雪、环境及光源。组件只叠加运动雪粒、透明前景、聚焦明暗和问号等效果，不要求把这些叠加层画进底图，也不会让人物改变表情或动作。调强度、符号或卡点不改变静态生图投影；真实场面变化仍沿原素材流程处理。

## 实图与呈现

P3作者取得实图后，在当前图片请求的`effectAnchors`填写人物及光源的源图归一化坐标，与最终`motion`一起交付。键是effects数组索引，值为`{"anchorFocus":"原目标描述","x":0.5,"y":0.2}`；数字仅示意，须据完整实图定位。整份提交effectAnchors，保留其它有效锚点；材料不足先补看，缺失目标回图片或设计责任，不猜位置。定位错误只修锚点；强度、方向、侧别或卡点调整只改效果及其Cue，不重生底图、不重写运镜。聚焦和问号跟随原相机，目标离开画面就隐藏，不钉在边缘；光束随实际光源投影。

效果与所属图一起参与原转场，透明前景不占A/B素材数；字幕与解说框继续在效果之上。作者让效果给主体和文字让出关注，不用强效果弥补构图。HY提供唯一帧时钟，跳帧、暂停、预览与成片共用呈现。样片只说明能力，不提供本集事实。
