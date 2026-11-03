import {gait,workingPose,rotatePoint,limbPath} from './people.mjs';
export function makePeopleAnimator(){
 const cache=new Map();
 const get=id=>{if(!cache.has(id)){const root=document.getElementById(id);if(!root)return null;const parts={};root.querySelectorAll('[data-part]').forEach(p=>parts[p.dataset.part]=p);cache.set(id,{root,parts,role:root.dataset.actor,tilt:Number(parts.head?.parentElement?.dataset.headTilt||0)});}return cache.get(id)};
 const attr=(n,k,v)=>{if(n)n.setAttribute(k,String(v))};
 const transform=(n,v)=>attr(n,'transform',v);
 return function act(id,state={}){
  const a=get(id);if(!a)return;const p=a.parts;
  transform(p.head,`rotate(${a.tilt+(state.nod||0)})`);
  if(a.role==='traveller'||a.role==='pusher'){
   const v=gait(state.distance||0,state.walk||0,state.phase||0);
   attr(p['leg-back'],'d',v.legs[0].d);attr(p['shoe-back'],'d',v.legs[0].shoe);attr(p['leg-front'],'d',v.legs[1].d);attr(p['shoe-front'],'d',v.legs[1].shoe);
   transform(p.body,`translate(0 ${v.bob})`);
   transform(p.pack,`rotate(${Math.sin(v.phase*Math.PI*2-.3)*.8*(state.walk||0)} -30 -176)`);
   transform(p['arm-back'],`rotate(${Math.sin(v.phase*Math.PI*2)*2.5*(state.walk||0)} -20 -181)`);
   if(a.role==='pusher'){attr(p['push-far'],'d',limbPath([-17,-182],[3,-153],[58,-148-v.bob],14,12,6));attr(p['push-near'],'d',limbPath([17,-182],[31,-151],[65,-150-v.bob],17,13,6));transform(p['push-hand0'],`translate(58 ${-148-v.bob})`);transform(p['push-hand1'],`translate(65 ${-150-v.bob})`);}
  }else if(a.role==='worker'){
   const angle=state.angle||0,kind=a.root.dataset.tool,v=workingPose(angle,kind,state.reach||0);
   attr(p['arm-near'],'d',v.near);attr(p['arm-far'],'d',v.far);
   transform(p.tool,`rotate(${angle} 60 -130)`);
   transform(p['hand-near'],`translate(${v.hands[0]}) rotate(${v.angle})`);transform(p['hand-far'],`translate(${v.hands[1]}) rotate(${v.angle})`);
   const sp=rotatePoint([156,-174],angle,[60,-130]),target=rotatePoint([(state.target?.[0]??156)-(state.weight||0),state.target?.[1]??-140],-(state.lean||0),[-12,-105]);
   attr(p.pour,'opacity',state.pour||0);attr(p.pour,'d',`M${sp}C${sp[0]+4} ${sp[1]+8} ${target[0]} ${target[1]-9} ${target}`);
   transform(p.body,`translate(${state.weight||0} 0) rotate(${state.lean||0} -12 -105)`);
  }else if(a.role==='guard')transform(p.spear,`rotate(${state.spear||0} 57 -178)`);
  else{transform(p.arms,`rotate(${state.read||0} -10 -185)`);transform(p.body,`translate(0 ${state.weight||0})`);}
 };
}
