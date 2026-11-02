# 地图窗口与岸上消耗

成品视频不随仓库分发。本例保留教学源码、图件和时序；需要动态预览时，沿本例已有构建入口在本机生成。配套旁白仅为同长度静音占位，构建程序优先读取本机保留的原声。已有完整原片保留在本机的local-media/private-assets/对应路径。

36秒无声教学小样，近代船型与拦截情节为虚构。真实丰后水道只用于展示地理空间；不代表某次历史战役、实际航线或兵力。用户通过的地图与普通SVG穿插小样沿现行组件落地：原讲解底板持续存在，地图保留浅纸自然边缘、两条轻折痕、右下卷角与微倾斜，不加夹子挂带。

本例用于学习地图窗口、共同投影与同源动画的连接。当前作品的主体、姿态与动作按本题重新设计，具象形象的完成度取[画法与参考实图](../../references/art.md)，需要作品对照时从[作品索引](../README.md)按相通问题取用；本例的现成兵棋与简略图件不作为成品造型基准。

观看组织：货物与仓库建立补给 → 地图展开交清水道两端 → 推近并显示拦截和运输停顿 → 地图移到右侧，左侧库存继续减少 → 返回地域连接 → 小地图与仓库共同收束。位置、缩放、普通图件和数量都从同一绝对时间求值，地图上的地名、路线和船使用同一投影。`animation.js`的T保存六次观看转折的Cue；地图让位、库存出现、箱子消耗和对应标题共同从T.stock安排，句内偏移用于错开动作。更换口播时先重新绑定转折，再按实际时窗调整内部动作与停驻；不能只改镜头Cue而把相关对象留在旧秒数上。内容与动作仅作教学，当前节目须按口播、来源和真实Cue重新设计。

从项目根运行：

```sh
node packages/templates/vox-explainer/examples/map-window/build.mjs build
node packages/templates/vox-explainer/examples/map-window/build.mjs stills
node packages/templates/vox-explainer/examples/map-window/build.mjs render
```

第二个参数可指定临时输出目录。首次制作从Mapzen Terrain Tiles下载此例范围的DEM到输出目录dem-cache；后续复用同缓存。原scene内嵌实际裁取数据，不读取这个缓存。小样沿现行treatment合同、模板校验器、renderData、P4资源准备、scenePreviewProps和compileComposition执行；渲染工程离线读取本地worker、字体与已内嵌地理，不请求地图服务。它不是正式剧集，也不写P3接纳或P4发布回执。

[scene.html](scene.html)保存普通图件与版式，[animation.js](animation.js)通过现行`spatial.createMapWindow`组合地图与动作；[build.mjs](build.mjs)准备有据数据、序列化同一scene并输出可重建的treatment和教学时点。内部数据与地图接口见[空间工具](../../spatial/docs/map-window.md#数据地图窗口)。原图片入口、旁图方法与当前生产授权均保持。

地理：Natural Earth，公有领域，1:1000万概化数据。地形：Mapzen Terrain Tiles / USGS SRTM、GMTED2010；[数据与署名](https://registry.opendata.aws/terrain-tiles/)。兵棋为项目改绘，参考letstalkaboutdune / AbsoluteUnits，CC BY 4.0，许可沿spatial/assets保留。放大不增加原数据精度，不能据此判断港池、古岸线或可航水深。
