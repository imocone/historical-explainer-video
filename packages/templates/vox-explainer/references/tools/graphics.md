# 纸面、标注与数值工具

## 纸面

需要纸面承托时，可在本单制作脚本中调用共用的[纸面资源](../../paper.mjs)，把返回的SVG片段写入同一候选的`scene.markup`。它生成自然撕边、浅纸纹、薄纸厚度和轻阴影，不包含本题内容或固定版式。

```js
import {paperSurface} from '/系统根目录/packages/templates/vox-explainer/paper.mjs';
const paper = paperSurface({id: 'surface', vertices: outline});
// outline是当前内容排定后的纸面轮廓顶点；paper放在同组内容的底层。
```

`vertices`按轮廓顺序给出本段SVG坐标，末尾不重复起点；轮廓、布局与进出场由作者设计。同一scene中每张纸使用不同`id`；返回组为`<id>-paper`，纸面边缘为`<id>-edge`，指定顶点保持原位。文字与动作留在边缘内侧，纸纹只作用于底纸，不给内容套纹理滤镜。局部弹窗不使用纸卡轮廓，沿[开窗方法](../creative/windows.md#旁图策略)由clipPath或mask裁出内景，接口见[空间工具](../../spatial/docs/detail.md#地图旁图与注意力)。

SVG随候选保存，播放与P4不读取临时脚本或重新随机生成；展开、停留和收回由原动画与Cue控制，外观见[画法](../art.md)。

## 手绘圈注与划线

先按[连线用途与画法](../creative/graphics.md#跟着讲解引导注意力)确定需要表达的对应和含义。清楚的直段、连接和准确几何可直接用原生SVG；需要手绘箭头、圈注、划线、括线或高亮时，可用[标注组件](../../annotations.mjs)。它复用Perfect Arrows与Perfect Freehand，生成可随scene保存的SVG及描线程序；字词、路线与时机由作者决定，普通字组仍用本单实字体。绘制工具不决定是否需要这条线，也不把标注变成默认装饰。

| 工具 | 输入与结果 |
|---|---|
| `measureText({fontFile,lines,fontSize,lineHeight=1.25,tracking=0})` | 用本单字体原文件测量已分行文字，返回每行`baseline / advance / box`。首行基线为整组纵坐标原点；后续行的`baseline`和`box.y`已含行距偏移。`box`为字形范围，不含底衬；放置时加整组坐标，不再重复加该行基线。不会自动断句、缩字或替换字体。 |
| `mark({id,kind,box,width=12,padding=10,seed=41,color})` | `kind`为`circle / underline / bracket / highlight`；围绕指定对象或词组边框生成固定笔迹。高亮用有轻重变化的填充笔痕，放在文字下层。 |
| `arrow({id,from,to,width=12,head=28,color,...options})` | 用Perfect Arrows计算起止点之间的曲线与尖端方向；可传`bow / flip / padStart / padEnd / straights / stretch / stretchMin / stretchMax`。它不理解障碍物，也不替作者选择路线。 |

颜色默认`var(--accent)`，尺寸均为本段SVG坐标；这些默认数值只用于起步，不是统一版式。按整幅手机画宽调笔迹、箭尖与留白，优先看清指向。每个`id`在本段唯一。正文、标题的实字体与字重分别来自本单`appearance.fonts`，测量路径相对系统根解析；排印后的浏览器字框仍须随字体、字距和变换复核。

起止点取实际可见轮廓、接合点或实测字框，不按透明图片外框或人物中心估计。普通连接线停在轮廓外，作用线落在本题确需指出的部位；箭尖与目标之间留出间隙，方向沿路径末段，大小与线身协调。曲线让转向平顺，折线的拐点、相邻平行线的间隔与同级线宽共同排布；线身、箭尖和必要底边共用同一路径及变换。涉及地理或机构的实际几何时保持其依据，不能为了绕字改动事实位置。

使用SVG marker时，按箭头与线杆的实际接合点设置`refX / refY`并安排端帽；线杆末端收在箭头内部，圆端帽不能越过尖端。也可把线杆和箭尖做成同一填充轮廓，用`clipPath / mask`沿进度显露。端点校准看最终可见的箭尖，不能只看路径终点或marker参数。

描线时连同完整线身观察箭尖何时出现，避免箭尖先悬在终点或与线身脱节。对象移动或构图变化后，从当前锚点与字框更新端点；留白不足时调整布局或显现时序，不靠增加圈框和更粗的笔画掩盖。

```js
import {mark, annotationTools} from '/系统根目录/packages/templates/vox-explainer/annotations.mjs';
const ink = mark({
  id: 'detail-mark', kind: 'circle',
  box: {x: 1200, y: 430, width: 80, height: 70}, width: 10, seed: 241
});
// 把ink放入scene.markup；坐标按实图或实测字框填写。
const setup = `const pen = (${annotationTools.toString()})(select('#canvas'));
onFrame(({time}) => {
  pen.draw(select('#detail-mark'), (time-cue('M002'))/.6);
});`;
// 把setup并入同一scene.animation；#canvas是本段SVG根，Cue与时长按本单声音设计。
```

`annotationTools(svg)`只使用传入的SVG，序列化后随正式animation保存；不另装播放器或时钟：

- `draw(group,progress)`把进度限制在0到1，按实际路径长度依次描出；箭尖等箭杆到达才出现，高亮沿独立遮罩揭开。淡出仍由原时间轴控制整个组。路径生成后保持不变；若改了路径，重新初始化工具，不能沿用旧长度。
- `point(element,x,y,relativeTo=svg)`把元素内的真实锚点换算到目标SVG坐标，跟随当前素材与镜头变换。
- `bounds(element,relativeTo=svg)`取得实际排印后的字组范围，并换算到同一坐标。动画开始前渲染器已加载本单字体；不要对尚未入场的`display:none`元素测量。

贴着目标的圈注可直接与目标放在同组。不要混用屏幕坐标、图片坐标和窗口局部坐标；地图让位与窗口展开时尤其要看中途是否仍指对。引线的坐标接口见[空间工具](../../spatial/docs/detail.md#地图旁图与注意力)。

保存生成的路径与animation，播放和P4不重新加载绘图库或随机重画。落笔后停稳，多行字按实际字组分别处理；精确边界与地形路线继续用对应原生几何。

颜色按[画法](../art.md)保持清楚反差。圈注、划线、括线与箭头自带贴合笔迹的浅纸色底边；`highlight`则是放在文字下层的半透明笔痕。自行绘制路径需要底边时，在彩色笔画下面复制同一路径并略加线宽，两层共用描线进度、显隐和变换。底边只托住笔画，不变成浅色实心圈。圈与文字、主体之间留空，范围准确对应所指对象。

## 字组与数值

`measureText`的`box`使用整组坐标；相对本行基线的字形底沿须减去该行`baseline`。例如`number`和`unit`分别是数字行、单位行的测量结果，数字的实际基线为`ny`，二者底沿对齐时：

```js
const bottomFromBaseline = line => line.box.y + line.box.height - line.baseline;
const unitBaseline = ny + bottomFromBaseline(number) - bottomFromBaseline(unit);
```

单位横向位置取数字的实际可见末端加所需间隙。按实际显示格式测量变化中可能出现的最宽字组，计入符号、小数、单位及间距，再预留空间、设定字组位置；揭示、移动或更新沿原scene时间轴完成。浏览器实测用于校准，语义与排版由作者决定。

数值保留为数值，单位与格式只作用于显示。用同一份原始值生成表格、图形长度、标签与算式；例如下面的虚构数值只示范换算，不提供当前题材或布局：

```js
const values = {sent: 1000, before: 300, after: 450};
const delta = values.after - values.before;
const rateBefore = values.sent === 0 ? null : values.before / values.sent;
const rateAfter = values.sent === 0 ? null : values.after / values.sent;
const points = rateBefore === null ? null : (rateAfter - rateBefore) * 100;
const growth = values.before === 0 ? null : delta / values.before;
const formatNumber = new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 1});
const formatPercent = new Intl.NumberFormat('zh-CN', {style: 'percent', maximumFractionDigits: 1});
// 图形取原始值；排印百分点用formatNumber，增长率用formatPercent；null不能显示成0。
// 百分点：45% - 30% = 15个百分点；相对增长：150 / 300 × 100% = 50%。
```

单位换算同步改变数值与标签；混合单位先换到共同尺度。数字内容改变时，圈线和底衬继续使用当前实测字框，整个字组沿同一scene与Cue进入预演、P4，不另建表格或图表交付。
