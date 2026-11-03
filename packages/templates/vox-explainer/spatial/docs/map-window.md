# 数据地图窗口与区域层

本页属于[spatial工具](../README.md)，所述源码与资源路径相对spatial目录，场景接口由模板统一提供。

## 数据地图窗口

制作脚本在Node中从`spatial/prepare-map.mjs`导入`prepareMapData`，以当前地图全部运镜覆盖的经纬度`bounds:[[west,south],[east,north]]`裁切数据。经度跨日期线时用连续区间，例如170至190。默认裁取包内Natural Earth，地形从Mapzen Terrarium瓦片提炼色面；下载只发生在制作时，瓦片缓存留在本单scratch。所需镜头更细时应取得适当精度的地理数据，不能用提升渲染zoom冒充数据精度。

```js
const data = await prepareMapData({
  bounds: [[130, 31], [134, 35]],
  cacheDirectory: path.join(scratchPath, 'dem-cache'),
  terrainAttribution: '地形：Mapzen Terrain Tiles · USGS SRTM/GMTED2010'
});
// 在作者构建脚本中序列化进scene.animation；不得留下scratch文件地址或fetch。
const animation = `const mapData = ${JSON.stringify(data)};
` + authoredAnimation;
```

署名示例适用于核对后的相应区域，不能照抄到所有国家。按[Mapzen数据提供者说明](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)核对当前区域，并在原来源交接与画面来源短栏保留实际提供者。`data.attribution`包含来源信息，不自动绘制，也不表示每一条都必须上屏；其中Natural Earth出处可留在制作依据中，地形及其它素材按[实际署名要求](resources.md#来源与署名)处理。

`zoom`可显式指定DEM取样层级，默认在最多32瓦片内选层级；`maxTiles`可按实际范围调整。无地形解释需要时传`relief:false`，不下载DEM；已有有据GeoJSON可传`geography:{land,lakes,rivers}`和`terrain`（FeatureCollection，properties.kind为foothill/hill/mountain/high/shade/light），由作者负责范围、精度和来源。准备失败返回实际故障，不用平地或随机山形补齐。

在scene.markup中留一个HTML容器（不能放进SVG内部）；scene.animation调用已注入的接口。示例以1920×1080画幅展示纵向展开的主地图；实际box、镜头与字组随观看任务共同设计，见[地图对象构图](../../references/spatial.md#地图对象构图)：

```js
const box = {x: 120, y: 140, width: 1680, height: 800};
const camera = {center: [132.05, 33.35], zoom: 7.75};
const map = spatial.createMapWindow({element: select('#map-slot'), data: mapData, box, camera});
map.overlay.innerHTML = '<g id="port"><circle r="7"/><text y="-20">港口</text></g>';
const view = {...box, longitude: camera.center[0], latitude: camera.center[1], zoom: camera.zoom};
timeline.to(view, {longitude: 132.11, latitude: 33.08, zoom: 9.1, duration: 2}, cue('M002'));
onFrame(async () => {
  await map.seek({box: view, camera: {center: [view.longitude, view.latitude], zoom: view.zoom}});
  const point = map.project([132.1, 33.1]);
  map.overlay.querySelector('#port').setAttribute('transform', `translate(${point})`);
});
```

初始和每帧seek均由正式Renderer等待地图数据与绘制完成，地图跟随原场景释放；异步`map.seek`必须await后再排印本帧图件。不要调用MapLibre的flyTo、easeTo或另起定时播放。box控制纸张位置、尺寸、opacity和可选rotate（默认0.8度）；camera控制center、zoom、bearing（默认正北），固定俯视。每帧从原时间直接求完整状态，不能按上一帧累加位移。地图容器始终保留实际尺寸，隐藏用opacity，避免display:none使视口失真。

`map.project([lon,lat])`返回内部SVG坐标，`map.path(coordinates)`返回共用投影的SVG折线路径；`map.screenPoint`返回包括纸边、平移及旋转的父画布坐标，用于旁图引线；`map.overlay`是内部SVG，文字与兵棋放在其内可保持屏幕尺寸。`map.size`返回内部width/height/pad。窗口缩小时若希望保持原地理范围，按视口尺寸比给zoom加`Math.log2(Math.min(newWidth/baseWidth,newHeight/baseHeight))`；是否保持范围由讲法决定。对象路线与已走轨迹仍使用同一几何/进度，再经过当前投影；每帧更新图件位置而非缩放整幅SVG。

数据已内嵌scene；本地MapLibre worker由原renderData.resourceFiles收集，预演和P4沿同一资源复制与Renderer使用。制作脚本和缓存不进入成片。地图与普通图解的观看交接沿[地图对象构图](../../references/spatial.md#地图对象构图)设计，本页接口继续负责实际地图窗口。

## 区域涂色

`createMapWindow`与`map.seek`均接受`regions`，为已内嵌的GeoJSON FeatureCollection；也可将初始区域放在`data.regions`。每个Feature使用稳定唯一的字符串或整数`id`和经纬度Polygon／MultiPolygon，保留闭合外环、内环及离散地块。含义、年代、来源、精度与变化依据沿[区域方法](../../references/spatial.md#用区域涂色表达范围与变化)由作者确定，组件不提供历史边界，也不由兵牌位置生成控制区。

```js
// zones在制作时按本题史料准备，已序列化进当前scene。
const map = spatial.createMapWindow({element: select('#map-slot'), data: mapData,
  box, camera, regions: zones});
onFrame(async ({time}) => {
  const p = Math.max(0, Math.min(1, (time - cue('M002')) / 1.2));
  const regions = {...zones, features: zones.features.map(feature => ({...feature,
    properties: {...feature.properties, opacity: p}
  }))};
  await map.seek({box, camera, regions});
  // 同一帧的地名、路线及兵棋随后用map.project更新。
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

区域位于地形之上、水系及海岸线之下，文字、兵棋和路线仍在SVG覆盖层。区域几何不会自动按陆地裁切：领土、陆上控制区应在制作时用有据轮廓及项目已有Turf交、并、差处理；海上范围保留其实际海域。内环可表达不属于该面的辖区，MultiPolygon保留飞地和岛屿。跨日期线与底图沿同一个连续经度区间准备。分批色面、范围变化与同图多层按Feature顺序安排，后面的面覆盖前面的面；重叠透明度会叠加，不替作者判断实际归属。
