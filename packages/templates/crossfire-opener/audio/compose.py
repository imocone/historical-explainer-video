"""Deterministic C-sharp minor score and three motion sounds, synthesized locally."""
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt

ROOT = Path(__file__).parent
SR, DURATION, BAR = 48000, 13.8, 1.915
rng = np.random.default_rng(1904)
music = np.zeros((round(SR * DURATION), 2))


def clock(seconds):
    return np.arange(round(seconds * SR)) / SR


def hz(note):
    return 440 * 2 ** ((note - 69) / 12)


def band(y, low, high):
    return sosfilt(butter(2, [low, high], btype='bandpass', fs=SR, output='sos'), y)


def edge(y, attack=.006, release=.08):
    y = y.copy()
    a, b = min(round(attack * SR), len(y)), min(round(release * SR), len(y))
    y[:a] *= np.sin(np.linspace(0, np.pi / 2, a)) ** 2
    y[-b:] *= np.cos(np.linspace(0, np.pi / 2, b)) ** 2
    return y


def place(bus, at, y, gain=1, pan=0):
    if y.ndim == 1:
        y = y[:, None] * np.array([np.cos((pan + 1) * np.pi / 4),
                                   np.sin((pan + 1) * np.pi / 4)])
    start = round(at * SR)
    n = min(len(y), len(bus) - start)
    if n > 0:
        bus[start:start + n] += y[:n] * gain


def strings(note, seconds=.46, sustain=False):
    t, f = clock(seconds), hz(note)
    # A bowed ensemble: inharmonic phases and three slightly detuned voices.
    out = np.zeros((len(t), 2))
    for side, detune in enumerate([-.0022, .0022]):
        y = np.zeros(len(t))
        for offset in [-.0014, 0, .0013]:
            for h in range(1, 13):
                phase = 2 * np.pi * f * (1 + detune + offset) * h * t
                phase += .017 * h * np.sin(2 * np.pi * 5.2 * t + side)
                decay = 1 if sustain else np.exp(-t * (4.8 + h * .54))
                y += np.sin(phase + .19 * h * h) * decay / h ** 1.35
        out[:, side] = edge(y / 3, .11 if sustain else .018, .21 if sustain else .11)
    return out


def low(note, seconds=.65):
    t, f = clock(seconds), hz(note)
    y = np.sin(2 * np.pi * f * t) + .25 * np.sin(4 * np.pi * f * t)
    return edge(y * np.exp(-t * 3.4), .009, .14)


def drum(seconds=.72, high=False):
    t = clock(seconds)
    f0, f1 = (165, 83) if high else (112, 49)
    phase = 2 * np.pi * (f1 * t + (f0 - f1) * .032 * (1 - np.exp(-t / .032)))
    skin = band(rng.normal(size=len(t)), 180, 1900) * np.exp(-t * 32)
    return edge(np.sin(phase) * np.exp(-t * 8) + skin * .24, .002, .14)


def air_hit(seconds=.22):
    t = clock(seconds)
    return edge(band(rng.normal(size=len(t)), 3500, 9000) * np.exp(-t * 24), .003, .07)


def glass(note, seconds=1.35):
    t, f = clock(seconds), hz(note)
    y = sum(np.sin(2 * np.pi * f * ratio * t) * amp * np.exp(-t * rate)
            for ratio, amp, rate in [(1, 1, 3.4), (2, .23, 7), (3.01, .05, 12)])
    return edge(y, .012, .25)


# One continuous grid and a composed harmonic arc, instead of restarting at each cut.
chords = [(49, [49, 56, 61, 64], [61, 68, 73, 76, 68, 73, 75, 68]),
          (45, [45, 52, 57, 61], [57, 64, 69, 73, 64, 69, 73, 71]),
          (42, [42, 49, 54, 57], [54, 61, 66, 69, 61, 66, 73, 69]),
          (44, [44, 51, 56, 60], [56, 63, 68, 72, 63, 68, 75, 72])]
for section, (root, chord, pattern) in enumerate(chords):
    start = section * BAR
    for note in chord:
        place(music, start, strings(note, min(BAR + .28, 7.24 - start), True), .043)
    for i, note in enumerate(pattern):
        if i not in (0, 4):
            continue
        at = start + i * BAR / 8
        strength = [1, .64, .82, .70, 1, .65, .88, .78][i]
        # Alternating octave voices make a rhythm that remains audible on a phone.
        place(music, at, strings(note - 12, .95), .09 * strength, -.20)
        # The upper octave is omitted: the bed stays below the voice.
        if i % 2 == 0:
            place(music, at, low(root - 12), .15 if i == 0 else .10)
        if section in (0, 2) and i == 0:
            place(music, at, drum(high=i == 6), .08)

# Land on C-sharp minor together with the full-frame body image.
for note in [49, 56, 61, 64]:
    place(music, 7.16, strings(note, 2.0, True), .048)
place(music, 7.16, drum(), .08)
# No high melodic ping at the handoff.
for i in range(6):
    at = 8.12 + i * BAR / 2
    place(music, at, strings([49, 56, 61, 56][i % 4], 1.0), .045, -.12)
    if i % 4 == 0:
        place(music, at, low(37, .9), .10)

# A short stereo room gives the ensemble depth without a long competing tail.
dry = music.copy()
for delay, gain in [(.037, .13), (.071, .10), (.109, .08), (.173, .06), (.257, .035)]:
    n = round(delay * SR)
    music[n:] += dry[:-n, ::-1] * gain
music = sosfilt(butter(2, 40, btype='highpass', fs=SR, output='sos'), music, axis=0)
music = np.tanh(music * 1.2) / 1.2
music *= .56 / np.max(np.abs(music))
t = np.arange(len(music)) / SR
# Phrase-level dynamics, including a small intake before the final drive.
envelope = np.interp(t, [0, .12, 5.35, 5.7, 6.38, 6.52, 6.7, 7.16, 7.95, 8.2, 13.25, 13.8],
                     [.62, .66, .66, .72, .74, .68, .72, .76, .60, .42, .42, 0])
sf.write(ROOT / 'ember-original-bgm.wav', music * envelope[:, None], SR, subtype='PCM_24')


def sweep(seconds, peak, seed):
    local = np.random.default_rng(seed)
    t = clock(seconds)
    noise = local.normal(size=len(t))
    p = np.clip(t / peak, 0, 1)
    env = np.where(t <= peak, p ** 3, np.exp(-(t - peak) / .12))
    y = (band(noise, 120, 1100) * (1 - p * .5) + band(noise, 1700, 7600) * p * .30) * env
    return edge(y, .014, .12)


def punch(seconds=.55):
    t = clock(seconds)
    y = np.sin(2 * np.pi * (48 * t + 2.6 * (1 - np.exp(-t * 24)))) * np.exp(-t * 9)
    y += band(rng.normal(size=len(t)), 700, 4200) * np.exp(-t * 85) * .22
    return edge(y, .002, .1)


effects = {}
cut = np.zeros((round(.44 * SR), 2))
place(cut, 0, sweep(.44, .19, 20), .45, -.32)
effects['ember-cut'] = cut
lock = np.zeros((round(.96 * SR), 2))
place(lock, 0, sweep(.38, .16, 21), .4, -.6)
place(lock, .065, sweep(.38, .16, 22), .4, .6)
place(lock, .33, punch(), .68)
effects['ember-lock'] = lock
release = np.zeros((round(1.32 * SR), 2))
place(release, 0, sweep(.82, .47, 24), .55, -.5)
place(release, .16, sweep(.75, .38, 25), .45, .5)
place(release, .80, punch(.28), .16)
effects['ember-release'] = release
for name, y in effects.items():
    y *= .63 / np.max(np.abs(y))
    sf.write(ROOT / f'{name}.wav', y, SR, subtype='PCM_24')
print('Original score and motion sounds written.')
