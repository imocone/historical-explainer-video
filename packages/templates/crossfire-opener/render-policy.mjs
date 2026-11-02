import { VIDEO_SPEC } from "../../video-spec.mjs";

export const CROSS_FIRE = Object.freeze({
  durationSeconds: 8,
  narrationStartMs: 100,
  maxNarrationMs: 5380,
  cuts: [0, 1.85, 3.78],
  crossingStart: 5.48,
  bodyStart: 6.42,
  settledAt: 7.16,
  exitTransition: Object.freeze({ type: "crossfire-open", durationInFrames: Math.round(1.58 * VIDEO_SPEC.fps) })
});

export const phase = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
export const mix = (a, b, p) => a + (b - a) * p;
export const ease = (t, a, b) => { const p = phase(t, a, b); return p * p * (3 - 2 * p); };
export const openingAt = t => { const p = phase(t, 6.62, 7.16); return p * p * p * (4 - 3 * p); };
const nudge = (t, start, duration) => {
  const p = phase(t, start, start + duration);
  if (p < .20) return .10 * (p / .20) ** 3;
  if (p < .38) return .10 + .65 * (p - .20) / .18;
  return .75 + .25 * (1 - (1 - (p - .38) / .62) ** 5);
};
const strokes = [
  { x: 975, y: 440, w: 1570, h: 350, angle: 18, from: -1, delay: 0 },
  { x: 965, y: 530, w: 1640, h: 360, angle: -25, from: 1, delay: .025 },
  { x: 990, y: 835, w: 1700, h: 330, angle: -3, from: 1, delay: .05 }
];

export const platePose = (t, i) => {
  const spec = strokes[i], p = phase(t, 5.48 + spec.delay, 5.95 + spec.delay);
  const arrival = nudge(t, 5.48 + spec.delay, .47) + Math.sin(phase(p, .68, 1) * Math.PI) * .0038;
  const drive = nudge(t, 6.42, .24), open = openingAt(t), preload = ease(t, 6.26, 6.42);
  const release = phase(open, i === 0 ? .06 : .13, i === 0 ? .82 : .90), exit = release * release * (3 - 2 * release);
  let x = spec.x + spec.from * (1920 + spec.w) * (1 - arrival), y = spec.y + 45 * (1 - arrival) * (i === 1 ? -1 : 1);
  let angle = spec.angle + (1 - arrival) * (i === 1 ? -14 : i === 0 ? -9 : 9), w = spec.w, h = spec.h;
  if (i === 1) {
    x = mix(x + 46 * preload * (1 - drive), 960, open); y = mix(y, 540, open);
    angle = mix(angle - 1.65 * preload * (1 - drive), 0, open);
    w = mix(w * (1 + .012 * preload * (1 - drive)), 1924, open);
    h = mix(h * (1 - .045 * preload * (1 - drive)), 1084, open);
  } else {
    const direction = i === 0 ? 1 : -1, travel = direction * ((1920 + spec.w) * exit - 24 * preload * (1 - exit));
    x += Math.cos(spec.angle * Math.PI / 180) * travel;
    y += Math.sin(spec.angle * Math.PI / 180) * travel;
    angle += direction * 1.2 * exit * (1 - open);
  }
  return { x, y, angle, w, h, open, drive };
};

// The source is the actual first body scene, with its own camera and media clock.
// Its aperture and the opener's erased region share the same plate geometry.
export const incomingCrossfirePresentation = ({ frame, durationInFrames }) => {
  const t = 8 - (durationInFrames - frame) / VIDEO_SPEC.fps;
  if (t >= CROSS_FIRE.settledAt) return { opacity: 1 };
  const { x, y, angle, w, h, open, drive } = platePose(t, 1);
  if (drive <= 0) return { opacity: 0 };
  const track = w * (1 - drive), cut = Math.min(28, h * .085) * (1 - open);
  const left = -w / 2 + track, topLeft = Math.max(left, -w / 2 + cut);
  const topRight = w / 2, bottomRight = w / 2 - cut, offsetY = 210 * (1 - open);
  // Clip the trapezoid to the entering rectangular body window.
  const points = [[topLeft, -h / 2], [topRight, -h / 2], [bottomRight, h / 2], [left, h / 2]];
  if (left > bottomRight) points[2] = points[3] = [left, -h / 2 + (topRight - left) / cut * h];
  const polygon = points.map(([px, py]) => `${px - track + 960}px ${py + 540 - offsetY}px`).join(",");
  return { opacity: 1, clipPath: `polygon(${polygon})`, transformOrigin: "center",
    transform: `translate(${x - 960}px,${y - 540}px) rotate(${angle}deg) translate(${track}px,${offsetY}px)` };
};
