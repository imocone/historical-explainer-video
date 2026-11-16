# 三维制作

选用三维的判断见[关键画面与衔接](../creative/design.md#关键画面与衔接)。Three.js由本模板运行器直接提供。markup放Canvas及必要的文字层，三维主体、环境、相机、光照和材质在animation中建立。Canvas按实际区域设置尺寸和确定的像素比；需要透出背景时使用`alpha: true`和透明清屏。画布与外观见[交付接口](../delivery.md#画布与动画)。

先按最需要看清的机位做完整场面：主体和作用处有尺度、承托与遮挡，光向帮助分出接触与结构，材料随观看距离细化。机制演示可以让相机先到作用处、在接触时稳住，再沿同一模型揭示结果。节奏沿[运动编排](../creative/motion.md#主体动作与取景一起排)，交互作品的自动巡游不能直接当讲解镜头。

## 让标注跟住部件

三维负责形体、接触与遮挡，SVG负责易读的字组和引线。把引线起点放在真正要看的部位，例如榫头的止挡面。起点随部件和相机移动，文字放在留白处，只在画面重排时才换位置。

Google的实际演示用三维热点驱动SVG尺寸线，并按所示表面是否朝向相机决定显隐。Drei把投影、镜头背面和实际遮挡分开算。Remotion的三维视频用当前视频帧驱动场景。本模板用同一原声时钟更新模型、相机和引线。[Google 尺寸线源码](https://github.com/google/model-viewer/blob/master/packages/modelviewer.dev/examples/annotations/index.html#L391-L419) · [Drei 标注源码](https://github.com/pmndrs/drei/blob/master/src/web/Html.tsx#L25-L56) · [Remotion 逐帧渲染源码](https://github.com/remotion-dev/remotion/blob/main/packages/three/src/ThreeCanvas.tsx)

用原`timeline`驱动物体或相机，在`onFrame`里用这一帧的模型位姿和相机更新投影、标注与三维画面。下面假定已建好`scene3`、`camera`、`model`、`renderer`与SVG标注组；所指的面在`M002`到`M003`之间可见，且只在这次观察中用到标注。

```js
const note = select('#joint-note');
const leader = select('#joint-leader');
const localAnchor = new THREE.Vector3(0.18, 0.04, 0.1); // 在实际模型上量取止挡面的位置
const worldAnchor = new THREE.Vector3();
onFrame(({time}) => {
  const point = spatial.projectAnchor(model.localToWorld(worldAnchor.copy(localAnchor)), camera);
  const show = point && time >= cue('M002') && time < cue('M003');
  note.setAttribute('visibility', show ? 'visible' : 'hidden');
  if (show) {
    leader.setAttribute('x1', point.x);
    leader.setAttribute('y1', point.y);
  }
  renderer.render(scene3, camera);
});
```

`spatial.projectAnchor`默认对应全幅SVG坐标。局部Canvas传入它在SVG `viewBox`中的`{x, y, width, height}`。相机焦距、缩放等投影参数改变后先调用`updateProjectionMatrix()`。点在镜头后方或出画时会得到`null`。部件被前面的物体挡住仍可能在画幅内，此时按演示阶段收起标注。若遮挡要随连续转动判断，再用射线查当前遮挡物。解释内部时可以先做剖开、拆出或淡化遮挡件，再让引线出现。每帧按当前状态计算，跳帧后能直接重现，无需独立播放循环。

试制时看接触前、接触时、换角后这三处。确认引线指向同一个部件，字组有足够阅读时间，章内跳回原处能恢复同一画面。

## 材质与取帧

三维输出使用`THREE.SRGBColorSpace`，颜色纹理标为sRGB，法线／粗糙度等数据纹理保持数据空间。灯光、材质与色调映射会改变最终颜色，按[共同画法](../art.md)校准三维与SVG的合成结果。先用中性白光和适量补光观察材料本色，再校准局部明暗；有色灯光只用于本题确需的氛围。颜色纹理与材质color相乘，纹理已含本色时材质color用白色，避免重复染暗。不要默认添加全物体米黄噪点或后期饱和度滤镜。可用同步绘制的CanvasTexture承载纹理；确需已交付图片时，markup仍用`<img src="asset:AR001">`引用，在异步`onFrame`中首次等待该元素`decode()`后建立Texture并标记`needsUpdate`，运行器会等待回调再交付该帧；不另开运行时下载。

WebGLRenderer使用`preserveDrawingBuffer: true`保留绘制结果供异步取帧，P3预演与P4继续通过同一seek驱动。创建资源后及时注册`onCleanup`：释放本段创建的geometry、material、texture、render target和renderer，共享对象去重释放；独占的WebGL上下文可在dispose后`forceContextLoss()`。从场景移除物体不会自动释放GPU资源。整段复看时同时确认首帧、跳帧、回看和重进后的对象与标注一致。
