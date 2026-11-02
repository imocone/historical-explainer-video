"""Original ten-second piano cue, with recorded CC0 Kawai piano samples.

Run with node packages/runtime-config.mjs python compose.py.
No audio from the supplied reference recording is used in the composition.
The two-chord/seven-note idea was discussed with AGY; timing, voicing,
performance, sample playback and mixing are authored here.
"""
from pathlib import Path
from fractions import Fraction
import subprocess
import sys
import tempfile
import re
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, resample_poly, fftconvolve

ROOT = Path(__file__).resolve().parent
BANK = ROOT
SR = 48000
N = 12 * SR

# Seven-note phrase, with a deliberately unhurried opening and shorter answer.
# Times are musical phrasing choices, not image-cut synchronization.
MELODY = [
    (0.48, 60, 1.52, .58),   # C4
    (1.64, 65, 1.34, .67),   # F4
    (2.66, 67, 1.20, .60),   # G4
    (3.70, 68, 1.67, .70),   # Ab4
    (5.13, 72, 1.08, .66),   # C5
    (5.96, 70, 1.02, .53),   # Bb4
    (6.74, 68, 2.25, .48),   # Ab4, final note
]
# Two open voicings. The G melody supplies the first chord's ninth.
# The second voicing introduces the major seventh without a crowded midrange.
SUPPORT = [
    (.10, 41, 3.65, .30), (.16, 48, 3.58, .22), (.23, 56, 3.45, .17),
    (3.83, 37, 4.20, .30), (3.90, 44, 4.10, .19),
    (3.98, 53, 3.95, .22), (4.07, 60, 3.83, .14),
]

def smooth(x):
    x = np.clip(x, 0, 1)
    return x*x*(3-2*x)

regions = []
for section in (BANK / 'piano.sfz').read_text().split('<region>')[1:]:
    # Read only the soft layer, stopping before the high-velocity group.
    values = dict(re.findall(r'(\w+)=([^\s]+)', section.split('<group>')[0]))
    if values.get('sample', '').endswith('vL.flac'):
        regions.append(values)

cache = {}
def piano_note(midi, hold, velocity):
    r = next(r for r in regions if int(r['lokey']) <= midi <= int(r['hikey']))
    key = r['sample']
    if key not in cache:
        source, rate = sf.read(BANK / key, always_2d=True)
        cache[key] = (source, rate)
    source, rate = cache[key]
    ratio = Fraction(SR / rate / 2**((midi-int(r['pitch_keycenter']))/12)).limit_denominator(12000)
    x = resample_poly(source, ratio.numerator, ratio.denominator, axis=0)
    # Library files are normalized individually. Balance their initial energy,
    # retaining the recorded stereo image, inharmonicity and natural decay.
    initial = x[:int(.30*SR)]
    rms = max(float(np.sqrt(np.mean(initial**2))), 1e-6)
    x *= .10/rms
    t = np.arange(len(x))/SR
    # Keep the hammer attack; only remove possible discontinuity at the edge.
    env = smooth(t/.003) * np.exp(-np.maximum(t-hold, 0)/.40)
    env *= 1-smooth((t-(len(x)/SR-.025))/.025)
    x *= (env * velocity**1.35)[:,None]
    cutoff = min(float(r.get('cutoff', 6500)), 4600 + 1900*velocity)
    x = sosfilt(butter(2, cutoff, fs=SR, output='sos'), x, axis=0)
    return x

def performance(events):
    out = np.zeros((N,2))
    for start,note,hold,vel in events:
        x = piano_note(note,hold,vel)
        offset = round(start*SR)
        take = min(len(x),N-offset)
        out[offset:offset+take] += x[:take]
    return out

lead = performance(MELODY)
support = performance(SUPPORT)
dry = lead + support
dry = sosfilt(butter(2, 48, btype='highpass', fs=SR, output='sos'),dry,axis=0)
# Compact room: sparse early reflections and a low-level diffuse tail.
# No pitch doubling, whooshes, beats, or replacement of the recorded attack.
early = np.zeros_like(dry)
for delay,gain in [(.023,.11),(.041,.08),(.067,.055),(.091,.035)]:
    d = int(delay*SR)
    early[d:] += dry[:-d,::-1] * gain
rng = np.random.default_rng(90626)
tail = np.zeros_like(dry)
rt = np.arange(int(2.1*SR))/SR
for c in range(2):
    ir = sosfilt(butter(2, 3100, fs=SR, output='sos'),rng.normal(size=len(rt)))
    ir = sosfilt(butter(2, 240, btype='highpass', fs=SR, output='sos'),ir)
    ir *= np.exp(-rt/.37)*smooth((rt-.026)/.025)
    ir /= np.sqrt(np.sum(ir*ir))
    tail[:,c] = fftconvolve(.8*dry[:,c]+.2*dry[:,1-c],ir)[:N]
mix = dry + early + .13*tail
# Leave the final recorded note intact, then release the cue across the
# existing exit transition. Every stem uses the same sample-accurate envelope.
t = np.arange(N)/SR
exit_env = (1-smooth((t-8.18)/1.76))*smooth(t/.055)
mix *= exit_env[:,None]
mix = mix[:10*SR]
peak = float(np.max(abs(mix)))
mix *= .65/peak
output = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'memory-piano.wav'
# Preserve the accepted two-stage PCM24 quantization and static -4.39 dB gain.
with tempfile.TemporaryDirectory(prefix='memory-piano-') as temp:
    raw = Path(temp) / 'mix.wav'
    sf.write(raw, mix, SR, subtype='PCM_24')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(raw),
                    '-af', 'volume=-4.39dB', '-c:a', 'pcm_s24le', str(output)], check=True)
print(f'Wrote {output}: ten seconds, 48 kHz stereo PCM24')
