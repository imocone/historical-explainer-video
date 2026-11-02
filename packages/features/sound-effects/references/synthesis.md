# 按动作制作声音

输入是已经理解的表达任务与实际时长。声音可以直接取基础素材、组合Lemo生成器，或写本段专用函数；三者都回到同一事件合同，不另建声音目录或调用链。

## 原生成入口

在当前工作单`scratchPath`中保存配方及必要源码，执行：

```text
node /系统根目录/packages/features/sound-effects/generate.mjs <当前工作单> <配方JSON>
```

程序执行本地制声，返回`{file,sha256,durationSeconds,syncSeconds}`，作为事件的asset。路径、摘要与时长由程序给出，不手填；syncSeconds由作者指定为实际听觉作用点，程序验证它位于文件内。生成的PCM为48kHz双声道，源码和配方与WAV一起保存至本集原P3音效资产区；更新源码会形成不同资产身份。正式渲染只读PCM，不执行作者源码。

制声失败停在本入口，修改同一本单配方或代码后再执行；不重做图片、旁白或画面设计。程序不调用网络、付费音库、TTS或作曲服务；作者源码只做本地声音合成，不承担其它文件操作或外部调用。

## 用已有生成器组合

```json
{"seed":7,"syncSeconds":0.04,"layers":[
  {"generator":"creak","parameters":{"v":0.3},"gain":0.5,"pan":0},
  {"generator":"woodtap","parameters":{"v":0.8},"atSeconds":0.04,"gain":1,"pan":0}
]}
```

每层支持`parameters / atSeconds / gain / pan / effects / roomWet`。正的atSeconds安排准备、作用和余韵的关系；syncSeconds对准整段声音的重音，而不是默认文件起点。固定seed使同一代码与配方可复现。

可用的原Lemo生成器：

- 基础：click/clack(pitch,v)、crash(v)、whoosh(d,v)、creak(v)、thump(v,f)、step(v)、ding(v)、pop(v)、quindar(v,f)、rumble(d,v)、ignite(v)、roar(d,v)、heartbeat(v)。省略参数沿原实现，roar须给d。
- 材质：paper(d,v)、woodtap(v)、metal(f,v,d)。
- `ink-`系列：drip(v)、brush(d,v)、water_step(v)、splash(v)、skid(v)、sword(v)、cut(v)、splatter(v)、collapse(v)、waterclose(v)、cloth(v)、seal(v)。
- `watercolor-`系列：brush(d,g,pan0,pan1)、stamp(g)、wind(d,g)、chirp(g,f0)、plink(g,f)、fire(d,g)、rain(d,g)、whipbird(g,pan)、swell(d,g,rev)、airy(d,g)。

watercolor的风、火、雨保留长过程的渐入渐出，需要足够时长；不能把它们随意截成短点击。动态声像与双声道空间保留。每层可用`effects:[{"type":"lowpass","frequency":3000}]`，以及highpass、bandpass(low/high)、compress(parameters)、limit(parameters)；roomWet调用原水彩混响。滤波表现材质与远近，混响表现空间，不能当作万能美化。

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

输出必须有限、非空，syncSeconds在实际声音内。程序只对超过余量的峰值整体缩放，不把每段自动抬到同一响度；作品中有意义的强弱仍由作者设计，最终旁白让位和母线处理由共享混音负责。源码只是制作声音，不在其中生成整章BGM、旁白或第二条时间轴。
