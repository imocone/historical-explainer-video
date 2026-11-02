export const clamp = value => Math.max(0, Math.min(1, value));
export const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((value, i) => value + (b[i] - value) * t);

// One sampled path owns both the moving object and the visible trail.
export function route(points) {
  if (points.length < 2 || points.some(p => p.length !== 2 || p.some(v => !Number.isFinite(v))))
    throw new Error('路线需要至少两个有效平面坐标');
  const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  const total = lengths.reduce((a, b) => a + b, 0);
  const sample = progress => {
    let remaining = total * clamp(progress);
    const trail = [points[0]];
    for (let i = 0; i < lengths.length; i++) {
      if (remaining <= lengths[i] || i === lengths.length - 1) {
        const point = mix(points[i], points[i + 1], lengths[i] ? remaining / lengths[i] : 0);
        return {point, trail: [...trail, point]};
      }
      remaining -= lengths[i];
      trail.push(points[i + 1]);
    }
  };
  return {length: total, sample};
}

// Each new move starts at the actual pose at that instant, including overlapping moves.
export function cameraTrack(initial, moves) {
  const events = [];
  const at = time => {
    let pose = initial;
    for (const event of events) {
      if (time < event.start) break;
      pose = mix(event.from, event.to, event.duration > 0 ? smooth((time - event.start) / event.duration) : 1);
    }
    return pose;
  };
  for (const move of [...moves].sort((a, b) => a.start - b.start)) {
    if (!(move.to[2] > 0) || move.duration < 0) throw new Error('镜头倍率须为正，时长须非负');
    events.push({...move, from: at(move.start)});
  }
  return at;
}

export const screenPoint = (point, camera, center) => [
  center[0] + (point[0] - camera[0]) * camera[2],
  center[1] + (point[1] - camera[1]) * camera[2]
];

// Screen-space connector: stop outside the measured label/inset, point at its subject.
export function leaderPath(point, box, {gap = 8} = {}) {
  const edge = [Math.max(box.x, Math.min(box.x + box.width, point[0])),
    Math.max(box.y, Math.min(box.y + box.height, point[1]))];
  const distance = Math.hypot(point[0] - edge[0], point[1] - edge[1]);
  if (distance <= gap) return '';
  const start = edge.map((value, i) => value + (point[i] - value) * gap / distance);
  return `M${start.join(' ')} L${point.join(' ')}`;
}

const overlap = (a, b, gap) => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
  && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;

// Author-selected offsets stay fixed within a shot. This reports conflicts instead
// of moving geographic anchors, hiding necessary names or shrinking their type.
export function layoutLabels(labels, {bounds, obstacles = [], gap = 12}) {
  const placed = [];
  return labels.map(label => {
    const choices = label.offsets ?? [[0, -70], [0, 60], [120, 0], [-120, 0]];
    const options = choices.map(offset => {
      const origin = label.boxOffset ?? [-label.width / 2, -label.height / 2];
      const box = {x: label.point[0] + offset[0] + origin[0],
        y: label.point[1] + offset[1] + origin[1], width: label.width, height: label.height};
      const outside = Math.max(0, bounds.x - box.x) + Math.max(0, bounds.y - box.y)
        + Math.max(0, box.x + box.width - bounds.x - bounds.width)
        + Math.max(0, box.y + box.height - bounds.y - bounds.height);
      const collisions = [...obstacles, ...placed].filter(other => overlap(box, other, gap)).length;
      return {id: label.id, offset, box, collisions, outside, score: outside * 1000 + collisions};
    });
    const result = options.reduce((best, option) => option.score < best.score ? option : best);
    placed.push(result.box);
    return result;
  });
}

// Mercator is only a geographic skeleton. An oblique terrain image needs the
// three-point calibration below; image pixels never establish historical facts.
export const mercator = ([longitude, latitude]) => {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(latitude) >= 85.051129)
    throw new Error('经纬度超出墨卡托可用范围');
  return [longitude * Math.PI / 180, -Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360))];
};
export function geographicFrame(bounds, viewport) {
  const sw = mercator(bounds[0]), ne = mercator(bounds[1]);
  if (!(ne[0] > sw[0] && sw[1] > ne[1])) throw new Error('地理范围须按西南、东北排列；跨日期线先统一经度');
  const scale = Math.min(viewport.width / (ne[0] - sw[0]), viewport.height / (sw[1] - ne[1]));
  return coordinate => {
    const point = mercator(coordinate);
    return [viewport.x + viewport.width / 2 + (point[0] - (sw[0] + ne[0]) / 2) * scale,
      viewport.y + viewport.height / 2 + (point[1] - (sw[1] + ne[1]) / 2) * scale];
  };
}
export function calibrateTerrain(anchors) {
  if (anchors.length !== 3) throw new Error('地形定位需要三个不共线的地理与图内锚点');
  const [a, b, c] = anchors.map(anchor => mercator(anchor.geo));
  const determinant = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
  if (Math.abs(determinant) < 1e-12) throw new Error('定位锚点不能共线');
  return coordinate => {
    const p = mercator(coordinate), x = p[0] - a[0], y = p[1] - a[1];
    const u = (x * (c[1] - a[1]) - y * (c[0] - a[0])) / determinant;
    const v = ((b[0] - a[0]) * y - (b[1] - a[1]) * x) / determinant;
    return anchors[0].point.map((value, i) => value + u * (anchors[1].point[i] - value) + v * (anchors[2].point[i] - value));
  };
}

export function geographicPath(geometry, project) {
  const line = (points, closed = false) => points.length
    ? points.map((p, i) => `${i ? 'L' : 'M'}${project(p).join(' ')}`).join(' ') + (closed ? ' Z' : '') : '';
  switch (geometry.type) {
    case 'LineString': return line(geometry.coordinates);
    case 'MultiLineString': return geometry.coordinates.map(p => line(p)).join(' ');
    case 'Polygon': return geometry.coordinates.map(p => line(p, true)).join(' ');
    case 'MultiPolygon': return geometry.coordinates.flatMap(p => p.map(r => line(r, true))).join(' ');
    default: throw new Error(`不支持的地理线面：${geometry.type}`);
  }
}
