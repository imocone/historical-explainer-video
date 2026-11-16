# Cue与句内时序

## Cue绑定

全章粗排按分镜在原scene排实际观看转折，为重要的变化写 `moments`。同一镜可有多次变化，切镜也可由原动画单独安排。粗排初期若要用原预演短试，只写并绑好当前试做用到的项。把 `moments` 写入本单原候选后运行：

```bash
node packages/modules/author-beat/cue-options.mjs <工作单> <候选>
```

每次只给`nextTarget`的`legalOptions`。按本单文字和时窗选一条，经本单cue-sync写入`featureResults["cue-sync"].items`末尾（如`{target:"M001",action:"advance-explainer",cueId,edge}`），再运行命令选下一项，直到返回`complete:true`。`cuePool`是原始时点池，不能代替当前合法选项。返修时保留首条受影响绑定之前的有效前缀，从受影响处逐项重验；后续旧选择仍合法且符合设计的，原样写回。

`advance-explainer`提供`cue(id)`的时间锚点，画面换镜和状态变化由animation编排。选项按原字幕毫秒检查顺序，同一帧可容纳按顺序绑定的多个变化。最后一个Cue的结束点取本章最后一帧。对象可跨锚点持续动作，已声明的动作偏移须落在本章内。动作和阅读留多少时间，由实际预演判断。

## 画面动作时刻

需要多个画面对象共用接触、断开或落定时刻时，可在`scene.events`声明`{id:'E001',target:'M002',offsetSeconds:.45}`，动画通过`eventTime('E001')`读取。它是可选的画面时间接口：target引用已有moment，偏移相对其Cue绑定时刻，按实际动作或已投递的实测短语编排；已有动画可继续使用`cue`，不要求每个对象声明事件。

## 实测短语与句内卡点

当前任务视图的`templateContext.audio.speechTiming`按需给出P2已接纳、与同一原声绑定的实测短语。`available:true`时，只含本段Cue；每个`phrases`条目有`index / text / startOffsetSeconds / endOffsetSeconds`。偏移已沿原渲染帧率计算，均相对于该Cue的start；相同文本的不同次出现按Cue与index区分。原生词与ASR差异块都保持实际可用的整体边界，不能将词内各字平均分时。

需要精卡时，把对应moment沿原cue-sync绑定该Cue的`edge:"start"`。以卡在短语说完为例，在`scene.events`为该moment设一个事件，`offsetSeconds`填入本单选中的`endOffsetSeconds`。动画用事件时刻：

```js
const contact = eventTime('E001');
```

在该时刻做出观众真能看见的变化；具体安排见[作用与回应](motion.md#作用与回应的错时)。事件按帧合成Cue与短语偏移，硬切、显隐和状态更新可落在同一帧。需要贴发声开始时用该条目的`startOffsetSeconds`。不得把相对Cue开头的偏移加在end锚点上，也不能把整段Cue边界或手调动作秒数叫作词级实测时间。`available:false`时仍可按口播文本与Cue时窗编排；句内落点只是设计偏移，不能声称已与具体词语精确同步。不为取时间擅自重做配音、再次识别或补造对齐数据。原声或字幕真实变化后重取当前任务视图，并校准受影响的偏移和动作。
