export function createTrafficModel(cues,duration) {
  const steps=60,dt=1/steps;
  const shortcut=Array(40).fill(false),frames=[];
  let cycle=0;
  for(let frame=0;frame<=Math.ceil(duration*steps);frame++) {
    const time=frame*dt;
    const share=shortcut.filter(Boolean).length/40;
    const next=cycle+dt/(4+4*share);
    const desired=time>=cues.crowd&&time<cues.return;
    for(let i=0;i<40;i++) {
      const offset=(i+.5)/40;
      if(Math.floor(cycle+offset)!==Math.floor(next+offset))shortcut[i]=desired;
    }
    cycle=next;
    const r=shortcut.filter(Boolean).length/40;
    frames.push({time,cycle,shortcut:[...shortcut],share:r,flow:2000+2000*r,
      variable:20+20*r,old:65+20*r,new:40+40*r});
  }
  return time=>frames[Math.max(0,Math.min(frames.length-1,Math.round(time*steps)))];
}
