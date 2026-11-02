import {getArrow} from 'perfect-arrows';
import {getStroke} from 'perfect-freehand';
import {execFileSync} from 'node:child_process';
import {pythonCommand, runtimeEnvironment} from '../../runtime-config.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const systemRoot = fileURLToPath(new URL('../../../', import.meta.url));

// Measure the supplied real font; the author chooses words, lines and type size.
export function measureText({fontFile, lines, fontSize, lineHeight = 1.25, tracking = 0}) {
  if (!Array.isArray(lines) || !lines.length || lines.some(line=>typeof line!=='string' || /[\r\n\t]/u.test(line))
    || ![fontSize,lineHeight,tracking].every(Number.isFinite) || Math.min(fontSize,lineHeight)<=0)
    throw new Error('排字测量需要已分行文字、正字号与行距');
  const script = `import json,sys
from PIL import ImageFont
a=json.load(sys.stdin)
f=ImageFont.truetype(a['fontFile'],1000)
s=a['fontSize']/1000
result=[]
for i,text in enumerate(a['lines']):
    x,y,r,b=f.getbbox(text,anchor='ls',features=['tnum'])
    spacing=max(0,len(text)-1)*a['tracking']
    result.append({'baseline':i*a['fontSize']*a['lineHeight'],
        'advance':f.getlength(text,features=['tnum'])*s+spacing,
        'box':{'x':x*s,'y':y*s+i*a['fontSize']*a['lineHeight'],
            'width':(r-x)*s+spacing,'height':(b-y)*s}})
json.dump(result,sys.stdout)`;
  return JSON.parse(execFileSync(pythonCommand(),
    ['-c',script],{input:JSON.stringify({fontFile:path.resolve(systemRoot,fontFile),lines,fontSize,lineHeight,tracking}),encoding:'utf8',env:runtimeEnvironment()}));
}

// Author-time geometry. Only the resulting SVG travels with the scene.
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const group = (id, content) => `<g id="${escape(id)}">${content}</g>`;
const stroke = (d, color, width) => `<path data-pen-stroke d="${escape(d)}" fill="none" stroke="${escape(color)}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;

// Pressure varies along the actual centerline. A centerline mask keeps the same
// draw()/seek behavior while the visible mark has an ink nib's taper and edge.
const inkPath = (id, points, width, color) => {
  const outline = getStroke(points, {size:width, thinning:.55, streamline:0, smoothing:.55,
    simulatePressure:false, start:{cap:true,taper:width*1.6}, end:{cap:true,taper:width*2}, last:true});
  const d = `M${outline.map(p=>p.join(' ')).join('L')}Z`;
  const center = `M${points.map(p=>p.slice(0,2).join(' ')).join('L')}`;
  const xs=points.map(p=>p[0]), ys=points.map(p=>p[1]);
  const x=Math.min(...xs)-width*3, y=Math.min(...ys)-width*3;
  return `<defs><mask id="${escape(id)}-ink" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${Math.max(...xs)-x+width*3}" height="${Math.max(...ys)-y+width*3}">${stroke(center,'white',width*3)}</mask></defs><path d="${d}" fill="${escape(color)}" stroke="var(--paper)" stroke-width="${width*.5}" stroke-linejoin="round" paint-order="stroke fill" mask="url(#${escape(id)}-ink)"/>`;
};

export function mark({id, kind, box, width = 12, padding = 10, seed = 41, color = 'var(--accent)'}) {
  const {x, y, width:w, height:h} = box;
  if (![x,y,w,h,width,padding].every(Number.isFinite) || Math.min(w,h,width) <= 0 || padding < 0
    || !Number.isInteger(seed) || seed <= 0) throw new Error('笔迹需要有效边框、线宽、留白和固定正整数seed');
  let points;
  if (kind === 'circle') points = Array.from({length:97},(_,i)=> {
    const a=-.45+i/96*(Math.PI*2+.08), r=1+.008*Math.sin(a*5+seed);
    return [x+w/2+Math.cos(a)*(w/2+padding)*r,
      y+h/2+Math.sin(a)*(h/2+padding)*(1+.012*Math.sin(a*3+seed)), .5+.2*Math.sin(a*2+.4)];
  });
  else if (kind === 'underline') points = Array.from({length:49},(_,i)=>
    [x+w*i/48,y+h+padding+width*.1*Math.sin(i*.15+seed),.48+.18*Math.sin(i*.06)]);
  else if (kind === 'bracket') {
    const vertices=[[x-padding,y+h],[x-padding,y+h+padding*2],
      [x+w+padding,y+h+padding*2],[x+w+padding,y+h]];
    points=vertices.flatMap((a,i)=>i===vertices.length-1 ? [[...a,.4]]
      : Array.from({length:17},(_,j)=>[a[0]+(vertices[i+1][0]-a[0])*j/17,
        a[1]+(vertices[i+1][1]-a[1])*j/17,.5+.12*Math.sin(i+j*.2)]));
  }
  else if (kind === 'highlight') {
    const points = Array.from({length:17}, (_,i) => [x+w*i/16, y+h*.7+Math.sin(i/5)*h*.025, .6+.1*Math.sin(i/6)]);
    const outline = getStroke(points, {size:h*.56, thinning:.3, streamline:0, smoothing:.6,
      simulatePressure:false, start:{cap:false}, end:{cap:false}, last:true});
    const d = `M${outline.map(p=>p.join(' ')).join('L')}Z`;
    return group(id, `<defs><mask id="${escape(id)}-reveal" maskUnits="userSpaceOnUse" x="${x-h}" y="${y-h}" width="${w+h*2}" height="${h*3}">${stroke(`M${x-h/2} ${y+h*.7}H${x+w+h/2}`, 'white', h*2)}</mask></defs><path d="${d}" fill="${escape(color)}" opacity=".28" mask="url(#${escape(id)}-reveal)"/>`);
  } else throw new Error('笔迹选择circle、underline、bracket或highlight');
  return group(id, inkPath(id,points,width,color));
}

export function arrow({id, from, to, width = 12, head = 28, color = 'var(--accent)', ...options}) {
  if (![...from,...to,width,head].every(Number.isFinite) || Math.min(width,head) <= 0
    || Math.hypot(to[0]-from[0],to[1]-from[1]) < 1) throw new Error('箭头需要不同的起止点和正尺寸');
  const [sx,sy,cx,cy,ex,ey,angle] = getArrow(...from,...to, {bow:.12,padStart:8,padEnd:10,...options});
  const points=Array.from({length:65},(_,i)=> {
    const t=i/64,u=1-t;
    return [u*u*sx+2*u*t*cx+t*t*ex,u*u*sy+2*u*t*cy+t*t*ey,.52+.17*Math.sin(t*4)];
  });
  return group(id, inkPath(id,points,width,color)+`<path data-pen-tip d="M${-head} ${-head*.39}L0 0L${-head*.94} ${head*.36}L${-head*.69} -.5Z" transform="translate(${ex} ${ey}) rotate(${angle*180/Math.PI})" fill="${escape(color)}" stroke="var(--paper)" stroke-width="${width*.4}" stroke-linejoin="round" paint-order="stroke fill"/>`);
}

// Serialize this small function into scene.animation; no library or second clock.
export function annotationTools(svg) {
  const cache = new WeakMap();
  const point = (element, x, y, relativeTo = svg) => {
    const p = svg.createSVGPoint(); p.x=x; p.y=y;
    const result = p.matrixTransform(relativeTo.getScreenCTM().inverse().multiply(element.getScreenCTM()));
    return [result.x,result.y];
  };
  const bounds = (element, relativeTo = svg) => {
    const b = element.getBBox();
    const corners = [[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]]
      .map(p=>point(element,...p,relativeTo));
    const xs=corners.map(p=>p[0]), ys=corners.map(p=>p[1]);
    return {x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
  };
  const draw = (element, progress) => {
    let paths = cache.get(element);
    if (!paths) { paths=[...element.querySelectorAll('[data-pen-stroke]')].map(node=>({node,length:node.getTotalLength()})); cache.set(element,paths); }
    let left = Math.max(0,Math.min(1,progress))*paths.reduce((sum,p)=>sum+p.length,0);
    for (const {node,length} of paths) {
      node.setAttribute('stroke-dasharray', `${length} ${length}`);
      node.setAttribute('stroke-dashoffset', Math.max(0,length-left));
      node.setAttribute('opacity', left>0 ? 1 : 0);
      left -= length;
    }
    for (const tip of element.querySelectorAll('[data-pen-tip]')) tip.setAttribute('opacity', progress>=1 ? 1 : 0);
  };
  return {point,bounds,draw};
}
