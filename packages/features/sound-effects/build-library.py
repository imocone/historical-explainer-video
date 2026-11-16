"""Build the shipped accents with the Lemo synthesizer and body sound recipes.

Run: node packages/runtime-config.mjs python packages/features/sound-effects/build-library.py
The source and MIT notice are in lemo/. Production uses the shipped WAVs.
"""
from pathlib import Path
import hashlib
import json
import sys
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
sys.dont_write_bytecode = True
from lemo import sfx as S

HERE = Path(__file__).resolve().parent


def paper(d=.45, v=1.0):
    grain = S.noise(d)
    rub = S.bp(grain, 550, 2200) + .25 * S.bp(grain, 2000, 5100)
    return S.norm(rub * np.sin(np.pi * S.t_(d) / d) ** 1.5) * v


def woodtap(v=1.):
    # Lemo impasto/demo/mix.py: woodtap().
    d = .08; tt = S.t_(d)
    x = sum(a * np.sin(2 * np.pi * f * tt) * S.env_exp(d, tau) for f, a, tau in [(820, 1, .02), (1760, .5, .01), (3100, .3, .006)]) + S.hp(S.noise(d), 3000) * S.env_exp(d, .002) * .6
    return S.norm(x) * v


def metal(f=1150, v=1.0, d=.9):
    t = S.t_(d)
    modes = [(1, 1, .10), (2.35, .24, .045), (4.1, .10, .018)]
    ring = sum(level * np.sin(2 * np.pi * f * partial * t) * S.env_exp(d, decay)
               for partial, level, decay in modes)
    contact = .30 * S.bp(S.noise(d), 1000, 4300) * S.env_exp(d, .004)
    return S.norm(ring + contact) * v


def whoosh(d=.35, v=1.0):
    # Lower the sweep while keeping its strongest part around the visual cue.
    samples = round(d * S.SR)
    sweep = S.whoosh(((samples + 1) // 2) / S.SR)
    return S.norm(resample_poly(sweep, 2, 1)[:samples]) * v


def ding(v=1.0):
    d = 1.6
    t = S.t_(d)
    modes = [(925, 1, .16), (1440, .23, .080), (2435, .13, .040)]
    return S.norm(sum(level * np.sin(2 * np.pi * f * t) * S.env_exp(d, decay)
                      for f, level, decay in modes)) * v


def smooth_edges(audio, *, start=True, end=True):
    # Remove the discontinuity at the PCM boundary without rounding off the hit.
    samples = min(round(.002 * S.SR), len(audio) // 4)
    if samples < 2:
        return
    fade = np.linspace(0, 1, samples)[:, None]
    if start:
        audio[:samples] *= fade
    if end:
        audio[-samples:] *= fade[::-1]


def build():
    # syncSeconds marks the intended perceptual hit, not a guessed file start.
    recipes = [
        ('plastic-click', '塑料扣合', S.click, 0),
        ('table-clack', '桌面轻碰', S.clack, 0),
        ('wood-tap', '木质轻敲', woodtap, 0),
        ('metal-tap', '小金属碰响', metal, 0),
        ('paper', '短纸张摩擦', paper, .225),
        ('whoosh', '轻短扫动', whoosh, .175),
        ('creak', '机构短摩擦', S.creak, .11),
        ('thump', '低沉短重音', S.thump, 0),
        ('ding', '轻声落定', ding, 0),
        ('pop', '轻弹出', S.pop, 0),
    ]
    out = HERE / 'library'
    out.mkdir(exist_ok=True)
    sounds = {}
    for i, (name, label, make, sync) in enumerate(recipes):
        S._rng = np.random.default_rng(7 + i)
        mono = make().astype(np.float32)
        buf = np.zeros((len(mono), 2), np.float32)
        S.add(buf, mono, 0, gain=.32, pan=0)
        smooth_edges(buf)
        file = out / (name + '.wav')
        sf.write(file, buf, S.SR, subtype='PCM_24')
        sounds[name] = dict(label=label,
            file='packages/features/sound-effects/library/' + file.name,
            sha256=hashlib.sha256(file.read_bytes()).hexdigest(),
            durationSeconds=len(mono) / S.SR, syncSeconds=sync)
    (out / 'catalog.json').write_text(json.dumps(sounds, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    build()
