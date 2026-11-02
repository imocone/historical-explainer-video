# P1：发布内容修订与封面制作

作者接纳后准备封面交付，或明确修订文案／封面时才读取本文件。只处理当前剧集的release-main；正文与片头的创作、择优和事实核对仍由当前P1作者拥有。

## 首次封面与交付

P1作者按对应节目路线交齐正文、片头、平台文案与横竖封面构思，Engine接纳即写`制作/p1/release-main/publication.yaml`和`output/publication.txt`。普通开始、继续或重做P1包含双图的首次必要自带生图；文字接纳后同参next执行原produce-covers节点，不再单独询问封面授权。两张封面齐备才算P1完成。用户单独明确开始P2时仍只消费正式正文。

produce-covers消费接纳文案、当前Visual画法与字体、横竖Cover文字设计及各自参考，按原完整图文提示返回`image-generation-batch`。Director读取返回的[builtin方法](../../packages/modules/produce-covers/cover/builtin.md)，准备所有参考与提示，一次登记同批调用，同时发起横竖各一次自带生图。工具单次只支持一张图；同批并发两次，不等待一张完成再启动另一张，也不拼母图后裁切。两幅分别完整生成图文，不拆成底图与叠字。

原模块保存实际工具结果，全部待交付图片通过解码、原生画幅、尺寸、摘要等技术检查后写output双图与`制作/p1/release-main/cover-receipt.yaml`，不重写作者文案。失败或未知保留同批已完成图，只恢复原工具结果，不自动换服务或重投。技术交付后直接交付，不安排例行主观验收或主动重生；用户明确查看或修订时再处理。封面修订不重做P3正文素材。

## 整套发布内容重作

用户明确要求同时重写三平台文案与封面内容时，合用原两个选项，一次签发完整范围工作单：

```text
next --stage p1 --revise-publication --revise-cover
```

该入口形成`publication-all`，Codex提供本次必要调查，原AGY作者在同一次续写中联合定稿`platforms`和`covers`，写入唯一候选并提交一次接纳。新候选接纳前保留现行正式交付。尚未执行的封面重生请求可由该明确新目标替换；未收口作者、运行中封面或未知远端对象仍须先处理，不能覆盖。进入后用普通`next`续跑同一工作单，接纳后在本次P1修订范围内用自带生图完成实际受影响画幅；返工命令本身不携带付费参数，不授权发布。

## 文案返工

用户明确要求修改尚未发布的现行 P1 平台文案时，使用一次：

```text
next --stage p1 --revise-publication
```

纯平台文案定点返工只核对所选字段对应的平台：目标平台已有回执、已提交或结果未知时停止；其它平台的发布结果与原草稿保留。未限定字段或涉及封面时，仍须所有平台均无已完成或已提交的发布；进行中的封面远端任务也须先收口。尚未提交且与原正式输入、P4工作单一致的编辑草稿可以进行纯平台文案返工。程序固定原上传身份，新候选接纳后P4沿begin接回原标签与草稿，不重新上传；封面返工不适用。新候选接纳前保留旧正式文案。未点名修改封面文字时，封面内容逐字段锁定，接纳后无付费复用已接受双图，由作者接纳即时更新`publication.txt`，封面程序更新复用回执与发布指纹。返工命令本身不授权再次付费或平台发布。

只改具体字段时，重复`--publication-field`点名平台字段或封面文字，并用`--revision-reason`交接本次意见，例如：

```text
next --stage p1 --revise-publication --publication-field youtube.title --revision-reason "保留事件名，把这个标题中的疑问表达改顺"
```

可选youtube的title/description/tags、douyin或xiaohongshu的title/body/topics，以及`covers.youtube.visibleText`、`covers.vertical.visibleText`；数组按整字段修改。工作单提供当前正式文案基线，选择封面文字时还提供该画幅当前成图路径与摘要。未选字段和已认可画面保留；普通措辞编辑不重新调查三平台，实际新增看点、时效或事实疑点按发布内容方法调查。未指定字段仍重写三平台文案；同时重作封面画面与文案时使用前述整套入口，不夹带字段限制。内容返工也可用revision-reason交接具体意见，意见不扩大所选范围；签发后用普通next恢复同一单，不通过重复命令改动意见或范围。

图片已认可、只换封面文字时，可以与平台字段在同一张工作单内修改：

```text
next --stage p1 --revise-publication --publication-field covers.youtube.visibleText --publication-field covers.vertical.visibleText --revision-reason "保留当前两张图，只修改标题文字"
```

接纳后仅对文字实际变化的画幅编辑当前成图，保留人物、场景、构图和画风；文字未变则直接复用，不生成。用户明确的换字请求覆盖本次实际变化画幅的自带生图，随后用普通next取得当前提示、参考和原图；已有工具结果只恢复。要重新设计人物或场景时，仍使用封面内容返工或整套发布内容入口。

## 封面返工

自带生图结果未知时，保留当前generation.json及同批已完成图，只找回同次工具输出，再沿原交接程序deliver保存；普通next不重复调用。用户明确要求替换失败或未知结果时，点名当前画幅与原记录：

```text
next --stage p1 --target release-main --cover-variant youtube --cover-record <原记录指纹> --replace-cover-task
```

该入口只准备点名画幅的自带生图替换，保留原记录与另一幅；重复命令指向同一替换对象，随后普通next交回提示与参考。替换再次失败或未知时不自动循环。封面不恢复旧供应商的API接口；可选OpenAI图片服务沿原图片交接入口，新增付费须有当前明确许可。已交付成品与真实来源回执保留，只做本地核对与复用。

用户明确选择当前横竖Cover包登记的本集成品样图作为正式封面时，执行：

```text
next --stage p1 --target release-main --adopt-cover-examples
```

该入口只读取当前装配Cover中显式登记的`finalExample`，沿原P1作者链把横竖`visibleText`对齐样图，平台文案保持不变；接纳后用普通`next`由produce-covers节点本地规格化写入正式双图和真实`package-example`回执。不调用远端生图、不付费，也不把旧远端未知任务冒充成功；已有未知缓存保留。样图缺失、摘要或包身份变化、文案不一致、已有P4副作用及冲突工作单都停止。未登记成品样图的Cover仍走原生成路线。

用户明确接受现行封面并撤销待办重生时，执行`next --stage p1 --target release-main --cancel-cover-regeneration`。该动作只撤销现行重生请求，保留正式双图、文案、回执和生成记录，不生成或付费；有活动作者、生产锁、未收口远端或正式基线变化时保留现场并停止。

封面返工先看实际要改什么：只换字用上面的定点文案入口；重新设计内容用下述内容返工；原文正确但成图出现问题用定点重生。

文字过多、两个看点挤在一起或需要压缩主句，属于内容修订，先由原P1作者按封面方法完成取舍，再编辑实际变化的图片。只改可见原字且保留画面时点名visibleText；看点或场面也需改变时用封面内容返工。不让生图模型删字、改题，也不靠反复放大、加行或缩字代替文案修订。

内容承诺错误，例如 A／B 换题、正文不兑现、主次关系本身写错，使用：

```text
next --stage p1 --revise-cover
```

该入口把已接纳的平台文案逐字段锁定，只让原AGY作者重新形成 `covers`。新候选接纳后，实际变化的画幅属于新生产对象，未变化画幅保留原内容与可用生产结果；不得同时携带付费授权。

内容正确、只是某个画幅出现错字、裁字、阅读顺序、构图或画幅适配问题时，保留已接纳内容，只点名重生不合格画幅：

```text
next --stage p1 --regenerate-cover --cover-variant youtube --revision-reason "只修正横版被裁到的文字，保留正确主体和原文"
next --stage p1 --regenerate-cover --cover-variant vertical --revision-reason "只修正竖版人物遮挡标题的问题，其它正确部分保留"
```

也可重复 `--cover-variant` 同时点名两项，修订意见须明确各画幅实际要改之处；不改变已接受内容。该入口锁定现行 `publication.yaml`、封面回执和未点名画幅，本次意见保存在同一请求并进入所选画幅的编辑提示。用户明确的定点成图修订覆盖该画幅本次自带生图。随后普通next返回同一请求的完整提示、参考与原图；已开始工具调用只恢复原结果，不重复提交、不变更意见。成功交付后控制记录自动清除。
