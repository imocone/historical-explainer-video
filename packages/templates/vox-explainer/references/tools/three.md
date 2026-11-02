# 三维与SVG协作

Three.js由本模板运行器直接提供，不在scene里import、加载CDN或另起播放器。markup放Canvas及叠加的SVG／HTML，三维对象、相机、光照和材质在animation中建立。Canvas尺寸按本段实际设计区域设置，使用确定的像素比；使用`alpha: true`和透明清屏，让三维主体与底板、SVG共处一幅画面；局部承托物按内容需要绘制，不能变成全屏新底板。字幕空间仍取本单renderContext。

用原`timeline`驱动物体或相机的属性，在`onFrame`中计算其余完整状态、更新投影与标签，然后调用`renderer.render(scene3, camera)`。跳帧后仍能直接得到本帧状态，不调用`requestAnimationFrame`、`setAnimationLoop`或自行累计Clock时间。下面只说明绘制与投影的接口，假定已按本题建立scene3、camera、model、renderer及SVG标签：

```js
const label = select('#label');
const anchor = new THREE.Vector3();
onFrame(({time}) => {
  // model及camera的当前状态由原timeline或time的确定函数给出。
  camera.updateMatrixWorld();
  model.updateWorldMatrix(true, false);
  model.getWorldPosition(anchor).project(camera);
  // view为Canvas在同一SVG viewBox中的实际矩形。
  label.setAttribute('x', view.x + (anchor.x + 1) * view.width / 2);
  label.setAttribute('y', view.y + (1 - anchor.y) * view.height / 2);
  renderer.render(scene3, camera);
});
```

相机投影范围改变时调用`updateProjectionMatrix()`；模型局部锚点先转世界坐标再project。投影只解决对应位置，标签还须按实际画幅避让，并处理对象离开画幅、在相机后方或被遮挡时的显隐。SVG的viewBox、Canvas区域和外层变换保持对应。

三维输出使用`THREE.SRGBColorSpace`，颜色纹理标为sRGB，法线／粗糙度等数据纹理保持数据空间。灯光、材质与色调映射会改变最终颜色，按[共同画法](../art.md)校准三维与SVG的合成结果。先用中性白光和适量补光观察材料本色，再校准局部明暗；有色灯光只用于本题确需的氛围。颜色纹理与材质color相乘，纹理已含本色时材质color用白色，避免重复染暗。不要默认添加全物体米黄噪点或后期饱和度滤镜。可用同步绘制的CanvasTexture承载纹理；确需已交付图片时，markup仍用`<img src="asset:AR001">`引用，在异步`onFrame`中首次等待该元素`decode()`后建立Texture并标记`needsUpdate`，运行器会等待回调再交付该帧；不另开运行时下载。

WebGLRenderer使用`preserveDrawingBuffer: true`保留绘制结果供异步取帧，P3预演与P4继续通过同一seek驱动。创建资源后及时注册`onCleanup`：释放本段创建的geometry、material、texture、render target和renderer，共享对象去重释放；独占的WebGL上下文可在dispose后`forceContextLoss()`。从场景移除物体不会自动释放GPU资源。整段复看时同时确认首帧、跳帧、回看和重进后的对象与标注一致。
