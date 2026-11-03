import {C,N,g,at,P,R,L,E,T,U} from './drawing.mjs';
import {MAP_PALETTE as M} from '../../../spatial/map-style.mjs';
// Keep the approved paper-map palette. Geometry and its presentation stay SVG.
const merc=lat=>Math.log(Math.tan(Math.PI/4+lat*Math.PI/360));
export const geo=([lon,lat])=>[960+(lon-114.7)*80,450+(merc(36)-merc(lat))*80*180/Math.PI];
export const city={changan:[108.86,34.29],wu:[119.45,32.4],chu:[117.18,34.26],liang:[115.65,34.45],zhao:[114.49,36.61],linzi:[118.3,36.82]};
export const GP=q=>geo(typeof q==='string'?city[q]:q).map(v=>+v.toFixed(2));
export const point=q=>GP(q).join(' ');
function geoPath(v){
 const line=(r,closed)=>{let last=null,out='';for(let i=0;i<r.length;i++){const p=geo(r[i]);if(last&&Math.hypot(p[0]-last[0],p[1]-last[1])<.65&&i<r.length-1)continue;out+=(out?'L':'M')+p.map(n=>n.toFixed(1)).join(' ');last=p;}return out+(closed?'Z':'');};
 if(v.type==='Polygon')return v.coordinates.map(r=>line(r,true)).join('');
 if(v.type==='MultiPolygon')return v.coordinates.flatMap(p=>p.map(r=>line(r,true))).join('');
 if(v.type==='LineString')return line(v.coordinates,false);
 if(v.type==='MultiLineString')return v.coordinates.map(r=>line(r,false)).join('');return '';
}
// Shape grammar retained from the template's map-paper: a thin irregular edge,
// two light vertical folds, and a small lifted corner. No rectangular UI card.
function paperEdge(w,h,s){
 const points=[[4,7],[w*.32,3.5],[w*.67,5],[w-7,4],[w-3,h-54*s]],out=[];
 const edge=(a,b,n,seed)=>{const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);for(let i=0;i<n;i++){const t=i/n,rough=Math.sin(Math.PI*t)*(.65*Math.sin(i*1.71+seed)+.28*Math.sin(i*.59+seed));out.push([a[0]+dx*t-dy/len*rough,a[1]+dy*t+dx/len*rough]);}};
 for(let i=0;i<points.length-1;i++)edge(points[i],points[i+1],i===3?28:36,i*1.3);
 let d='M'+out.map(p=>p.map(v=>v.toFixed(2)).join(' ')).join('L');
 d+=`L${w-3} ${h-54*s}Q${w-6*s} ${h-42*s} ${w-42*s} ${h-8*s}Q${w-50*s} ${h-3} ${w-64*s} ${h-3}`;
 out.length=0;edge([w-64*s,h-3],[12,h-5],90,8);edge([12,h-5],[4,h-14],8,9);edge([4,h-14],[4,7],36,10);
 return d+'L'+out.map(p=>p.map(v=>v.toFixed(2)).join(' ')).join('L')+'Z';
}
export function mapDefs(data){
 const x=64,y=214,w=1792,h=710,s=.886,d=paperEdge(w,h,s);
 const land=data.land.features.map(f=>geoPath(f.geometry)).join('');
 let base=P(land,'none','#7999ad',18,'opacity=".20"')+P(land,'none','#e1e8e6',7)+P(land,M.land,'none');
 for(const kind of ['foothill','hill','mountain','high','shade','light'])base+=data.terrain.features.filter(f=>f.properties.kind===kind).map(f=>P(geoPath(f.geometry),M[kind],'none',0,`opacity="${kind==='shade'?.18:kind==='light'?.38:.65}"`)).join('');
 base+=data.lakes.features.map(f=>P(geoPath(f.geometry),M.water,'none')).join('')+data.rivers.features.map(f=>P(geoPath(f.geometry),'none','#7999ad',1.5)).join('')+P(land,'none','#52564f',1.15);
 return `<defs><linearGradient id="map-paper-light" x1="0" y1="0" x2=".25" y2="1"><stop stop-color="#fff8e9"/><stop offset=".6" stop-color="#f6eedc"/><stop offset="1" stop-color="#eee3ca"/></linearGradient><linearGradient id="map-paper-fold"><stop stop-color="#30372f" stop-opacity="0"/><stop offset=".47" stop-color="#30372f" stop-opacity=".035"/><stop offset=".5" stop-color="#30372f" stop-opacity=".06"/><stop offset=".52" stop-color="#f6eedc" stop-opacity=".17"/><stop offset="1" stop-color="#f6eedc" stop-opacity="0"/></linearGradient><linearGradient id="map-paper-curl" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f6eedc"/><stop offset=".65" stop-color="#f6eedc"/><stop offset="1" stop-color="#c3b69a"/></linearGradient><pattern id="map-paper-fibre" width="43" height="37" patternUnits="userSpaceOnUse"><path d="M4 8l3 .3m21 7 2-.4m-16 12 3 .5m18 5 4-.4" stroke="#6e695b" stroke-width=".7" opacity=".12"/></pattern><clipPath id="warm-mapclip">${R(88,238,1744,662,M.land)}</clipPath><clipPath id="map-paper-clip">${P(d)}</clipPath><g id="warm-mapbase">`+
 at(P(d,'#203b4310','none',0,'transform="translate(0 5)"')+P(d,'#baaf96','none',0,'transform="translate(.5 2.1)"')+P(d,'url(#map-paper-light)','#766c548a',1.15),x,y)+`<g clip-path="url(#warm-mapclip)">${R(88,238,1744,662,M.water)}${base}</g>`+
 at(`<g clip-path="url(#map-paper-clip)">${R(0,0,w,h,'url(#map-paper-fibre)')}${R(w*.32-37,0,74,h,'url(#map-paper-fold)')}${R(w*.67-37,0,74,h,'url(#map-paper-fold)')}</g>`+P(`M${w-64*s} ${h-3}Q${w-49*s} ${h-9*s} ${w-43*s} ${h-40*s}Q${w-41*s} ${h-51*s} ${w-3} ${h-54*s}L${w-42*s} ${h-8*s}Q${w-50*s} ${h-3} ${w-64*s} ${h-3}`,'url(#map-paper-curl)','#817452',.9),x,y)+
 g('',T('北',1761,823,26,'#596963','body','middle')+P('M1761 838L1753 864 1761 857 1769 864Z','#596963','none')+L(1761,855,1761,883,'#596963',1.4))+'</g></defs>';
}
export const mapBase=()=>U('warm-mapbase');
export const mapText=(s,x,y,color=C.ink,size=44,anchor='start',cl='title')=>T(s,x,y,size,color,cl,anchor,`paint-order="stroke" stroke="${M.land}" stroke-width="5.5" stroke-linejoin="round"`);
export function mapDot(name,key,color=C.ink,dx=20,dy=-22,size=44){const [x,y]=GP(key);return E(x,y,8,8,M.land,color,3)+E(x,y,2.5,2.5,color)+mapText(name,x+dx,y+dy,color,size);}
export function mapFooter(){return T('地理位置与行动方向示意',88,958,24,C.muted)+T('Natural Earth · Mapzen / USGS',1832,958,22,C.muted,'body','end');}
