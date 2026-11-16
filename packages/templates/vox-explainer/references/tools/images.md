# 图片

按分镜和[需要图片的实际画面](../creative/production.md#素材与动作一起设计)确定图件的用途、构图和可动部分，写入蓝图后再准备正式图片。主体、器物、环境、分件和状态图都沿此入口生成、修正或导入。没有图片需要时，`assetRequests: []`仍是完整合法的交付。[地图推演](../spatial.md)的地图沿[数据地图窗口](../../spatial/docs/map-window.md#数据地图窗口)制作，需要生图的地图图件、局部地貌及旁图情境使用本图片入口。

每个请求提供`requestId / purpose / sourceRefs / mustNotInvent / visualBrief / exactTexts`。`visualBrief.composition`写清本件主体或部件、姿态、视角、必要环境及后续动画用法；按[素材与动作](../creative/production.md#素材与动作一起设计)确定粒度，保全独立动作所需的轮廓、接合、活动空间和移动后露出的形体，并交清同物关系。地图图件沿[空间方法](../spatial.md)设计。`transparentBackground`只决定背景是否透明：true为透明，false为不透明，不改变构图范围。准确数字和普通标签由程序排印。

`visualBrief.styleReference`按本张图所需形态选择：省略或`general`用于人物、器物和普通情境；`terrain`用于局部地貌、剖面和地形操作情境。两者沿用本节目视觉包的造型、线条和材质画法。局部形态、用色、姿态、构图和地理依据由本件蓝图决定；画风参考不提供内容或地理事实。参考资料的规则更新不使已有有效图片失效。

图件确实要沿用章内角色色时，在本件蓝图写清用在什么对象上，如“主旗用 `var(--accent)`”。图片入口只投递并跟踪本件引用的颜色。旧图若曾随章内角色色制作，改色时对照原图和蓝图，把需要跟着变的色写进对应图件的蓝图。对象的材料本色和本件特定用色直接在蓝图交代，画面排字或底板用色沿原场景处理。

同一人物或器物需要新姿态、视角时，在新请求用`referenceImageId: "AR001"`选择本段已完成的对象原图，并在蓝图中说明保留什么、改变什么。修改已有图片时保留该请求的`asset`，把具体修正意见写进`visualBrief`；入口自动携带修改前的原图。画风参考与对象原图各有用途，不用画风图代替形象依据。

```bash
node packages/templates/vox-explainer/images.mjs prepare <工作单> <候选>
```

`prepare`只返回所需原图已就绪的请求。先完成可制作的图片，或按提示用`import-source`导入登记原件，再运行同一命令取得依赖它的请求。引用指向本段其它图片。出现循环时，按报出的图片编号纠正引用方向。

- 返回`recovery`时，把`sourceFile`作为原图PNG、`receiptPath`作为调用JSON，直接导入已有结果。
- 返回新生图或修图参数时，核对画风参考和对象原图，将完整`job`原样交给Codex原生imagegen，保存实际调用JSON，再导入原PNG与该JSON。漏传原图不能导入。

原调用失败或结果未知时，保留记录并停止。

```bash
node packages/templates/vox-explainer/images.mjs import <工作单> <候选> <AR编号> <原图PNG> <调用JSON> [锚点JSON]
```

程序保留真实提示、文件、来源、可见范围和可选原图归一化锚点。HTML、SVG及CSS均用`asset:AR001`引用同一图片。例如`<img src="asset:AR001">`或`<image href="asset:AR001" .../>`。布局按实图尺寸和透明范围安排，作用点要用实际锚点；移动布局不重生未改图片。不同姿态、反面或内部结构准备相应图件，让形体变化符合实际结构。

使用登记原件时在请求选择`sourceAssetId`，并将其列入sourceRefs，然后运行`images.mjs import-source <工作单> <候选> <AR编号> [锚点JSON]`。原件保留原始PNG/JPEG与出处，显示时取景、注释，不重绘其内容或冒充生成来源。

## 地理骨架参考

需要以地图约束局部地貌插画时，沿现有图片引用链传入实图：

1. 准备可用于该用途的PNG/JPEG，SVG先导出为PNG；沿[来源交接](../../../../p3-sources.md)登记并取得SA编号，已有登记直接复用。自制骨架交清数据出处、范围与精度限制，再用一个图片请求选择该`sourceAssetId / sourceRefs`，沿上面的`import-source`导入为如`AR001`。
2. 局部地貌请求设`referenceImageId: "AR001"`、`visualBrief.styleReference: "terrain"`并引用对应来源。在蓝图中说明须保留的海陆轮廓、地点、方向与连通关系，以及可调整的视角、厚度和材质；骨架约束地理，画风取本节目视觉包。
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

活动图件沿[素材与动作](../creative/production.md#素材与动作一起设计)准备；地图操作沿[直接推演的适用方法](../spatial.md#选择直接推演或旁图细节)组织。导入后按实际图片坐标定位：用裁框内的转轴旋转独立外层，固定背景与活动件分组；状态图使用同一接合点、尺度与外层变换。需要局部遮挡时用对应轮廓的clipPath或mask，姿态变化保持实际透视和形体关系。

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
