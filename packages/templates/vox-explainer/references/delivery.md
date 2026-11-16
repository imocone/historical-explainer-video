# 制作与交付

本文件拥有共同候选和动画接口，并按当前动作路由所需工具。创作路线与调用时点由[作者入口](../AUTHOR.md)组织，专业判断见[创作方法](vox.md)；工具按输入依赖执行，不必一次读完全部工具说明。

一份`treatment`保存整段作品。字段见[结果合同](../../../../contracts/vox-explainer-treatment.schema.json)，正常候选外壳与提交沿author-beat。

`design.md`是当前工作单`scratchPath`内的[整章制作稿](creative/design.md#整章设计稿)，从第1步写起，供本单各步读取和更新。预演读取当前候选，P4读取已接纳的章节`treatment`及正式交付的素材。

`templateContext.audio.file`是正式P2原声音频的绝对路径，`startMs / endMs`是本段在该文件中的播放窗口，`sha256`用于校验文件身份。预演读取同一文件和窗口，复用原配音与时长。作者的创作依据见[作者入口](../AUTHOR.md#接住本单)，句内时间见[实测短语与句内卡点](tools/cues.md#实测短语与句内卡点)。

- `templateId: "vox-explainer"`。
- `objective`：本段让观众明白什么。
- `appearance`：沿用本单`templateContext.appearance`的外观身份与字体。底色按本题调整，并在候选的`palette`填齐`accent`与`secondary`，其它角色色按需加入。见[画布与动画](#画布与动画)。
- `continuity`：本段时期、地点、人物与道具，遵守本单事实。`carryToNext`仅在有后续复现提示时填写，不代表下一正文段自动继承；已有内容保留。
- `moments`：将讲法中的关键动作、状态转变或理解发现记为`{id:"M001",purpose,sourceRefs}`，`purpose`写清本次可见变化或新认识，再选择对应Cue。一项可以跨多句，一句也可包含多项；一幅静态比较已经讲清时，可用一个理解发现绑定Cue。
- `scene.markup`：整段动画的场景、对象、图件与图文结构，保存为完整HTML片段，可含CSS、SVG、Canvas和图片。自由布局，不分固定元素类别。
- `scene.animation`：用原生JavaScript编排对象、图解、镜头与状态变化，可按表达需要非线性组织；播放仍由本段统一时钟定位。
- `assetRequests`：交付本段实际使用的图片，没有图片时为空数组；素材组织可参考[素材与动作](creative/production.md#素材与动作一起设计)。

## 按需工具

| 当前动作 | 读取 |
|---|---|
| 绑定moments、使用实测短语 | [Cue与句内时序](tools/cues.md) |
| 制作二维镜头、动作错时与联动 | [运动实现示例](tools/motion.md) |
| 生成、导入、裁件及摆放图片 | [图片接口](tools/images.md) |
| 使用Three.js并与SVG协作 | [三维接口](tools/three.md) |
| 纸面、标注、字体测量和数值 | [图文工具](tools/graphics.md) |
| 预演、取帧、导出及临时收字 | [预演接口](tools/preview.md) |
| 地图、路线、旁图和图件 | [空间工具入口](../spatial/README.md) |

## 画布与动画

从`templateContext.renderContext`取画幅与`safeArea`。以完整画幅组织场景，`safeArea`用于安排关键内容、避让字幕及画面边缘；地图构图和底图按[地图对象构图](spatial.md#地图对象构图)展开。

每段在独立Shadow DOM中，markup的根样式用`:host`，内部ID和CSS不会影响其它段。颜色变量为`--background`、`--ink`、`--paper`、`--accent`、`--secondary`及本段其它角色色，用如`fill: var(--accent)`的CSS取值。实字体用`var(--font-body)`与`var(--font-title)`，字重用`var(--font-body-weight)`与`var(--font-title-weight)`。

`appearance.palette.background`、`paper`、`ink`共同决定底板、衬色与字色，浅纸为默认。作者可按镜头设计环境和滤镜。节目字幕用本段`ink`作字色、`paper`作描边，按字幕实际压住的表面配色。字幕落在浅色地图上时，按地图配深字，并让两行字幕范围落在安静、连续的区域。讲解进入、退出及讲解互接由渲染器沿原专用推移处理。章内切点和动作由作者按[全章粗排](creative/design.md#全章粗排)写入同一scene。

`scene.animation`可直接使用：

| 接口 | 用途 |
|---|---|
| `root`、`select(css)` | 取得画面根或元素；select单个命中返回节点，多个返回数组，无命中报错 |
| `gsap`、`timeline` | 原生GSAP与本段受控时间轴；动画接到timeline，通过select传节点 |
| `THREE` | 随模板打包的Three.js命名空间，在本段Canvas中创建三维主体、相机、灯光与材质；见[三维制作](tools/three.md) |
| `spatial.projectAnchor(worldPoint, camera, view?)` | 把当前相机中的三维点换算成SVG坐标。点在镜头可见范围外时返回`null`。局部画布传入它在SVG中的矩形，见[三维标注](tools/three.md#让标注跟住部件) |
| `cue("M001")` | 该观看变化所选Cue的start或end绑定时刻，相对本段、单位秒 |
| `eventTime("E001")` | 本段scene.events中的画面动作时刻，相对本段、单位秒；独立于可选功能 |
| `onFrame(({frame,time,fps})=>...)` | 按指定帧直接绘制Canvas、改变SVG或计算完整状态 |
| `onCleanup(fn)` | 释放临时资源 |
| `spatial` | 数据地图窗口、连续路线、镜头、定位与标签工具，普通讲解和地图推演均可按需调用，见[空间工具](../spatial/README.md) |
| `assets` | Map，按AR编号读取图片的尺寸、可见范围与锚点 |
| `width / height / fps / duration` | 画幅、帧率、本段时长（秒） |

共同事实或位移由一处状态求出，形体、路径和读数读取它。需要整体移动的对象放在同一外层，独立活动件保留局部变换。变量、分组与函数属于当前scene。

GSAP动画写入提供的`timeline`，或把自建子时间轴加入它，由HyperFrames按本段时间定位。按需查看[取景与动作示例](tools/motion.md)。

独立的`gsap.to(...)`或未接入的子时间轴会自行播放，不能随本段跳帧复位。当前Shadow DOM内的CSS动画与Web Animations由Renderer按同一时间定位；逐帧函数按当前time计算完整状态，不能依赖前一帧、定时器或未固定的随机数。跳帧、倒放和重进应得到相同画面。不要在markup内放脚本或运行时网络请求。

按[口播卡点与画面节奏](creative/timing.md#按字幕时窗粗排)决定取景、作用、读数和字组各自的时机。用`cue('M002')`或已声明的`eventTime('E001')`取得时间锚点，动作留在本段时窗内。偏移是制作编排，实测词点按[短语证据](tools/cues.md#实测短语与句内卡点)取用。地图内的CSS与Web Animations共用本段时钟；随地理投影更新的位置在`await map.seek(...)`后计算。

混合图片时按[实际图片锚点](tools/images.md#图片与动作配合)校准，同一状态的控制关系保持一致。

同一元素的显隐由同一处控制。用SVG的`opacity`属性驱动时，初态也写在该属性上；不要再用CSS类固定`opacity:0`覆盖动画，导致对象始终不可见。

字组和标注的进入、停驻、退出或替换同样写入原`timeline / onFrame`，需要持续的依据按当前用途保留。逐帧函数由当前时间计算完整显隐与内容，不能只在越过进场点时置为可见而遗漏后续退出与回看状态。

### 附着、脱离与换表示

需要把同一物件带到另一处、改变形状再接入新关系时，先求承托对象的当前位姿，再把局部锚点经缩放、旋转和平移投到世界坐标；SVG同组嵌套可让浏览器执行相同变换，独立图层则显式求这个坐标。脱离时固定实际离开位置，飞行终点取目标在接触时刻的位置，另排中间通路；接入后跟随目标的当前位姿，不再沿两端插值。为人物、读数和作用处留出实际通路，不能只靠换层躲避相穿。

形变围绕实际接触点展开。例如物件底边受承托时，宽高改变仍保持底边锚点；代码画件用当前轮廓求锚点，图片从实图可见边界及已定锚点求位置。外层镜头最后统一作用于同一场景，独立叠加层按当前投影定位。绘制顺序与路径分别安排：需要从后面经过就进入相应遮挡层，需要在前面可见就给它实际通路。
