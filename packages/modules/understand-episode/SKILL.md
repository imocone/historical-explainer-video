---
name: understand-episode
description: 从整集正式口播与字幕生产 storyboard.yaml 的 understanding 区；只锁定跨下游必须一致的语义，不切 Beat、不设计画面。
---

# 整集语义理解

为导演和分段作者建立共同理解：整集真正要讲什么，关键关系怎样成立，涉及哪些人的处境与后果，使后续页面保留同一含义。

唯一产物是`{understanding}`候选。专业判断只见`references/text-understanding-method.md`。

## 路线

```text
核实正式输入 → 通读并形成最小共享语义 → 写入唯一候选并提交
```

这是一个创作步骤，不先造全文事实账本、不枚举覆盖、不另做封存或第二次组装。必需正式输入缺失，或冲突使整集核心语义无法成立时停止；不阻碍当前交付的未决按文字理解方法保留，缺乏依据的关系不写成确定事实。没有登记来源不等于缺少必需输入，不得用常识补齐。

## 执行

先运行并一次读取当前任务视图：

```sh
node packages/p3-task-view.mjs <workOrderPath>
```

按顺序完整读取其中全部`inputs.cues`、已投递来源和`references/text-understanding-method.md`；存在`inputs.returnRequest`时也必须完整读取。返工输入只限定当前必须关闭的问题与范围，不是事实来源，也不授权读取旧理解稿、旧候选或模型记忆。写入范围只能是`understanding`。

通读全文后，在同一判断中直接形成：

- `episodeQuestion / thesis / narrativeArc`和整集`semanticReading`三项压缩；
- 只有下游不能从当前cue安全恢复时才建立的`facts / relations`；
- 只有共享语义确实使用工作单来源资产时才建立的登记来源`evidence`；
- 会改变下游画面或事实强度的声音边界、语境、修辞、人的处境、`uncertainties / mustNotInvent`。

每个局部对象用`cueRefs`直接锚定正式正文。正文原文不复制为evidence；显然事实、转场、重复说明和单靠当前cue即可安全理解的内容不建立对象。`facts / relations / evidence`及四类局部语义数组都可以为空。F/R/E编号只需在各自数组内唯一且符合格式，不为增删对象重排已有编号。

把完整结果一次写入工作单规定的唯一`candidatePath`；候选必须携带当前`taskDigest`，不得使用`returnTo`。提交前从下游反查：Director是否能据此组织整集与分页，Author是否能保留局部cue容易丢失的关系、修辞真义和人的处境，并正确处理声音与来源边界；删除后不改变这些判断的对象必须删除。

候选必须且只能是`{understanding: {...}}`，不得写其它storyboard区块、`_producer`或正式路径。Schema／Validator核对形状、cue与来源存在、引用和修辞原句；开放语义由本包负责，不能用机械通过代替。

## 边界

- `understanding`只保存多个下游必须共同继承的最小稳定语义，不逐段复述全文，不建立Meaning Unit或准分镜。
- 不要求每条cue被语义对象覆盖；正式cue由Director和Author直接消费，并用`Cxxx`作为正文来源引用。
- 不创建Beat、模板、画面、素材、运镜或卡点。
- 不把来源未支持的日期、数字、身份、地点、因果、动机、心理、伤亡或经历写成共享事实；不据此禁止下游合理演绎、神态动作、视觉隐喻和幽默，具体边界由文字理解方法拥有。
- 正式输入的哈希与生产追溯由Engine记录，候选不重复填写。

## 交接与失效

- 正式接纳前只修改当前唯一候选；不得直接写正式故事板。候选经Engine按Schema和Validator接纳后写入`storyboard.yaml#understanding`，第一直接消费者是`direct-episode`。
- 已接纳结果不得原地手改。正式口播、cue、来源或共享语义确需变化时，通过正式入口返工；新结果的失效传播由System Control按真实读取关系处理。仅规则或代码维修不自行重签、清空候选或重做成果；当前任务是否保留由正式入口按真实输入、选择和写入边界裁决。
