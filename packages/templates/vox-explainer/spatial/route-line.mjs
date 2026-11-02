// Screen-space outline; geographic travel and the marker remain owned by Turf.
// Both lines taper; only an intended direction has an arrowhead.
export function routeLine(points, width, lineType) {
  const path = [];
  for (const p of points) {
    const previous = path.at(-1);
    const step = previous ? Math.hypot(p[0] - previous.p[0], p[1] - previous.p[1]) : 0;
    if (!previous || step > 0.01) path.push({ p, distance: (previous?.distance ?? 0) + step });
  }
  const total = path.at(-1)?.distance ?? 0;
  if (total < 2) return null;
  const at = distance => {
    const i = Math.max(1, path.findIndex(p => p.distance >= distance));
    const a = path[i - 1], b = path[i];
    const t = (distance - a.distance) / (b.distance - a.distance);
    return a.p.map((v, axis) => v + (b.p[axis] - v) * t);
  };
  const arrow = lineType === 'arrow';
  const headLength = arrow ? Math.min(width * 2.6, total * 0.55) : 0;
  const neckDistance = total - headLength;
  const neck = at(neckDistance), tip = at(total);
  const body = [...path.filter(p => p.distance < neckDistance), { p: neck, distance: neckDistance }];
  const unit = (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
    return [dx / length, dy / length];
  };
  const direction = arrow ? unit(neck, tip) : unit(body.at(-2).p, neck);
  const normal = [-direction[1], direction[0]];
  const scale = Math.min(1, total / (width * 3));
  const left = [], right = [];
  for (const [i, { p, distance }] of body.entries()) {
    const before = i ? unit(body[i - 1].p, p) : unit(p, body[i + 1].p);
    const after = i < body.length - 1 ? unit(p, body[i + 1].p) : direction;
    const nx = -before[1] - after[1], ny = before[0] + after[0];
    const norm = Math.hypot(nx, ny);
    const n = norm > 0.001 ? [nx / norm, ny / norm] : [-after[1], after[0]];
    const halfWidth = width * scale * (0.5 - 0.28 * distance / neckDistance);
    const offset = halfWidth / Math.max(0.5, n[0] * -after[1] + n[1] * after[0]);
    left.push([p[0] + n[0] * offset, p[1] + n[1] * offset]);
    right.push([p[0] - n[0] * offset, p[1] - n[1] * offset]);
  }
  const headWidth = width * scale * 0.95;
  const head = arrow ? [[neck[0] + normal[0] * headWidth, neck[1] + normal[1] * headWidth],
    tip, [neck[0] - normal[0] * headWidth, neck[1] - normal[1] * headWidth]] : [];
  const ring = [...left, ...head, ...right.reverse()];
  return [...ring, ring[0]];
}
