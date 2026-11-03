# 预演

```bash
node packages/templates/vox-explainer/preview.mjs --work-order <工作单> --candidate <候选>
```

命令返回Studio地址，不自动打开系统浏览器；按[Studio预览](../../../../../README.md#studio预览)复用、恢复并保留当前标签，修改后不另建标签。预演包含当前完整段落及原配音、节目字幕，与P4共用渲染器；只写临时预演工程，不写正式节目结果。`--export`导出本段MP4；`--validate-only`仅核对接口，不证明画面完成。播放器操作和导出成功都不能替作者判断作品。

工具只返回图片时，沿既有入口批量取实际画面，输出中同时提供单帧和总览图。按整段观看变化及其间的停驻选取时刻；关键动作与文字交接补看前后和中间过程。例如下列命令仅演示取图写法，时刻按当前作品选择：

```bash
node packages/templates/vox-explainer/preview.mjs --work-order <工作单> --candidate <候选> --stills --at 3.1 --at 3.2 --at 3.4 --at 3.6 --at 3.8 --at 3.9
```

`--at`是本段相对秒数，按当前fps取整到帧，末帧为`(durationInFrames - 1) / fps`；默认取点不能保证覆盖实际动作。打开返回的`output`里的图像，按时刻顺序查看，必要时放大单帧；手机检查将完整画面等比显示为约390px宽。已有同版MP4可直接取帧，不必重复渲染；修改候选后更新受影响画面，不能沿用旧图证明修正完成。图片只是本单临时审看材料，不另交报告或加入正式资产。

时间对照以生成工程为准：预演的字幕、音轨窗口与动画绑定共用同一起始帧；不要把全片绝对秒数直接当作本段`--at`。专业判断按[复看与修正](../creative/review.md#复看与修正)执行，文件身份、时长和工具成功本身不证明解释与画面完成。

首次完成时完整复看；局部返修复核受影响部分及前后衔接，范围随实际影响确定。只有需要核对编码、混音或实际文件交付时才导出MP4；已有同版文件直接使用。具体判断沿[复看方法](../creative/review.md#复看与修正)，不以导出代替观看。

暂缺图片时`--draft`显示明确占位，只用于同一候选中推敲构图和动作，不能当实图交付。完成素材后使用正常预演。与相邻正文的最终衔接仍由正式Studio消费已接纳结果；本段试看不冒充整集观看。

关键试制也使用本入口，需先形成当前实现所需的合法scene、moments、Cue与实际素材，再按设计稿中的本段时刻取相应画面。`--draft`只控制缺图占位，正常预演也可能显示未完成作品；进度、工程交接及后续制作按[作者入口](../../AUTHOR.md#二把关键设计做成实际画面与动作)执行，命令成功不表示整章完成。

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
