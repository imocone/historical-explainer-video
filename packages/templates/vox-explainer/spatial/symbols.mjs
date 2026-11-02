import { readFileSync } from 'node:fs';
import {route} from './geometry.mjs';

// Artwork licenses and adaptations are documented in README.md.
// This helper runs during authoring; the treatment receives only static SVG.
function unitGlyph(kind) {
  const svg = readFileSync(new URL(`./assets/unit-${kind}.svg`, import.meta.url), 'utf8');
  return svg.replace(/<!--[\s\S]*?-->/g, '').replace(/^<svg\b[^>]*>|<\/svg>\s*$/g, '').trim()
    .replaceAll('#303A37', 'var(--ink)');
}

const unitSizes = {
  infantry: 220, spearman: 220, archer: 220, cavalry: 210,
  cannon: 175, artillery: 175, machinegun: 170, tank: 210,
  ironclad: 220, warship: 240, destroyer: 230, transport: 225,
  submarine: 220, aircraft: 190, wagon: 185
};
const waterUnits = new Set(['ironclad', 'warship', 'destroyer', 'transport', 'submarine']);
const infantry = unitGlyph('infantry');
// A formation reads as a unit. The retained source figure still supplies its period detail.
const infantryFormation = [[-14, 10, .73], [47, 10, .73], [24, 22, .86]]
  .map(([x, y, scale]) => `<g transform="translate(${x} ${y}) scale(${scale})">${infantry}</g>`).join('');

// Shape and local color planes carry the material. No whole-object noise/tint pass.
let illustrationSequence = 0;
const illustrated = (content, separate = false) => {
  if (!separate) return content;
  const id = `vox-edge-${++illustrationSequence}`;
  return `<defs><filter id="${id}" x="-3%" y="-3%" width="106%" height="106%" color-interpolation-filters="sRGB">
    <feMorphology in="SourceAlpha" operator="dilate" radius="2.4" result="edge"/>
    <feFlood flood-color="var(--paper)"/><feComposite in2="edge" operator="in"/>
    <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter></defs><g filter="url(#${id})">${content}</g>`;
};

// The three visible roof/wall planes are kept for every use of the building.
const house = (x,y,scale=1) => `<g transform="translate(${x} ${y}) scale(${scale})" stroke="var(--ink)" stroke-width=".65" stroke-linejoin="round">
  <path d="M-19 0L6 8L24-4L-1-12Z" fill="#554f39" opacity=".2" stroke="none"/>
  <path d="M-18-25L5-17V5L-18-3Z" fill="#f2f1eb"/>
  <path d="M5-17L22-28V-6L5 5Z" fill="#c5cbd0"/>
  <path d="M-21-25L-6-40L10-29L5-16Z" fill="#bd603e"/>
  <path d="M-6-40L12-50L26-29L10-19L5-16L10-29Z" fill="#87402e"/>
  <path d="M-6-40L10-29L26-29M-21-25L5-16L26-29" fill="none" stroke-width=".8"/>
  ${Array.from({length:6},(_,i)=>`<path d="M${-18+i*3.8} ${-25+i*1.4}l12-11M${-2+i*3} ${-41-i*1.4}l13 18" fill="none" stroke="#e19268" stroke-width=".35" opacity=".8"/>`).join('')}
  <path d="M-15-21L-8-19V-10L-15-12ZM11-17L16-20V-12L11-9Z" fill="#2c475b"/>
  <path d="M-3 2V-11L2-9V4Z" fill="#6a5c40"/>
  <path d="M-17-5L-7-2M-15-8L-11-7M8 2L18-5M17-8L21-10M-14-21V-12M-12-19L-12-11M12-16L15-18" fill="none" stroke="#697b89" stroke-width=".45"/>
  <path d="M-15-19L-9-17M-18-4L4 3M6-15L6 3" fill="none" stroke="#faf8f1" stroke-width=".5"/>
</g>`;
const warehouse = `<g stroke="var(--ink)" stroke-width=".65" stroke-linejoin="round">
  <path d="M18 72L66 85L99 65L52 52Z" fill="#544d39" opacity=".22" stroke="none"/>
  <path d="M19 43L40 23L64 55V84L19 72Z" fill="#eeefeb"/>
  <path d="M64 55L96 35V65L64 84Z" fill="#b9c2ca"/>
  <path d="M15 43L39 20L73 0L50 22Z" fill="#ba5b3b"/>
  <path d="M39 20L73 0L101 34L64 57Z" fill="#91432e"/>
  ${Array.from({length:12},(_,i)=> {
    const t=i/12, x=39+34*t, y=20-20*t;
    return `<path d="M${x} ${y}L${64+37*t} ${57-23*t}" fill="none" stroke="#6d3831" stroke-width=".65"/>
      <path d="M${x+1.2} ${y+.2}L${65+37*t} ${56-23*t}" fill="none" stroke="#dc8861" stroke-width=".5"/>`;
  }).join('')}
  ${Array.from({length:5},(_,i)=> {
    const t=(i+1)/6;
    return `<path d="M${39+25*t} ${20+37*t}l${34+3*t} ${-20-3*t}" fill="none" stroke="#763e34" stroke-opacity=".6" stroke-width=".4"/>`;
  }).join('')}
  <path d="M15 43L39 20L64 57L101 34M39 20L73 0" fill="none" stroke-width=".95"/>
  <path d="M40 77V57L54 61V81Z" fill="#665940"/>
  <path d="M42 58V76M46 59V78M50 60V79M42 69L52 72M42 60L52 78" fill="none" stroke="#bba075" stroke-width=".45"/>
  <path d="M24 51L32 53V63L24 61ZM74 56L82 51V62L74 67ZM87 47L92 44V54L87 57Z" fill="#314e63"/>
  <path d="M24 52L31 54M25 52V61M76 55V64M87 49L92 46" fill="none" stroke="#c9e1e8" stroke-width=".55"/>
  ${[0,1,2,3].map(i=>`<path d="M20 ${49+i*7}l43 12M65 ${62+i*6}l29-18" fill="none" stroke="#736f51" stroke-opacity=".3" stroke-width=".45"/>`).join('')}
  <path d="M20 70L38 75M56 80L63 82M67 79L94 62" fill="none" stroke="#f9f7ef" stroke-width=".7"/>
</g>`;
const dock = `<g stroke="var(--ink)" stroke-width=".6" stroke-linejoin="round">
  <path d="M4 92L83 111L124 84L44 66Z" fill="#9c8056"/>
  <path d="M4 92V98L83 117V111Z" fill="#68573d"/>
  <path d="M83 111L124 84V90L83 117Z" fill="#534e37"/>
  ${Array.from({length:17},(_,i)=>`<path d="M${5+i*4.6} ${92+i*1.1}l39-26" fill="none" stroke="#493f2e" stroke-width=".5"/><path d="M${7+i*4.6} ${91+i*1.1}l35-23" fill="none" stroke="#d1b07a" stroke-width=".35"/>`).join('')}
  ${[[12,94],[79,111],[116,87]].map(([x,y])=>`<path d="M${x} ${y-4}v13l4 1v-13Z" fill="#6b583b"/><path d="M${x} ${y-4}l2-1l4 1l-2 1Z" fill="#b89a69"/>`).join('')}
</g>`;
const barrel = (x,y,s=1) => `<g transform="translate(${x} ${y}) scale(${s})" stroke="var(--ink)" stroke-width=".55">
  <path d="M-6-15Q-8-7-6 0Q0 3 6 0Q8-7 6-15Z" fill="#a28556"/>
  <path d="M2-15Q5-7 3 1L6 0Q8-7 6-15Z" fill="#6e6142" stroke="none"/>
  <ellipse cy="-15" rx="6" ry="2" fill="#c4a370"/>
  <path d="M-6-12Q0-9 6-12M-7-4Q0-1 7-4M-3-14Q-5-7-3 0M1-13V1" fill="none" stroke="#5d5941" stroke-width=".55"/>
</g>`;

const facilitySizes = { settlement: 150, port: 100, station: 90 };
export const symbols = {
  port: `${dock}${warehouse}${barrel(104,87,.85)}${barrel(114,82,.65)}
    <g stroke="var(--ink)" stroke-width=".5" fill="none"><path d="M7 103Q27 108 44 111M32 115L63 122M91 120L117 103" stroke="#7baebe"/><path d="M92 92Q105 89 106 93Q106 98 97 98Q91 96 92 92M94 94Q101 92 103 94" stroke="#5f5940"/></g>`,
  station: `${warehouse}<g stroke="var(--ink)" stroke-width=".65">
    <path d="M2 91L82 112L125 86M1 97L82 118L128 90" fill="none"/>
    ${Array.from({length:16},(_,i)=>`<path d="M${4+i*4.9} ${89+i*1.3}l-3 11l2 .5l3-11Z" fill="#8a7551"/>`).join('')}
    <path d="M67 42L78 35V45L67 52Z" fill="#f5f5ed"/><path d="M72 40V45L76 44" fill="none" stroke-width=".6"/>
  </g>`,
  settlement: `<g stroke-linejoin="round"><path d="M6 85L39 62L120 84L84 114Z" fill="#67934e" opacity=".18"/>
    <path d="M23 71L51 86L80 70M51 86L80 102" fill="none" stroke="#c9c7bb" stroke-width="4"/>
    ${house(43,58,.85)}${house(82,66,.9)}${house(19,85,.75)}${house(58,102,1)}${house(102,99,.85)}
    <path d="M5 93l3-5l3 4M34 107l3-4l4 3M104 77l3-6l4 4M88 115l3-4l4 2" fill="none" stroke="#3e713b" stroke-width=".6"/>
  </g>`,
  ...Object.fromEntries(Object.keys(unitSizes).map(kind => [kind, kind === 'infantry' ? infantryFormation : unitGlyph(kind)]))
};

// Static treatment data: the ground point stays at (0, 0), including while moving.
export function mapMarker(kind, color = 'accent', size = facilitySizes[kind] ?? unitSizes[kind]) {
  if (!symbols[kind]) throw new Error(`未知地图元件：${kind}`);
  const glyph = illustrated(symbols[kind].replaceAll('currentColor', `var(--${color})`), !facilitySizes[kind]);
  const grounded = !waterUnits.has(kind) && kind !== 'aircraft';
  const canvas = facilitySizes[kind] ? 128 : 170;
  const anchorY = facilitySizes[kind] ? 112 : grounded ? 153 : kind === 'aircraft' ? 85 : 119;
  return {
    width: size + 24,
    height: (grounded ? size * 2 : size) + 24,
    markup: `<g transform="scale(${size / canvas})">
      ${grounded ? `<ellipse cx="0" cy="0" rx="34" ry="5" fill="var(--ink)" opacity="0.16"/>
        <circle cx="0" cy="0" r="2.5" fill="var(--ink)" stroke="var(--paper)" stroke-width=".7"/>` : ''}
      <g transform="translate(${-canvas / 2} ${-anchorY})">${glyph}</g>
    </g>`
  };
}

// A paper carrier changes presentation, never the underlying illustration.
const counterGlyph = kind => `<g transform="translate(0 -51) scale(.55) translate(-85 -90)">${symbols[kind]}</g>`;
export function unitCounter(kind, color = 'accent', size = 140) {
  if (!unitSizes[kind]) throw new Error(`未知兵牌：${kind}`);
  return {
    width: size * 1.12, height: size * 1.08,
    markup: `<g transform="scale(${size / 104})" style="color:var(--${color})">
      <ellipse cy="2" rx="20" ry="3" fill="var(--ink)" opacity=".09"/>
      <path d="M-50-101L49-100L51-18L8-16L0-3L-9-16L-51-18Z" fill="var(--ink)" opacity=".14" transform="translate(1 2)"/>
      <path d="M-50-101L-19-102L12-101L49-101L50-69L49-41L50-18L9-17L0-4L-9-17L-50-18L-51-58Z" fill="var(--paper)" stroke="var(--ink)" stroke-opacity=".65" stroke-width=".7"/>
      <path d="M-45-96L-20-97L18-96L45-97" fill="none" stroke="currentColor" stroke-width="4.5"/>
      ${illustrated(counterGlyph(kind).replaceAll('currentColor',`var(--${color})`))}
      <circle r="2" fill="currentColor"/>
    </g>`
  };
}

// Paper separation is a fine edge; there is no second flat-icon branch.
export function unitSymbol(kind, color = 'accent', size = 210) {
  if (!unitSizes[kind]) throw new Error(`未知兵种：${kind}`);
  const floating = waterUnits.has(kind), airborne = kind === 'aircraft';
  const anchor = airborne ? 85 : floating ? 119 : 153;
  const glyph = `<g transform="translate(-85 -${anchor})">${symbols[kind]}</g>`;
  return {
    width: size + 24, height: size * 1.5 + 24,
    markup: `<g transform="scale(${size / 170})" style="color:var(--${color})">
      ${airborne || floating ? '' : '<ellipse cy="1" rx="31" ry="3.5" fill="var(--ink)" opacity=".13"/>'}
      ${illustrated(glyph.replaceAll('currentColor',`var(--${color})`),true)}
    </g>`
  };
}

// Two forces at one geographic point; the branches separate glyphs, not locations.
export function pairedInfantry(size = 148) {
  const glyphAccent = illustrated(symbols.infantry.replaceAll('currentColor', 'var(--accent)'), true);
  const glyphSecondary = illustrated(symbols.infantry.replaceAll('currentColor', 'var(--secondary)'), true);
  return {
    width: size * 2.5,
    height: size * 2.2,
    markup: `<g transform="scale(${size / 170})">
      <ellipse cx="-50" cy="0" rx="32" ry="5" fill="var(--ink)" opacity="0.16"/>
      <ellipse cx="50" cy="0" rx="32" ry="5" fill="var(--ink)" opacity="0.16"/>
      <path d="M-50 0L50 0" fill="none" stroke="var(--ink)" stroke-width="1.1" stroke-linecap="round"/>
      <g transform="translate(-135 -153)">${glyphAccent}</g>
      <g transform="translate(135 -153) scale(-1 1)">${glyphSecondary}</g>
      <circle cx="0" cy="0" r="3" fill="var(--ink)" stroke="var(--paper)" stroke-width=".8"/>
    </g>`
  };
}

// Generic timber crossing. The top, side, piles and braces share one projection.
const beam = (a,b,w=2.2) => {
  const length=Math.hypot(b[0]-a[0],b[1]-a[1]);
  const nx=-(b[1]-a[1])/length*w/2, ny=(b[0]-a[0])/length*w/2;
  const corners=[[a[0]+nx,a[1]+ny],[b[0]+nx,b[1]+ny],[b[0]-nx,b[1]-ny],[a[0]-nx,a[1]-ny]];
  return `<path d="M${corners.map(p=>p.join(' ')).join('L')}Z" fill="#927348" stroke="var(--ink)" stroke-width=".55"/>
    <path d="M${a[0]+nx*.45} ${a[1]+ny*.45}L${b[0]+nx*.45} ${b[1]+ny*.45}" fill="none" stroke="#d4b681" stroke-width=".45"/>`;
};
const bridge = `<g stroke="var(--ink)" stroke-width=".6" stroke-linejoin="round">
  ${beam([-54,-12],[-52,27],4)}${beam([34,-27],[35,9],4)}
  ${beam([-52,25],[34,-20],2.5)}${beam([-49,-10],[34,9],2.5)}
  ${beam([-64,-22],[43,-40],2.4)}
  ${Array.from({length:6},(_,i)=>beam([-62+i*20.4,-21-i*3.44],[-62+i*20.4,-7-i*3.44],1.8)).join('')}
  <path d="M-65-9L42-27L67-7L-40 13Z" fill="#b99a67"/>
  <path d="M-40 13L67-7V-2L-40 18Z" fill="#755e3e"/>
  <path d="M-65-9L-40 13V18L-65-4Z" fill="#8d724c"/>
  ${Array.from({length:22},(_,i)=> {
    const x=-64+i*4.8,y=-9-i*.81;
    return `<path d="M${x} ${y}l24 21" fill="none" stroke="#514b35" stroke-width=".5"/>
      <path d="M${x+1.3} ${y+.5}l20 17" fill="none" stroke="#e1c590" stroke-width=".45"/>
      <path d="M${x+8} ${y+6}l5 4M${x+16} ${y+14}l3 2" fill="none" stroke="#836943" stroke-width=".35"/>`;
  }).join('')}
  ${beam([-38,13],[-37,43],4.1)}${beam([51,-4],[52,25],4.1)}
  ${beam([-37,39],[51,-2],2.9)}${beam([-35,15],[51,23],2.9)}
  ${beam([-40,18],[66,-2],2.5)}
  ${Array.from({length:6},(_,i)=>beam([-40+i*21.2,12-i*4],[-40+i*21.2,-4-i*4],2.1)).join('')}
  ${beam([-43,-3],[69,-24],2.7)}
  ${beam([-43,4],[68,-17],1.1)}
  <path d="M-38 40L-34 41M51 23L55 24M-40 15L65-5" fill="none" stroke="#cfaf78" stroke-width=".5"/>
  ${[[-38,16],[-37,38],[52,-1],[52,23],[-40,-3],[64,-23]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r=".65" fill="#393e30" stroke="none"/>`).join('')}
</g>`;
const earthwork = `<g stroke="var(--ink)" stroke-width=".65" stroke-linejoin="round">
  <path d="M-60 5L-57-18L-35-36L-12-27L16-30L37-42L59-26L63-3L39-11L17-1L-11 3L-36-8Z" fill="#8c7753"/>
  <path d="M-57-18L-35-36L-12-27L16-30L37-42L59-26L39-19L17-12L-12-10L-34-19Z" fill="#779a55"/>
  <path d="M-60 5L-57-18L-34-19L-12-10L17-12L39-19L59-26L63-3L39-11L17-1L-11 3L-36-8Z" fill="#aa9266"/>
  <path d="M-35-18L-12-9L17-11L39-18L39-11L17-1L-11 3L-36-8Z" fill="#6e6648" opacity=".65"/>
  ${Array.from({length:20},(_,i)=> {const x=-54+i*5.8,y=-9+Math.sin(i*.6)*6;return `<path d="M${x} ${y}l2 5m-1-2l3 1" fill="none" stroke="#5d5940" stroke-width=".4"/>`;}).join('')}
  <path d="M-51-22l3-4l3 1M-37-30l3-3l3 2M-18-26l2 3l4-1M-2-24l2-4l3 3M19-29l3-4l4 1M37-35l4-1l2 3M48-29l4-3" fill="none" stroke="#3c6636" stroke-width=".75"/>
  <path d="M-61 7L-38-3L-13 7L16 4L40-6L65 1" fill="none" stroke="#d0ba89" stroke-width="1.2"/>
</g>`;
const works = {earthwork, bridge};
export function worksMarker(kind, size = 140) {
  if (!works[kind]) throw new Error(`未知工事：${kind}`);
  return {width:size+24, height:size+24,
    markup:`<g transform="scale(${size/128})">${illustrated(works[kind])}</g>`};
}


export function infrastructure(points, {kind = 'road', width = 14} = {}) {
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${p.join(' ')}`).join(' ');
  if (kind === 'road') return `<g stroke-linejoin="round" stroke-linecap="round"><path d="${d}" fill="none" stroke="var(--ink)" stroke-opacity=".45" stroke-width="${width}"/><path d="${d}" fill="none" stroke="var(--paper)" stroke-width="${width * .84}"/><path d="${d}" fill="none" stroke="#897650" stroke-opacity=".35" stroke-width="${width * .18}" stroke-dasharray="2 7 1 11"/></g>`;
  if (kind !== 'railway') throw new Error('通路只支持road或railway');
  const path = route(points), ties = [];
  if (!path.length) return '';
  for (let distance = 0; distance <= path.length; distance += width * 1.5) {
    const a = path.sample(Math.max(0, distance - 1) / path.length).point;
    const b = path.sample(Math.min(path.length, distance + 1) / path.length).point;
    const p = path.sample(distance / path.length).point, angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const x = Math.sin(angle) * width / 2, y = -Math.cos(angle) * width / 2;
    ties.push(`M${p[0] - x} ${p[1] - y}L${p[0] + x} ${p[1] + y}`);
  }
  return `<path d="${ties.join(' ')}" fill="none" stroke="#8d7652" stroke-width="2.4"/><path d="${d}" fill="none" stroke="var(--ink)" stroke-width="1.2"/>`;
}
