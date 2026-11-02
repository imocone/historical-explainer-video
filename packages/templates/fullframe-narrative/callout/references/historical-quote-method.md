# 历史引文收口方法

只有当前工作单`inputs.authorPhase=quotes`时执行本节。只处理工作单尚未解决的`quoteRequests`及相关cues，沿每项id保留对应关系；不得改动原画面、锚点、显示Cue或其它框。局部重切后，程序依据同一正式故事板中的原接纳批次，自动保留问题、资料库和原输入未变、范围未扩大且来源唯一的取消决议；不把非空引文自动搬到新位置。作者不转抄旧决议，也不为这些位置再次查询。

先读当前请求、相关cues及存在时的inputs.narrationEvidence：documents是当前正式口播绑定并已保留的正文与定位，queries是同次材料的原Query引用。inputs.retainedQuoteEvidence是同一集当前故事板已接纳引文批次中的来源与原文；改分镜后用这些原文重新判断当前引句，不因镜头编号变化再查一次。已取得且充分的依据直接选句，不重新搜索或查询；视频讲述仍只作线索，资料库转引不能改署成未读过的原书。归并可共用来源的请求，每个id独立判断，不另写分组表。这里只制作引文及出处，不例行重审整篇口播；必要补查限于当前引用。

偶然读到与口播明确矛盾的可靠正文时，先收齐本次已发现的问题及依据，说明改字是否涉及整集重配音、字幕与画面；保留正式正文、音频和已成画面，在明确处理方案及修订授权前不启动或接纳P1改稿。一般精度差异按现行基本事实尺度处理，不补齐无关例外；无法核实的引文可取消，明确反证不能用取消引文掩盖。已完成的取材与判断保留，继续不依赖冲突的工作。

全部位置仍在同一工作单按下面三个动作收口，不增加生产步骤。

1. **取得原文。** 已投递的P1正文、原Query或已接纳引文原文足以支持当前引用时直接复用。当前引用仍缺原文或出处线索，且有`inputs.referenceVideos`时，按下文只读相关视频的必要段落、已有quotes和来源信息；视频讲述者的概括只算线索。仍需找文献时，已有原语言引句先复制搜索，整句无结果再用有辨识度的连续短句；只有白话转述时，用人物、事件、年代及对应原语言关键词查找。已有书名、章节或页码时沿定位读正文，同书相关请求集中核对，不因另一个位置需要引用又广搜。不要求先有资料库，也不因一次查询没有原文就取消。
2. **确认出处与语境。** 打开记载它的文献原文、可靠整理本或扫描页，核对所在段落、说话者、年代、书名篇卷，以及是否支持当前具体说法。搜索摘要、视频字幕和他人的出处标签只帮助定位；已取得可确认的原文及出处直接使用，无需再搜索一次证明。扫描件先利用目录、书内检索或现有文字层定位，核对印刷页码与扫描页序的对应，再读取目标页及必要相邻语境；OCR只辅助定位和转录，疑字、断句与标点回看原页，不猜补。网页读取遇到403或不支持的文档格式时，转用可读同一原件的浏览器或可信版本，不反复用同一种失败方式；阅读页码已明确时不退回泛关键词搜索。不同年份、不同次借款或不同说话者的近似文字不能互相代用。
3. **引文与出处一起填入。** 先取得来源原文及必要上下文（网页存入来源text，资料库读取原cited_text），再选取对应当前口播、可独立读懂的连续短句。上屏text必须为中文：中文原句照录，非中文原句忠实翻译成中文后填写；原文留在现有来源记录里。译文保留原意、否定、条件和数字，不加入自己的解释；显示容量按中文text计算，过长时选更短且含义完整的原句再译，不删接原文或截掉关键限定。口播和视频中的句子只作检索，即使看起来像原文，也要核对文献原文有无删节后再选取。citation写《书名》及必要卷／篇，可附确知作者；使用来源中可辨认的书名，不以视频网站或资料库名称署名，不猜卷号。显示短书名须包含于实际文献标题；引文与署名取自同一核实来源，不把二手材料改名冒充原书。

**结束查找。** 继续检索应能说明新线索会解决哪一处原文或归属疑点，例如新找到的书名、页码、原语言用词或可读版本；只改同义词、重复打开相同结果不算推进。相关具体线索已核对、合理可读版本仍无法提供可确认的原文或归属时，该项写null，说明本次无法核实，不宣称史实为假或全网不存在。访问故障先按上述读取分支处理，不能一次打不开就取消；没有可用替代且工具故障仍阻断核实时，保留已完成项并报告实际阻塞。已启动NotebookLM的失败或未知仍按下文恢复规则处理，不用null收口掩盖。不设固定搜索次数，不为了填满预留位置扩大为当前口播之外的史料研究。

**参考材料按需读取。** 视图保留视频身份和`transcript.path / sha256`等定位信息，全文与原始带时分段保存在当前正式工作单中。仅在上述引用缺口确需参考视频时，按已投递id读取`inputs.referenceVideos`的相关连续段落及必要上下文；单行过长时按字符区间读取。已读且未变的部分沿用，截断只补当前所需的缺失部分，不默认通读全部视频。校正全文用于理解，原始`segments`只在需要时间定位或辨认差异时按范围读取，两者不能互相覆盖。来源文件中的新版文字不能替换当前单已绑定的正文。可按以下只读方式取一段，必要时从实际返回的末行之后续读，不另存副本：

```javascript
// node --input-type=module - <workOrderPath> <videoId> <起始行1-based> <结束行inclusive>
import { readFileSync } from "node:fs";
const [file, id, from, to] = process.argv.slice(2);
const video = JSON.parse(readFileSync(file, "utf8")).inputs.referenceVideos.find(v => v.id === id);
const lines = video.transcript.text.split(/\r?\n/u);
console.log(JSON.stringify({id, title: video.title, url: video.url, quotes: video.quotes,
  from: Number(from), to: Math.min(Number(to), lines.length), totalLines: lines.length,
  text: lines.slice(Number(from) - 1, Number(to)).join("\n")}));
```

P1的documents由原引文程序直接绑定source、title与text，quote.sourceId沿用其source，网页、本地正文或资料库原source_id均保持实际身份；queries用于回查原始引用，缺少文献身份时先补足出处再署名。已接纳批次原文沿用投递的source_id与来源标题；只使用已投递的documents或retainedQuoteEvidence时，无需转抄或另存取证文件。新增网页取证在当前工作单`scratchPath`保存一份`historical-quote-sources.json`：

```json
{"sources":[{"url":"实际打开的文献页面网址","title":"该页实际文献标题","text":"从页面复制的原文段落及必要上下文"}]}
```

这是当前引文候选的取材记录，交原接纳程序读取，不是额外报告或来源库。text保存实际读到的正文，不仅写待展示短句，不把自己的改写当页面原文。quote的sourceId使用对应url；网页标题含站点等信息时，以页面正文／目录明确标示的实际文献标题填写title，不能从希望显示的citation倒造title。同页多项引文可共用一份正文；确实查不到的项无需虚构来源。没有可用网页来源且没有可直接消费的P1依据、已接纳原文或已完成NotebookLM原文回执时，仍写`{"sources":[]}`，不要省略文件。已保存且核对成立的材料直接复用。

每取得并核实一份新增网页来源，就补入这个原来源文件；已完成判断写回唯一候选的对应`items`，未判断项暂不填写，不以null冒充进度。恢复先读已投递的P1依据和已接纳原文、现有来源文件、候选及已有查询回执，接续尚未完成项；原文、出处或语境没有新疑点的项不重新搜索。全部当前id完成后才交B2统一接纳，草稿中的部分items不代表已正式交付。读取进度和剩余线索沿当前会话续接，不新建检索台账或第二候选。

有`inputs.notebookId`且需要资料库帮助时，可运行原查询入口一次：

```text
node packages/runtime-config.mjs python -B packages/templates/fullframe-narrative/callout/query-historical-quote.py <workOrderPath>
```

它一次取得当前批次的线索，之后仍可直接网上查原文和出处。完整读取`historical-quote-query.json`；如果真实来源本身就是所需原文，可选其sourceId并使用`response.references[].cited_text`中连续逐字包含的文字，非中文原句按上述方法译成中文text，不另复制网页材料。NotebookLM回答的概括或二手书的转引只帮助定位，不能把其来源标题改署成原书。已有同任务、同Notebook与同批请求的完成回执复用，不逐项重投；请求不同、未完成、远端未知或服务错误则保留现场并恢复原对象，不重投，也不能用空引文或新的网页记录掩盖失败。等待同一进程每次最多60秒，无独立工作时首次exec_command等待30秒，后续write_stdin有界收取；functions.exec已返回cell_id时只等待该cell。

候选result仍只需`{items: [{id, quote}]}`，按工作单逐项覆盖。有可靠原文时quote填写`kind / text / citation / sourceId`，text使用中文，省略anchorFocus；确实无法确认原文或出处时quote写null，只取消该引文。作者对照原文确认中文引文忠实，程序从实际取材记录与已有原查询补齐`receipt / sourceTitle / citedTextSha256`并核对来源绑定，不要求中文译文逐字包含在原文中。同一sourceId有多个实际文献标题时，程序按citation书名唯一匹配；仍不唯一时，在已有sourceTitle字段选填本次实际使用的完整来源标题，不改写原证据或虚构标题。原句能定位或来源正文唯一时无需填写摘要；同一sourceId有多段原文、中文译文无法直接定位时，用下面只读命令列出工作单已投递或scratch已保存的原文及摘要，选实际用于翻译的那一段，将其citedTextSha256原样填入quote的已有同名字段，不猜首段、不另查一次、不手算摘要。

```javascript
// node --input-type=module - <当前workOrderPath或scratch中historical-quote-query.json或historical-quote-sources.json路径> <sourceId>
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const [file, sourceId] = process.argv.slice(2);
const data = JSON.parse(readFileSync(file, "utf8"));
const references = data.inputs ? [
  ...(data.inputs.retainedQuoteEvidence?.references ?? []),
  ...(data.inputs.narrationEvidence?.documents ?? []).map(doc => ({ source_id: doc.source, cited_text: doc.text })),
  ...(data.inputs.narrationEvidence?.queries ?? []).flatMap(query => query.references)
] : data.response?.references ?? (data.sources ?? []).map(page => ({ source_id: page.url, cited_text: page.text }));
for (const reference of references.filter(item => item.source_id === sourceId && typeof item.cited_text === "string" && item.cited_text.trim())) {
  console.log(JSON.stringify({ sourceId, citedTextSha256: createHash("sha256").update(reference.cited_text).digest("hex"), text: reference.cited_text }));
}
```

作者不复制回执。完成本批内容判断后交Author正式accept；机械字段错误只修正实际错误，不重新取材。引文取消不重做Beat，不移动其它框或画面时间。
