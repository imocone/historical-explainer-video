# 运动实现示例

按[运动编排](../creative/motion.md)确定观看与时间安排后，按需取用下面的实现。示例共用原scene、Cue、timeline与onFrame，画布和动画接口见[制作与交付](../delivery.md#画布与动画)。

## 二维取景

普通二维先分清世界、观看窗口和屏幕参照。世界中的对象保留原坐标，外层窗口裁掉当前不看的部分，内层相机移动世界；公共字幕仍由原字幕层处理。当前确需稳定可读的尺度或身份可独立放在屏幕层；提问、关键词和结果字组则与主体一起设计大小、位置和进退，也可成为画面中的对象。窗口与文字空间按这一镜安排，不从开头固定一条标题栏再把所有动作塞到下面。下面的结构只说明裁切与相机的嵌套，具体窗口按本题画幅、safeArea和当前构图安排：

```html
<defs><clipPath id="shot-window"><rect x="120" y="240" width="1680" height="720"/></clipPath></defs>
<g clip-path="url(#shot-window)"><g id="camera"><!-- 本题场景对象 --></g></g>
<g id="reading"><!-- 当前确需独立于镜头的屏幕参照 --></g>
```

再按要看的作用范围求取景，而不是先猜一个放大倍数。范围包含本次必须同时看清的对象、接触处与必要行程；先摆出它在正常尺寸和手机整幅中的实际画面，再连接镜头。以下沿原timeline与onFrame落实，替代该组其它变换，避免两个实现抢写同一元素：

```js
const view = {x:120, y:240, width:1680, height:720};
const frame = b => ({x:b.x+b.width/2, y:b.y+b.height/2,
  s:Math.min(view.width/b.width, view.height/b.height)});
const camera = frame({x:100,y:230,width:1720,height:740});
timeline.to(camera,
  {...frame({x:505,y:405,width:360,height:250}), duration:.5, ease:'power2.inOut'}, cue('M001')+.9);
onFrame(() => select('#camera').setAttribute('transform',
  `translate(${view.x+view.width/2} ${view.y+view.height/2}) scale(${camera.s}) translate(${-camera.x} ${-camera.y})`));
```

上面的数值只说明范围适配。实际取景可看[七国之乱的官署过程](../../examples/seven-kingdoms/README.md#观看设计)：由外观叠化进入内部，再依三处职能安排开门、取景和回到全景。相机与人物、门扇各自排时，共同服务当前观看。实际题目重选范围与时间；范围仍包住整张图时不会形成近景，不直接套用本例坐标和镜头顺序。

按对象范围求取景可参照[Manim的auto_zoom实际实现](https://github.com/ManimCommunity/manim/blob/16ea443e2a5f1d79db0a721161411ce916d6e733/manim/camera/moving_camera.py)；[Motion Canvas相机示例](https://github.com/motion-canvas/motion-canvas/blob/7b91435c301d530351dcf5ebb91dd139c002e405/packages/docs/docs/getting-started/camera.mdx)同样把对象状态与观看窗口分开。此处二维适配不提供三维透视；Three.js与数据地图使用自身相机。取景、比较尺度和标签归属沿[主体动作与取景](../creative/motion.md#主体动作与取景一起排)判断，屏幕字号按观看距离调整。

## 作用与回应的错时

进场可用`power3.out`先快后缓取得位置，退出可用`power3.in`加速让位，镜头或大组重排可用`power2.inOut`协调启停；按已定动作选择曲线。

以“物件落入可动托盘”为例，先在markup中对齐物件终点与托盘，把物件和托盘放在同一`#landing`组内，再将该组放入取景组：

```js
const hit = cue('M002'); // 本例贴Cue边界；句内落点取本单实测偏移
timeline.to(select('#view'),
  {x:-180, scale:1.25, duration:.6, ease:'power2.inOut'}, hit-.9);
timeline.to(select('#piece'),
  {x:300, duration:.32, ease:'power3.in'}, hit-.32);
timeline.to(select('#landing'), {y:8, duration:.08, ease:'power2.out'}, hit);
timeline.to(select('#landing'), {y:0, duration:.16, ease:'power2.out'}, hit+.08);
timeline.fromTo(select('#result'), {opacity:0},
  {opacity:1, duration:.18}, hit+.14);
```

这里的数值只解释一次编排：取景先完成，物件较快抵达，承托组随后带着已接触的物件一同回应，读数再接过注意。换对象就按真实结构改姿态、路径和反馈，静止地面不跟着跳；归属与读数按真正完成条件改变，不因视觉收势反复增减。用onFrame时同样为这些角色分别求进度和保持态，再由同一时间重建完整画面。

## 动画实现参考

声音与运动的交接还可参考[Manim Voiceover的发声标记实例](https://github.com/ManimCommunity/manim-voiceover/blob/main/examples/bookmark-example.py)：不仅定位某个词，还用到下一标记的时窗安排当前动作。它在缺少细边界时使用的线性插值不作为本模板实测依据。[Motion Canvas时间事件](https://github.com/motion-canvas/motion-canvas/blob/main/packages/docs/docs/getting-started/time-events.mdx)把关键事件与动作时长共同调试；在此仍使用原Cue、实测偏移和同一timeline。[Remotion字幕示例](https://github.com/remotion-dev/template-tiktok/blob/main/src/CaptionedVideo/Page.tsx)按词的真实时间窗口求当前强调状态，可借到本题确需的重点字组，不套其整套花字或英文空格分页；文字的语义选择、力度与阅读交接仍由作者决定。

[官方示例](https://github.com/motion-canvas/examples)展示了组织动画的实现方式。当前作品确定了要表达的关系与画面后，可按需取用这些思路，把已设计的对象对应与变化落实到动画结构：

| 制作思路 | 示例中的做法 | 在本模板怎样实现 |
|---|---|---|
| 同一对象转换表示 | [光照合成](https://github.com/motion-canvas/examples/blob/master/examples/deferred-lighting/src/scenes/lightBasics.tsx)将颜色层、光照层展开成运算关系，再合成同一图像 | 保留对象的形象与对应，将它拆开、重组、放大或转成图解，使变化本身解释关系 |
| 共用状态保持呈现联动 | [视差组件](https://github.com/motion-canvas/examples/blob/master/examples/smooth-parallax/src/components/Parallax.tsx)由同一相机位置和层级比例控制多层图片；[演示场景](https://github.com/motion-canvas/examples/blob/master/examples/smooth-parallax/src/scenes/layers.tsx)把层的位置与比例关系展开 | 从本题数据或已定演绎状态求出主体、局部与读数，使同一结果的不同表现保持一致，再由原onFrame按当前时间呈现 |
| 按对象关系分组 | [层级](https://motioncanvas.io/docs/hierarchy/)让子物件继承整体运动，同时保留自身变化 | 外层组织整体位置与镜头，内层组织活动件；转换视图时保持锚点、身份与前后姿态连续 |
| 按理解过程组织动作 | [时序](https://motioncanvas.io/docs/flow/)提供并行、顺序、延迟和错时，[时间事件](https://motioncanvas.io/docs/time-events/)将关键动作联系到声音 | 沿真实Cue安排动作的重叠、先后、停顿与缓急，让作用、反馈和阅读各有合适时机 |

这些思路沿现有GSAP、timeline和onFrame落实；当前时间直接确定完整状态，跳帧和倒放保持一致。Motion Canvas的生成器流程在此转换为原Cue上的时间关系，对象与状态写入原scene，预演与P4继续消费同一交付。具体造型、布局、速度和制作顺序由本题决定。
