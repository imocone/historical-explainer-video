# 按动作制作声音

输入是已经理解的表达任务与实际时长。声音可以直接取基础素材、裁切实录、组合Lemo生成器，或写本段专用函数；都回到同一事件合同，不另建节目声音目录或调用链。

## 原生成入口

在当前工作单`scratchPath`中保存配方及必要源码，执行：

```text
node /系统根目录/packages/features/sound-effects/generate.mjs <当前工作单> <配方JSON>
```

程序执行本地制声，返回`{file,sha256,durationSeconds,syncSeconds}`，作为事件的asset。路径、摘要与时长由程序给出，不手填；syncSeconds由作者指定为实际听觉作用点，程序验证它位于文件内。生成的PCM为48kHz双声道，源码和配方与WAV一起保存至本集原P3音效资产区；更新源码会形成不同资产身份。正式渲染只读PCM，不执行作者源码。

制声失败停在本入口，修改同一本单配方或代码后再执行；不重做图片、旁白或画面设计。程序不调用网络、付费音库、TTS或作曲服务；作者源码只做本地声音合成，不承担其它文件操作或外部调用。

## 按需使用本集实录

已有合适的音频就用当前任务视图 `inputs.sourceAssets` 里的 SA 编号。缺素材时，按具体动作找一条能用的录音。先确认实际片段、出处和使用许可。需要署名的素材应能按许可落实署名。只有选中的录音才登记。

如果原件还没登记，在本单 scratch 写一份资料描述。字段为本地原件 `file`、`mediaType: "audio"`、原始出处 `sourceCitation`、`creator`、`date`、`rightsStatus`、`usageNotes`。作者或日期未知可写 `null`。用途备注写明材质、动作和许可范围。沿原来源入口登记，再把返回的编号填进配方。

```text
node /系统根目录/packages/p3-sources.mjs <当前工作单> <资料描述JSON>
```

```json
{"syncSeconds":0.16,"layers":[
  {"generator":"recording","parameters":{"sourceAssetId":"SA003","startSeconds":1.20,"endSeconds":1.62},"gain":0.5}
]}
```

例中的截取时点相对原始录音，同步点相对组合结果。选单声道或双声道 WAV／FLAC 等可解码文件，程序按原采样率取片段并转为成片所用的 48 kHz。原录音留在现有来源区，制声配方保留出处与文件摘要。内置录音仍使用 `name`，一个录音层只选一种来源。

## 按剧情裁切和淡出

在配方中用`clip`裁切和淡化整段输出，适用于实录、分层组合和专用源码的结果。

```json
{"syncSeconds":0.8,"clip":{"startSeconds":0.5,"endSeconds":2.6,"fadeInSeconds":0.1,"fadeOutSeconds":0.6},"layers":[
  {"generator":"recording","parameters":{"name":"shore-lap"}}
]}
```

`syncSeconds`和`clip`的起止点都以裁切前的声音为准。程序返回裁切后的时长和同步点，本例为2.1秒和0.3秒，事件直接使用返回值。起止点省略时取原边界。淡入、淡出省略时，新切口只做防爆音的短淡化。程序先按全段峰值留余量，裁切后沿用这个电平。

同一声源在中途靠近、退远或给下一句让位时，可在配方顶层加 `gainEnvelope`。例如一拨水声先可辨，随后随船退远：

```json
{"gainEnvelope":[{"atSeconds":0,"gain":0.65},{"atSeconds":0.4,"gain":1},{"atSeconds":1.5,"gain":0}]}
```

时点沿裁切前的声音，点与点间平滑改变音量，首尾沿用最近一点。1 保留原电平，0 为无声，曲线和裁切都在峰值余量处理后执行。声音退完后可用 `clip` 收在最后一点。需要分别卡点的声源各交一个事件。

## 用已有生成器组合

```json
{"seed":7,"syncSeconds":0.04,"layers":[
  {"generator":"creak","parameters":{"v":0.3},"gain":0.5,"pan":0},
  {"generator":"woodtap","parameters":{"v":0.8},"atSeconds":0.04,"gain":1,"pan":0}
]}
```

每层支持`parameters / atSeconds / gain / pan / effects / roomWet`。正的atSeconds安排准备、作用和余韵的关系；syncSeconds对准整段声音的重音，而不是默认文件起点。固定seed使同一代码与配方可复现。

实录和合成可以放在同一配方。内置的`heavy-wood-door`（1.62秒）是重木门的移动与收束，`shore-lap`（5.1秒）保留两次小浪到岸和回落。按场面选择和裁切。例如：

```json
{"syncSeconds":0.35,"layers":[
  {"generator":"recording","parameters":{"name":"shore-lap","startSeconds":0.5,"endSeconds":2.6}}
]}
```

录音层的时点相对原件，省略时使用全段。仅缩短已做好的声音时，用整体 `clip` 保留原电平。内置录音来源见[SOURCES.md](../SOURCES.md#实录素材)。

同一声源在切镜后被门、玻璃或距离遮弱时，可以在这一层追加遮挡处理。例如：

```json
{"type":"occlusion","parameters":{"atSeconds":1.6,"durationSeconds":0.2,"frequency":1250,"gain":0.55}}
```

`atSeconds`从本层裁切后的起点算起。`durationSeconds`是变闷、变轻的过程，`frequency`是遮挡后的低通频率，`gain`是遮挡后的线性电平。处理沿同一段采样渐变，保留整段时长和同步点。按本次实图切换、实际声源和旁白空隙填写参数，以上数值只解释写法。声源本来已经衰尽时，让原声自然结束即可。

可用的生成器：

- 基础：click/clack(pitch,v)、crash(v)、whoosh(d,v)、creak(v)、thump(v,f)、step(v)、ding(v)、pop(v)、quindar(v,f)、rumble(d,v)、ignite(v)、roar(d,v)、heartbeat(v)。省略参数沿原实现，roar须给d。
- 材质：paper(d,v)、woodtap(v)、metal(f,v,d)。
- `ink-`系列：drip(v)、brush(d,v)、water_step(v)、splash(v)、skid(v)、sword(v)、cut(v)、splatter(v)、collapse(v)、waterclose(v)、cloth(v)、seal(v)。
- `watercolor-`系列：brush(d,g,pan0,pan1)、stamp(g)、wind(d,g)、chirp(g,f0)、plink(g,f)、fire(d,g)、rain(d,g)、whipbird(g,pan)、swell(d,g,rev)、airy(d,g)。

watercolor的风、火、雨保留原演示的长起落，适用于声音本身需要发展的过程。只交代天气或地点时，选起势合适的一小段实录或为实际时段配声。每层可用`effects:[{"type":"lowpass","frequency":3000}]`，以及highpass、bandpass(low/high)、compress(parameters)、limit(parameters)；roomWet调用原水彩混响。用滤波表现材质与远近，用混响表现空间。

正文的paper、metal、whoosh和ding默认已调整摩擦主体、共鸣或扫声亮度。

## 为本段写专用声音

若库里的形态不符合动作，在同一scratch写Python文件，导出`render(*, sr, rng, ...)`。它返回浮点NumPy数组，形状为`(采样数,)`或`(采样数,2)`；sr为48000，rng是由配方seed固定的随机发生器。参数通过配方parameters传入，可直接使用NumPy及随入口可导入的`lemo.sfx`工具。源码是本机受信任的创作代码，不是隔离执行服务。

下面展示“摩擦逐渐变紧、接触后释放”的构造方法：频谱决定摩擦质地，连续包络表达阻力，局部瞬态表达接触；具体频率、时长和力度由本段内容决定，不直接套用示例。

```python
import numpy as np
from lemo import sfx as S

def render(*, sr, rng, duration, contact):
    if not 0 < contact < duration:
        raise ValueError('接触点须在过程内')
    t = np.arange(round(duration * sr)) / sr
    grain = S.bp(rng.standard_normal(len(t)), 700, 3400)
    # 阻力逐渐积累，接触后迅速放掉，末尾自然结束。
    force = np.interp(t, [0, .05, contact * .7, contact, min(duration, contact + .12), duration],
                     [0, .2, .45, 1, .08, 0])
    texture = grain * (.7 + .3 * np.sin(2 * np.pi * 19 * t)) * force * .06
    elapsed = np.maximum(0, t - contact)
    body = np.sin(2 * np.pi * 130 * elapsed) * np.exp(-elapsed / .07) * (t >= contact) * .12
    return texture + body
```

配方使用与自身相邻的源码相对路径：

```json
{"seed":31,"syncSeconds":2.1,"sourceFile":"friction-release.py","parameters":{"duration":2.55,"contact":2.1}}
```

sourceFile与layers二选一；需要复杂组合时在render内部形成完整声音。源码可使用`S.noise(d)`、`S.t_(d)`、`S.lp(x,f)`、`S.hp(x,f)`、`S.bp(x,low,high)`、`S.env_exp(d,tau)`、`S.norm(x)`、`S.add(stereo,x,at,gain,pan)`及上列原函数。S.add用于把单声道放入双声道母线；自写随机过程优先用传入rng，不读取系统时间或未固定随机源。

持续声按真实动作构造强弱包络、频率变化与颗粒疏密，瞬态按接触构造主体与余韵。需要声源移动时，双声道输出按时间改变左右分量，不靠多个重复短声伪装运动。可以把同一对象的几种状态放在一个函数中，以不同参数形成可辨认的声音家族。

输出必须有限、非空，syncSeconds在实际声音内。程序在文件两端施加最多2毫秒的淡化以去除边界跳变，并只对超过余量的峰值整体缩放。作品中有意义的强弱由作者设计，最终旁白让位和母线处理由共享混音负责。源码只是制作声音，不在其中生成整章BGM、旁白或第二条时间轴。
