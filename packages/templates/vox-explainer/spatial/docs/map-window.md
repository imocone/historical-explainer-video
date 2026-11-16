# 数据地图窗口与区域层

本页属于[spatial工具](../README.md)，所述源码与资源路径相对spatial目录，场景接口由模板统一提供。

## 数据地图窗口

制作脚本在Node中从`spatial/prepare-map.mjs`导入`prepareMapData`，以当前地图全部运镜覆盖的经纬度`bounds:[[west,south],[east,north]]`裁切数据。经度跨日期线时用连续区间，例如170至190。默认裁取包内Natural Earth，地形从Mapzen Terrarium瓦片提炼色面；下载只发生在制作时，瓦片缓存留在本单scratch。所需镜头更细时应取得适当精度的地理数据，不能用提升渲染zoom冒充数据精度。

```js
const data = await prepareMapData({
  bounds: [[128, 31], [136, 36]],
  relief: false
});
// 在作者构建脚本中序列化进scene.animation；不得留下scratch文件地址或fetch。
const animation = `const mapData = ${JSON.stringify(data)};
` + authoredAnimation;
```

选用地形时，按[Mapzen数据提供者说明](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)核对当前区域，填入`terrainAttribution`，提供`cacheDirectory`保存本单瓦片缓存。`data.attribution`只记录来源，不自动绘制；Natural Earth出处可留在制作依据中，地形及其它素材按[实际署名要求](resources.md#来源与署名)处理。

`zoom`可显式指定DEM取样层级，默认在最多32瓦片内选层级；`maxTiles`可按实际范围调整。无地形解释需要时传`relief:false`，不下载DEM；已有有据GeoJSON可传`geography:{land,lakes,rivers}`和`terrain`（FeatureCollection，properties.kind为foothill/hill/mountain/high/shade/light），由作者负责范围、精度和来源。准备失败返回实际故障，不用平地或随机山形补齐。

在scene.markup中留一个HTML容器（在SVG外，左上角对齐场景原点；局部地图的位置由`box`确定）。scene.animation调用已注入的接口。下面以全幅地图为例；取景和布局见[地图对象构图](../../references/spatial.md#地图对象构图)：

```js
const camera = {center: [132.05, 33.35], zoom: 7.75};
const anchor = [132.1, 33.1]; // 仅示意定位接口
const map = spatial.createMapWindow({element: select('#map-slot'), data: mapData, camera});
map.overlay.innerHTML = '<g id="focus"><circle r="26" fill="var(--vox-text-ink)" stroke="var(--vox-text-paper)" stroke-width="5"/><text class="vox-label vox-text-outline" y="-44" text-anchor="middle" font-size="76">观察点</text></g>';
const view = {longitude: camera.center[0], latitude: camera.center[1], zoom: camera.zoom};
const detail = {longitude: anchor[0], latitude: anchor[1], zoom: 9.1};
const moveFrom = cue('M001');
const observe = cue('M002');
timeline.to(view, {...detail, duration:observe-moveFrom, ease:'power2.inOut'}, moveFrom);
onFrame(async () => {
  await map.seek({camera: {center: [view.longitude, view.latitude], zoom: view.zoom}});
  const point = map.project(anchor);
  map.overlay.querySelector('#focus').setAttribute('transform', `translate(${point})`);
});
```

示例在两个有间隔的Cue间沿同一地图移近，地点、路线和队伍随当前投影更新，机位到位后行动仍按原时钟继续。标记和字号换成本章实际图件，在手机整幅下校准。若只需直接切近，用`timeline.set(view, detail, observe)`；第0帧已是近景时，直接初始化为细节幅。

创建时传入`box`会启用纸窗，尺寸包含纸边和内边距。全幅地图省略`box`；需要无纸边的局部地图时也先省略，在原`onFrame`的`map.seek`中传本帧`box`设位置和大小。纸边有无由创建时决定。海陆、水系和地形沿[组件底图样式](../map-style.mjs)。

同一例改成纸窗时，创建地图传入 `box: {x: 120, y: 140, width: 1680, height: 800}`。需要为旁图让位时，把`box`的位置或尺寸一起排进原`timeline`，在同一个`onFrame`中将当帧`box`和`camera`传给`map.seek`，再更新图件投影。纸边、折痕和卷角由组件绘制；纸窗外的旁图引线使用`map.screenPoint`取来源端点。

初始和每帧seek均由正式Renderer等待地图数据与绘制完成，地图跟随原场景释放；异步`map.seek`必须await后再排印本帧图件。不要调用MapLibre的flyTo、easeTo或另起定时播放。box控制位置、尺寸、opacity和可选rotate（全幅默认0度，纸窗默认0.8度）；camera控制center、zoom、bearing（默认正北），固定俯视。每帧从原时间直接求完整状态，不能按上一帧累加位移。地图容器始终保留实际尺寸，隐藏用opacity，避免display:none使视口失真。

`map.project([lon,lat])`返回内部SVG坐标，`map.path(coordinates)`返回共用投影的SVG折线路径；`map.screenPoint`在地图容器坐标中计入纸边内距、平移及旋转，容器对齐场景原点时可直接供旁图引线使用。`map.overlay`是内部SVG，文字和图件的位置随投影更新，大小按实屏设置，地图推近不会自动放大它们。`map.size`返回地图实际可见区域的width/height及内距pad。相机中心不变且希望窗口缩放后仍包含原地理范围时，可按实际视口尺寸给zoom加`Math.log2(Math.min(newWidth/baseWidth,newHeight/baseHeight))`。宽高比变了会在一轴多露出一部分，须有数据覆盖。对象路线与已走轨迹仍使用同一几何/进度，再经过当前投影。

数据已内嵌scene；本地MapLibre worker由原renderData.resourceFiles收集，预演和P4沿同一资源复制与Renderer使用。制作脚本和缓存不进入成片。地图与普通图解的观看交接沿[地图对象构图](../../references/spatial.md#地图对象构图)设计，本页接口继续负责实际地图窗口。

## 区域涂色

`createMapWindow`与`map.seek`均接受`regions`，为已内嵌的GeoJSON FeatureCollection；也可将初始区域放在`data.regions`。每个Feature使用稳定唯一的字符串或整数`id`和经纬度Polygon／MultiPolygon，保留闭合外环、内环及离散地块。含义、年代、来源、精度与变化依据沿[区域方法](../../references/spatial.md#用区域涂色表达范围与变化)由作者确定，组件不提供历史边界，也不从图件位置推断控制区。

下面单独演示同一机位展示两期范围。已经创建地图时，只把区域状态加进现有的`map.seek`，继续用原相机。

```js
// beforeZones / afterZones 是本题有依据的两个状态，已序列化进当前scene。
const map = spatial.createMapWindow({element: select('#map-slot'), data: mapData, camera,
  regions: beforeZones});
const changeAt = cue('M002'); // 本镜展示后一状态的时刻
onFrame(async ({time}) => {
  await map.seek({camera, regions: time < changeAt ? beforeZones : afterZones});
  // 同一帧的地名、路线及图件随后用map.project更新。
});
```

每个Feature的`properties`可包含以下绘制值；不写时采用表中低对比默认值，实际配色按本题选择：

| 属性 | 默认值 | 用途 |
|---|---|---|
| `fill` | `#af806a` | 区域颜色；可用CSS色值，不能传未解析的CSS变量 |
| `fillOpacity` | `0.35` | 填色透明度，0至1 |
| `opacity` | `1` | 整个区域的透明度，0至1；0同时隐藏填色与描边 |
| `stroke` | `#6b6557` | 边界颜色 |
| `strokeOpacity` | `0.8` | 边界透明度，0至1 |
| `strokeWidth` | `1.5` | 屏幕像素线宽；0不描边 |
| `dashed` | `false` | 虚线轮廓；具体含义由作者交清 |

`seek`接收该帧的**完整区域集合**，不是增量补丁：删除Feature即退出该面，空集合清空全部区域；未传`regions`则恢复创建时的集合。改色、强调和显隐通过绘制值变化完成；范围变化由作者交付当时的完整geometry，不在屏幕坐标里缩放原边界。组件仅在几何或虚线类型改变时更新GeoJSON，绘制值经原生feature-state更新；每次完整重置对应状态，逆序和跳帧不依赖上一帧。可用原timeline动画properties的绘制值；组件只读取表中绘制属性、id与geometry，不序列化动画库附加缓存，其它事实及来源元数据仍由作者保留。所有调用仍须await，不使用自主动画或浏览器时钟。

区域位于地形之上、水系及海岸线之下，文字、图件和路线仍在SVG覆盖层。区域几何不会自动按陆地裁切：领土、陆上控制区应在制作时用有据轮廓及项目已有Turf交、并、差处理；海上范围保留其实际海域。内环可表达不属于该面的辖区，MultiPolygon保留飞地和岛屿。跨日期线与底图沿同一个连续经度区间准备。分批色面、范围变化与同图多层按Feature顺序安排，后面的面覆盖前面的面；重叠透明度会叠加，不替作者判断实际归属。
