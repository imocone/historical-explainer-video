# 地理与图件资源

本页属于[spatial工具](../README.md)，所述源码与资源路径相对spatial目录，场景接口由模板统一提供。

## 地理骨架与地形定位

作者脚本可从geometry.mjs导入：

- `geographicFrame([[west,south],[east,north]],{x,y,width,height})`：返回经纬度到平面图内点的函数，保持墨卡托比例。跨日期线先把经度统一到连续区间。
- `calibrateTerrain([{geo:[lon,lat],point:[x,y]},…])`：用三个不共线的已知地标对应斜视图内坐标，返回定位函数。额外地标用于人工核对偏差，不用函数掩盖不符的地形。
- `geographicPath(geometry,project)`：把GeoJSON线面投影为SVG d；Polygon使用fill-rule="evenodd"保留内环。按本题裁取数据与视口，保留整体连通性，不把全球细节全部塞进成片。

作者脚本从geography.mjs调用`await geographicLayers({bounds,viewport,layers:['land','lakes','rivers']})`，可直接裁取包内数据并取得每层的SVG路径数组。它先用Turf裁取选定范围，再用同一投影成图，避免把极区或无关全球细节带入当前范围。按用途给陆地、水面和河线配色，面使用evenodd填充，水系与地形保持连通。选用SVG总览或为地块生图准备地理骨架时可取用这些路径；正式数据推演的主底图走[共用地图窗口](map-window.md#数据地图窗口)，地图表示的取舍沿[空间方法](../../references/spatial.md#先建立可信空间)。

geography/{land,lakes,rivers}.json是原包保留的Natural Earth物理地理：只作骨架，不是地形高程或历史边界。需要更细的地理拓扑、并集或差集时，作者脚本可使用项目已有Turf，输出静态SVG到scene.markup；成片不请求网络地图。需要三维主体时沿模板提供的[Three.js运行接口](../../references/tools/three.md)，与SVG共用原Cue和时钟。

## 地图图件、设施与道路

本节列出可选的 SVG 标记，也可自行绘制或沿[原图片入口](../../references/tools/images.md#图片)制作图件。先按[空间方法](../../references/spatial.md#让行动确实改变局势)决定观众要看到地点、走向还是部队的实际行动，再为本题选择图形。

选用 [symbols.mjs](../symbols.mjs) 的图件时，作者脚本在制作时取 `markup` 写入原场景。

[人物底稿](../../references/art.md#svg底稿与改绘)可按需取用或改绘。已经认出的角色或部队再次出现时，保留身份色和可辨特征，再按新景别调整细节和字位。

| 要画什么 | 可选图件 |
|---|---|
| 古代陆上行动 | `ancient-infantry` 直接用[人物底稿](../../artwork/people.mjs)的护卫改成步行队列。`ancient-cavalry` 用同一护卫的骑姿，接到[马身与马具](../assets/unit-horse.svg)。按本题改衣装、兵器、骑姿和马具。 |
| 水上渡运 | `raft` 用同一人物底稿的工匠改撑桨姿势，加上[筏身与水痕](../assets/unit-raft-hull.svg)。按本题改载物、桨手与方向。 |
| 装备及旧图件 | `cannon`、`artillery`、`machinegun`、`tank`、`ironclad`、`warship`、`destroyer`、`transport`、`submarine`、`aircraft`、`wagon`。需要承接已有单位画面时也可取 `infantry`（持枪队列）、`spearman`、`archer`、`cavalry`。 |
| 设施与工事 | `mapMarker` 可取 `gatehouse`、`settlement`、`port`、`station`。`worksMarker` 可取 `earthwork`、`bridge`。`infrastructure(points,{kind,width})` 可取 `road`、`railway`，连接和桥位按当前来源确定。 |

`mapMarker(kind,color,size)` 取地点或行动图件。`unitSymbol(kind,color,size)` 提供带贴形浅边的无框图件。参数 `size` 用于缩放原图，不等于图件轮廓的实测宽度。按约 390px 宽的实际整幅看是否认得轮廓、方向和落点；太小就加大有效轮廓或重新取景。`pairedInfantry` 是已有的近现代共点示意，只在同一位置有据、且这对图件符合题目时使用。

需要独立单位图例或明确采用兵棋表示时，可选 `unitCounter(kind,color='accent',size=140)`。它提供浅色纸面、阵营色顶边和地面定位点。队名置于牌外。`size` 为牌面宽度，底端定位点是 `(0,0)`，可交给 `createScene` 的 `unit` 并设置 `screenSize:true`。

这些符号接口的 `color` 传 `appearance.palette` 中的角色名，如 `secondary`。同一SVG里放多个带浅边的图件时，每件分别调用一次，给每个浅边滤镜留下独立ID。浅边辅助分离轮廓，主体仍要和地形有足够反差。

陆上符号锚点在脚下地面，木筏在水线，舰船在船体中心，飞机在机身中心。侧视船可按方向镜像，保持船体直立。符号不编码人数、编制、海拔或真实面积。`mapMarker('gatehouse', …)` 取闭门地标。选用该地标且需要展示同一座门开合时，可用[建筑底稿](../../references/art.md#svg标注与排字)的 `gatehouse({id, open})`，按原锚点和景别摆放。

## 来源与署名

表中“装备及旧图件”共用本项目改绘，造型参考 [AbsoluteUnits](https://github.com/letstalkaboutdune/AbsoluteUnits)，作者 letstalkaboutdune，采用 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)，完整许可在 [assets/AbsoluteUnits-LICENSE.txt](../assets/AbsoluteUnits-LICENSE.txt)。使用这些素材时在画面来源短栏保留“兵棋改绘：letstalkaboutdune / AbsoluteUnits · CC BY 4.0”，单独导出也携带署名与改绘说明。

古代步卒、骑乘、木筏、牌面、土垒、桥和设施为本项目绘制。马身参考馆藏的马颈、肩胯和鞍座比例，使用自绘SVG。[MOA 美术馆鞍马](https://www.moaart.or.jp/en/collections/110/) · [大都会艺术博物馆骑马俑](https://www.metmuseum.org/art/collection/search/44805)

特定年代、地区和器物形制以本题依据为准。

[Natural Earth陆地](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-land/)、[湖泊](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-lakes/)、[河流](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-rivers-lake-centerlines/)为[公有领域](https://www.naturalearthdata.com/about/terms-of-use/)，官方不要求署名。原land.json及2026-10-02转换的湖泊河流数据原样保留。10m表示1:1000万概化比例，并非10米精度；来源与精度保留在当前制作依据中，不要求画面显示“地理骨架：Natural Earth”。历史资料、DEM和其它素材分别按实际许可履行署名，不因底图为公有领域而省略。
