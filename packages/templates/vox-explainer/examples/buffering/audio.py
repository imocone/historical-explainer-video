"""Rebuild local voice, original score and motion marks into a separate directory."""
from pathlib import Path
import array
import json
import math
import random
import subprocess
import sys
import wave

ROOT = Path(__file__).resolve().parent
OUTPUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT.parents[4] / 'tmp/vox-buffering-audio'
(OUTPUT / 'assets').mkdir(parents=True, exist_ok=True)
RATE = 48000

def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout

lines = json.loads((ROOT / 'narration.json').read_text())
clips = []
cursor = .7
for index, line in enumerate(lines, 1):
    source = OUTPUT / 'assets' / f'voice-{index:02}.aiff'
    target = source.with_suffix('.wav')
    if not target.exists():
        run('/usr/bin/say', '-v', 'Tingting', '-r', '206', '-o', str(source), line['text'])
        run('ffmpeg', '-v', 'error', '-y', '-i', str(source), '-af',
            'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse,highpass=f=85,loudnorm=I=-17:TP=-2:LRA=7',
            '-ar', str(RATE), '-ac', '1', str(target))
    with wave.open(str(target)) as voice:
        samples = array.array('h', voice.readframes(voice.getnframes()))
    length = len(samples) / RATE
    duration = max(line['min'], length + .48)
    clips.append({**line, 'id': index, 'start': round(cursor, 4),
                  'voiceDuration': length, 'duration': duration, 'file': target.name})
    cursor += duration

duration = math.ceil((cursor + 1.5) * 60) / 60
mix = array.array('f', [0]) * (math.ceil(duration * RATE) + 1)
for clip in clips:
    with wave.open(str(OUTPUT / 'assets' / clip['file'])) as voice:
        samples = array.array('h', voice.readframes(voice.getnframes()))
    start = round(clip['start'] * RATE)
    for i, value in enumerate(samples):
        mix[start + i] += value / 32768 * .82

def note(at, hz, amplitude=.025, length=1.25):
    start = round(at * RATE)
    for i in range(min(round(length * RATE), len(mix) - start)):
        t = i / RATE
        envelope = (1 - math.exp(-t * 150)) * math.exp(-t * 3.1)
        tone = math.sin(t * hz * math.tau) + .24 * math.sin(t * hz * math.tau * 2.005)
        mix[start + i] += amplitude * envelope * tone

def sweep(at, length=.55, amplitude=.035):
    rng = random.Random(round(at * 1000))
    start = round(at * RATE)
    low = 0
    for i in range(min(round(length * RATE), len(mix) - start)):
        low = low * .91 + rng.uniform(-1, 1) * .09
        p = i / (length * RATE)
        mix[start + i] += low * math.sin(p * math.pi) ** 2 * amplitude

# A restrained C6 / Am7 / Fmaj7 / Gsus bed, voiced below narration.
chords = [(130.813, 196, 261.626, 329.628), (110, 164.814, 220, 261.626),
          (87.307, 130.813, 174.614, 220), (98, 146.832, 196, 261.626)]
for i in range(math.ceil(duration / 4)):
    for j, hz in enumerate(chords[(i // 2) % 4]):
        note(i * 4 + j * .45, hz, .012 if j < 2 else .009, 2.1)
starts = {c['key']: c['start'] for c in clips}
for key in ['unfold', 'rewind', 'compare', 'limit', 'conclusion']:
    sweep(starts[key] + .1)
sweep(starts['rewind'] + 1.4, .85, .035)
arrivals = json.loads((ROOT / 'arrivals.json').read_text())
buffer_origin = starts['rewind'] + 3.2
definition_clock = starts['definition'] - buffer_origin
held_clock = definition_clock + (starts['reserve'] - starts['definition']) * .08

def buffer_clock(at):
    if at <= definition_clock:
        return buffer_origin + at
    if at <= held_clock:
        return starts['definition'] + (at - definition_clock) / .08
    return starts['reserve'] + at - held_clock

for convert, delay, cutoff in [
    (lambda at: starts['rule'] + .9 + at, 0, starts['rewind']),
    (buffer_clock, 2, starts['compare']),
    (lambda at: starts['compare'] + .3 + at, 2, starts['limit'])
]:
    for at in sorted(set(arrivals)):
        for j in range(arrivals.count(at)):
            stamp = convert(at) + j * .045
            if stamp < cutoff:
                note(stamp, 520 + j * 85, .024, .16)
    end = delay
    for at in arrivals:
        end = max(end, at)
        stamp = convert(end)
        if stamp < cutoff:
            note(stamp, 185, .013, .10)
        end += 1
for i in range(3):
    note(starts['limit'] + .3 + i, 185, .013, .1)
note(duration - 3, 130.813, .027, 2.8)
note(duration - 2.84, 196, .018, 2.5)
note(duration - 2.68, 261.626, .016, 2.2)
pcm = array.array('h')
for i, value in enumerate(mix):
    t = i / RATE
    fade = min(1, t / .35, max(0, (duration - t) / 1.1))
    pcm.append(round(max(-.98, min(.98, value * fade)) * 32767))
with wave.open(str(OUTPUT / 'assets' / 'narration.wav'), 'w') as output:
    output.setnchannels(1)
    output.setsampwidth(2)
    output.setframerate(RATE)
    output.writeframes(pcm.tobytes())
(OUTPUT / 'timing.json').write_text(json.dumps({'duration': duration, 'clips': clips},
                                           ensure_ascii=False, indent=2))
print(json.dumps({'duration': duration, 'clips': [(c['key'], round(c['start'], 2), round(c['voiceDuration'], 2)) for c in clips]}, ensure_ascii=False))
