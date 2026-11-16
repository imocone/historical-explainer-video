# 七国之乱：汉景帝到底在削什么？

约3分11秒（190.898秒），1920×1080，全SVG讲解。与[运粮](../supply-mg/README.md)并列为本模板仅有的两部长案例。保留完整作品的构图、造型、镜头、动作与节奏，源码供按需查阅。

画面由原生SVG路径、色面、文字和矢量地图组成，没有生图、位图拼贴或Canvas画面。地图数据及历史示意的范围见[来源说明](CREDITS.md)。本例的题材、场景布局、分段和时间不成为其它作品的预设；共同画法与正式交付仍由本模板现行方法拥有。

## 观看设计

| 时间（约） | 片段 | 源码中的场景 |
|---|---|---|
| 0—32.5秒 | 从“削什么”进入封地，比较郡与诸侯国 | `question / system` |
| 32.5—50.4秒 | 从官署外观进入内部，展示三处职能 | `offices` |
| 50.4—70.1秒 | 铸钱、煮盐、财力与招聚，回到完整封地 | `wealth` |
| 70.1—108.2秒 | 逐个展开削地，再观察土地、居民与治理归属 | `edict / meaning` |
| 108.2—149.7秒 | 起兵者、三路行动与梁国阻挡 | `rebellion / fronts` |
| 149.7—171.2秒 | 两个年份与置官关系变化 | `reform` |
| 171.2秒—结束 | 回到同一封地，收拢场景与问题 | `answer` |

[timing.json](timing.json)记录字幕和场景起止，词边界在各场景的 `words` 中。用场景名在 `scenes.mjs` 找构图和图件，在 `animate.js` 查各阶段怎样展开。

## 源码

| 文件 | 内容 |
|---|---|
| [scenes.mjs](src/scenes.mjs) | 整片构图、字组、图层与场景 |
| [animate.js](src/animate.js) | 主体动作、取景、文字时序与交接 |
| [art.mjs](src/art.mjs) | 本片工坊、聚落、环境和共用图件的场景组合 |
| [animate-people.js](src/animate-people.js) | 本片人物姿态与动作 |
| [map.mjs](src/map.mjs)、[map-data.json](assets/map-data.json) | 地图几何、地形与绘制 |

人物、建筑与器物使用模板的[SVG底稿](../../references/art.md#svg底稿与改绘)。

## 工程复现

维护案例工程时，可从仓库根目录运行构建，结果写入指定目录。

```bash
node packages/templates/vox-explainer/examples/seven-kingdoms/build.mjs /tmp/vox-seven-kingdoms
```

工程所用音轨、字体、地图数据及许可见[CREDITS.md](CREDITS.md)。
