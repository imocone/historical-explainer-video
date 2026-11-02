# Cue与句内时序

## Cue绑定

把`moments`写入候选后运行：

```bash
node packages/modules/author-beat/cue-options.mjs <工作单> <候选>
```

按本单文字、时窗及完整合法选项选择Cue，通过本单cue-sync把每项绑定为`{target:"M001",action:"advance-explainer",cueId,edge}`，写回同一候选的`featureResults["cue-sync"].items`。这个action只提供`cue(id)`的时间锚点，不自动换页或清空场景；对象可在多个锚点之间持续动作，具体时长和句内延迟在animation中设计，随画面预演校准。

## 画面动作时刻

需要多个画面对象共用接触、断开或落定时刻时，可在`scene.events`声明`{id:'E001',target:'M002',offsetSeconds:.45}`，动画通过`eventTime('E001')`读取。它是可选的画面时间接口：target引用已有moment，偏移相对其Cue绑定时刻，按实际动作或已投递的实测短语编排；已有动画可继续使用`cue`，不要求每个对象声明事件。

## 实测短语与句内卡点

当前任务视图的`templateContext.audio.speechTiming`按需给出P2已接纳、与同一原声绑定的实测短语。`available:true`时，只含本段Cue；每个`phrases`条目有`index / text / startOffsetSeconds / endOffsetSeconds`。偏移已沿原渲染帧率计算，均相对于该Cue的start；相同文本的不同次出现按Cue与index区分。原生词与ASR差异块都保持实际可用的整体边界，不能将词内各字平均分时。

需要精卡时，把对应moment沿原cue-sync绑定该Cue的`edge:"start"`，直接取目标条目的偏移。例如当前条目的`endOffsetSeconds`为1.2，设计要在这次发声完成时让物件接触：

```js
const contact = cue('M002') + 1.2; // 1.2复制自本单选中短语的实测偏移
timeline.to(select('#parcel'), {x:180, duration:.45}, contact - .45);
timeline.from(select('#keyword'), {opacity:0, y:8, duration:.15}, contact);
```

动作时长和字组效果按本题设计；若要贴发声开始，用该条目的`startOffsetSeconds`。不得把start偏移加在end锚点上，也不能把整段Cue边界或手调动作秒数叫作词级实测时间。`available:false`时仍可按口播文本与Cue时窗编排；句内落点只是设计偏移，不能声称已与具体词语精确同步。不为取时间擅自重做配音、再次识别或补造对齐数据。原声或字幕真实变化后重取当前任务视图，并校准受影响的偏移和动作。
