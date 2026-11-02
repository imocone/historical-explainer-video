# 真实案例：P3 Author装配路线

本案例只解释现行P3正文Author怎样把一个Workflow节点、一个Module、已选Template和Feature组成一条执行路线。它不新增规则；与现行Workflow、包清单、工作单、入口或消费者冲突时，以现场为准并修正本案例。

只有在审计装配型Module、嵌套步骤、`each-*`迭代、Template选择或Feature调用时才按需读取。

## 先看身份，不看编号

```text
video Workflow
└─ author Node（scope: each-author-unit）
   └─ author-beat Module（SKILL.md）
      ├─ body-template Slot（beat-template，恰好一个）
      │  ├─ fullframe-narrative Template（AUTHOR.md）
      │  └─ vox-explainer Template（AUTHOR.md）
      └─ beat-feature Slot（episode-features，可多个）
         └─ cue-sync Feature（AUTHOR.md）
```

`author`只是Workflow执行位置，不是Skill。`author-beat`才是该节点唯一直接责任包；它使用`SKILL.md`。两个正文Template和`cue-sync`不是挂在节点上的第二、第三Module，而是通过`author-beat/package.yaml`的插槽装配；它们使用`AUTHOR.md`。

Visual Director已经在正式Visual Plan中写入Beat的`templateId`及连续讲解的`templateRuns`。Engine据此选择正文Template；Author只能核对工作单装配与`authorUnit.templateId`一致，不能重新决定“该用全画幅还是讲解”。

## 作者单位不是一律一个Beat

Engine按正文顺序形成作者单位：

- 不属于`templateRun`的普通Beat形成一个`kind: beat`单位，由它已选的Template创作一份结果。
- 同一连续讲解`templateRun`的全部成员Beat合成一个`kind: template-run`单位，只创作一份整段结果。

`author-beat`完成并接纳当前单位后，Engine才签发下一个单位。因此“Workflow逐作者单位”“全画幅逐普通Beat”“讲解整段一次”和Template内部多张画面是不同层级，不能混成多套循环。

## 当前只走一条路线

```text
当前authorUnit与已选装配
→ 进入唯一已选Template
   ├─ fullframe：Codex结合当前与相邻参考联合设计、测量复核 → 解说框与Cue
   └─ vox：按讲解模板设计完整画布并保存同一treatment → 读取cue-options，调用cue-sync
→ author-beat汇总treatment + featureResults
→ preflight → accept → status
→ Engine签发下一authorUnit
```

父级与模板步骤不是竞争流程。B路线是Module父级编排；当前只进入所选Template子路线，具体步骤和动作层级以其根入口为准，不能按字母编号直接计算步骤数；`cue-sync`在Template点名的位置被调用并返回`{items}`，没有自己的Workflow提交线。全画幅的`camera/`和`callout/`仍是Template内部组件，不是新节点或新正式包。

主模型在同一`candidatePath`形成唯一正式结果。

## 怎样审计这个结构

先分别回答以下事实，再判断问题：

| 问题 | 现行答案 | 真源 |
|---|---|---|
| 谁决定执行位置和顺序 | `video` Workflow与Engine | `workflow/video.yaml`、`engine/runtime.mjs` |
| 节点直接责任方是谁 | `author-beat` Module | Workflow与Module清单 |
| 当前Template谁选择 | Visual Director形成归属，Engine按`beat-template`装配 | Visual Plan、Module插槽与工作单 |
| 专业画面步骤谁拥有 | 当前唯一所选Template | Template根`AUTHOR.md`及按需方法 |
| Cue结果谁拥有 | `cue-sync` Feature | Feature根`AUTHOR.md`、Schema与Validator |
| 谁汇总和提交 | `author-beat` | Module根入口、Preflight与Accept |
| 谁推进下一单位 | Engine | `each-author-unit`运行逻辑 |

只有答案落到准确层级后，才能说是根Module编排缺失、Template步骤错误、Feature合同越权、包内组件越级、初始投递过多、选择机制错误或消费者未接通。不能因为同时看见父步骤、模板步骤和Feature动作，就把问题概括为“P3整体没有条理”。

## 现行职责与边界

- 保留[现行Workflow](../../../workflow/video.yaml)规定的阶段与节点归属；P3完成正文创作，片头由P4的`opener`节点处理。
- 保留Visual Director选择Template、Engine生成作者单位和逐单位推进。
- 保留两个正文模板各自的专业方法与步骤。
- 保留一个工作单一个`candidatePath`、Codex唯一正式作者和Feature结果独立封装。
- `author-beat`父路线、`cue-sync`调用身份和Author初始根规则投递与上述结构一致。
