# 回忆画流原创主题

`memory-piano.wav`为用户在2026-09-06试听认可的原创钢琴配乐母版，48kHz立体声24bit。10.5秒片头按原速消费十秒母版及其自然尾音，随最后2.3秒离场边界淡出；母版结束后的0.5秒留作正文口播开始前的音乐呼吸。七音旋律C4—F4—G4—Ab4—C5—Bb4—Ab4，配Fm(add9)与Dbmaj7两组和声。该结构经AGY讨论，由Codex编配、采样渲染及混音；不包含正片参考录音的声音，不使用旧CoreAudio音轨。

## 正式消费与预览

P4通过`sources.mjs`和模板`render-plan.mjs`消费本目录母版，不读取Music目录或演示文件。片头施加-10 dB增益（约0.316音量），并在8.2—10.5秒随画面退场；片头不叠加TTS。该增益与经典片头及正文默认配乐的实际播放时段共同控制在约-32至-33 LUFS。同源预览供用户播放查看，不设AI听感验收。

用户认可的是无口播片头方向；未据此宣称完整正式节目或发布已经验收。

## 音源与复现

真实钢琴采样来自FreePats的 **Upright Piano KW，2022-02-21版**：Kawai立式钢琴，由Gonzalo和Roberto于2017年录制、Roberto编辑，按CC0 1.0发布。仅保留曲谱实际使用的十个低力度FLAC文件及其SFZ映射；原许可见`samples/CC0.txt`。

- 音源与作者说明：<https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html>
- 原始音源：<https://freepats.zenvoid.org/Piano/UprightPianoKW/UprightPianoKW-SFZ+FLAC-20220221.7z>
- 许可：<https://creativecommons.org/publicdomain/zero/1.0/>

加工包括移调、时序、力度、延音包络、均衡、早期反射和混响。它是原创采样编配，不冒充现场演奏录音。复现不需要联网：

```sh
node packages/runtime-config.mjs python packages/templates/documentary-opener/audio/compose.py /tmp/memory-piano-reproduced.wav
```

依赖当前Python中的NumPy、SciPy、SoundFile与本机FFmpeg。脚本先生成PCM24混音再施加固定增益，保留认可母版的量化路径；输出应与`sources.mjs`的SHA256一致。旧Swift作曲和Python混音入口已由此单一脚本承接，历史版本由Git保存。
