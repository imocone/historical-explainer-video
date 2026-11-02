# 封面自带生图交接

本方法由Director在P1的produce-covers返回`image-generation-batch`时消费。普通P1授权包含首次必要横竖原生封面。按返回的backend进入下列原生或API工具路径，原文、参考、画幅、技术交付和恢复边界共用。

`backend:openai`时，先核对已有当前明确图片付费许可，再对本批实际缺失画幅并发运行下列原入口；它读取原提示与参考、保存API结果并交回同一记录，不用另做底图、文案或封面候选：

```text
node packages/modules/produce-covers/cover/builtin.mjs generate --workspace <绝对节目目录> --episode <epNN> --variant <youtube或vertical> --record <record> --authorize-paid-images
```

API完成记录沿同一命令恢复，不再带授权参数；未知不再次提交。全部结果交回后仍同参next交付双图和原回执。以下原生begin及`tools.image_gen__imagegen`操作只用于`backend:builtin`，API不得冒记成该工具。

原程序按当前publication、Visual与Cover装配完整prompt、referencedImagePaths、画幅及记录指纹。保留原文与参考顺序，先用view_image查看实际图片，重复参考只需看一次。Visual参考提供场景画法，Cover参考提供文字材质、版式及配图相对文字的明暗对比和细节分配，编辑时末张是当前封面。不得从样图继承本集内容、代写作者文字、改为底图叠字，或裁一张母图交双封面。

横竖各使用一张登记的标准Cover样图。多张Visual原图完整拼成一张画风参考板，同批共用、只查看一次；每次生图使用画风参考与对应画幅的标准封面图，编辑时另带当前原图。提示开头说明原图号与附件映射，不把参考板作为封面母图。工具每次最多5张附件。

准备全部当前待制作request后，一次执行原交接程序begin，重复--request传入同批所有画幅与指纹：

```text
node packages/modules/produce-covers/cover/builtin.mjs begin --workspace <绝对节目目录> --episode <epNN> --request youtube:<record> --request vertical:<record>
```

随后在同一次functions.exec内用Promise.allSettled同时调用各request的`tools.image_gen__imagegen`，分别使用完整prompt、referenced_image_paths和transparent_background:false。工具每次只返回一张，因此同批并发两次；不得等待第一张完成才启动第二张，不声称一次工具调用输出两个画幅。单画幅修订或另一幅已有有效交付时只调用实际缺失画幅。工具失败或结果未知时不换API，不自动再次调用。

返回后分别把工具给出的实际本地文件交回原记录：

```text
node packages/modules/produce-covers/cover/builtin.mjs deliver --workspace <绝对节目目录> --episode <epNN> --variant <youtube或vertical> --record <record> --source <工具输出绝对路径>
```

同批只完成一张也先交回保存；另一张未知只找回同次工具结果，不重投。没有本地输出时先按工具真实返回恢复文件，不能冒充路径或生产身份。程序只导入实际输出，不自动生成。

全部返回后同参`next --stage p1 --target release-main`。原模块核对图片解码及原生画幅，等比归一到横版2048×1152、竖版1536×2048，完整双图齐备才写正式图片和cover-receipt；不裁图、叠字或改写publication。回执如实记录imagegen及工具身份，不伪造模型、付费和远端任务号。技术交付后不安排例行主观验收或重生；用户明确查看或修订时再处理。

封面不恢复旧供应商的API提交、查询、下载或任务编号绑定；本次可选OpenAI接口只保存本地原请求与结果。失败或未知确需替换时须有用户明确指令，API再次付费同时须有明确许可，用原`--replace-cover-task`点名当前生图记录；保留原记录和成功另一幅。旧成品与来源回执只做本地核对与复用。换字使用现行publication定点修订，画面表现使用原regenerate-cover，具体意见与原图进入同一提示。
