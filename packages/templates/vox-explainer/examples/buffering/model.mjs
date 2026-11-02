import data from './arrivals.json' with {type: 'json'};

// Each tile is one second of playable content, not one encoded frame or packet.
export const arrivals = data;

export function schedule(delay = 0, input = arrivals) {
  let end = delay;
  return input.map((at, index) => {
    const start = Math.max(end, at);
    end = start + 1;
    return {index, arrival: at, start, end};
  });
}

export function playback(time, delay = 0, input = arrivals) {
  const slots = schedule(delay, input);
  const received = input.filter(at => at <= time).length;
  const played = slots.reduce((sum, item) => sum + Math.max(0, Math.min(1, time - item.start)), 0);
  const active = slots.find(item => time >= item.start && time < item.end);
  return {slots, received, played, stock: Math.max(0, received - played),
    complete: played >= input.length, waiting: time < delay,
    stalled: time >= delay && !active && played < input.length};
}
