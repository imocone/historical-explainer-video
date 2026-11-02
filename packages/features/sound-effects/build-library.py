"""Build the shipped accents with Lemo's unmodified procedural SFX module.

Run: node packages/runtime-config.mjs python packages/features/sound-effects/build-library.py
The source and MIT notice are in lemo/. Production uses the shipped WAVs.
"""
from pathlib import Path
import hashlib
import json
import sys
import numpy as np
import soundfile as sf
sys.dont_write_bytecode = True
from lemo import sfx as S

HERE = Path(__file__).resolve().parent


def paper(d=.45, v=1.0):
    # Lemo archive-lighttable/demo/mix.py: paper().
    x = S.bp(S.noise(d), 1800, 7000) * np.sin(np.pi * np.linspace(0, 1, int(round(d * S.SR)))) ** 1.5
    return S.norm(x) * v


def woodtap(v=1.):
    # Lemo impasto/demo/mix.py: woodtap().
    d = .08; tt = S.t_(d)
    x = sum(a * np.sin(2 * np.pi * f * tt) * S.env_exp(d, tau) for f, a, tau in [(820, 1, .02), (1760, .5, .01), (3100, .3, .006)]) + S.hp(S.noise(d), 3000) * S.env_exp(d, .002) * .6
    return S.norm(x) * v


def metal(f=2400, v=1.0, d=.9):
    # Lemo teardown/demo/mix.py: metal().
    tt = S.t_(d)
    x = sum(a * np.sin(2 * np.pi * f * k * tt) * S.env_exp(d, tau) for k, a, tau in [(1, 1, .35), (2.76, .5, .18), (5.4, .25, .09), (8.9, .12, .05)])
    return S.norm(x + S.hp(S.noise(d), 5000) * S.env_exp(d, .002) * .6) * v


def build():
    # syncSeconds marks the intended perceptual hit, not a guessed file start.
    recipes = [
        ('plastic-click', '塑料扣合', S.click, 0),
        ('table-clack', '桌面轻碰', S.clack, 0),
        ('wood-tap', '木质轻敲', woodtap, 0),
        ('metal-tap', '小金属碰响', metal, 0),
        ('paper', '短纸张摩擦', paper, .225),
        ('whoosh', '轻短扫动', S.whoosh, .175),
        ('creak', '机构短摩擦', S.creak, .11),
        ('thump', '低沉短重音', S.thump, 0),
        ('ding', '清亮落定', S.ding, 0),
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
        file = out / (name + '.wav')
        sf.write(file, buf, S.SR, subtype='PCM_24')
        sounds[name] = dict(label=label,
            file='packages/features/sound-effects/library/' + file.name,
            sha256=hashlib.sha256(file.read_bytes()).hexdigest(),
            durationSeconds=len(mono) / S.SR, syncSeconds=sync)
    (out / 'catalog.json').write_text(json.dumps(sounds, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    build()
