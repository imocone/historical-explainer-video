import {clamp, route, cameraTrack, screenPoint, layoutLabels, leaderPath} from './geometry.mjs';
import {routeLine} from './route-line.mjs';
export * from './geometry.mjs';
export {routeLine};

// Draw authored lines with the same absolute clock as the scene.
export function createDrawing({node, head, points, closed = false, start = 0,
  duration = 1, until = Infinity, width = 10, dash = [], screenSize = true}) {
  const vertices = closed ? [...points, points[0]] : points;
  const geometry = route(vertices);
  return {
    seek(time, zoom = 1) {
      const progress = duration > 0 ? clamp((time - start) / duration) : Number(time >= start);
      const {point, trail} = geometry.sample(progress);
      const scale = screenSize ? 1 / zoom : 1;
      const visible = progress > 0 && geometry.length > 0 && time < until;
      node.setAttribute('d', trail.map((p, i) => `${i ? 'L' : 'M'}${p.join(' ')}`).join(' ')
        + (closed && progress === 1 ? ' Z' : ''));
      node.setAttribute('fill', 'none');
      node.setAttribute('stroke-width', width * scale);
      node.setAttribute('stroke-dasharray', dash.length ? dash.map(x => x * scale).join(' ') : 'none');
      node.setAttribute('stroke-linecap', 'round');
      node.setAttribute('stroke-linejoin', 'round');
      node.style.opacity = visible ? '1' : '0';
      if (head) {
        const previous = [...trail].reverse().find(p => Math.hypot(p[0] - point[0], p[1] - point[1]) > .001);
        let d = '';
        if (!closed && previous && visible) {
          const angle = Math.atan2(point[1] - previous[1], point[0] - previous[0]);
          const length = Math.min(width * 3.5 * scale, geometry.length * progress);
          const back = [point[0] - Math.cos(angle) * length, point[1] - Math.sin(angle) * length];
          const normal = [-Math.sin(angle) * length * .45, Math.cos(angle) * length * .45];
          d = `M${point} L${back[0] + normal[0]} ${back[1] + normal[1]} L${back[0] - normal[0]} ${back[1] - normal[1]} Z`;
        }
        head.setAttribute('d', d);
        head.style.opacity = d ? '1' : '0';
      }
      return {point, progress};
    }
  };
}

// All times are local seconds, resolved from the existing cue() by the author.
// Nodes are ordinary authored SVG; no second treatment or animation clock.
export function createScene({world, center, camera, routes = [], units = [], labels = [], drawings = []}) {
  const cameraAt = cameraTrack(camera.initial, camera.moves ?? []);
  const paths = new Map(routes.map(item => [item.id, {...item, geometry: route(item.points)}]));
  const strokes = drawings.map(createDrawing);
  const measure = node => {
    const box = node.getBBox();
    return {width: box.width, height: box.height, boxOffset: [box.x, box.y]};
  };
  return {
    layout({time, bounds, obstacles, gap}) {
      const pose = cameraAt(time);
      return layoutLabels(labels.filter(label => time >= (label.from ?? 0) && time < (label.until ?? Infinity))
        .map(label => ({...label, ...measure(label.node),
        point: screenPoint(label.point, pose, center)})), {bounds, obstacles, gap});
    },
    seek(time) {
      const pose = cameraAt(time);
      world.setAttribute('transform', `translate(${center}) scale(${pose[2]}) translate(${-pose[0]} ${-pose[1]})`);
      for (const drawing of strokes) drawing.seek(time, pose[2]);
      const sampled = new Map();
      for (const path of paths.values()) {
        const progress = path.duration > 0 ? clamp((time - path.start) / path.duration) : Number(time >= path.start);
        const sample = path.geometry.sample(progress);
        sampled.set(path.id, sample.point);
        if (path.node) {
          const ring = routeLine(sample.trail, path.width ?? 12, path.intent ? 'arrow' : 'trail');
          path.node.setAttribute('d', ring ? ring.map((p, i) => `${i ? 'L' : 'M'}${p.join(' ')}`).join(' ') + ' Z' : '');
          path.node.style.opacity = time >= path.start && time < (path.until ?? Infinity) ? '1' : '0';
        }
      }
      for (const unit of units) {
        let point = unit.point;
        for (const id of unit.routes ?? []) {
          const path = paths.get(id);
          if (!path) throw new Error(`部队引用未知路线：${id}`);
          if (path.intent) throw new Error('意图线不能移动部队');
          if (time >= path.start) point = sampled.get(id);
        }
        unit.node.setAttribute('transform', `translate(${point})${unit.screenSize ? ` scale(${1 / pose[2]})` : ''}`);
        unit.node.style.opacity = time >= (unit.from ?? 0) && time < (unit.until ?? Infinity) ? '1' : '0';
        if (unit.label) unit.label.setAttribute('transform', `${unit.screenSize ? '' : `scale(${1 / pose[2]}) `}translate(${unit.labelOffset ?? [0, -65]})`);
      }
      for (const label of labels) {
        const point = screenPoint(label.point, pose, center);
        const x = point[0] + (label.offset?.[0] ?? 0), y = point[1] + (label.offset?.[1] ?? 0);
        label.node.setAttribute('transform', `translate(${x} ${y})`);
        label.node.style.opacity = time >= (label.from ?? 0) && time < (label.until ?? Infinity) ? '1' : '0';
        if (label.leader) {
          const box = label.node.getBBox();
          label.leader.style.opacity = label.node.style.opacity;
          label.leader.setAttribute('d', leaderPath(point, {x: x + box.x, y: y + box.y,
            width: box.width, height: box.height}));
        }
      }
      return {camera: pose, positions: sampled};
    }
  };
}
