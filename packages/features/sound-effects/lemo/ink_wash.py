"""Lemo styles/ink-wash/demo/mix.py: original SFX functions, MIT.
Only imports, random setup and room initialization are adapted; no film timeline/music/voice.
Upstream SHA256: f481a2f9b4b8594d9b24a6516a9afd4037d44379f6f297da94d20deaab009434
"""
import numpy as np
from .sfx import SR, t_, noise, bp, lp, hp, env_exp, brown
rng = np.random.default_rng(11)

def env_adsr(d, a=.01, r=.1):
    n = len(t_(d)); e = np.ones(n); na, nr = int(a * SR), int(r * SR)
    if na: e[:na] = np.linspace(0, 1, na)
    if nr: e[-nr:] *= np.linspace(1, 0, nr)
    return e


def drip(v=1.):         # ink/water dripping onto paper: a short downward-sliding "di" + a soft wet "pu"
    d = .35; t = t_(d)
    f = 1300 * np.exp(-t / .02) + 380
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .045)
    thud = lp(noise(d), 900) * np.exp(-t / .03) * .5
    return (tone * .6 + thud) * v


def brush(d=.4, v=1.):   # brush / sword-energy cutting the air: band-pass noise + bristly graininess
    t = t_(d); x = bp(noise(d), 1200, 6500)
    grain = (rng.random(len(t)) < .02) * rng.standard_normal(len(t)) * 2
    e = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 1.5
    return (x + bp(grain, 2000, 8000) * .4) * e * v * .5


def water_step(v=1.):    # toe touching the water: light splash + small "dong"
    d = .5; t = t_(d)
    sp = bp(noise(d), 900, 5000) * np.exp(-t / .05)
    plop = np.sin(2 * np.pi * (240 + 400 * np.exp(-t / .015)) * t) * np.exp(-t / .07)
    drops = np.zeros(len(t))
    for k in range(5):
        s = int((.05 + rng.random() * .3) * SR); f = 1800 + rng.random() * 2500; L = int(.03 * SR)
        if s + L < len(t): drops[s:s + L] += np.sin(2 * np.pi * f * t[:L]) * np.exp(-t[:L] / .006) * .25
    return (sp * .6 + plop * .45 + drops) * v


def splash(v=1.):
    d = 1.2; t = t_(d)
    return (bp(noise(d), 300, 4000) * np.exp(-t / .25) + lp(noise(d), 400) * np.exp(-t / .4) * .6) * v


def skid(v=1.):
    d = 1.0; t = t_(d)
    return bp(noise(d), 500, 3500) * np.exp(-t / .35) * (1 - np.exp(-t / .03)) * v * .7


def sword(v=1.):         # drawing the sword: iron scabbard scraping upward + a long, thin, clear metallic ring
    d = 2.4; t = t_(d)
    scrape = bp(noise(d), 2500, 7000) * np.clip(1 - t / .35, 0, 1) * (t < .35) * .5
    ring = sum(a * np.sin(2 * np.pi * f * t + p) * np.exp(-t / tau) for f, a, tau, p in [(1870, .5, 1.1, 0), (3140, .35, .8, 1), (4420, .25, .6, 2), (6110, .15, .4, 3), (2490, .2, .9, .5)])
    ring *= (1 - np.exp(-np.maximum(t - .3, 0) / .005)) * (t > .3)
    return (scrape + ring * .5) * v


def cut(v=1.):           # cutting the current: tearing airflow + roar of the river being split + low-frequency impact
    d = 2.6; t = t_(d)
    tear = bp(noise(d), 800, 9000) * np.exp(-t / .12) * 1.2
    roar = lp(brown(d), 900) * np.exp(-t / .9) * 2.5
    boom = np.sin(2 * np.pi * (45 + 60 * np.exp(-t / .05)) * t) * np.exp(-t / .5)
    return (tear + roar + boom * .9) * v


def splatter(v=1.):      # ink spots landing on paper: many very short wet dots
    d = 1.2; x = np.zeros(len(t_(d)))
    for k in range(70):
        s = int(rng.random() ** 1.6 * (d - .05) * SR); L = int(.018 * SR); tt = np.arange(L) / SR
        x[s:s + L] += bp(rng.standard_normal(L), 1500, 7000) * np.exp(-tt / .004) * (.3 + rng.random() * .7)
    return x * v * .6


def collapse(v=1.):
    d = 2.8; t = t_(d)
    return (lp(brown(d), 700) * 2 + bp(noise(d), 300, 2500) * .5) * np.exp(-t / 1.1) * (1 - np.exp(-t / .1)) * v


def waterclose(v=1.):
    d = 1.8; t = t_(d)
    return bp(noise(d), 200, 2200) * np.sin(np.pi * t / d) ** 2 * v * .6


def cloth(v=1.):
    d = .5; t = t_(d)
    return bp(noise(d), 300, 3000) * np.sin(np.pi * t / d) * v * .35


def seal(v=1.):          # wooden seal pressed onto paper: a muffled "dong" + fine paper rustle
    d = .6; t = t_(d)
    thud = np.sin(2 * np.pi * (110 + 80 * np.exp(-t / .01)) * t) * np.exp(-t / .08)
    knock = bp(noise(d), 600, 2400) * np.exp(-t / .012) * .6
    paper = bp(noise(d), 3000, 9000) * np.exp(-t / .05) * .12
    return (thud + knock + paper) * v
