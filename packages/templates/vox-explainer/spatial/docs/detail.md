# 局部窗口与标签布局

本页属于[spatial工具](../README.md)，所述源码与资源路径相对spatial目录，场景接口由模板统一提供。

## 地图旁图与注意力

局部窗口的统一外观、来源对应与地图让位见[旁图策略](../../references/creative/windows.md#旁图策略)。本节只说明开口、内景和引线的坐标与裁切；全屏细节作为场景转换承接。

用SVG的`clipPath`或`mask`限定内景可见范围。外层安排窗口位置，裁切层控制开口，内部场景另组设计镜头与动作。可在同一scene内放置以下结构；省略的尺寸、内景和轮廓由本段填写：

```html
<defs><clipPath id="detail-clip" clipPathUnits="userSpaceOnUse">
  <rect id="detail-aperture" x="0" y="0" width="0" height="0"/>
</clipPath></defs>
<g id="detail-window">
  <g clip-path="url(#detail-clip)"><g id="detail-scene"><!-- 完整内景 --></g></g>
</g>
```

下面是一种从实际地点向停驻位置展开窗口的实现：`W/H`是本段确定的窗口尺寸，`C`是停驻中心，`eventPoint`是地图来源点，`start/span`取本段Cue与作者安排的展开时窗。每帧求同一个镜头与开口状态；内景按最终观看尺度布置，裁切范围逐渐显露其中内容。作者也可按当前讲法直接显露、平移或设计其它转换。

```js
onFrame(({time}) => {
  const {camera} = scene.seek(time);
  const u = Math.max(0, Math.min(1, (time - start) / span));
  const p = u * u * (3 - 2 * u);
  const A = spatial.screenPoint(eventPoint, camera, center);
  const P = A.map((v, i) => v + (C[i] - v) * p);
  select('#detail-window').setAttribute('transform', `translate(${P[0]-W/2} ${P[1]-H/2})`);
  const aperture = select('#detail-aperture');
  for (const [key, value] of Object.entries({
    x: W*(1-p)/2, y: H*(1-p)/2, width: W*p, height: H*p
  })) aperture.setAttribute(key, value);
});
```

窗口用上述rect形成规则开口，边框与浅衬读取同一开口几何；需要遮罩时可用mask。内部船、人、器物保持各自比例和动作，开口展开、窗口移动与内景推近分别编排。示例只展示坐标与裁切关系，具体轨迹、缓急和进退由本题决定；收窗时关闭可见范围，内部过程保留实际先后与最终状态。

选用连线时，`leaderPath(point,box,{gap:8})`从屏幕中的字组或矩形窗口外缘连向所指点，返回SVG路径；box为当前实际`{x,y,width,height}`。地图端取`screenPoint`，窗口端取当前开口边缘。目标在框内或太近时返回空线，保留内容；非矩形图件的指引线可按其实际轮廓选边缘点，用原生SVG绘线。线始终位于窗口内容下方。选用标签引线可向`createScene.labels`显式传入`leader`路径节点，与标签同放在world外的屏幕层；工具随镜头更新端点与显隐，未传则不绘线。

需要[来源框与双连线](../../references/creative/windows.md#旁图策略)时，将来源范围与当前开口的相对边角配对，保持各自当前坐标与固定配对关系。上例方窗在屏幕中的左上角为`[P[0]-W*p/2,P[1]-H*p/2]`，右下角为`[P[0]+W*p/2,P[1]+H*p/2]`。来源端沿地图当前变换，开口端沿窗口当前变换，线宽与必要底边共同更新；作者据构图选择能避开文字、主体和通道的端点。

文字用加载后的真实`getBBox()`取得字组范围，并计入标签的屏幕平移；底衬存在时用底衬外框。固定角度、字体和停驻状态不变时可缓存测量，内容变化再测。SVG本地框先换到屏幕坐标，再与地图引线共同计算，并查看实际画面中的遮挡。

手绘圈线沿[标注接口](../../references/tools/graphics.md#手绘圈注与划线)生成，需要`createDrawing`时采样同一路径。与主体同组定位，或在原`onFrame`中用同一采样点更新位置；指认与行动的含义由[空间方法](../../references/spatial.md#镜头层次与文字一起设计)决定。

## 布局

用`asset.width / height`与`explainerPlacement.contentBounds`求有效地块的宽高和偏移，区分透明画布与真正地形。可用区为`W×H`、有效地块为`w×h`时，`min(W/w,H/h)`是完整放入该区域的试摆倍率，按有效轮廓对齐，不按PNG外框居中。最终倍率与取景沿[地图对象构图](../../references/spatial.md#地图对象构图)决定；镜头对地形、路线、对象与来源点使用同一变换。

字体加载后，可用`scene.layout({time,bounds,obstacles,gap})`取得各地名字组的候选偏移；bounds用本单安全区，obstacles是屏幕坐标的{x,y,width,height}，填写当前兵牌、关键通道、标题等必须避让的范围。也可直接调用`layoutLabels`，提供每项id、point、实测width/height及按偏好排序的offsets。

结果含offset、box、collisions、outside。程序不隐藏标签或缩字；仍冲突时由作者调整取景、偏移或出现时序。选定偏移写回设计，在同一停驻状态保持稳定，不每帧自动避让。测量不能判断地形图里的重要道路，作者必须把需保留的作用处计入obstacles，并看实际画面。
