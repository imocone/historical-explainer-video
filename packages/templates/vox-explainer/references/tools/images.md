# 图片

普通讲解选择图片制作主体、器物、环境、分件或状态图时，按[素材与动作](../creative/production.md#素材与动作一起设计)确定构图与所需变化，沿本节生成、修正或导入；没有图片需要时，`assetRequests: []`仍是完整合法的交付。[地图推演](../spatial.md)的地图沿[数据地图窗口](../../spatial/docs/map-window.md#数据地图窗口)制作；确需生图的兵棋、局部地貌及旁图情境使用本图片入口。展示登记原件使用`import-source`，保留原貌与来源。作者把本件作用和可控部分落实到蓝图与scene；`prepare`只返回当前生图参数，交给Codex原生imagegen生成后导入。

每个请求提供`requestId / purpose / sourceRefs / mustNotInvent / visualBrief / exactTexts`。`visualBrief.composition`写清本件主体或部件、姿态、视角、必要环境及后续动画用法；按[素材与动作](../creative/production.md#素材与动作一起设计)确定粒度，保全独立动作所需的轮廓、接合、活动空间和移动后露出的形体，并交清同物关系。地图图件沿[空间方法](../spatial.md)设计。`transparentBackground`只决定背景是否透明：true为透明，false为不透明，不改变构图范围。准确数字和普通标签由程序排印。

`visualBrief.styleReference`按本张图所需形态选择，不按整段题材选择：省略或`general`使用人物、器物与普通情境的说明；局部地貌、剖面和地形操作情境用`terrain`。两者的第一张参考均为[共同画风图](../comic-terrain.png)，用途按[共同画风](../art.md#共同画风)理解；`general`另带第二张[人物与器物图](../comic-figures.png)，只补充比例、体块、衣物结构与手物接触，不继承其中身份、时代衣装、厚纸边、背景环境、站姿或静态构图，纯器物图也不因此增加人物。`terrain`保持单张共同画风参考，局部地貌形态由其专门说明提供。具体内容、姿态、构图与用色按本件蓝图制作。程序按明确选择投递说明，不猜蓝图关键词；画风参考数量变化本身不使已有有效图片失效。

同一人物或器物需要新姿态、视角时，在新请求用`referenceImageId: "AR001"`选择本段已完成的对象原图，并在蓝图中说明保留什么、改变什么。修改已有图片时保留该请求的`asset`，把具体修正意见写进`visualBrief`；入口自动携带修改前的原图。画风参考与对象原图各有用途，不用画风图代替形象依据。

```bash
node packages/templates/vox-explainer/images.mjs prepare <工作单> <候选>
```

prepare只返回原图已就绪的请求；先完成返回的图片并导入，再运行同一命令取得依赖它的新姿态请求。引用不能越出本段、指向自身或形成循环。逐一查看返回参数中的画风参考和对象原图，将完整job原样交给Codex原生imagegen，保存实际调用JSON，再导入原PNG与该JSON；漏传原图不能导入：

```bash
node packages/templates/vox-explainer/images.mjs import <工作单> <候选> <AR编号> <原图PNG> <调用JSON> [锚点JSON]
```

程序保留真实提示、文件、来源、可见范围和可选原图归一化锚点。HTML、SVG及CSS均用`asset:AR001`引用同一图片。例如`<img src="asset:AR001">`或`<image href="asset:AR001" .../>`。布局按实图尺寸和透明范围安排，作用点要用实际锚点；移动布局不重生未改图片。不同姿态、反面或内部结构准备相应图件，让形体变化符合实际结构。

历史API已有完成结果时，prepare返回`recovery`，直接以其中sourceFile和receiptPath沿同一import恢复原图，保留实际来源；失败或未知时停止并保留记录，不切原生重投。当前新图片及修图均沿上文原生工具入口；修图保留当前asset，并在visualBrief交清具体意见，入口自动携带原图。

使用登记原件时在请求选择`sourceAssetId`，并将其列入sourceRefs，然后运行`images.mjs import-source <工作单> <候选> <AR编号> [锚点JSON]`。原件保留原始PNG/JPEG与出处，显示时取景、注释，不重绘其内容或冒充生成来源。

## 地理骨架参考

需要以地图约束局部地貌插画时，沿现有图片引用链传入实图：

1. 准备可用于该用途的PNG/JPEG，SVG先导出为PNG；沿[来源交接](../../../../p3-sources.md)登记并取得SA编号，已有登记直接复用。自制骨架交清数据出处、范围与精度限制，再用一个图片请求选择该`sourceAssetId / sourceRefs`，沿上面的`import-source`导入为如`AR001`。
2. 局部地貌请求设`referenceImageId: "AR001"`、`visualBrief.styleReference: "terrain"`并引用对应来源。在蓝图中说明须保留的海陆轮廓、地点、方向与连通关系，以及可调整的视角、厚度和材质；骨架约束地理，画风仍取本包画法。
3. 运行原`prepare`，确认返回的`referenced_image_paths`包含骨架实图，再将完整参数交给生图工具。`sourceRefs`只记录来源，不会自动传图。骨架可仅作参考，但其请求和实图随引用链保留；结果沿原`import`导入，再按实图校准。

## 图片与动作配合

本节与下节按本件实际需要使用：生图素材与地图图片可裁件、分层并配合动作；登记原件可取景、定位和注释，保留原内容与出处。图片和SVG可以直接放在同一SVG坐标中，并随同一外层一起移动、旋转或缩放。制作脚本可调用[imagePlacement](../../image-geometry.mjs)计算图件与锚点位置：

```js
import {imagePlacement} from '/系统根目录/packages/templates/vox-explainer/image-geometry.mjs';
const placed = imagePlacement({x: 320, y: 160, width: 1200, height: 620,
  anchors: {pivot: {x: .5, y: .5}}}, asset);
// placed.image供image元素定位，placed.bounds为可见范围；placed.anchors.pivot是同坐标作用点。
```

`asset`取候选中已导入的图片；有原图锚点时优先使用原图坐标，没有时才用指定的可见范围相对位置。把结果写入scene，让叠加线、活动件与实图的作用处对齐；锚点仍须按实图确认。

图件按[素材与动作](../creative/production.md#素材与动作一起设计)准备活动件、接合处、遮挡及移动后露出的完整形体；地图操作同时沿[尺度与操作](../spatial.md#尺度与操作)组织。导入后按实际图片坐标定位：用裁框内的转轴旋转独立外层，固定背景与活动件分组；状态图使用同一接合点、尺度与外层变换。需要局部遮挡时用对应轮廓的clipPath或mask，姿态变化保持实际透视和形体关系。

确需制作分件接触与状态反馈时，可查[局部实现](../../examples/parcel/scene.mjs)，取用裁件、接合与共同进度的做法；本题的作用关系、物件和动作仍按当前设计完成。

整件器物沿道路、轨道或台面移动时，在原图找出前后两处真实接触点，并在承托图层找到对应位置。按两点连线确定方向与比例，再平移到位；已定显示尺度时，沿路径寻找相同接触点间距的前后位置。物件与承托面共用所在空间的镜头变换，用实图作用点保持进入、行进与落定中的贴合；弯道或视角超出当前图件能力时调整取景或准备适合的图件。

## 小物件成组制作与取用

作者按当前设计选择共同制作的小件；差异很大的视角、材质或分辨率需求分开，保证每件能满足实际观看尺寸。

一组用原有一个`assetRequest`。在`visualBrief.composition`中交清每件是什么、姿态或视角、相对尺寸、各自位置，以及“完整轮廓、互不遮挡、件间透明留空、无编号文字、无共同地面”。活动部件要带上接合处和转轴附近的完整形体；多个姿态按实际动作需要安排。整张素材图供分件取用，成片按当前讲法重新组合和安排动作。

生成后沿原入口导入整张PNG，查看实际图件而非假定它严格落在等分网格。给每件选一个包住完整轮廓、留少量透明边且不含邻件的原图像素裁框；在同一scene里反复引用这个AR，用SVG视口分别取用，再各自摆放和动画。裁框和图内锚点属于当前scene制作数据，不另交素材清单、文件副本或新请求。

```html
<!-- 示例：2048×1024原图中的一个600×400裁框，等比显示为240×160。 -->
<g id="part" transform="translate(480 320)">
  <svg width="240" height="160" viewBox="80 60 600 400" overflow="hidden">
    <defs><clipPath id="part-crop"><rect x="80" y="60" width="600" height="400"/></clipPath></defs>
    <image href="asset:AR002" width="2048" height="1024" clip-path="url(#part-crop)"/>
  </svg>
</g>
```

尺寸与裁框替换为本件实图；每件使用不同的外层与裁框id，移动或转动各自外层。显式clipPath裁住原图，避免显示比例变化后，视口留白带入邻件细边；画布的满幅CSS只作用于根SVG，不覆盖分件视口的宽高。局部转轴按裁框内的真实位置换算；使用说明文字或引线时，随当前变换保持对象对应。整张图的`contentBounds`只表示全部图件的总范围，不能拿来当每一件的边框。若件间粘连、轮廓被裁或分辨率不足，沿原图片入口修对应素材，使每个裁框内保有独立、完整、清楚的图件。布局或动作变化仍复用合格图件。
