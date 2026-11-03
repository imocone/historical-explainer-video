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

完整字幕、词边界和场景时间保存在[timing.json](timing.json)。

## 源码

| 文件 | 内容 |
|---|---|
| [scenes.mjs](src/scenes.mjs) | 整片构图、字组、图层与场景 |
| [animate.js](src/animate.js) | 主体动作、取景、文字时序与交接 |
| [art.mjs](src/art.mjs) | 建筑、器物、工坊、聚落与环境 |
| [people.mjs](src/people.mjs)、[animate-people.js](src/animate-people.js) | 人物形体、姿态与动作 |
| [map.mjs](src/map.mjs)、[map-data.json](assets/map-data.json) | 地图几何、地形与绘制 |
| [drawing.mjs](src/drawing.mjs) | SVG绘制函数 |

## 预览与复现

从仓库根目录运行，构建只写指定输出目录：

```bash
node packages/templates/vox-explainer/examples/seven-kingdoms/build.mjs /tmp/vox-seven-kingdoms
npx hyperframes preview /tmp/vox-seven-kingdoms --background
```

使用命令返回的完整作品预览地址播放。本仓库保留源码与预览入口，不附MP4。

本机沿原`assetFile`入口使用已有音轨；公开`assets/mix.wav`为同长度静音占位，画面和字幕可独立播放。字体、GSAP和地图样式引用各自已有所有者，来源及许可见[CREDITS.md](CREDITS.md)。
