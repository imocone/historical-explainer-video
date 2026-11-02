# 空间镜头、路线与指认

本页属于[spatial工具](../README.md)，所述源码与资源路径相对spatial目录，场景接口由模板统一提供。

## 连续镜头和行动

scene.animation已经提供`spatial`。所有时间用本段秒数，由真实`cue(id)`取得。示例仅说明接口，不提供战术、地形或布局事实：

```js
const scene = spatial.createScene({
  world: select('#world'), center: [960, 460],
  camera: {initial: [800, 450, 1], moves: [
    {start: cue('M002'), duration: 1.5, to: [1100, 450, 1.5]}
  ]},
  routes: [{id: 'advance', points: [[700, 500], [900, 430], [1100, 450]],
    start: cue('M003'), duration: 3, node: select('#trail'), width: 12}],
  units: [{node: select('#force'), point: [700, 500], routes: ['advance'],
    screenSize: true, label: select('#force-name'), labelOffset: [0, -65]}],
  labels: [{id: 'place', node: select('#place-name'), point: [1100, 450],
    offset: [100, -65]}]
});
onFrame(({time}) => scene.seek(time));
```

`world`包含共同地形、路线、部队及其队名；独立地点标签`labels`放在同一SVG的屏幕层，位于world之外。有底衬时将底衬与文字放进同一标签g，测量便包含它。路线node是填充色SVG path；单位node是以地面接触点为原点的g，其`label`在单位g内。`screenSize:true`稳定兵牌与队名的屏幕大小；否则只稳定队名。from/until决定对象显隐，路线start/duration/until决定生长与保留时间，均为本段秒数。单位的routes按行动顺序列出，后一路从前一路实际终点开始，不列意图线。

默认路线是无箭头的实际轨迹，兵牌直接消费同一采样点。`intent:true`只生成有尖头的实心方向线，不可给units引用；需要虚线计划时用下面的drawings。`spatial.route(points).sample(progress)`也可用于自定义线型和图片运动，返回同一point和已走trail。平滑曲线先采样同一个SVG path，再同时供轨迹与兵牌使用，不分别拟合。

## 划线、指向与圈定

`createScene`的`drawings`绘制独立说明线，不移动兵牌。node为带stroke颜色的SVG path，head为同色fill的可选箭头path，两者都放在world中。作者决定含义、位置与短说明，工具不从线型推断军事结果：

```js
drawings: [
  {node: select('#plan-line'), head: select('#plan-head'),
    points: [[700, 500], [880, 420], [1100, 450]],
    start: cue('M002'), duration: 1.2, until: cue('M003'), width: 12, dash: [18, 12]},
  {node: select('#focus-ring'), closed: true,
    points: [[960, 380], [1110, 365], [1180, 470], [1030, 510]],
    start: cue('M003'), duration: .8, width: 10}
]
```

无dash为实线；无head为普通划线；closed沿给定点闭合，可用采样椭圆点画圈。圈线绘完才闭合，过程中不跨内部补斜线。默认screenSize稳定屏幕线宽、虚线间距与箭头大小；需要随地形缩放时设false。观察线、炮击弧线与区域边界可用相同工具，但曲线须先采样；控制面用[区域层](map-window.md#区域涂色)表达，不能把圈线出现当成占领。采用原生SVG的圆、曲线、遮罩或手绘笔触也可，仍走原timeline／onFrame。

默认说明线宽10、路线宽12，只作为试摆起点。作者按实际画幅、背景和手机观看尺寸校准，线身、箭尖及落点必须一起看清；繁密地形上的底边或浅底由同一SVG承载。自由圈注与指认笔迹可用[标注组件](../../references/tools/graphics.md#手绘圈注与划线)的实色笔身与纸色底边，准确边界和地理路线仍保留真实几何。

不使用createScene时，可单独创建`const drawing = spatial.createDrawing({...})`，在原`onFrame`中调用`drawing.seek(time, 当前镜头倍率)`；屏幕层的线用倍率1。它与场景使用同一秒数，不开启额外播放时钟。

`spatial.cameraTrack(initial,moves)`按当前时间直接返回[x,y,zoom]；重叠镜头从当时实际位置衔接。倒放和跳帧不依赖历史状态。`screenPoint(point,camera,center)`供局部图引线、其它屏幕标注定位。额外状态和动画继续用原timeline或onFrame，不开第二时钟。
