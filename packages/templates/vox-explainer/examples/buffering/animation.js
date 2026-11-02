const timing = __TIMING__;
const arrivals = __ARRIVALS__;
const schedule = __SCHEDULE__;
const playback = __PLAYBACK__;
const starts = Object.fromEntries(timing.clips.map((clip, i) => [clip.key, cue(`M${String(i + 1).padStart(3, '0')}`)]));
const S = key => starts[key];
const $ = id => select(`#${id}`);
const clamp = x => Math.max(0, Math.min(1, x));
const lerp = (a, b, p) => a + (b - a) * p;
const ease = p => {p = clamp(p); return p * p * p * (10 + p * (-15 + 6 * p));};
const out = p => 1 - (1 - clamp(p)) ** 4;
const phase = (t, at, duration) => clamp((t - at) / duration);
const gate = (t, start, end, fade = .5) => ease(phase(t, start, fade)) * (1 - ease(phase(t, end, fade)));
const cache = new WeakMap();
const set = (el, attrs) => {
  const old = cache.get(el) ?? {};
  for (const [key, raw] of Object.entries(attrs)) {
    const value = typeof raw === 'number' ? Math.round(raw * 1000) / 1000 : raw;
    if (old[key] !== value) {el.setAttribute(key, value); old[key] = value;}
  }
  cache.set(el, old);
};
const pos = (el, x, y, scale = 1, rotation = 0) => set(el, {transform: `translate(${x.toFixed(3)} ${y.toFixed(3)}) rotate(${rotation.toFixed(3)}) scale(${scale.toFixed(4)})`});
const alpha = (id, value) => set($(id), {opacity: clamp(value)});
const text = (id, value) => {const element = $(id);if (element.textContent !== value) element.textContent = value;};
const ns = 'http://www.w3.org/2000/svg';
const make = (tag, attrs, parent) => {const el = document.createElementNS(ns, tag);set(el, attrs);parent.append(el);return el;};

const frames = arrivals.map((_, i) => $(`frame-${i}`));
const movieParts = ['main-movie', 'top-movie', 'bottom-movie'].map(id => {
  const g = $(id), one = selector => g.querySelector(selector);
  return {g, back: one('.wheel-back'), front: one('.wheel-front'), bike: one('.bicycle'),
    near: one('.leg-near'), far: one('.leg-far'), shoe: one('.shoe'),
    scarf: one('.scarf'), land: one('.far-land'), trees: one('.trees'), road: one('.road-marks'),
    loading: one('.loading'), spinner: one('.spinner')};
});

function paintMovie(parts, played, loading, time) {
  const angle = played * Math.PI * 2 * .88;
  const foot = a => [11 + 21 * Math.cos(a), 28 + 21 * Math.sin(a)];
  const leg = (hip, target, bend) => {
    const mx = (hip[0] + target[0]) / 2, my = (hip[1] + target[1]) / 2;
    return `M${hip[0]} ${hip[1]}Q${mx + bend} ${my - 9} ${target[0]} ${target[1]}`;
  };
  const near = foot(angle), far = foot(angle + Math.PI);
  set(parts.back, {transform: `translate(-68 28) rotate(${played * 154})`});
  set(parts.front, {transform: `translate(68 28) rotate(${played * 154})`});
  set(parts.near, {d: leg([-31, -69], near, 31)});
  set(parts.far, {d: leg([-27, -76], far, 25)});
  set(parts.shoe, {d: `M${near[0] - 6} ${near[1]}l18 2`});
  set(parts.bike, {transform: `translate(${Math.sin(played * .8) * 4} ${90 + Math.sin(angle * 2) * 1.5})`});
  set(parts.scarf, {d: `M-5-134Q-45 ${-133 + Math.sin(angle) * 6}-70 ${-153 + Math.sin(angle + .7) * 9}L-61-128Q-34-117-6-122Z`});
  set(parts.land, {transform: `translate(${-played * 7} 0)`});
  set(parts.trees, {transform: `translate(${-played * 22} 0)`});
  set(parts.road, {transform: `translate(${-((played * 50) % 85)} 0)`});
  set(parts.loading, {opacity: loading ? 1 : 0});
  set(parts.spinner, {transform: `rotate(${time * 245})`});
}

const comparison = [0, 2].map((delay, row) => {
  const baseY = row ? 632 : 367;
  const group = make('g', {}, $('time-ribbons'));
  make('path', {d: `M430 ${baseY + 83}H1310`, stroke: '#829173', 'stroke-width': 3}, group);
  const slots = schedule(delay);
  const blocks = slots.map(item => {
    const x = 430 + item.start * 62;
    const g = make('g', {}, group);
    make('path', {d: `M${x} ${baseY}l60-2v72l-60 2Z`, fill: row ? '#638169' : '#b77c5f', stroke: '#344e3b', 'stroke-width': 3}, g);
    make('path', {d: `M${x + 6} ${baseY + 47}l15-22l17 13l16-8v29h-48Z`, fill: '#d4d6b1', opacity: .8}, g);
    const n = make('text', {x: x + 30, y: baseY + 49, 'text-anchor': 'middle', 'font-size': 33, fill: '#fcf0d7'}, g);
    n.textContent = String(item.index + 1).padStart(2, '0');
    return {g, ...item};
  });
  const gaps = row ? [{start: 0, end: 2}] : slots.flatMap((slot, i) =>
    i && slot.start > slots[i - 1].end ? [{start: slots[i - 1].end, end: slot.start}] : []);
  for (const gap of gaps) {
    make('rect', {x: 430 + gap.start * 62, y: baseY - 2,
      width: (gap.end - gap.start) * 62, height: 78, fill: row ? '#a6b493' : '#bd7358', opacity: .45}, group);
    if (!row) for (let x = 430 + gap.start * 62 + 9; x < 430 + gap.end * 62 - 5; x += 19)
      make('path', {d:`M${x} ${baseY + 3}l-8 63`,stroke:'#a95942','stroke-width':4,opacity:.55},group);
  }
  const pulse = make('path', {d: `M0 ${baseY - 43}V${baseY + 73}`, stroke: '#e2a16d', 'stroke-width': 8}, group);
  return {blocks, pulse};
});

const titles = [
  ['wait', '先等两秒，反而顺了', ''],
  ['unfold', '把时间，拆给你看', ''],
  ['rule', '播放连续，数据分批到', '一格 = 一秒视频 · 数字为示意'],
  ['raw', '空档，会撞上屏幕', ''],
  ['rewind', '倒回去，先留一点余量', ''],
  ['definition', '这份余量，叫缓冲', ''],
  ['reserve', '网络停一下，播放继续', ''],
  ['compare', '同一段网络，两种播放', ''],
  ['limit', '余量用完，照样会卡', ''],
  ['tradeoff', '多留余量，也要付出等待', '']
].map(([key, title, detail]) => ({at: S(key) - (key === 'raw' ? 1 : 0), key, title, detail}));
const rawOrigin = S('rule') + .9;
const bufferOrigin = S('rewind') + 3.2;
const compareOrigin = S('compare') + .3;
const defTime = S('definition') - bufferOrigin;
const heldTime = defTime + (S('reserve') - S('definition')) * .08;

function headline(time) {
  const current = titles.findLast(item => time >= item.at);
  const next = titles.find(item => item.at > time)?.at ?? S('conclusion');
  const a = current ? out(phase(time, current.at, .65)) * (1 - ease(phase(time, next - .22, .22))) : 0;
  alpha('headline', a); alpha('detail-line', a);
  if (current) {
    text('headline-text', current.title);
    text('detail-text', current.detail);
    pos($('headline'), 0, 17 * (1 - a));
  }
  alpha('opening-type', out(phase(time, .1, .5)) * (1 - ease(phase(time, S('wait') - .2, .3))));
}

function framePose(index, clock, delay, coiled, input = arrivals) {
  const state = playback(clock, delay, input), slot = state.slots[index], el = frames[index];
  if (!slot) {set(el, {opacity: 0});return;}
  const completed = Math.floor(state.played + 1e-8);
  const rank = index - completed;
  const queueX = 1120 - rank * 115;
  const queueY = 511 + coiled * (16 + Math.sin(rank * .7) * 8);
  let x = queueX, y = queueY, scale = .83, rotation = coiled * (-4 + rank * 2), opacity = 1;
  if (clock < slot.arrival) {
    const p = phase(clock, slot.arrival - .64, .64), q = ease(p);
    x = lerp(202, queueX, q);y = lerp(386 + (index % 3) * 30, queueY, q) - Math.sin(p * Math.PI) * 154;
    scale = lerp(.48, .83, out(p));rotation = lerp(-24, rotation, q);opacity = p > 0 ? 1 : 0;
  } else if (clock >= slot.start) {
    const p = phase(clock, slot.start, 1), q = ease(p);
    x = lerp(1120, 1525, q);y = lerp(queueY, 446, q) - Math.sin(p * Math.PI) * 70;
    scale = lerp(.83, .43, q);rotation = lerp(rotation, 4, q);
    opacity = 1 - ease(phase(p, .64, .36));
    if (clock >= slot.end) opacity = 0;
  } else {
    // Newly exposed tiles settle together as the oldest second is consumed.
    const fractional = state.played - completed;
    x += 115 * ease(fractional);
  }
  pos(el, x, y, scale, rotation);set(el, {opacity});
}

onFrame(({time: t}) => {
  headline(t);
  const unfold = ease(phase(t, S('unfold'), 2.25));
  const returnHome = ease(phase(t, S('conclusion') + .15, 2.25));
  const compare = gate(t, S('compare'), S('limit') - .3, .65);
  const system = unfold * (1 - compare) * (1 - ease(phase(t, S('conclusion') + .1, .7)));
  const coiled = ease(phase(t, S('rewind') + 1.4, 1.6));
  const limit = t >= S('limit') && t < S('tradeoff');
  const tradeoff = t >= S('tradeoff') && t < S('conclusion');
  const closing = t >= S('conclusion');
  const trade = ease(phase(t, S('tradeoff') + .4, 3.4));
  const movieX = lerp(1120, 1530, unfold), movieY = lerp(500, 442, unfold);
  const movieScale = lerp(1.45, .78, unfold);
  pos($('hero-movie'), lerp(movieX, 1120, returnHome), lerp(movieY, 500, returnHome), lerp(movieScale, 1.45, returnHome));
  alpha('hero-movie', 1 - compare);
  alpha('hero-ground', (1 - unfold) + returnHome);
  pos($('hero-ground'), 0, 20 * Math.sin(returnHome * Math.PI));
  alpha('top-label', system);
  alpha('source', system);pos($('source'), 202, 386, 1, -2 + Math.sin(t * .6) * .8);
  alpha('coil', system);alpha('coil-shadow', system * coiled);
  const coilPath = offset => {
    const y = value => lerp(511 + offset, value + offset, coiled);
    return `M213 ${y(391)}C357 ${y(391)} 406 ${y(618)} 619 ${y(622)}L1001 ${y(622)}C1169 ${y(622)} 1205 ${y(458)} 1343 ${y(449)}`;
  };
  set($('coil-depth'), {d:coilPath(17)});set($('coil-surface'), {d:coilPath(0)});
  set($('coil-light'), {d:coilPath(-33)});set($('coil-holes'), {d:coilPath(24)});
  pos($('coil'), -60 * trade, 0, 1 + .05 * trade);
  alpha('stream-cards', unfold * (1 - compare) * (1 - returnHome));
  alpha('rewind-mark', gate(t, S('rewind') + .1, S('rewind') + 2.15, .5));
  pos($('rewind-mark'), 875, 447, .7 + .3 * out(phase(t, S('rewind') + .1, .55)), -24 * (1 - ease(phase(t, S('rewind') + .1, 1.8))));

  let modelTime, delay = 0, state;
  if (t < rawOrigin) {
    const fan = ease(phase(t, S('unfold') + .35, 1.85));
    frames.forEach((el, i) => {
      const p = out(phase(t, S('unfold') + .3 + i * .045, .7));
      pos(el, lerp(1120, 235 + i * 108, fan), lerp(465, 490 + (i - 5.5) ** 2 * 3.2, fan), lerp(.25, .8, p), (i - 5.5) * 4 * fan);
      set(el, {opacity: p});
    });
    modelTime = 0;state = playback(0);
  } else {
    if (t < S('rewind')) modelTime = t - rawOrigin;
    else if (t < bufferOrigin) modelTime = (S('rewind') - rawOrigin) * (1 - ease(phase(t, S('rewind'), 1.9)));
    else if (t < S('definition')) {modelTime = t - bufferOrigin;delay = 2;}
    else if (t < S('reserve')) {modelTime = defTime + (t - S('definition')) * .08;delay = 2;}
    else {modelTime = heldTime + t - S('reserve');delay = 2;}
    state = playback(modelTime, delay);
    if (limit) {
      modelTime = Math.max(0, t - S('limit') - .3);delay = 0;
      state = playback(modelTime, 0, [-1, -1, -1]);
      frames.forEach((_, i) => framePose(i, modelTime, 0, true, [-1, -1, -1]));
    } else if (tradeoff || closing) {
      const n = 2 + Math.round(4 * trade);
      const elapsed = Math.max(0, t - S('conclusion'));
      state = {played: elapsed, stock: Math.max(0, 2 + 4 * trade - elapsed), stalled: false, waiting: !closing};
      frames.forEach((el, i) => {
        const p = closing ? phase(elapsed, i * .08, .95) : 0, q = ease(p);
        pos(el, lerp(1120 - i * 105, lerp(movieX, 1120, returnHome), q),
          lerp(524 + (i % 2) * 5, lerp(movieY, 500, returnHome), q) - Math.sin(p * Math.PI) * 110,
          lerp(.83, .43, q), lerp(-3 + i * 1.5, 4, q));
        set(el, {opacity: i < n ? 1 - ease(phase(p, .55, .45)) : 0});
      });
    } else frames.forEach((_, i) => framePose(i, modelTime, delay, coiled));
  }

  const openingPlayed = t < 2.1 ? t : t < S('wait') + 2 ? 2.1 : 2.1 + t - S('wait') - 2;
  const finalPlayed = Math.max(0, t - S('conclusion'));
  const played = lerp(t < rawOrigin ? openingPlayed : state.played, finalPlayed, returnHome);
  const loading = t < S('unfold') ? t >= 2.1 && t < S('wait') + 2 : state.stalled || state.waiting;
  paintMovie(movieParts[0], played, returnHome > .2 ? false : loading, t);
  alpha('frame-halo', system * (state.stalled ? 1 : 0));
  pos($('frame-halo'), 1530, 442, .78);

  const badge = system * coiled * out(phase(t, bufferOrigin - .45, .55))
    * (t < S('compare') || t >= S('limit') ? 1 : 0);
  alpha('stock-badge', badge);pos($('stock-badge'), 847, 307, .92 + .04 * trade, -1);
  text('stock-value', Math.max(0, state.stock).toFixed(1));
  set($('stock-value'), {fill: state.stock < .1 ? '#ad563d' : '#365c44'});
  const lastArrival = arrivals.filter(at => at <= modelTime).at(-1) ?? 0;
  const networkOff = limit ? 1 : t > S('reserve') && modelTime < 13 && modelTime - lastArrival > .75 ? 1 : 0;
  alpha('network-gap', system * coiled * networkOff);
  pos($('network-gap'), 200, 552, 1);
  alpha('wait-clock', system * (tradeoff || closing ? 1 : t >= bufferOrigin && t < bufferOrigin + 2 ? 1 : 0));
  pos($('wait-clock'), 340, 619, .87);
  set($('clock-hand'), {transform: `rotate(${tradeoff || closing ? 45 + trade * 225 : Math.max(0, t - bufferOrigin) * 90})`});

  alpha('comparison', compare);
  pos($('comparison'), 0, 30 * (1 - out(phase(t, S('compare'), .7))));
  const ct = Math.max(0, Math.min(14.15, t - compareOrigin));
  pos($('compare-top-screen'), 1611, 390, .54);
  pos($('compare-bottom-screen'), 1611, 655, .54);
  const raw = playback(ct, 0), buffered = playback(ct, 2);
  paintMovie(movieParts[1], raw.played, raw.stalled, t);
  paintMovie(movieParts[2], buffered.played, buffered.waiting, t);
  [raw, buffered].forEach((row, index) => {
    comparison[index].blocks.forEach(item => {
      const entered = ct >= item.start;
      set(item.g, {opacity: entered ? 1 : .15});
      const p = out(phase(ct, item.start, .25));
      set(item.g, {transform: `translate(0 ${12 * (1 - p)})`});
    });
    const pulseAt = Math.floor(ct / 3) * 3;
    set(comparison[index].pulse, {transform: `translate(${430 + ct * 62} 0)`, opacity: Math.max(0, 1 - (ct - pulseAt) / .5)});
  });
  pos($('compare-cursor'), 430 + ct * 62, 291);
  text('compare-time', `${ct.toFixed(1)} 秒`);
  alpha('top-stall-tag', raw.stalled ? 1 : 0);pos($('top-stall-tag'), 1611, 396, .8, -4);
  alpha('bottom-wait-tag', buffered.waiting ? 1 : 0);pos($('bottom-wait-tag'), 492, 672, .7, -3);
  alpha('final-type', ease(phase(t, S('conclusion') + .6, 1.25)));
});
