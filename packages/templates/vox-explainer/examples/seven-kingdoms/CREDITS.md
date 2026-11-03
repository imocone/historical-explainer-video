# 来源与范围

本例收录2026-11-03完成的全SVG重做版。路径造型、场景、人物、字组与动画为本项目代码创作。此前独立工程中的生图素材不在本例中，也未被本版画面使用。

历史叙述沿用原作品材料：[《史记·吴王濞列传》](https://www.njmuseum.com/files/wshl/rbbook/gb/25/shiji/sj106.html)、[《汉书·百官公卿表》](https://zh.wikisource.org/wiki/漢書/卷019)。区分前154年削地与前145年不得复治国。地块只表示治理归属，形状、面积和数量不编码真实行政边界、人口或国力。地图路线表示主要方向，不是精确行军轨迹。参考作品不替代当前节目的史料核对。

人物、器物与建筑是汉代类型的解释性概括，使用低直屋顶、木构、院落和交领衣物等特征，不把东汉单件文物当作景帝时期的原样复原；匿名工匠动作只服务操作示意，不声称记录了特定人物的实际行为。

地图数据沿用本作品准备的Natural Earth概化陆地、水系及Mapzen Terrain Tiles地形；GMTED2010 / SRTM数据由USGS提供。现代地形不能证明前154年的海岸、水道或政治边界。署名与许可沿[Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/)和[Mapzen数据提供者说明](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)；样式直接读取本模板的`spatial/map-style.mjs`，几何绘制为SVG。

本机音轨沿用独立作品的合成旁白、配乐与效果混音，不重新生成。配乐为Kevin MacLeod的“Dreams Become Real”，署名incompetech.com，CC BY 4.0：[原作品页](https://incompetech.com/wordpress/2015/04/dreams-become-real/)与[许可](https://creativecommons.org/licenses/by/4.0/)。音效来自原项目Lemo声音资源，沿[MIT许可](../../../../features/sound-effects/lemo/LICENSE)。原混音仅保存在`local-media/private-assets/`，公开`assets/mix.wav`是本项目制作的190.898秒静音占位。

字体使用本模板的Noto Sans SC Medium与Noto Sans CJK SC Black，沿[SIL OFL](../../fonts/Noto-OFL.txt)。GSAP、HyperFrames、esbuild等安装依赖沿项目[第三方声明](../../../../../THIRD_PARTY_NOTICES.md)。

`src/`保存完整作品源码，地图样式导入使用仓库相对路径。
