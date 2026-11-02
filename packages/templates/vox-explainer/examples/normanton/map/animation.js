function animate({select,cue,onFrame,spatial,anchors}) {
  const clamp=x=>Math.max(0,Math.min(1,x));
  const ease=x=>{x=clamp(x);return x*x*(3-2*x)};
  const ramp=(t,a,d=.6)=>ease((t-a)/d);
  const mix=(a,b,u)=>a+(b-a)*u;
  const node=id=>select('#'+id);
  const show=(id,v)=>node(id).setAttribute('opacity',clamp(v));
  const pose=(id,x,y,s=1,r=0)=>node(id).setAttribute('transform',`translate(${x} ${y}) rotate(${r}) scale(${s})`);
  const M=Object.fromEntries(Array.from({length:9},(_,i)=>{const id=`M${String(i+1).padStart(3,'0')}`;return[id,cue(id)]}));
  const camera=spatial.cameraTrack([960,470,1],[
    {start:M.M002-.2,duration:.8,to:[anchors.event[0]+80,anchors.event[1]-140,1.45]},
    {start:M.M003,duration:1.2,to:[1090,570,1.02]},
    {start:M.M005,duration:1.1,to:[1010,510,.86]},
    {start:M.M006-.3,duration:1,to:[960,470,1]},
    {start:M.M009,duration:1,to:[960,470,.95]}
  ]);
  const center=[960,470];
  const ring=node('event-ring');
  onFrame(({time:t})=>{
    const zoom=camera(t);pose('map-world',center[0]-zoom[0]*zoom[2],center[1]-zoom[1]*zoom[2],zoom[2]);
    const base=1-ramp(t,M.M006-.1,.7);
    show('map-chapter',base);
    show('map-heading',1-ramp(t,M.M002-.2,.6));
    show('trip-line',ramp(t,.1,.7)*(1-ramp(t,M.M002-.1,.45)));
    show('event-mark',ramp(t,1.25,.65));
    ring.setAttribute('stroke-dashoffset',-(Math.min(t,8)*12)%21);
    const sink=ramp(t,M.M002+.55,1.1);
    pose('sinking-ship',0,110*sink,.98,-7*sink);
    show('map-ship',ramp(t,.45,.7)*(1-ramp(t,M.M003-.5,.5)));
    show('hours',ramp(t,M.M002-.1,.2)*(1-ramp(t,M.M003-.1,.45)));
    node('hours-line').setAttribute('stroke-dasharray',`${ramp(t,M.M002,.6)} 1`);
    const ripple=ramp(t,M.M002+.9,.5)*(1-ramp(t,M.M003+.2,.7));
    show('map-ripple',ripple);
    const labels=[['yokohama',anchors.yokohama],['kobe',anchors.kobe],['oshima',anchors.oshima],['kumano',anchors.event]];
    for(const [name,p] of labels){
      const q=spatial.screenPoint(p,zoom,center);
      pose('label-'+name,q[0]+(name==='kumano'?230:0),q[1]+(name==='kumano'?-20:0));
      const visible=name==='kobe'||name==='yokohama'?1-ramp(t,M.M002-.1,.5):ramp(t,.7,.6);
      show('label-'+name,visible*(name==='oshima'?1-ramp(t,M.M003,.7):name==='kumano'?1-ramp(t,M.M005,.6):1));
    }
    show('geo-note',1-ramp(t,M.M002-.2,.6));

    const detailIn=ramp(t,M.M003,.9),detailOut=ramp(t,M.M006-.2,.6);
    const detailScale=mix(.04,1,detailIn);
    const a=spatial.screenPoint(anchors.event,zoom,center);
    const dx=mix(a[0],972,detailIn),dy=mix(a[1],150,detailIn);
    pose('detail-window',dx,dy,detailScale);
    show('detail-window',detailIn*(1-detailOut));
    const connector=`M${a[0]} ${a[1]} L${dx+30*detailScale} ${dy+420*detailScale}`;
    for(const id of ['detail-link','detail-link-ink']){node(id).setAttribute('d',connector);show(id,detailIn*(1-detailOut)*(1-ramp(t,M.M005,.6))*.85)}
    const rescue=ramp(t,M.M003+.5,1.7);
    pose('villager-0',mix(735,705,rescue),mix(225,300,rescue),.92);
    const arrive=ramp(t,M.M004,.95);
    pose('lifeboat',mix(203,440,arrive),mix(439,400,arrive),.96);
    show('lifeboat',ramp(t,M.M003+1.1,.6));
    pose('captain',mix(500,552,ramp(t,M.M004+.9,.85)),mix(392,357,ramp(t,M.M004+.9,.85)),1.12);
    show('captain',ramp(t,M.M004+.8,.3));
    show('captain-aboard',1-ramp(t,M.M004+.8,.3));
    pose('crew-cluster',mix(414,620,ramp(t,M.M004+1.4,1)),mix(389,357,ramp(t,M.M004+1.4,1)),.9);
    show('crew-cluster',ramp(t,M.M004+1.35,.3));
    show('crew-aboard',1-ramp(t,M.M004+1.35,.3));
    show('safe-tag',ramp(t,M.M004+.2,.6));
    const exceptionIn=ramp(t,M.M005,.7);
    pose('crew-exception',135,mix(476,382,exceptionIn));
    show('crew-exception',exceptionIn*(1-ramp(t,M.M006-.1,.6)));

    const passengers=ramp(t,M.M006-.1,.7),lost=ramp(t,M.M007,.9),comparison=ramp(t,M.M008-.15,.7);
    show('passenger-chapter',passengers*(1-comparison));
    pose('passenger-ship',407,627,1.3);
    pose('passenger-grid',mix(836,690,lost),mix(277,335,lost),1);
    for(let i=0;i<25;i++){
      const g=node('passenger-'+i),enter=ramp(t,M.M006+.2+(i%5)*.08+Math.floor(i/5)*.12,.45);
      const down=ramp(t,M.M007+(i%5)*.06+Math.floor(i/5)*.07,.9);
      g.setAttribute('transform',`translate(${i%5*108} ${Math.floor(i/5)*82+down*38})`);
      g.setAttribute('opacity',enter*(1-down*.7));
      g.setAttribute('color',down>.5?'#4f5b51':'var(--accent)');
    }
    show('passenger-outcome',ramp(t,M.M007+.55,.6));
    show('passenger-water',ramp(t,M.M007,.65));
    show('passenger-ship',1-lost*.65);
    pose('passenger-title',0,-lost*14);

    const news=ramp(t,M.M009,.7);
    show('contrast',comparison*(1-news));
    show('responsibility',ramp(t,M.M008+2.2,.6));
    pose('contrast-captain',1260,mix(512,493,ramp(t,M.M008+.1,.8)),3.1);
    show('news',news);
    pose('news',0,mix(65,0,news),1,mix(-2,0,news));
    show('news-marks',ramp(t,M.M009+.4,.9));
  });
}

animate({select,cue,onFrame,spatial,anchors:{"yokohama":[1522,341],"kobe":[480,445],"oshima":[627.211426770727,698.4544977229864],"event":[662.1060175081866,718.1507832719861]}});