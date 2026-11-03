# 第三方许可与素材来源

项目自有代码及文档采用根[MIT许可证](LICENSE)。第三方代码、字体、地图、纹理、音频及其嵌入部分仍适用各自许可。没有明确再分发依据的素材不包含在根MIT授权中；“用于视频的许可”不能当成“把素材放进源码包的许可”。核对日期：2026-11-02。

## 代码与安装依赖

| 对象 | 许可与说明 |
|---|---|
| `packages/features/sound-effects/lemo/` | © 2026 LemoLab，MIT；原[许可证](packages/features/sound-effects/lemo/LICENSE)保持。制声脚本引用的方法沿代码注释保留来源 |
| HyperFrames | Apache-2.0；从npm安装，原上游声明随依赖保留 |
| GSAP | [Standard No Charge License](https://gsap.com/standard-license/)，不是MIT。官方明确允许AI生成GSAP代码；若将其用于可视化动画搭建产品，另按协议中的用途限制判断 |
| sharp及其本机图像组件 | sharp为Apache-2.0，部分预编译依赖另含LGPL许可；不把它们统一改标为MIT |
| 其它npm、Python及系统工具 | 依赖版本见`package-lock.json`、`requirements.txt`和安装说明；各组件原许可保持。仓库不附`node_modules`、Python环境、FFmpeg或ImageMagick二进制；再次打包这些组件时须保留上游许可与其要求的文件 |

## 已有明确来源的随仓资源

| 资源 | 来源、许可与保留位置 |
|---|---|
| Noto、思源宋体、霞鹜文楷GB、站酷小薇、马善政字体 | 各自SIL OFL及版权声明原样保留；详见三个Visual的`render/fonts/LICENSES.md`及[讲解字体原许可](packages/templates/vox-explainer/fonts/Noto-OFL.txt)。保留字体名称和附加许可，不能按MIT单独转授 |
| MiSans协议PDF | 仅保留[原协议](visuals/meiji-state-machine/render/fonts/MiSans-License.pdf)供本机用户核对；MiSans字体文件不随仓库分发。公开字幕使用仓库中已许可的Noto Sans SC，原字体仅在本机保留 |
| `packages/templates/vox-explainer/spatial/geography/{land,lakes,rivers}.json` | [Natural Earth公有领域数据](https://www.naturalearthdata.com/about/terms-of-use/)；原数据用途及精度见[资源说明](packages/templates/vox-explainer/spatial/docs/resources.md) |
| `packages/templates/vox-explainer/spatial/assets/unit-*.svg` | 参考letstalkaboutdune的[AbsoluteUnits](https://github.com/letstalkaboutdune/AbsoluteUnits)改绘，CC BY 4.0；原[许可全文](packages/templates/vox-explainer/spatial/assets/AbsoluteUnits-LICENSE.txt)及SVG内署名保持。使用时保留作者、项目、许可和改绘说明 |
| `packages/templates/glass-opener/assets/window-glass-{normal.png,pbr.jpg}` | © 2023 Wayfair，Eric Chadwick制作的[GlassBrokenWindow](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/GlassBrokenWindow)，[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)；本项目用于动态玻璃网格并调整强度，保留该署名与加工说明 |
| `packages/templates/documentary-opener/audio/samples/*.flac`、`piano.sfz` | FreePats Upright Piano KW，2022-02-21；Gonzalo、Roberto录制，Roberto编辑，[CC0 1.0](https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html)。十个实际采样及[原许可](packages/templates/documentary-opener/audio/samples/CC0.txt)保持 |

当前资料明确记为本项目原创生成或程序合成的资源，其本项目可授权部分按MIT开放：

- `visuals/*/references/assets/`中当前说明明确记为本项目生图的画风参考；原始外部作品或截图未因此取得本项目的授权。
- `.github/assets/showcase/`中的README展示封面、截图和无声动图来自本项目作者已公开的节目及原创模板示例，来源见[画面示例](README.md#画面示例)与[成片展示](README.md#成片展示)；讲解动图取自[工资示例](packages/templates/vox-explainer/examples/salary/README.md)的18—32秒。随仓仅提供压缩展示图与无声片段动图，不附原视频、音轨或字体文件。
- [封面参考](packages/covers/type-first-editorial/examples/README.md)、[透明前景](packages/templates/fullframe-narrative/effects/assets/README.md)、玻璃`glass-cracks.png`与`glass-edge.png`，以及全画幅示意图中本项目绘制的SVG和对应渲染图。
- `packages/features/sound-effects/library/*.wav`的程序制声音效、crossfire-opener的`ember-*.wav`合成声音，以及documentary-opener的`memory-piano.wav`原创采样编配；Lemo代码和FreePats采样继续分别保留原许可。

这不覆盖第三方原件、商标、人物肖像或他人作品的额外权利，也不把未注明出处的文件自动认定为原创。示例素材的可借鉴范围仍见各例README；创作方法参考不等于获得素材再分发权。

## 不随仓库分发的本机素材

不能确认源码再分发权的原件已从公开文件中移出。`local-media/`被Git忽略；它不是MIT开放内容。本机具备这些原件时仍读取原件，新安装使用下列公开资源，不依赖个人素材。

| 原件或范围 | 公开版处理 |
|---|---|
| 原默认背景音乐`default.mp3` | 不附带默认配乐，原文件只留本机。用户可自行放入具备使用权的音乐 |
| episode-opener与opposed-opener中源于Mixkit的音效 | 公开文件为本项目制作的静音占位WAV，保留原采样率、声道数和长度。Mixkit原件及裁切版本只留本机；[来源登记](packages/templates/episode-opener/audio/sources.mjs)根据实际使用的文件报告来源 |
| episode-opener与crossfire-opener原背景音乐《沈黙》 | DOVA-SYNDROME／OpenTracks原件只留本机；公开文件为相同时长的静音占位，不转授原音乐 |
| 三个Visual的`MiSans-Semibold.woff2` | 字体原件只留本机；公开使用OFL的Noto Sans SC。原许可PDF保留，不能据此认为原字体已随源码开放 |
| 示例旁白与视频 | 公开旁白为相同时长的静音占位；成品及示例视频均不随仓库分发，本机保留完整原片和原声 |

上述占位音频按本项目MIT范围开放，不代表原音乐、原音效或原音色获得再分发许可。公开片头及本机从示例源码生成的预览因此可能无声；用户自行配置有权使用的音频后可恢复声音。

Normanton示例中的地图图像是按Natural Earth公有领域数据绘制的定性示意，依据见该例`sources.md`；并未随仓附入外部地图截图。其它项目自产图片的依据见各资源目录的说明，不把方法参考作品并入项目授权。

首次公开使用审查后的当前源码建立独立干净Git历史。原Git与原素材仅保留在本机私有备份，不随开源目录分发；实际历史清理结果以本次维护验收为准。
