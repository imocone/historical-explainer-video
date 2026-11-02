# 个人配乐

公开源码不附默认音乐；没有本机配置或节目指定曲目时，正文保持无配乐。个人音频放在仓库根的`local-media/background-music/`，不进入Git。

需要个人默认配乐时，把有视频使用权的音频放进`local-media/background-music/`，在根`.env`填写：

```dotenv
BACKGROUND_MUSIC_FILE=local-media/background-music/local.mp3
BACKGROUND_MUSIC_SOURCE=曲名、作者和许可依据
BACKGROUND_MUSIC_RIGHTS=licensed
```

`BACKGROUND_MUSIC_RIGHTS`沿现有来源合同，可用`public-domain`、`licensed`或`permission-granted`，须按实际依据填写。文件存在或本机配置不等于取得授权。

节目已登记的`sourceAssetId`优先于本机默认；显式关闭时两者都不播放。播放音量、循环、淡入淡出和声音作者的收放意图保持原规则。节目专属音乐仍使用原来源登记，不另加制作步骤。

不要把只允许用于成片的音乐当素材包发布。旧Git历史中的音频也不会因当前文件删除而消失。
