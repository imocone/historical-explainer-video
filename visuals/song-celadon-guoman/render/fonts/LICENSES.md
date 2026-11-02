# 字体来源与许可

本目录原有的四套字体均来自字体项目的官方仓库，按`OFL-1.1.txt`中合并保留的各自版权声明、保留字体名称条款、LXGW附加许可与SIL Open Font License 1.1（SIL开放字体许可证1.1）随视觉包分发。

| 文件 | 正式用途 | 上游目录 |
| --- | --- | --- |
| `ZCOOLXiaoWei-Regular.ttf` | 节目刊名、短出处 | `google/fonts/ofl/zcoolxiaowei` |
| `LXGWWenKaiGB-Medium.ttf` | 集标题、片头片尾短句、短文化旁注 | `lxgw/LxgwWenkaiGB/fonts/TTF` |
| `NotoSansSC-Medium.ttf` | 正文、标签、地图标注 | `google/fonts/ofl/notosanssc` |
| `MaShanZheng-Regular.ttf` | 回忆画流片头标题、封面主字 | `google/fonts/ofl/mashanzheng` |

字体角色、实际字重与摘要以`../tokens.json`为准，使用上游真实家族名作为加载与生图提示名称。小薇和马善政没有的字形由已分发、已装载的霞鹜文楷GB补足；不从本机安装字体决定后备字形。不得用展示字体排长段说明文字。

马善政字体从原回忆画流片头资源原样移入本包，未修改或子集化；原始版权声明和OFL许可随包保留。实际字体角色及摘要以`../tokens.json`为准。

同一字体原件可被本包多个角色引用，来源及许可同上表；文件内容未修改。vox-explainer的字体由该模板自行持有。

## MiSans 字幕字体

本软件使用 MiSans 字体。`MiSans-Semibold.woff2`仅用于节目字幕，来自[小米官方 MiSans 字体包](https://hyperos.mi.com/font/zh/download/)内的`MiSans/woff2/MiSans-Semibold.woff2`（Version 4.009），原件未修改、转换或子集化。字体内部家族为MiSans、字形为Semibold，OS/2真实字重为520；浏览器按真实字重注册，不合成粗体。

Copyright © 2020-2025 Beijing Xiaomi Mobile Software Co.,Ltd. All Rights Reserved.

MiSans使用独立的[小米字体知识产权许可协议](MiSans-License.pdf)，不属于本目录的SIL OFL授权。本软件随附官方协议及版权声明；本项目使用该字体创作视频，不将字体作为独立产品分发或售卖。

开源分发不附MiSans字体原件，公开字幕使用本包已有的OFL Noto Sans SC。用户本机的MiSans原件放在忽略跟踪的local-media/private-assets/对应Visual路径时，仍按原协议及原字形使用；许可PDF与版权说明保留。
