"""Render an authored recipe with the original Lemo synthesizer; no network or music."""
import json
from math import gcd
import re
import sys
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
sys.dont_write_bytecode = True
from lemo import sfx as S
from lemo import ink_wash as I, watercolor as W
from importlib.util import spec_from_file_location, module_from_spec

spec = spec_from_file_location('material_recipes', Path(__file__).with_name('build-library.py'))
materials = module_from_spec(spec)
spec.loader.exec_module(materials)
recordings_path = Path(__file__).with_name('recordings')
recordings = json.loads((recordings_path / 'catalog.json').read_text())


def recording(*, name=None, sourceAssetId=None, startSeconds=0, endSeconds=None, directory=Path('.')):
    if sourceAssetId is not None:
        if name is not None or not re.fullmatch(r'SA[0-9]{3}', sourceAssetId):
            raise ValueError('实录来源须为单一本集音频编号')
        file = directory / f'{sourceAssetId}.audio'
    else:
        if name not in recordings:
            raise ValueError(f'未登记实录音效: {name}')
        file = recordings_path / recordings[name]
    with sf.SoundFile(file) as source:
        if not np.isfinite(startSeconds) or (endSeconds is not None and not np.isfinite(endSeconds)):
            raise ValueError('实录裁切时点须为有限值')
        if source.channels not in (1, 2):
            raise ValueError('实录须为单声道或双声道')
        rate = source.samplerate
        start = round(startSeconds * rate)
        end = source.frames if endSeconds is None else round(endSeconds * rate)
        if not 0 <= start < end <= source.frames:
            raise ValueError('实录裁切须位于素材内且保留至少一个采样')
        source.seek(start)
        samples = source.read(end - start, dtype='float32', always_2d=True)
    if rate != S.SR:
        divisor = gcd(S.SR, rate)
        samples = resample_poly(samples, S.SR // divisor, rate // divisor, axis=0)
    materials.smooth_edges(samples)
    return samples[:, 0] if samples.shape[1] == 1 else samples


def occlude(samples, *, atSeconds, durationSeconds, frequency, gain):
    if not all(np.isfinite(value) for value in (atSeconds, durationSeconds, frequency, gain)):
        raise ValueError('遮挡时点、时长、频率与增益须为有限值')
    start = round(atSeconds * S.SR)
    frames = round(durationSeconds * S.SR)
    end = start + frames
    if atSeconds < 0 or frames < 2 or end > len(samples):
        raise ValueError('遮挡变化须位于本层声音内')
    if not 0 < frequency < S.SR / 2 or not 0 <= gain <= 1:
        raise ValueError('遮挡低通频率或衰减增益无效')
    # Filter from the original onset so the tail inherits the same wave and filter state.
    quieter = S.lp(samples, frequency) * gain
    quieter[:start] = samples[:start]
    blend = np.linspace(0, 1, frames)
    blend = blend * blend * (3 - 2 * blend)
    quieter[start:end] = samples[start:end] * (1 - blend) + quieter[start:end] * blend
    return quieter


def apply_gain_envelope(samples, points):
    if not isinstance(points, list) or len(points) < 2:
        raise ValueError('声音音量曲线至少需要两个点')
    times, gains = np.asarray([(point['atSeconds'], point['gain']) for point in points], dtype=float).T
    if (not np.isfinite(times).all() or times[0] < 0 or times[-1] > len(samples) / S.SR
            or np.any(np.diff(times) <= 0)):
        raise ValueError('声音音量曲线的时点须在原素材内严格递增')
    if not np.isfinite(gains).all() or np.any((gains < 0) | (gains > 1)):
        raise ValueError('声音音量曲线的增益须在0到1之间')
    levels = np.interp(np.arange(len(samples)) / S.SR, times, gains)
    samples *= levels[:, None]


def clip_sound(samples, sync, *, startSeconds=0, endSeconds=None, fadeInSeconds=0, fadeOutSeconds=0):
    endSeconds = len(samples) / S.SR if endSeconds is None else endSeconds
    times = (startSeconds, endSeconds, fadeInSeconds, fadeOutSeconds)
    if not all(np.isfinite(value) and value >= 0 for value in times):
        raise ValueError('声音裁切与淡化时间须为非负有限值')
    start, end, fade_in, fade_out = (round(value * S.SR) for value in times)
    start_seconds = start / S.SR
    if not 0 <= start < end <= len(samples) or not start_seconds <= sync < end / S.SR:
        raise ValueError('声音裁切须位于素材内并保留syncSeconds')
    if fade_in + fade_out > end - start:
        raise ValueError('声音淡入和淡出须位于裁切窗口内')
    original_length = len(samples)
    samples = samples[start:end]
    if fade_in:
        ramp = np.sin(np.linspace(0, np.pi / 2, fade_in)) ** 2
        samples[:fade_in] *= ramp[:, None]
    if fade_out:
        ramp = np.sin(np.linspace(0, np.pi / 2, fade_out)) ** 2
        samples[-fade_out:] *= ramp[::-1, None]
    materials.smooth_edges(samples, start=start > 0, end=end < original_length)
    return samples, sync - start_seconds


generators = {name: getattr(S, name) for name in (
    'click', 'clack', 'crash', 'whoosh', 'creak', 'thump', 'step', 'ding', 'pop',
    'quindar', 'rumble', 'ignite', 'roar', 'heartbeat')}
generators.update(paper=materials.paper, woodtap=materials.woodtap, metal=materials.metal,
                  whoosh=materials.whoosh, ding=materials.ding, recording=recording)
generators.update({f'ink-{name}':getattr(I,name) for name in (
    'drip','brush','water_step','splash','skid','sword','cut','splatter','collapse','waterclose','cloth','seal')})
generators.update({f'watercolor-{name}':getattr(W,name) for name in (
    'brush','stamp','wind','chirp','plink','fire','rain','whipbird','swell','airy')})

def synthesize(recipe, directory=Path('.')):
    S._rng = np.random.default_rng(recipe.get('seed', 7))
    I.rng = np.random.default_rng(recipe.get('seed', 7))
    W.rng = np.random.default_rng(recipe.get('seed', 7))
    W.prepare_room()
    layers = []
    if 'sourceFile' in recipe:
        if 'layers' in recipe:
            raise ValueError('专用制声与分层配方只能选择一种')
        custom_spec = spec_from_file_location('authored_sound', directory / recipe['sourceFile'])
        custom = module_from_spec(custom_spec)
        custom_spec.loader.exec_module(custom)
        # Authored local code, just like the authored scene code; not a sandbox.
        x = np.asarray(custom.render(sr=S.SR, rng=np.random.default_rng(recipe.get('seed', 7)),
                                    **recipe.get('parameters', {})), dtype=np.float32)
        layers.append((0, x, 1, 0))
    for layer in recipe.get('layers', []):
        generator = generators[layer['generator']]
        params = dict(layer.get('parameters', {}))
        if generator is recording:
            params['directory'] = directory
        if 'd' in params and (not np.isfinite(params['d']) or params['d'] <= 0):
            raise ValueError('声音时长须为正有限值')
        mono = np.asarray(generator(**params), dtype=np.float32)
        for effect in layer.get('effects', []):
            def process(x):
                kind = effect['type']
                if kind == 'lowpass': return S.lp(x, effect['frequency'])
                if kind == 'highpass': return S.hp(x, effect['frequency'])
                if kind == 'bandpass': return S.bp(x, effect['low'], effect['high'])
                if kind == 'compress': return S.compress(x, **effect.get('parameters', {}))
                if kind == 'limit': return S.limit(x, **effect.get('parameters', {}))
                if kind == 'occlusion': return occlude(x, **effect['parameters'])
                raise ValueError('未知声音处理: ' + kind)
            mono = process(mono) if mono.ndim == 1 else np.stack([process(mono[:,c]) for c in range(2)],1)
        if layer.get('roomWet', 0):
            stereo = W.st(mono) if mono.ndim == 1 else mono
            mono = W.verb(stereo, layer['roomWet'])
        at = layer.get('atSeconds', 0)
        if not np.isfinite(at) or at < 0:
            raise ValueError('组合偏移须为非负有限值')
        layers.append((at, mono, layer.get('gain', 1), layer.get('pan', 0)))
    if not layers:
        raise ValueError('配方至少包含一层声音')
    for _, x, _, _ in layers:
        if x.ndim not in (1, 2) or (x.ndim == 2 and x.shape[1] != 2):
            raise ValueError('制声器须返回单声道或双声道声音')
        if not len(x) or not np.isfinite(x).all():
            raise ValueError('制声结果为空或非有限值')
    length = max(int(at * S.SR) + len(x) for at, x, _, _ in layers)
    output = np.zeros((length, 2), np.float32)
    for at, x, gain, pan in layers:
        if not np.isfinite(gain) or gain <= 0 or not -1 <= pan <= 1:
            raise ValueError('组合增益或声像无效')
        if x.ndim == 1:
            S.add(output, x, at, gain=gain, pan=pan)
        elif x.ndim == 2 and x.shape[1] == 2:
            start = int(at * S.SR)
            left = np.cos((pan + 1) * np.pi / 4) * np.sqrt(2)
            right = np.sin((pan + 1) * np.pi / 4) * np.sqrt(2)
            output[start:start+len(x)] += x * np.array([left,right]) * gain
        else:
            raise ValueError('制声器须返回单声道或双声道声音')
    sync = recipe.get('syncSeconds', 0)
    if not 0 <= sync < len(output) / S.SR:
        raise ValueError('syncSeconds须位于声音内')
    materials.smooth_edges(output)
    # Set headroom on the original signal. Cutting or riding the level may
    # remove its peak, but must not lift the remaining sound.
    peak = float(np.max(np.abs(output)))
    if peak > .32:
        output *= .32 / peak
    if 'gainEnvelope' in recipe:
        apply_gain_envelope(output, recipe['gainEnvelope'])
    if 'clip' in recipe:
        output, sync = clip_sound(output, sync, **recipe['clip'])
    return output, sync

if __name__ == '__main__':
    recipe = json.loads(Path(sys.argv[1]).read_text())
    output, sync = synthesize(recipe, Path(sys.argv[1]).resolve().parent)
    sf.write(sys.argv[2], output, S.SR, subtype='PCM_24')
    print(json.dumps({'durationSeconds':len(output) / S.SR, 'syncSeconds':sync}))
