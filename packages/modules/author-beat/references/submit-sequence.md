# Author 单次交付与接纳

当前候选完成本次创作或精修后运行，参数取当前工作单与节目调用值：

```text
node packages/modules/author-beat/submit.mjs <工作单> <候选> <节目目录> <epNN>
```

原入口执行本单Preflight，返回工作单、候选路径及章节编号，任一失败立即停止。当前作者修正实际失败项后沿原入口再交付；全画幅与讲解子代理均交回主代理。真实上游缺口按Module的returnTo规则交回主代理，不对退回候选运行结果Preflight。

全画幅及仅修Feature的候选通过B2并交回后进入接纳。讲解初制B2通过后留在原单，主代理按[P3逐段精修](../../../../director/references/p3.md#讲解逐段精修)收齐，再为各章分别派精修者。精修者修改本章后沿本命令重新提交。各章精修交齐后，由主代理串行运行：

```text
node engine/cli.mjs accept --workspace <节目目录> --episode <epNN> --stage p3 --segment <TR编号>
node engine/cli.mjs status --workspace <节目目录> --episode <epNN> --stage p3
```

逐条执行，失败时先核对当前现场。原Accept消费该章节最终候选，将结果合入最新故事板；全画幅内部逐Beat核验保存，成员交付齐备才计该章完成，讲解沿整章结果计数。接纳失败交当前负责该候选的执行者沿原单修正。引文收口由主代理在阶段根工作单执行同一B2，accept不带segment。

本章任务视图完整消费一次；规则、案例及配图在本作者上下文中已完整保有且未变时沿用。仅在本作者仍完整持有同版全片语境时，才可把原视图`referenceDigests`交给`p3-task-view.mjs --reuse-references`，合读原文与新增、变化材料；新作者首次读取或上下文缺失时省略该参数取得全文。长结果按完整成员分批读，不以摘要代替判断，不另写阅读记录。
