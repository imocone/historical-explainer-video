import test from 'node:test';
import assert from 'node:assert/strict';
import { selectRenderWorkers } from './hyperframes.mjs';

const GiB = 1024 ** 3;
const resources = { duration: 480, fps: 60, width: 1920, height: 1080,
  freeDiskBytes: 100 * GiB, memoryPercent: 60, totalMemoryBytes: 16 * GiB };

test('render keeps native auto workers when the complete frame estimate fits', () => {
  const selected = selectRenderWorkers(resources);
  assert.equal(selected.workers, 'auto');
  assert.ok(selected.requiredBytes > 60 * GiB);
});

test('render streams with one worker when temporary frame storage will not fit', () => {
  const selected = selectRenderWorkers({ ...resources, freeDiskBytes: 20 * GiB });
  assert.equal(selected.workers, 1);
  assert.match(selected.reason, /空间/);
  assert.equal(selectRenderWorkers({ ...resources, duration: 1, freeDiskBytes: 20 * GiB }).workers, 'auto',
    '短片应按自身时长选择，不能只按固定剩余空间切单进程');
});

test('render uses one worker for memory pressure, small RAM, or unknown resource readings', () => {
  for (const changes of [{ memoryPercent: 24 }, { totalMemoryBytes: 8 * GiB },
    { memoryPercent: NaN }, { freeDiskBytes: NaN }]) {
    assert.equal(selectRenderWorkers({ ...resources, ...changes }).workers, 1);
  }
});

test('explicit single worker wins, while invalid modes and dimensions fail clearly', () => {
  assert.equal(selectRenderWorkers({ ...resources, mode: '1' }).workers, 1);
  assert.throws(() => selectRenderWorkers({ ...resources, mode: '8' }), /auto 或 1/);
  assert.throws(() => selectRenderWorkers({ ...resources, duration: 0 }), /时长/);
  assert.throws(() => selectRenderWorkers({ ...resources, width: NaN }), /尺寸/);
});
