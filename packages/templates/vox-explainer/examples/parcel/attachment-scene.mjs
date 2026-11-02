// 坐标与接合的技术示意，不提供当前作品的讲法、造型或时间配额。
// scene 可由本模板原运行器直接执行；所有状态只由当前 time 求值。
export const createAttachmentStudy = () => ({
  duration: 8,
  cues: {},
  scene: {
    markup: `<style>:host{display:block}svg{width:100%;height:100%;font-family:var(--font-body)}</style>
<svg viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
  <text x="160" y="170" font-size="48" fill="#30372f">附着、离开、接入：位置怎样连续</text>
  <g id="source"><path d="M-125 0H125V24H-125Z" fill="#b8794b" stroke="#503e30" stroke-width="3"/><path d="M-90 24V95M90 24V95" stroke="#503e30" stroke-width="8"/></g>
  <g id="receiver"><path d="M-145 0H145V24H-145Z" fill="#547e80" stroke="#304c51" stroke-width="3"/><path d="M-100 24V95M100 24V95" stroke="#304c51" stroke-width="8"/></g>
  <g id="load"><rect id="form" fill="#d8b15c" stroke="#665231" stroke-width="4"/><circle id="identity" fill="#815b39"/></g>
  <text id="phase" x="160" y="790" font-size="38" fill="#30372f"/>
</svg>`,
    animation: String.raw`
const clamp = p => Math.max(0, Math.min(1, p));
const mix = (a, b, p) => a + (b - a) * p;
const sourceAt = t => ({x: 300 + 22*t, y: 550, r: -6 + t, s: 1 + .02*t});
const receiverAt = t => ({x: 1400 - 18*t, y: 550 - 3*t, r: 6 - t, s: .9 + .02*t});
const sourceAnchor = {x: 30, y: 0}, receiverAnchor = {x: -20, y: 0};
const project = (pose, local) => {
  const a = pose.r * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return {x: pose.x + pose.s*(c*local.x - s*local.y),
          y: pose.y + pose.s*(s*local.x + c*local.y)};
};
const transform = p => 'translate('+p.x+' '+p.y+') rotate('+p.r+') scale('+p.s+')';
const cubic = (a,b,c,d,p) => {
  const q = 1-p;
  return {x:q*q*q*a.x+3*q*q*p*b.x+3*q*p*p*c.x+p*p*p*d.x,
          y:q*q*q*a.y+3*q*q*p*b.y+3*q*p*p*c.y+p*p*p*d.y};
};
const source = select('#source'), receiver = select('#receiver'), load = select('#load');
const form = select('#form'), identity = select('#identity'), phase = select('#phase');
const release = 2, contact = 5;
onFrame(({time:t}) => {
  const left = sourceAt(t), right = receiverAt(t);
  source.setAttribute('transform', transform(left));
  receiver.setAttribute('transform', transform(right));
  let pose, origin;
  if (t <= release) {
    pose = left;
    origin = project(pose, sourceAnchor); // 附着：从父物当前位姿求世界锚点。
  } else if (t < contact) {
    const a = sourceAt(release), b = receiverAt(contact);
    const from = project(a, sourceAnchor), to = project(b, receiverAnchor);
    const p = clamp((t-release)/(contact-release));
    origin = cubic(from, {x:from.x+80,y:240}, {x:to.x-80,y:240}, to, p);
    pose = {r:mix(a.r,b.r,p), s:mix(a.s,b.s,p)};
    // 独立路径从脱离时的真实世界位置起，落到接触时的真实目标位置。
  } else {
    pose = right;
    origin = project(pose, receiverAnchor); // 接合后重新跟随目标的当前位姿。
  }
  load.setAttribute('transform', transform({...pose, ...origin}));
  const morph = clamp((t-4.3)/1.5), w = mix(58,110,morph), h = mix(88,42,morph);
  form.setAttribute('x', -w/2); form.setAttribute('y', -h);
  form.setAttribute('width', w); form.setAttribute('height', h);
  identity.setAttribute('cx', 0); identity.setAttribute('cy', -h/2);
  identity.setAttribute('r', Math.min(w,h)*.18);
  // 宽高从底边中心展开，当前形状的接触锚点始终是局部(0,0)。
  phase.textContent = t<=release ? '随左侧承托移动、转动和缩放' :
    t<contact ? '离开原锚点，沿预先安排的上方通路移动并变形' :
    '接到新锚点，形状继续改变，底边仍贴住当前承托';
});
`
  }
});
