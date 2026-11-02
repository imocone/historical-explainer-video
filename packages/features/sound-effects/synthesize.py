"""Render an authored recipe with the original Lemo synthesizer; no network or music."""
import json
import sys
from pathlib import Path
import numpy as np
import soundfile as sf
sys.dont_write_bytecode = True
from lemo import sfx as S
from lemo import ink_wash as I, watercolor as W
from importlib.util import spec_from_file_location, module_from_spec

spec = spec_from_file_location('material_recipes', Path(__file__).with_name('build-library.py'))
materials = module_from_spec(spec)
spec.loader.exec_module(materials)
generators = {name: getattr(S, name) for name in (
    'click', 'clack', 'crash', 'whoosh', 'creak', 'thump', 'step', 'ding', 'pop',
    'quindar', 'rumble', 'ignite', 'roar', 'heartbeat')}
generators.update(paper=materials.paper, woodtap=materials.woodtap, metal=materials.metal)
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
    # Leave room for voice and music without normalizing away authored dynamics.
    peak = float(np.max(np.abs(output)))
    if peak > .32:
        output *= .32 / peak
    return output

if __name__ == '__main__':
    recipe = json.loads(Path(sys.argv[1]).read_text())
    output = synthesize(recipe, Path(sys.argv[1]).resolve().parent)
    sync = recipe.get('syncSeconds', 0)
    if not 0 <= sync < len(output) / S.SR:
        raise ValueError('syncSeconds须位于声音内')
    sf.write(sys.argv[2], output, S.SR, subtype='PCM_24')
    print(json.dumps({'durationSeconds':len(output) / S.SR, 'syncSeconds':sync}))
