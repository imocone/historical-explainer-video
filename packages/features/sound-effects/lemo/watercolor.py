"""Lemo styles/watercolor/demo/mix.py: original SFX functions, MIT.
Only imports, random setup and room initialization are adapted; no film timeline/music/voice.
Upstream SHA256: 12ce537e39907dca5362327b17a86bb92de59969405e08802767992018844eaf
"""
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
SR = 48000
rng = np.random.default_rng(11)
IR = None
def prepare_room():
    global IR
    n = int(1.8 * SR)
    IR = np.stack([noise(n), noise(n)], 1) * np.exp(-np.arange(n) / SR * 3.2)[:, None]
    IR = np.stack([lp(IR[:, 0], 5000), lp(IR[:, 1], 5000)], 1)
    IR /= np.sqrt((IR ** 2).sum(0))

def bp(x, lo, hi, o=2): return sosfilt(butter(o, [lo, hi], 'band', fs=SR, output='sos'), x)


def lp(x, f, o=2): return sosfilt(butter(o, f, 'low', fs=SR, output='sos'), x)


def hp(x, f, o=2): return sosfilt(butter(o, f, 'high', fs=SR, output='sos'), x)


def noise(n): return rng.standard_normal(n)


def pink(n):
    w = np.fft.rfft(noise(n)); f = np.arange(len(w)); f[0] = 1
    return np.fft.irfft(w / np.sqrt(f), n) * 20


def norm(x, p=1.0): return x / (np.abs(x).max() + 1e-9) * p


def st(x, pan=0.0):
    l = np.cos((pan + 1) * np.pi / 4); r = np.sin((pan + 1) * np.pi / 4)
    return np.stack([x * l * 1.414, x * r * 1.414], 1)


def env(n, a, r):
    t = np.arange(n) / SR; return np.minimum(1, t / max(a, 1e-4)) * np.exp(-np.maximum(0, t - a) / max(r, 1e-4))


def fade(x, fi, fo):
    n = len(x); e = np.ones(n); a = int(fi * SR); b = int(fo * SR)
    if a: e[:a] = np.linspace(0, 1, a) ** 1.5
    if b: e[-b:] = np.minimum(e[-b:], np.linspace(1, 0, b) ** 1.5)
    return x * (e[:, None] if x.ndim == 2 else e)


def dbfs(x): return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)


def verb(x2, wet=.3):
    y = np.stack([fftconvolve(x2[:, 0], IR[:, 0])[:len(x2)], fftconvolve(x2[:, 1], IR[:, 1])[:len(x2)]], 1)
    return x2 * (1 - wet) + y * wet


def brush(d, g, pan0=-.5, pan1=.5):
    n = int(d * SR); p = np.arange(n) / n
    x = bp(noise(n), 1500, 7000) * (.6 + .4 * np.abs(np.sin(np.arange(n) / SR * 2 * np.pi * 9)))
    x += bp(pink(n), 300, 1500) * .5
    e = np.sin(np.pi * p) ** .8
    pan = pan0 + (pan1 - pan0) * p
    y = norm(x * e, .5) * g
    return np.stack([y * np.cos((pan + 1) * np.pi / 4) * 1.414, y * np.sin((pan + 1) * np.pi / 4) * 1.414], 1)


def stamp(g):
    n = int(1.2 * SR); t = np.arange(n) / SR
    x = np.sin(2 * np.pi * np.cumsum(90 * (1 + .5 * np.exp(-t * 30))) / SR) * np.exp(-t * 9) + lp(noise(n), 900) * env(n, .002, .05) * .6
    return verb(st(norm(x, .8) * g), .25)


def wind(d, g):
    n = int(d * SR); t = np.arange(n) / SR
    gust = .55 + .45 * np.sin(2 * np.pi * .21 * t + 1) * np.sin(2 * np.pi * .09 * t)
    a = lp(pink(n), 600) * gust + bp(noise(n), 700, 2200) * .06 * gust
    b = lp(pink(n), 600) * gust
    return fade(np.stack([norm(a, .5), norm(b, .5)], 1) * g, 2.5, 3)


def chirp(g, f0):
    n = int(.09 * SR); t = np.arange(n) / SR
    f = f0 * (1 + .35 * np.sin(2 * np.pi * 38 * t)) * (1 + 1.2 * t)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * t / t[-1]) ** 2
    return x * g


def plink(g, f):
    n = int(.35 * SR); t = np.arange(n) / SR
    fr = f * (1 + .8 * np.exp(-t * 60)); x = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t * 22)
    return verb(st(x * g, rng.uniform(-.3, .3)), .3)


def fire(d, g):
    n = int(d * SR); t = np.arange(n) / SR
    roar = lp(pink(n), 500) * (.6 + .4 * np.sin(2 * np.pi * .7 * t) ** 2)
    imp = (rng.random(n) < 90 / SR) * rng.uniform(-1, 1, n)
    crack = hp(np.convolve(imp, np.exp(-np.arange(300) / 40), 'same'), 1500) * 3
    x = norm(roar, .5) + norm(crack, .7)
    return fade(np.stack([x, np.roll(x, 500)], 1) * g, 1.2, 2.0)


def rain(d, g):
    n = int(d * SR); t = np.arange(n) / SR
    base = hp(pink(n), 1200) * .5 + bp(noise(n), 3000, 9000) * .3
    imp = (rng.random(n) < 220 / SR) * rng.uniform(.2, 1, n)
    drops = bp(np.convolve(imp, np.exp(-np.arange(200) / 25), 'same'), 1500, 6000)
    x = norm(base, .5) + norm(drops, .35)
    ramp = np.clip((t - 0) / 8, 0, 1) ** 1.5 * .55 + np.clip((t - 9) / 5, 0, 1) * .45
    y = np.stack([x, np.roll(x, 900)], 1) * ramp[:, None]
    return fade(y * g, .5, 3.0)


def whipbird(g, pan):
    d = 2.1; n = int(d * SR); t = np.arange(n) / SR; x = np.zeros(n)
    k1 = int(1.25 * SR); t1 = t[:k1]
    f1 = 2000 + 250 * (t1 / t1[-1]); a1 = np.minimum(1, t1 / .05) * (1 - .2 * t1)
    x[:k1] = np.sin(2 * np.pi * np.cumsum(f1) / SR) * a1 * .6
    k2 = int(.09 * SR); s2 = k1 + int(.04 * SR); t2 = np.arange(k2) / SR
    f2 = 1800 * np.exp(t2 / t2[-1] * np.log(4.2)); x[s2:s2 + k2] += np.sin(2 * np.pi * np.cumsum(f2) / SR) * np.sin(np.pi * t2 / t2[-1]) * 1.0
    for off in (.3, .5):
        s3 = s2 + int(off * SR); k3 = int(.1 * SR); t3 = np.arange(k3) / SR
        f3 = 2600 - 900 * t3 / t3[-1]; x[s3:s3 + k3] += np.sin(2 * np.pi * np.cumsum(f3) / SR) * np.sin(np.pi * t3 / t3[-1]) * .45
    return verb(st(x * g, pan), .4)


def swell(d, g, rev=False):
    n = int(d * SR); p = np.arange(n) / n
    e = (p if not rev else p) ** 2.2
    x = bp(pink(n), 250, 5000) * e * np.minimum(1, (1 - p) / .03)
    return st(norm(x, .45) * g)


def airy(d, g):
    n = int(d * SR); p = np.arange(n) / n
    x = bp(pink(n), 300, 3000) * np.sin(np.pi * p) ** 2
    return st(norm(x, .4) * g)
