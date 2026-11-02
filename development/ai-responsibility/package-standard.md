# 人工智能责任包标准

本文件规定正式人工智能责任包怎样进入系统、把什么投递给模型、产出什么，以及由谁消费和使其失效。内部工作怎样分步骤见[内部流程标准](workflow-standard.md)；内部方法和组件边界见[内部能力标准](internal-capability-standard.md)。

## 真实责任链

修改前沿现场还原：

```text
Workflow → package manifest → AI／程序入口 → Schema／Validator
→ runtime consumer → invalidation／failure return → formal artifact
```

并逐项写清责任方、输入、真实专业工作、可观察结果、接纳条件、失败回路和下游消费者。任一项没有现场所有者或消费者，先处理结构缺口，不能直接润色入口文案。

## 先还原层级，再判断问题

审计、整改或扩展装配型责任链时，先从现行Workflow、包清单、工作单和消费者还原本次结构切片：

```text
Workflow → Node → Module → Slot → 已选Template／Feature／Cover
→ 方法／确定性资源／包内组件 → 正式结果 → 直接消费者
```

- Node只是Workflow中的执行位置，不是Skill或责任包；它通过`moduleId`指向唯一Module。
- 人工智能Module是使用`SKILL.md`的正式责任包，拥有该节点的公共编排、交接和失败返回。
- Template／Feature是通过Module插槽装配的人工智能责任包，使用`AUTHOR.md`；Template拥有被选中后的专业创作步骤，Feature拥有被调用时形成的独立结果。Cover是通过Module插槽装配的确定性责任包，拥有封面设计语言，不使用人工智能入口。
- 方法、确定性资源和包内组件继承所属正式包，不因有目录、入口或编号就自动成为节点、Module、Template或Feature。
- 对`each-*`范围必须继续查清真实迭代单位由谁生成、一个单位包含什么、按什么顺序推进以及谁签发下一个单位。

层级未还原前，不得只凭文件名、步骤编号或目录数量判断“整个阶段混乱”。审计结论必须准确落到上述一层及其真实消费者；子流程编号多，不等于存在多条互相竞争的总流程。

## 正式身份与入口

- 人工智能Module使用清单登记的`SKILL.md`；纯确定性Module使用`programEntry`、Schema和Validator。
- Template和Feature使用清单`authorRules`登记的`AUTHOR.md`。
- 没有人工智能创作流程的Visual和Cover不补人工智能入口。
- `SKILL.md`的发现身份必须与包`id`和真实能力一致；Template／Feature的`catalog`承担同类发现责任。发现信息只帮助选择，不建立Workflow、授权或业务身份。

把内部资源提升为正式责任包必须符合[内部能力标准](internal-capability-standard.md)，并按`AGENTS.md`走架构变化。

## 根执行契约

拥有编排权的包根入口必须自己表达：

- 上级路线、业务分支和每步准入前提；
- 每步可观察完成结果及其第一直接消费者；
- 结果锁定后仍允许修改的范围；
- 失败返回、失效传播和最终交接。

方法仍在、组件已抽出、Schema或Validator可通过、下游存在消费者，都不能替代根执行契约。包内组件只声明自身合同，不得取得包根的路线和兄弟编排权。

装配型Module的根入口还必须说清：选择发生在何处、当前工作单已经选中了什么、怎样进入所选Template、Feature由谁在什么结果之后调用、怎样汇总结果，以及完成后由谁推进下一单位。Module只能核对正式选择，不能在作者节点重新选择或重判Template。Template和Feature的内部步骤由各自根入口拥有，父Module只引用并编排，不复制其专业方法。

## 投递角色与唯一真源

清单角色只登记实际消费者需要的最小资源：

- `rules`：当前Module执行模型直接需要的入口和业务方法；不得混入确定性程序源码。
- `copyRules`：跨阶段Template在上游文案节点直接需要、而当前作者不需要的规则。
- `authorRules`：当前Template／Feature作者直接读取的入口和业务方法。
- `acceptanceRules`：供接纳程序消费、执行模型不直接读取的确定性依赖。工作单记录其身份与摘要；恢复和接纳使用现行规则，摘要变化本身不使原工作单、候选或成果失效。
- `assetContractRules`：素材合同编译器直接读取的确定性合同。
- `renderRules`：渲染消费者直接读取的版式或动作合同。
- `renderAssets`：渲染消费者直接读取的二进制母版；只投递身份与摘要，不作为模型规则正文。
- `generatedResources`：由正式静态装配生成并核对集合的程序资源，不是人工智能入口或手工维护的第二注册表。
- `productionProfiles`：Visual提供、素材或发布程序直接读取的确定性生产配置；不因被人工智能责任包的消费者读取而变成作者规则。
- `coverRules`：Cover提供文字配色与材质、字后渐变和横竖版式；字体由所选Visual提供。P1作者拥有本集文案与场景构思，文案骨架由[封面内容方法](../../packages/modules/author-narration/references/cover-content-method.md)规定，Cover不另定模式。

  规则与清单中的`examples`在封面构思时进入P1作者；同包提供多个画幅时由规则指定各画幅例子，程序只传当前画幅参考。Cover清单的`verticalCoverPackageId`声明配套竖版，允许同包实现双画幅。

  样图只教文字设计与图文分量，场景画法由所选Visual的`productionProfiles`及参考提供；两者都不提供本集人物、器物、地点或事件。作者从正文独立构思场景，按Cover允许的文字区域联合安排字组与场景，程序原样消费。
- `runtimeResources`：不随初始规则正文展开、只在首个消费点按清单身份使用的资源。入口明确链接的Markdown方法或操作说明可由人工智能按需读取；Validator、脚本、策略和其它确定性实现只由Engine或登记命令执行，人工智能只消费其正式输入输出，不读源码寻找第二套答案。
- `examples`：只在能够区分真实易混判断时投递，不得从例子反向发明正文没有的规则。

Schema可以作为结果合同向模型披露；Validator、投影、换算和其它确定性程序只由正式程序入口执行。一个资源只有被多个角色真实直接消费时才可重复登记。

公共Module只接收所有实现都成立的公共内容。所选Template／Feature的私有字段和方法必须通过清单登记的上下文入口投递给真实消费者，公共Module不得接收、生成或管理具体包的私有合同。

## 实际投递与跨阶段影响

文件存在或被拆分，不等于模型在运行时收到或没有收到。修改清单角色、上下文入口或资源内容时，必须同时检查Engine实际装配和每个直接消费者；任何一处仍提前投递、遗漏投递或混入下游实现，修改都没有完成。

Template被多个阶段消费时，修改规则、字段、资源角色或实现前，逐个核对各阶段消费者，并说明“需要同步修改”或“无影响”的现场依据。影响不明或必要同步未完成时，按[治理入口的共同停止边界](README.md#共同停止边界)暂停依赖该条件的操作，继续已授权且不依赖该条件的调查与方案准备。
