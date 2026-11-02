import test from 'node:test';
import assert from 'node:assert/strict';
import {route, cameraTrack, calibrateTerrain, geographicFrame, layoutLabels, screenPoint, leaderPath} from './geometry.mjs';
import {createScene, createDrawing} from './scene.mjs';
import {geographicLayers} from './geography.mjs';

const node = () => ({style: {}, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }});

test('离线海陆水系先裁取再投影，不把极区数据带入局部地形', async () => {
  const layers = await geographicLayers({bounds: [[115, 30], [140, 50]],
    viewport: {x: 0, y: 0, width: 1920, height: 1080}});
  for (const paths of Object.values(layers)) {
    assert.ok(paths.length > 0);
    for (const d of paths) {
      assert.match(d, /^M/); assert.doesNotMatch(d, /NaN|Infinity/);
      for (const match of d.matchAll(/[ML]([^MLZ]+)/g)) {
        const [x, y] = match[1].trim().split(/\s+/).map(Number);
        assert.ok(x >= -1e-6 && x <= 1920 + 1e-6 && y >= -1e-6 && y <= 1080 + 1e-6);
      }
    }
  }
  const islands = await geographicLayers({bounds: [[170, -22], [190, -12]],
    viewport: {x: 0, y: 0, width: 1000, height: 1000}, layers: ['land']});
  const xs = islands.land.flatMap(d => [...d.matchAll(/[ML]([^MLZ]+)/g)].map(m => Number(m[1].trim().split(/\s+/)[0])));
  assert.ok(xs.some(x => x < 500) && xs.some(x => x > 500), '日期线两侧岛屿必须同时保留');
});

test('同一路径带动兵牌和轨迹，回跳恢复同一位置；意图线不移动兵牌', () => {
  const world = node(), trail = node(), force = node(), label = node();
  const scene = createScene({world, center: [0, 0], camera: {initial: [0, 0, 2]},
    routes: [{id: 'r', points: [[0, 0], [100, 0], [100, 100]], start: 1, duration: 4, node: trail}],
    units: [{node: force, label, point: [0, 0], routes: ['r'], screenSize: true}]});
  assert.deepEqual(scene.seek(4).positions.get('r'), [100, 50]);
  assert.equal(force.attributes.transform, 'translate(100,50) scale(0.5)');
  const state = JSON.stringify([world, trail, force, label]);
  scene.seek(0); assert.equal(force.attributes.transform, 'translate(0,0) scale(0.5)');
  scene.seek(4); assert.equal(JSON.stringify([world, trail, force, label]), state);
  assert.deepEqual(route([[0, 0], [100, 0], [100, 100]]).sample(.75).trail.at(-1), [100, 50]);
  const invalid = createScene({world, center: [0, 0], camera: {initial: [0, 0, 1]},
    routes: [{id: 'plan', points: [[0, 0], [100, 0]], start: 0, duration: 1, intent: true}],
    units: [{node: force, point: [0, 0], routes: ['plan']}]});
  assert.throws(() => invalid.seek(1), /意图线不能移动/);
});

test('镜头中途衔接连续，定位锚点与方向一致', () => {
  const at = cameraTrack([0, 0, 1], [{start: 0, duration: 4, to: [100, 100, 2]},
    {start: 2, duration: 2, to: [50, 50, 1]}]);
  assert.deepEqual(at(2), [50, 50, 1.5]); assert.deepEqual(at(4), [50, 50, 1]);
  assert.deepEqual(at(0), [0, 0, 1]);
  const anchors = [{geo: [120, 40], point: [0, 0]}, {geo: [121, 40], point: [100, 20]},
    {geo: [120, 41], point: [30, -100]}];
  const project = calibrateTerrain(anchors);
  for (const anchor of anchors) assert.ok(project(anchor.geo).every((x, i) => Math.abs(x - anchor.point[i]) < 1e-8));
  const flat = geographicFrame([[120, 40], [121, 41]], {x: 0, y: 0, width: 100, height: 100});
  assert.ok(flat([121, 41])[0] > flat([120, 40])[0]);
  assert.ok(flat([121, 41])[1] < flat([120, 40])[1]);
});

test('说明线按真实长度绘制，箭头贴线头，回跳与镜头缩放不留旧状态', () => {
  const line = node(), head = node();
  const drawing = createDrawing({node: line, head, points: [[0, 0], [100, 0], [100, 100]],
    start: 1, duration: 4, until: 7, width: 4, dash: [12, 8]});
  assert.deepEqual(drawing.seek(4, 2).point, [100, 50]);
  assert.match(head.attributes.d, /^M100,50 /);
  assert.equal(line.attributes['stroke-width'], 2);
  assert.equal(line.attributes['stroke-dasharray'], '6 4');
  const state = JSON.stringify([line, head]);
  drawing.seek(8); assert.equal(line.style.opacity, '0'); assert.equal(head.style.opacity, '0');
  drawing.seek(0); assert.equal(head.attributes.d, '');
  drawing.seek(4, 2); assert.equal(JSON.stringify([line, head]), state);
  const scene = createScene({world: node(), center: [0, 0], camera: {initial: [0, 0, 2]},
    drawings: [{node: line, points: [[0, 0], [100, 0]], width: 6}]});
  scene.seek(.5); assert.equal(line.attributes.d, 'M0 0 L50 0');
  assert.equal(line.attributes['stroke-width'], 3);
});

test('圈线完成才闭合，重复点或零长度线不会留下无效箭头', () => {
  const line = node(), head = node();
  const ring = createDrawing({node: line, points: [[0, 0], [100, 0], [100, 100]], closed: true});
  ring.seek(.5); assert.doesNotMatch(line.attributes.d, /Z/);
  ring.seek(1); assert.match(line.attributes.d, / Z$/);
  const zero = createDrawing({node: line, head, points: [[10, 20], [10, 20]]});
  zero.seek(1); assert.equal(line.style.opacity, '0'); assert.equal(head.attributes.d, '');
  const repeated = createDrawing({node: line, head, points: [[0, 0], [0, 0], [100, 0]]});
  repeated.seek(1); assert.match(head.attributes.d, /^M100,0 /);
  assert.doesNotMatch(head.attributes.d, /NaN|Infinity/);
});

test('字组按真实边框避让，无法避让时保留冲突，不隐字或挪地点', () => {
  const label = {id: 'a', point: [100, 100], width: 100, height: 50, boxOffset: [-50, -45]};
  const bounds = {x: 0, y: 0, width: 500, height: 500};
  const result = layoutLabels([label, {...label, id: 'b'}], {bounds});
  assert.ok(result.every(item => !item.collisions && !item.outside));
  const blocked = layoutLabels([{...label, offsets: [[0, 0]]}], {bounds, obstacles: [{x: 0, y: 0, width: 500, height: 500}]});
  assert.equal(blocked[0].collisions, 1); assert.deepEqual(label.point, [100, 100]);
  const name = {...node(), getBBox: () => ({x: -50, y: -45, width: 100, height: 50})}, leader = node();
  const scene = createScene({world: node(), center: [0, 0], camera: {initial: [0, 0, 1]},
    labels: [{...label, node: name, leader, until: 2}]});
  scene.seek(3); assert.equal(leader.style.opacity, '0');
  scene.seek(1); assert.equal(leader.style.opacity, '1');
  assert.equal(scene.layout({time: 3, bounds}).length, 0);
});

test('旁图与文字连线从外缘收口，镜头缩放后仍指向原地点', () => {
  const box = {x: 100, y: 100, width: 200, height: 80};
  assert.equal(leaderPath([400, 140], box), 'M308 140 L400 140');
  assert.equal(leaderPath([0, 140], box), 'M92 140 L0 140');
  assert.equal(leaderPath([200, 0], box), 'M200 92 L200 0');
  assert.equal(leaderPath([200, 300], box), 'M200 188 L200 300');
  assert.equal(leaderPath([200, 140], box), '');
  assert.equal(leaderPath([305, 140], box), '');
  const target = screenPoint([40, 60], [100, 100, .5], [600, 300]);
  assert.equal(leaderPath(target, box).split(' L')[1], '570 280');
  const diagonal = leaderPath([400, 250], box).match(/^M([\d.]+) ([\d.]+) L400 250$/);
  assert.ok(diagonal && Number(diagonal[1]) > 300 && Number(diagonal[2]) > 180);
  const name = {...node(), getBBox: () => ({x: -50, y: -40, width: 100, height: 50})}, leader = node();
  const scene = createScene({world: node(), center: [0, 0],
    camera: {initial: [0, 0, 1], moves: [{start: 0, duration: 2, to: [0, 0, 2]}]},
    labels: [{node: name, leader, point: [100, 100], offset: [120, 0], until: 3}]});
  scene.seek(0);
  assert.equal(leader.attributes.d, 'M162 100 L100 100', '默认引线须停在字组外，不能穿进文字');
  scene.seek(2);
  assert.equal(leader.attributes.d, 'M262 200 L200 200', '镜头移动后字组保持屏幕大小，引线跟随真实位置');
  scene.seek(4); assert.equal(leader.style.opacity, '0');
  scene.seek(0); assert.equal(leader.attributes.d, 'M162 100 L100 100');
  assert.equal(leader.style.opacity, '1');
});
