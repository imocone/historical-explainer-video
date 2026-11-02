from pathlib import Path
import subprocess,json,wave,array,math
root=Path(__file__).resolve().parent
lines=[
('same','同样一桶水，把绳子都拉下一段。左边升得高，右边却只升了一半。',['同样一桶水，把绳子都拉下一段。','左边升得高，右边却只升了一半。'],8),
('support','差别就在这里。左边一段绳提桶；右边两段绳，共同托着会移动的滑轮。',['左边一段绳提桶；','右边两段绳，共同托着会移动的滑轮。'],8),
('force','忽略摩擦和滑轮重量，两段绳各分担一半重量，手上需要的力也就减半。',['忽略摩擦和滑轮重量，','两段绳各分担一半重量，手上需要的力也就减半。'],8),
('rewind','把它倒回去。这次让两只桶升到一样高。',['把它倒回去。','这次让两只桶升到一样高。'],5),
('length','动滑轮两侧的绳段，都要缩短同样长度。手就必须拉走两倍的绳。',['动滑轮两侧的绳段，都要缩短同样长度。','手就必须拉走两倍的绳。'],8),
('end','它省力，却不省功。少用一半力，要走两倍的路。',['它省力，却不省功。','少用一半力，要走两倍的路。'],5)]
rate=48000;clips=[];cursor=.5
for i,(key,text,captions,minimum) in enumerate(lines):
 a=root/'assets'/f'voice-{i}.aiff';w=a.with_suffix('.wav')
 subprocess.run(['/usr/bin/say','-v','Tingting','-r','206','-o',str(a),text],check=True)
 subprocess.run(['ffmpeg','-v','error','-y','-i',str(a),'-ar',str(rate),'-ac','1','-af','silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse,loudnorm=I=-17:TP=-2:LRA=7',str(w)],check=True)
 with wave.open(str(w)) as f:n=f.getnframes();voice=n/rate
 d=max(minimum,voice+.65)
 clips.append(dict(key=key,text=text,captions=captions,start=round(cursor,4),voiceDuration=voice,duration=d,file=w.name))
 cursor+=d
length=math.ceil((cursor+1)*60)/60;mix=array.array('h',[0])*(math.ceil(length*rate))
for c in clips:
 with wave.open(str(root/'assets'/c['file'])) as f:a=array.array('h',f.readframes(f.getnframes()))
 start=round(c['start']*rate)
 mix[start:start+len(a)]=a
with wave.open(str(root/'assets/narration.wav'),'w') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(rate);f.writeframes(mix.tobytes())
(root/'timing.json').write_text(json.dumps(dict(duration=length,clips=clips),ensure_ascii=False,indent=2))
print(json.dumps(dict(duration=length,clips=[(c['key'],round(c['start'],2),round(c['voiceDuration'],2)) for c in clips])))
