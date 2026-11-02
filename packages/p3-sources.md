# P3补查资料交接

导演判断或正文创作缺少必要依据时，先读原始资料，核对年代、对象、关系和可支持的精度。只补当前画面所需的信息，不改变正式口播或共享Understanding；与其冲突时回真实上游。时代外观的专业判断由导演模块的[固定方法](modules/direct-episode/references/period-appearance-method.md)拥有，本说明只负责资料交接。

将取得的原件或自己整理的有出处资料存于当前工作单scratch。整理文须写清原页链接、相关页段、支持什么、不支持什么；摘要不能代替未读原文，也不能把来源图片的权利写成自己所有。事实笔记与原图分别登记，原图用于画面或生图参考须具备相应权利。

在同一scratch保存一次调用需要的JSON：

```json
{
  "file": "/绝对路径/已取得资料.md",
  "mediaType": "document",
  "sourceCitation": "真实来源名称、网址及相关页段",
  "creator": "实际作者或机构",
  "date": null,
  "rightsStatus": "permission-granted",
  "usageNotes": "用于支持的地点、关系和精度；不能据此推断的内容"
}
```

示例的权利值须按实际材料填写。沿正式登记入口执行：

```sh
node packages/p3-sources.mjs <workOrderPath> <资料描述JSON>
node packages/p3-task-view.mjs <workOrderPath>
```

程序将文件与摘要追加到原`制作/input/source-assets.yaml`，返回SA编号；重放同一资料复用原编号。原工作单、候选和已成素材保留。导演在`directorBrief`中交清“SA编号支持什么对象、特征或关系及其限定”，作者按清单中相对本集`制作/input/`的路径读取对应正文，并在使用它的`moments / assetRequests.sourceRefs`引用SA。全画幅与讲解的任务视图、设计检查、图片、预演和接纳消费同一现行清单；联合单各成员共用视图顶层的`inputs.sourceAssets`。不能只在会话贴网址，或用未登记的SA编号冒充交接。

资料正文不会被程序自动改写成图纸或整篇注入生图。作者把适用的可见特征落实到当前模板原设计字段；原图按该模板的参考图入口真实传入，`sourceRefs`只表达引用关系，不能替代实际传图。

补查发现设计应改变时，当前作者只修改实际受影响内容。原来源被改动或删除时沿原next核对输入变化，不手改工作单，不重生仍有效素材。登记失败留在当前责任方处理，资料无法支持必要事实才回真实上游。
