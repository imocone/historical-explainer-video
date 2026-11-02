export const mapPaperMarkup = '<svg id="paper-frame" aria-hidden="true"><defs><linearGradient id="paper-warm" x1="0" y1="0" x2=".25" y2="1"><stop stop-color="#fff8e9"/><stop offset=".6" stop-color="#f6eedc"/><stop offset="1" stop-color="#eee3ca"/></linearGradient></defs><path id="paper-depth" fill="#baaf96" transform="translate(.5 2.1)"/><path id="paper-face" fill="url(#paper-warm)" stroke="#766c54" stroke-opacity=".58" stroke-width=".9"/><path id="paper-lip" fill="none" stroke="#fffbed" stroke-width=".9" stroke-opacity=".65" transform="translate(0 -.65)"/></svg><div id="map-aperture"><div id="map"></div><svg id="geo-art"></svg></div><svg id="paper-overlay" aria-hidden="true"><defs><clipPath id="paper-clip"><path id="paper-outline"/></clipPath><filter id="paper-noise" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="2" seed="17" stitchTiles="stitch"/></filter><linearGradient id="paper-fold"><stop stop-color="#30372f" stop-opacity="0"/><stop offset=".47" stop-color="#30372f" stop-opacity=".045"/><stop offset=".5" stop-color="#30372f" stop-opacity=".06"/><stop offset=".52" stop-color="#f6eedc" stop-opacity=".12"/><stop offset="1" stop-color="#f6eedc" stop-opacity="0"/></linearGradient><linearGradient id="paper-curl" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f6eedc"/><stop offset=".65" stop-color="#f6eedc"/><stop offset="1" stop-color="#c3b69a"/></linearGradient></defs><g clip-path="url(#paper-clip)"><rect id="paper-grain" filter="url(#paper-noise)" opacity=".014" style="mix-blend-mode:multiply"/><rect id="paper-fold-one" fill="url(#paper-fold)"/><rect id="paper-fold-two" fill="url(#paper-fold)"/><path id="paper-corner" fill="url(#paper-curl)" stroke="#817452" stroke-width=".8"/></g></svg>';

function paperEdge(w,h,s){
 const points=[[4,7],[w*.32,3.5],[w*.67,5],[w-7,4],[w-3,h-54*s]],out=[];
 function edge(a,b,n,seed){const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);for(let i=0;i<n;i++){const t=i/n,rough=Math.sin(Math.PI*t)*(.65*Math.sin(i*1.71+seed)+.28*Math.sin(i*.59+seed));out.push([a[0]+dx*t-dy/len*rough,a[1]+dy*t+dx/len*rough]);}}
 for(let i=0;i<points.length-1;i++)edge(points[i],points[i+1],i===3?28:36,i*1.3);
 let d='M'+out.map(p=>p.map(v=>v.toFixed(2)).join(' ')).join('L');
 d+=`L${w-3} ${h-54*s}Q${w-6*s} ${h-42*s} ${w-42*s} ${h-8*s}Q${w-50*s} ${h-3} ${w-64*s} ${h-3}`;
 out.length=0;edge([w-64*s,h-3],[12,h-5],90,8);edge([12,h-5],[4,h-14],8,9);edge([4,h-14],[4,7],36,10);
 return d+'L'+out.map(p=>p.map(v=>v.toFixed(2)).join(' ')).join('L')+'Z';
}

export function layoutMapPaper(root, width, height) {
  const $ = id => root.querySelector('#' + id);
  const s = Math.max(.55, Math.min(width / 1760, height / 828)), u = n => n * s;
  const d = paperEdge(width, height, s);
  for (const id of ['paper-frame', 'paper-overlay']) $(id).setAttribute('viewBox', `0 0 ${width} ${height}`);
  for (const id of ['paper-face', 'paper-outline', 'paper-depth', 'paper-lip']) $(id).setAttribute('d', d);
  $('paper-corner').setAttribute('d', `M${width-u(64)} ${height-3}Q${width-u(49)} ${height-u(9)} ${width-u(43)} ${height-u(40)}Q${width-u(41)} ${height-u(51)} ${width-3} ${height-u(54)}L${width-u(42)} ${height-u(8)}Q${width-u(50)} ${height-3} ${width-u(64)} ${height-3}`);
  $('paper-grain').setAttribute('width', width); $('paper-grain').setAttribute('height', height);
  for (const [id, pos] of [['paper-fold-one', .32], ['paper-fold-two', .67]]) {
    $(id).setAttribute('x', width * pos - u(42)); $(id).setAttribute('width', u(84)); $(id).setAttribute('height', height);
  }
  const pad = 15 + 9 * Math.max(0, Math.min(1, (width - 540) / 1060));
  const innerWidth = Math.max(1, Math.round(width - pad * 2)), innerHeight = Math.max(1, Math.round(height - pad * 2));
  Object.assign($('map-aperture').style, {left: pad + 'px', top: pad + 'px', width: innerWidth + 'px', height: innerHeight + 'px'});
  $('geo-art').setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
  return {width: innerWidth, height: innerHeight, pad};
}
