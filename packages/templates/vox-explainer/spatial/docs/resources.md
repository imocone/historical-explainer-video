# 地理与兵棋资源

本页属于[spatial工具](../README.md)，所述源码与资源路径相对spatial目录，场景接口由模板统一提供。

## 地理骨架与地形定位

作者脚本可从geometry.mjs导入：

- `geographicFrame([[west,south],[east,north]],{x,y,width,height})`：返回经纬度到平面图内点的函数，保持墨卡托比例。跨日期线先把经度统一到连续区间。
- `calibrateTerrain([{geo:[lon,lat],point:[x,y]},…])`：用三个不共线的已知地标对应斜视图内坐标，返回定位函数。额外地标用于人工核对偏差，不用函数掩盖不符的地形。
- `geographicPath(geometry,project)`：把GeoJSON线面投影为SVG d；Polygon使用fill-rule="evenodd"保留内环。按本题裁取数据与视口，保留整体连通性，不把全球细节全部塞进成片。

作者脚本从geography.mjs调用`await geographicLayers({bounds,viewport,layers:['land','lakes','rivers']})`，可直接裁取包内数据并取得每层的SVG路径数组。它先用Turf裁取选定范围，再用同一投影成图，避免把极区或无关全球细节带入当前范围。按用途给陆地、水面和河线配色，面使用evenodd填充，水系与地形保持连通；这些路径可用于宏观SVG总览，也可作为地块生图的地理骨架，地图形式与画法沿[空间方法](../../references/spatial.md#先建立可信空间)完成。

geography/{land,lakes,rivers}.json是原包保留的Natural Earth物理地理：只作骨架，不是地形高程或历史边界。需要更细的地理拓扑、并集或差集时，作者脚本可使用项目已有Turf，输出静态SVG到scene.markup；成片不请求网络地图。需要三维主体时沿模板提供的[Three.js运行接口](../../references/tools/three.md#三维与svg协作)，与SVG共用原Cue和时钟。

## 兵牌、设施与道路

地图兵棋默认SVG，必要时也可沿[原图片入口](../../references/tools/images.md#图片)生图。以下图形供按题取用或改绘，具体形象、细节和动作沿[空间方法](../../references/spatial.md#让行动确实改变局势)设计。

作者脚本从symbols.mjs导入`mapMarker(kind,color,size)`，取返回值markup写进SVG g；函数在Node中读取本地素材，不能在scene.animation里import。支持infantry、spearman、archer、cavalry、cannon、artillery、machinegun、tank、ironclad、warship、destroyer、transport、submarine、aircraft、wagon及settlement、port、station。`pairedInfantry`将两方图形连在同一真实锚点；`worksMarker`有土垒和桥。

`unitCounter(kind,color='accent',size=140)`提供浅色纸面、阵营色顶边与地面定位点；kind须明确选择上述兵种。infantry是持枪队列，其余kind提供对应兵种形象；图形数量不代表人数或编制。队名置于牌外。size为牌面宽度，底端定位点是(0,0)，可交给createScene的unit并设置screenSize:true。

这些符号接口的`color`传palette中的名称，如`'accent'`、`'secondary'`；实际色值在`appearance.palette`中设置，选择能与当前地形区分的前景色；底边辅助分离轮廓，不能代替主体自身的颜色反差。例：`unitSymbol('warship','secondary',150)`。不要传`'#426778'`或`'var(--secondary)'`，接口会自行构造CSS变量。

`unitSymbol(kind,color='accent',size=210)`复用同套详细形象，去掉牌框并加贴合主体的浅纸色底边，与复杂地形拉开反差。kind同样须明确选择。底边在手机宽度仍须连续可见，主体的轮廓和特征同时清楚。陆上单位以脚下为原点，舰船和飞机以形体中心为原点。兵牌与独立SVG按构图选择；必要时减弱脚下纹理，不靠放大阴影辨认。近景操作道具另按实际观看尺度完成真实结构、活动部分和接触关系。最终大小以约390px宽的整幅画面判断；看不清时增大符号、减少同时出现的单位或推近，不能只把预览图单独放大。

钢盔步兵只适合其时代；古代步卒、特定军服或装备不能硬套。一般力量可按当前题目自绘兵牌。陆上符号锚点在地面，舰船在船体中心，飞机在机身中心；侧视船可镜像但不整船旋转。符号不编码人数、海拔或真实面积。道路和铁路可用`infrastructure(points,{kind,width})`生成静态SVG；连接和桥位仍由当前来源决定。

## 来源与署名

`mapMarker`、`unitCounter`与`unitSymbol`的具体兵种素材共用本项目改绘，造型参考[AbsoluteUnits](https://github.com/letstalkaboutdune/AbsoluteUnits)，作者letstalkaboutdune，采用[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)，完整许可保留在assets/AbsoluteUnits-LICENSE.txt。使用这些素材时在画面来源短栏保留“兵棋改绘：letstalkaboutdune / AbsoluteUnits · CC BY 4.0”，导出单独元件也须携带署名与改绘说明。牌面为本项目自绘。

土垒、桥和设施为本项目自绘。

[Natural Earth陆地](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-land/)、[湖泊](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-lakes/)、[河流](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-rivers-lake-centerlines/)为[公有领域](https://www.naturalearthdata.com/about/terms-of-use/)，官方不要求署名。原land.json及2026-10-02转换的湖泊河流数据原样保留。10m表示1:1000万概化比例，并非10米精度；来源与精度保留在当前制作依据中，不要求画面显示“地理骨架：Natural Earth”。历史资料、DEM和其它素材分别按实际许可履行署名，不因底图为公有领域而省略。
