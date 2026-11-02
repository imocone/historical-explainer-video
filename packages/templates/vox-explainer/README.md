# Vox讲解模板

作者从[AUTHOR.md](AUTHOR.md)开始。模板选择由导演按[正文划段方法](../../modules/direct-episode/references/template-selection-method.md)判断。

讲解以代码编排精细、高级且有表现力的纯动效演示动画。作者从本单内容与导演目标出发，把含义转成可观察的关系，组织观众逐渐理解的过程，并完成整幅画与运动的美感。地图与普通讲解的方法选择、整章设计、同源试制与制作、复看和恢复统一由作者入口安排，正式结果仍只有原treatment。普通讲解按表达需要组合Three.js、SVG、HTML/CSS与Canvas，主体与环境可用代码绘制或沿原图片入口制作，以GSAP及现有组件编排。

| 文件 | 负责什么 |
|---|---|
| [AUTHOR.md](AUTHOR.md) | 本单输入、方法选择、设计与制作的结果交接、恢复、工具调用时点与交回 |
| [vox.md](references/vox.md) | 创作方法入口：按理解、设计、制作、运动、图文、窗口和复看进入子方法 |
| [art.md](references/art.md) | 本包画法及对应参考图 |
| [delivery.md](references/delivery.md) | 共同候选与动画接口；按任务进入Cue、图片、三维、图文工具和预演说明 |
| [spatial.md](references/spatial.md) | 地理依据、范围与行动、地图构图和镜头；细节展开取用共用窗口方法 |
| [空间工具](spatial/README.md) | 工具入口；按地图数据、镜头路线、窗口布局和地理兵棋资源选择接口 |
| [作品与源码](examples/README.md) | 按需参考的已有作品与局部技法 |

地图与普通图解、局部窗口和全屏细节可按理解需要穿插，共用原treatment、实图和Cue，P3预演与P4消费同一交付。三维、SVG与图片按[画法](references/art.md)统一；固定底板和外部进出场由原渲染消费者提供，具体使用见[画布与动画](references/delivery.md#画布与动画)。

默认标题采用[Noto Sans CJK SC Black](fonts/NotoSansCJKsc-Black.otf)的真实900字重，说明和数字采用[Noto Sans SC Medium](fonts/NotoSansSC-Medium.ttf)的真实500字重。标题、标签与数字的层级和编排见[文字与标签](references/creative/graphics.md#文字与标签)；实字体随原appearance与渲染资源交付，许可见[fonts/Noto-OFL.txt](fonts/Noto-OFL.txt)。笔画与纸面相协调，标注、圈线和图标在整幅手机画宽下保持可辨。
