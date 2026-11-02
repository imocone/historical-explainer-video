# 宋韵温柔繁华国漫视觉包

用于中国历史题材。保留约5—5.5头身的成熟轻Q人物，以及同步概括的建筑、器物与自然形体；深褐细线、青瓷木褐色面和电影块面光影共同形成温润二维画风。具体朝代、人物衣冠、建筑与器物来自当前节目和画面设计，不由宋代参考补写。

## 参考覆盖

五张固定参考依次为室内夜景人物、水城夜景、水城日景、街市人物日景、工坊室内日景。夜间室内、街市与工坊在原参考上展开为完整宽场景；两张水城全景保持原图。人体仍沿用本包成熟轻Q比例，不因退远改成长身；参考中的人物占画幅大小、场景范围与构图不继承。具体繁华程度、劳动内容、时段与光源由当前画面决定，不从参考增补。地图旁图只继承配色、线条、填色和人物比例。

[夜间室内](references/assets/song-gentle-prosperity-light-q-world-night-wide-v13.png) · [水城夜景](references/assets/song-gentle-prosperity-light-q-watercity-night-master-v12.png) · [水城日景](references/assets/song-gentle-prosperity-light-q-watercity-day-master-v12.png) · [完整街市](references/assets/song-gentle-prosperity-light-q-street-character-day-wide-v13.png) · [完整工坊](references/assets/song-gentle-prosperity-light-q-workshop-interior-day-wide-v13.png)

## 字体与配套外观

| 用途 | 字体与实际字重 |
| --- | --- |
| 刊名、系列标识 | 站酷小薇 400，保留古雅的印刷题字感 |
| 集标题、片头短句 | 霞鹜文楷 GB Medium 500，温润而克制 |
| 正文、标签、地图文字 | Noto Sans SC Medium 500，保持阅读清楚 |
| 横竖封面主字、回忆画流片头标题 | 马善政毛笔楷书 400，呼应国漫的手绘题字 |

展示字体只承担短字角色；小薇与马善政没有的字形由本包已装载的文楷补足，不依赖本机楷体。横竖封面都从本包取得字体，Cover控制文字层级、字号、色序、字面处理和布局；生图中的文字仍按实际成图核对。

地图纸面偏暖米色，保留轻微材质。字幕使用MiSans Semibold，近白字配细深色描边与柔和阴影；字号、行距与底部留白由共用字幕层提供。线条、纸面与字体分别从现有令牌读取，不改变模板的空间关系、字号布局、几何或动作。

## 真源与消费

- [visual-package.json](visual-package.json)登记身份、生产方案和固定有序参考组；[style.json](style.json)提供全画幅与封面画法。
- [render/tokens.json](render/tokens.json)提供确定性字体、颜色、线条、底面、阴影和地图材质；[字体许可](render/fonts/LICENSES.md)随字体分发。令牌颜色面向界面可读性，不要求与生图像素逐项相等。
- P3拥有内容、构图、透视和叙事光照；需要交付静态SVG时，由Engine投递本包的绘图参数，Template按自己的方法绑定绘图助手。P3/P4作者将已定画面与画风组合；地图旁图只绘制前景部件，保留模板的空间关系和透明留白。P1封面横竖版都继承本包绘画与字体，Cover控制文字表现和布局。P2字幕测量与P4压片使用同一套字体和外观令牌；正文、地图、片头片尾及转场按各自真实渲染入口消费本包外观，Template保留语义、几何和运动职责。
- 正文、片头、地图旁图和封面均按清单完整使用固定参考组，逐方案只继承已登记的绘制职责。参考只证明画法，不提供人物身份、服装、文字、地点、构图或史实。
- 现有装载器检查参考路径、摘要、图片格式与1536×864尺寸以及字体资源。本说明不参与运行时、失效或授权，不增加第二套画法或成图验收流程。

空间与军事推演由vox-explainer统一拥有画法、字体和连续地形呈现，不消费本Visual的独立地图配置。
