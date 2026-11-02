import React, { useLayoutEffect, useRef } from "react";
import { VIDEO_SPEC } from "../../../video-spec.mjs";
import { projectedEffectAnchor } from "./runtime.mjs";

const vertex = `attribute vec2 position; void main(){gl_Position=vec4(position,0.,1.);}`;
const common = `precision highp float;
uniform vec2 resolution;
uniform float time, amount, drift, fullRegion, mirror;
uniform vec2 lightSource;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
float noise(vec2 p){
  vec2 a=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(a),hash(a+vec2(1.,0.)),f.x),mix(hash(a+vec2(0.,1.)),hash(a+vec2(1.,1.)),f.x),f.y);
}
float fbm(vec2 p){
  float sum=0., amp=.5; mat2 turn=mat2(.8,-.6,.6,.8);
  for(int i=0;i<5;i++){sum+=noise(p)*amp; p=turn*p*2.03+vec2(19.1,7.7); amp*=.5;}
  return sum;
}
vec2 uv(){return vec2(gl_FragCoord.x/resolution.x,1.-gl_FragCoord.y/resolution.y);}
`;

// Evolving noise supplies volume; these are frame-sampled overlays, not clocks.
const shaders = {
  fog: `${common}
void main(){
  vec2 q=uv(), p=vec2(q.x*5.2,q.y*8.5)+vec2(-time*.23*drift,0.);
  vec2 bend=vec2(fbm(p*.6+time*.08),fbm(p*.6+vec2(9.1,-time*.09)));
  float large=fbm(p+bend*2.5), fine=fbm(p*1.7+vec2(time*.13,-time*.07));
  float density=smoothstep(.28,.73,large*.72+fine*.28);
  float ground=mix(smoothstep(.50,.84,q.y),1.,fullRegion);
  float lower=smoothstep(.72,1.,q.y);
  float alpha=(density*.66+.05)*ground*(.64+.36*lower)*amount;
  gl_FragColor=vec4(mix(vec3(.56,.64,.68),vec3(.86,.89,.89),density),alpha);
}`,
  dust: `${common}
void main(){
  vec2 q=uv(), p=vec2(q.x*6.1,q.y*10.2)+vec2(-time*.37*drift,-time*.12);
  vec2 curl=vec2(fbm(p*.62+vec2(0.,time*.14)),fbm(p*.65+vec2(7.,-time*.1)));
  float n=fbm(p+curl*3.1), mass=smoothstep(.30,.70,n);
  float band=mix(smoothstep(.50,.76,q.y),1.,fullRegion)*(1.-smoothstep(.98,1.15,q.y));
  float gust=.70+.30*sin(time*.9+q.x*4.);
  gl_FragColor=vec4(mix(vec3(.46,.36,.24),vec3(.80,.68,.48),n),mass*band*gust*.76*amount);
}`,
  "soft-light": `${common}
void main(){
  vec2 q=uv(), d=q-lightSource; d.x*=1.7777778*mirror;
  float angle=atan(d.y,d.x), broad=fbm(vec2(angle*7.5,time*.19));
  float narrow=pow(.5+.5*sin(angle*31.+broad*6.+time*.24),3.);
  float fan=smoothstep(.12,.34,angle)*(1.-smoothstep(1.28,1.58,angle));
  float texture=fbm(q*vec2(8.,5.)+vec2(time*.03,-time*.1));
  float breath=.65+.35*sin(time*.66-.65);
  float rays=(narrow*.67+broad*.33)*fan;
  float distanceFade=1.-smoothstep(.3,1.55,length(d));
  gl_FragColor=vec4(1.,.85,.61,rays*(.5+texture*.5)*distanceFade*breath*.9*amount);
}`,
  grain: `${common}
void main(){
  vec2 q=gl_FragCoord.xy/2.4; float tick=floor(time*24.);
  float n=noise(q+vec2(tick*13.27,tick*31.19));
  float fine=hash(floor(gl_FragCoord.xy)+vec2(tick*39.17));
  float tone=clamp(.5+(n-.5)*1.2+(fine-.5)*.18,0.,1.);
  gl_FragColor=vec4(vec3(tone),.24*amount);
}`
};

const compile = (gl, type, source) => {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
};

export const Atmosphere = ({ effect, seconds, camera, strength }) => {
  const canvas = useRef(null), state = useRef(null);
  const { width, height } = VIDEO_SPEC;
  const kind = effect.type;
  useLayoutEffect(() => {
    const gl = canvas.current.getContext("webgl", { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("全画幅效果无法创建WebGL画布");
    const program = gl.createProgram();
    const vs = compile(gl, gl.VERTEX_SHADER, vertex), fs = compile(gl, gl.FRAGMENT_SHADER, shaders[kind]);
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    gl.useProgram(program);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniforms = Object.fromEntries(["resolution", "time", "amount", "drift", "fullRegion", "mirror", "lightSource"]
      .map(name => [name, gl.getUniformLocation(program, name)]));
    state.current = { gl, program, uniforms };
    return () => {
      state.current = null; gl.deleteBuffer(buffer); gl.deleteProgram(program); gl.deleteShader(vs); gl.deleteShader(fs);
    };
  }, [kind]);
  useLayoutEffect(() => {
    const { gl, program, uniforms: u } = state.current;
    if (gl.isContextLost()) throw new Error("全画幅效果WebGL上下文已丢失");
    const source = effect.anchor ? projectedEffectAnchor({ anchor: effect.anchor, camera }) : { x: 0, y: 0 };
    gl.viewport(0, 0, canvas.current.width, canvas.current.height); gl.useProgram(program);
    gl.uniform2f(u.resolution, canvas.current.width, canvas.current.height);
    gl.uniform1f(u.time, seconds); gl.uniform1f(u.amount, strength.atmosphere);
    gl.uniform1f(u.drift, (effect.direction === "left" ? -1 : effect.direction === "calm" ? 0 : 1) * strength.drift);
    gl.uniform1f(u.fullRegion, effect.region === "full" ? 1 : 0);
    gl.uniform1f(u.mirror, effect.source === "top-right" ? -1 : 1);
    gl.uniform2f(u.lightSource, source.x, source.y);
    gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.finish();
  }, [kind, seconds, strength, effect, camera, width, height]);
  return <canvas ref={canvas} width={kind === "grain" ? width : Math.round(width / 2)}
    height={kind === "grain" ? height : Math.round(height / 2)} style={{ width: "100%", height: "100%",
      mixBlendMode: kind === "soft-light" ? "screen" : kind === "grain" ? "soft-light" : "normal" }}/>;
};
