import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {promisify} from "node:util";
import test from "node:test";
import {mixCompositionAudio} from "./audio-mix.mjs";

const exec=promisify(execFile);
const sample=(wav,channel=0)=>wav.readInt16LE(wav.indexOf(Buffer.from("data"))+8+Math.floor(.2*48000)*4+channel*2);

test("逐段片头旁白单声道转双声道保持原电平，其他轨道与旧模板不变",async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),"opposed-audio-"));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const mono=path.join(directory,"mono.wav"),stereo=path.join(directory,"stereo.wav");
  await exec("ffmpeg",["-v","error","-y","-f","lavfi","-i","aevalsrc=0.05:d=1:s=48000","-c:a","pcm_s16le",mono]);
  await exec("ffmpeg",["-v","error","-y","-f","lavfi","-i","aevalsrc=0.04|0.08:d=1:s=48000","-c:a","pcm_s16le",stereo]);
  const input=await readFile(mono), inputOffset=input.indexOf(Buffer.from("data"))+8+Math.floor(.2*48000)*2;
  const original=input.readInt16LE(inputOffset),stereoInput=await readFile(stereo);
  const mix=async({templateId="opposed-opener",id="opener-narration",kind="narration",file="mono.wav"}={})=>{
    const result=await mixCompositionAudio({projectDirectory:directory,
      props:{fps:60,segments:[{segmentType:"opener",templateId}],audioTracks:[{id,kind,segmentType:"opener",file,startMs:0,endMs:1000,volume:1,loop:false}]},
      timeline:{fromFrame:0,toFrame:60,anchorMs:0}});
    return readFile(result);
  };
  const opposed=await mix();
  assert.ok(Math.abs(sample(opposed)/original-1)<.01);
  assert.ok(Math.abs(sample(opposed,1)/original-1)<.01);
  const unchangedStereo=await mix({file:"stereo.wav"});
  assert.ok(Math.abs(sample(unchangedStereo)/sample(stereoInput)-1)<.01);
  assert.ok(Math.abs(sample(unchangedStereo,1)/sample(stereoInput,1)-1)<.01);
  const legacy=await mix({templateId:"episode-opener"});
  const music=await mix({id:"music",kind:"background-music"});
  for(const output of [legacy,music]) assert.ok(Math.abs(sample(output)/original-Math.SQRT1_2)<.01);
});
