# 少一半力，多一倍路

成品视频不随仓库分发。本例保留教学源码、图件和时序；需要动态预览时，沿本例已有构建入口在本机生成。配套旁白仅为同长度静音占位，构建程序优先读取本机保留的原声。已有完整原片保留在本机的local-media/private-assets/对应路径。

观看样片（仅本机保留） · 43.55秒 · 1920×1080 · 60fps

这份独立样片于2026-10-24得到大刘对图件与代码结合效果的认可。它供作者辨认“怎样把不同材料组织成同一个场景”这一容易混淆的判断；创作方法由[vox.md](../../references/vox.md)拥有，具体双栏、倒回与素材数量不作为通用要求。

## 构想怎样影响制作

整段围绕同一个负载在两种连接关系中的变化展开：先保持拉绳距离相同，再查看承重绳段，回到起点后改为保持上升高度相同。对象继续存在，比较条件改变，已经认识的机构因此能支持后面的发现。观看顺序与本题相配，不必每句换一幅画；[原构思](brief.md)保留了当时的取舍。

木桶在本题只需整体位移，不需要内部操作，因此用一张完整透明图保留木头、金属和水面的质感。绳路、轮子、支架和吊接必须随关系变化，由代码精细绘制。两种材料共用画风参考、照明方向与接触坐标；生成图片参与机构的真实吊接，代码形体也承担结构和材质表现。若题目改为桶内漏水或提手弯曲，就要重新判断控制粒度，不能沿用这次整桶移动的选择。

运动由位移求出绳路、轮子与读数，保持连接及比例；起止、停顿、名称和受力表示按当时的观看重点安排。精细度同时落在桶的纹理、代码机构的轮廓与体积、绳子的接合和手机尺寸下的文字分量。没有固定的图片／代码分工、使用比例或运动顺序。

## 到哪里看实现

- [art.mjs](art.mjs)：精细SVG机构与透明木桶，外层坐标、吊接、遮挡和文字位置。
- [animation.js](animation.js)：同源位移推导路径、转轮、长度与标签，Cue组织观看重点，按当前时间直接求完整状态。
- [build.mjs](build.mjs)、[film.jsx](film.jsx)：原treatment Schema、Validator、Cue、renderData、Renderer和公共字幕的独立样片调用。
- [原图](assets/bucket.png)：生成器物及参考用途；这是示意素材，不是史料。
- [声音脚本](audio.py)、[时序](timing.json)、[旁白](assets/narration.wav)：本地Tingting配音，独立样片输入。

在本目录运行`node build.mjs build`或`node build.mjs preview`；默认输出到仓库`tmp/vox-pulley-demo`。`node build.mjs render`导出到该目录；指定目录时用`node build.mjs render /绝对路径/临时目录`。重做声音使用`/Users/imoconeice/.local/bin/python audio.py`。

## 已有证据与边界

样片采用理想不可伸长绳、匀速提起、忽略摩擦及绳轮自重；“格”是共同长度示意。概念依据：[OpenStax Physics 9.3](https://openstax.org/books/physics/pages/9-3-simple-machines)、[UW–Madison Pulleys](https://www.physics.wisc.edu/ingersollmuseum/exhibits/mechanics/pulleys/)。

原样片通过treatment、Cue与渲染检查，完成导出、乱序定位、绳长及吊接核对和390px画宽复看；修正过标签归属及小画宽字号问题。迁入时保留已认可的影片和原图，只调整构建器的项目路径。图片作为本例本地资源消费，没有正式P3图片导入、工作单接纳或节目发布；此例不证明其他题目、作者或正式生产已达到同样效果。
