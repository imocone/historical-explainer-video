# P4三画面闪回片头

`episode-opener`在P4只拥有`episode-package.yaml#opener`的三画面创作。P1通过`copyRules`让片头与正文共同成立；P4必须逐字使用当前正式`openerNarration`，不得改写。

## 路线

```text
核实创作前提后联合形成并核对唯一三画面候选 → 自带生图交付三张实图 → 交付author-bookend H2提交
```

当前设计问题留在对应步骤修正；正式输入缺失或确属工作单允许的上游问题返回真实上游。

### 创作前提：继承正式内容

读取当前P1正式`openerNarration`、已完成正文storyboard、Understanding、包含`albumPlan`和正文首Beat的`directionContext`、全部正文Beat与来源资产。程序在接纳时把`openerNarration`原样填入`flashbackLine`，作者直接沿用已接纳内容，不重复核对正文事实或逐项回查来源对应。三个观察面与`albumPlan.intent / openingState`同向。

正文`treatment`提供观察面与连续性参考。片头据此进行画面创作，不新增历史结论、人物关系或战果，不另开取证或事实审查。

`sourceRefs`引用来源资产时，只能选择工作单中`rightsStatus`为`public-domain / licensed / permission-granted`的正式资产；其它状态不能交给外部生产。

正式输入齐备后，沿该原句进入联合创作，不单独保存输入基线。

### 联合形成唯一三画面候选

完整读取`references/opener-treatment-standard.md`。主模型从同一句片头确定`O01 / O02 / O03`三个观察面，完成`visualBrief / bodyRefs / sourceRefs / mustNotInvent`，形成一份连贯设计。引用记录沿用当前正式输入，不逐项复查正文来源；不能为迁就画面修改正式片头。

完成条件：唯一候选已经完整填写`flashbackShots`，正式原句由程序补齐；三个观察面各有不可替代的可见职责，合起来完整投影同一个信息缺口，没有第二句、第四画面、预制动效或未经证据支持的画面内容。

## 图片交付

设计成立后按[作者图片交付](../../authored-images.md)在当前候选生成三张独立闪回图，分别写入 `flashbackShots[].asset`；不增加第四画面或重复图纸创作。

## 交付条件

按同一业务标准、模板Schema和正反样例完成三画面设计与图片交付，不再复查正文事实或来源对应。作者只需交付`templateId / flashbackShots`，程序补齐`flashbackLine`并执行素材权利、引用身份、文件及时间合同；成立后把同一候选交给`author-bookend` H2提交，本Template不取得工作单提交权。

片头候选提交后的TTS、句级卡点、总时间线和口播占比由Engine按`acceptanceRules`确定性验收，不属于片头创作。真实TTS超限时P4停止，只有用户明确发起P1片头定点返工才能缩短原句；不得自动加速、拉长模板或在P4改字。
