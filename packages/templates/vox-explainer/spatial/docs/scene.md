# 空间镜头、路线与指认

本页属于[spatial工具](../README.md)，所述源码与资源路径相对spatial目录，场景接口由模板统一提供。

## 连续镜头和行动

scene.animation已经提供`spatial`。以下SVG示意在`M002`至`M003`沿同一场面移近，保住来路和落点。镜头到位后让图件的行程在镜内看清。Cue与坐标按本章替换：

```js
const scene = spatial.createScene({
  world: select('#world'), center: [960, 460],
  camera: {initial: [800, 450, 1], moves: [
    {start: cue('M002'), duration: cue('M003') - cue('M002'), to: [1100, 450, 1.5]}
  ]},
  routes: [{id: 'crossing', points: [[860, 500], [990, 470], [1100, 450]],
    start: cue('M003'), duration: cue('M004') - cue('M003')}],
  units: [{node: select('#traveller'), point: [860, 500], routes: ['crossing']}]
});
onFrame(({time}) => scene.seek(time));
```

`world`包含共用镜头的底图与对象。对象的node是以实际接触点为原点的g；确需跟随的短名可作为该g内的`label`传入。独立标签`labels`放在world外的屏幕层，底衬与文字放进同一g。默认图件随镜头放大，标签维持屏幕尺寸；`screenSize:true`会连图件一起固定大小，需按实屏另设尺寸。需要同时显示轨迹时，给路线传入有填色的SVG path作为`node`。对象用`from / until`控制显隐，路线用`start / duration / until`控制时序，均为本段秒数。一个对象走多段时，后一路从前一路终点接起。

默认路线是无箭头的实际轨迹，移动图件直接消费同一采样点。`intent:true`只生成有尖头的实心方向线，不可给units引用；需要虚线计划时用下面的drawings。`spatial.route(points).sample(progress)`也可用于自定义线型和图片运动，返回同一point和已走trail。平滑曲线先采样同一个SVG path，再同时供轨迹与移动图件使用，不分别拟合。

## 划线、指向与圈定

`createScene`的`drawings`只绘制独立说明线。node为带stroke颜色的SVG path，head为同色fill的可选箭头path，两者都放在world中。作者决定含义、位置与短说明，工具不从线型推断军事结果：

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

`spatial.cameraTrack(initial,moves)`按当前时间返回[x,y,zoom]。`duration:0`直接切；正时长使用固定的平滑插值，只在合适时取用。需要跟随或另编速度时，按[二维取景](../../references/tools/motion.md#二维取景)用原timeline或onFrame从同一机位控制世界和屏幕标注，位置可用`screenPoint(point,camera,center)`求出。自编镜头直接控制相机层，别和`createScene.seek`同时写同一组变换。倒放和跳帧不依赖历史状态。
