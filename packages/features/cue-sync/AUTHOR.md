# Cue Sync Feature（卡点同步）

## 身份与调用关系

`cue-sync`是装配到`author-beat/beat-feature`插槽的Feature，不是Workflow节点、Module或独立提交流程。它只在当前所选Template点名的位置，把Template已经形成的合法动作绑定到当前作者单位的真实字幕边界，并把一个`{items:[...]}`结果返回调用方。

```text
所选Template形成合法动作与当前字幕范围
→ cue-sync完成绑定
→ Template继续自己的后续步骤
→ author-beat最终把结果写入featureResults.cue-sync
```

普通单位的范围是一个Beat；连续讲解单位的范围是整个`templateRun`，可以使用全部成员cues，成员Beat边界不截断动作。正文工作流必须具有该Feature的最终结果；不得关闭、漏写或用模板默认时间替代。

## 调用前提

调用方必须同时交付：

- 当前作者单位的全部真实cues与允许范围；
- Template已经形成的合法`target / action`集合及必须保持的专业先后关系；动作编号和存储位置不决定播放时间；
- Template投递的合法选项或一次完整推荐方案。

全画幅在联合设计中从`templateContext.cueOptions`交付`frameId / action / cueId / edge`，同帧作者请求的`requestId`作为`target`；有短时效果时按模板效果方法交`show-effect`，定稿后如有实际解说框，再交付`show-callout`。场景持续效果没有额外绑定。不得猜动作或读取确定性源码补清单。

Vox讲解在Template指定位置运行cue-options，完整读取当前moments对应的合法目标、真实cue池与选项；本Feature按口播语义为每个观看变化绑定advance-explainer。推荐方案仅在模板实际提供时参考，不能代替语义选择。同一时刻可以绑定多个观看变化，既定顺序仍由模板核对；画面的保留、替换、换景与句内动作由同一scene表达，不由绑定自动推断。需要调整时只修同一绑定结果，已有准确前缀保留；观看变化或画面职责有误返回Template，不逐零件增加卡点。

任一前提缺失时不开始绑定，直接把缺口返回当前Template；输入核实本身不构成Feature步骤。

## 唯一业务步骤：绑定动作与字幕边界

为每个合法动作选择一个语义准确、顺序成立的真实字幕边界。每项只保存：

```text
target / action / cueId / edge
```

`edge`只允许`start`或`end`；不保存短语、词级时间、字符估时、偏移、帧数、动画时长或缓动。不得增加自由动作、隐藏目标、整集绑定表，也不得关闭Template动作来适配容量。

稳定结果是当前单位唯一的`{items:[...]}`：每个合法动作恰有一个绑定，没有遗漏、重复、越界或倒序。全画幅可以在联合设计中写入画面动作，解说框设计继续完善同一个结果；Vox讲解在Template指定位置形成完整结果。调用方把现行结果写入唯一候选的`featureResults.cue-sync`，本Feature不自行提交工作单。

完成条件：结果通过当前Template时序预算、`cue-sync` Schema和Validator。确定性程序会在接纳前把真实cue边界换成帧；本Feature不填写帧数或P4实现；Template允许的部件内动作时长由Template自身合同与方法拥有，不能写入cue绑定。合同核对是本步骤的完成条件，不另立“核对并提交”步骤。

Author Preflight按真实字幕边界时间整理已选绑定；同一时刻按模板目标清单稳定排列，完整校验通过才写回原候选，不改变`cueId / edge`。重复、未知动作、遗漏、越界或违反模板专业先后关系仍失败。全画幅解说框各自独立触发，预留引文存放在最后不要求它最后出现；全画幅A/B与Vox讲解moments的既定先后关系仍由各自Template核对。

## 失败返回

- 动作有合法边界但当前选择不准确或不顺序：留在本步骤重新绑定。
- 合法动作集合超过真实Cue容量：返回`action-capacity-conflict`。
- 当前字幕范围不存在任何可执行绑定：返回`cue-range-unexecutable`。
- Template动作、画面职责或范围本身需要变化：只报告事实并返回调用Template，由Template决定回到自己的哪个步骤。

本Feature不得自行改Template动作、扩大字幕范围、增加兼容动作、使用默认时间，或决定调用方返回哪个上级节点。
