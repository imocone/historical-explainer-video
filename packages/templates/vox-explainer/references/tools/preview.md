# 预演

```bash
node packages/templates/vox-explainer/preview.mjs --work-order <工作单> --candidate <候选>
```

命令返回Studio地址，不自动打开系统浏览器；按[Studio预览](../../../../../README.md#studio预览)复用、恢复并保留当前标签，修改后不另建标签。预演包含当前完整段落及原配音、节目字幕，与P4共用渲染器；只写临时预演工程，不写正式节目结果。`--export`导出本段MP4；`--validate-only`仅核对接口，不证明画面完成。播放器操作和导出成功都不能替作者判断作品。

需要取帧时，只选当前要判断的画面。输出包含单帧和总览图，`--at`指定本段内的秒数：

```bash
node packages/templates/vox-explainer/preview.mjs --work-order <工作单> --candidate <候选> --stills --at 3.1 --at 3.2 --at 3.4 --at 3.6 --at 3.8 --at 3.9
```

`--at`是本段相对秒数，按当前fps取整到帧。正文末帧为`(durationInFrames - 1) / fps`。整集末章的预演还包含片尾淡出和黑场，可取帧至全黑前。默认取点跟随已绑定的观看变化。用取帧查口播与画面之间的空档时，按正式Cue顺序选时刻，在疑似掉拍的句段取前后和句内帧。打开返回的`output`里的图像，按时刻顺序查看，必要时放大单帧。手机检查将完整画面等比显示为约390px宽。已有同版MP4可直接取帧。修改候选后用新版画面核对受影响处。图片只供本单临时审看。

打开可持续播放的预演时沿用上面的默认目录，它在工作单临时目录之外。取帧和导出可以用 `--output-dir` 指到工作单内，两者都会重建字幕子场景，用同一目录时依次运行。用工作单内的导出工程开播放器会让后台服务在接纳清理时继续写入该目录，影响接纳收尾。

预演按正式交接核对音频文件，并让字幕、音轨窗口和动画绑定共用同一起始帧。若报告本单字幕与当前原声交接不一致，按现行工作单重新取得字幕和音频交接，再校准受影响的动作。画面复看沿[复看与修正](../creative/review.md#复看与修正)。

Studio不便播放时可用同版MP4，需取可播放文件或核对编码时可用`--export`。同版过程帧和时序用于定位构图、遮挡或动作位置；力度、接镜和实际认读沿[复看方法](../creative/review.md#复看与修正)用原速播放确认。单章预演覆盖本章及适用的整集片尾。哪侧相邻镜头已接纳，就在本章接纳后沿[正式Studio相邻Beat预览](../../../../../README.md#studio预览)联看哪侧接缝，讲解章选其对应的B编号。

[全章粗排](../creative/design.md#全章粗排)与关键试制都使用本入口，以原候选的scene、moments和Cue预演画面和字幕。暂缺图片时加 `--draft`，预演用占位图并标出草稿，保留候选结构及时间校验，略过正式图片交付校验。实图交付复核使用正常入口。正式Studio使用已接纳结果呈现与相邻正文的衔接。

## 临时收起字幕与答案文字

按[复看方法](../creative/review.md#复看与修正)选择暂时收起的文字，保留必要身份、数值、条件及文字自身承担的解释材料。只编辑返回的临时预演工程，候选、Cue与原声不变：

- 口播字幕：在`projectDirectory/index.html`的样式中临时加入`#captions{display:none!important}`。
- scene中的HTML／SVG总结句：外层样式不能穿过Shadow DOM。在同一`index.html`的`composition-data`之后、`scene.js`标签之前临时插入下例；将`#answer-text`替换为当前实际总结文字的选择器。程序读`timeline.scenes`中的场景副本，故与`props.segments`一起修改；样式保留节点和布局测量，只收起可见文字。

```html
<script>
{
  const source = document.getElementById('composition-data');
  const data = JSON.parse(source.textContent);
  for (const segment of [
    ...data.props.segments,
    ...data.timeline.scenes.map(item => item.segment)
  ]) {
    const scene = segment.renderData?.voxExplainer?.scene;
    if (scene) scene.markup += '<style>#answer-text{opacity:0!important}</style>';
  }
  source.textContent = JSON.stringify(data);
}
</script>
```

该例用于当前单段预演的场景根；地图内部的文字须在地图自己的Shadow DOM根内加相应临时样式。Canvas绘字或三维文字没有对应DOM节点时，在临时工程的同一场景副本中仅省去该文字的绘制或显示，保留对象状态、计算和动作。

重载同一预演标签后，先确认所选文字已收起、必要依据仍在，再取图。批量取图用原[截图函数](../../../../modules/render-video/runtime/hyperframes.mjs)`snapshotComposition({projectDirectory, frames, outputDirectory})`，frames为该段帧号；它读取当前工程，不重新编译。不要用会重建工程的preview命令取得隐藏文字后的图，也不把这种临时审看版用于成片导出。审看后重跑原预演命令恢复正常画面。
