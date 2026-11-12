// DJI O4 Pro fused quaternion ↔ Betaflight gyro motion matcher.
// Experimental, browser-local only. No video frames are decoded or uploaded.
// DJI wire field mapping cross-checked against parhipov/DJIFix src/dji_o4.py.
const u32=(v,p)=>v.getUint32(p),four=(v,p)=>String.fromCharCode(...new Uint8Array(v.buffer,v.byteOffset+p,4));
function atoms(v,a,b){const out=[];for(let p=a;p+8<=b;){let n=u32(v,p),h=8;if(n===1){n=Number(v.getBigUint64(p+8));h=16}else if(n===0)n=b-p;if(!Number.isSafeInteger(n)||n<h||p+n>b)throw Error('Invalid MP4 atom');out.push({type:four(v,p+4),a:p+h,b:p+n});p+=n}return out}
function get(v,a,type){return atoms(v,a.a,a.b).find(x=>x.type===type)}
function required(v,a,type){const x=get(v,a,type);if(!x)throw Error('Missing MP4 atom '+type);return x}
async function movie(file){let p=0;while(p<file.size){const buf=new DataView(await file.slice(p,p+16).arrayBuffer());if(buf.byteLength<8)break;let n=u32(buf,0);const type=four(buf,4);if(n===1)n=Number(buf.getBigUint64(8));if(n===0)n=file.size-p;if(!Number.isSafeInteger(n)||n<8||p+n>file.size)throw Error('Invalid MP4 header');if(type==='moov'){if(n>120e6)throw Error('MP4 index exceeds diagnostic memory limit');const v=new DataView(await file.slice(p,p+n).arrayBuffer());return {v,root:{a:n===16?16:8,b:n}}}p+=n}throw Error('MP4 metadata index not found')}
function sampleIndex(v,track){
 const mdia=required(v,track,'mdia'),minf=required(v,mdia,'minf'),stbl=required(v,minf,'stbl'),sd=required(v,stbl,'stsd');
 if(four(v,sd.a+12)!=='djmd')return null;
 const stsz=required(v,stbl,'stsz'),stsc=required(v,stbl,'stsc'),offsets=get(v,stbl,'stco')||get(v,stbl,'co64');
 if(!offsets)throw Error('DJI metadata chunk offsets missing');
 const count=u32(v,stsz.a+8),constant=u32(v,stsz.a+4),sCount=u32(v,stsc.a+4),cCount=u32(v,offsets.a+4);
 if(count>1000000||sCount>100000||cCount>1000000)throw Error('Unreasonably large DJI sample table');
 const sc=[];for(let k=0;k<sCount;k++){const p=stsc.a+8+k*12;sc.push([u32(v,p),u32(v,p+4)])}
 const locations=[];let index=0,entry=0;
 for(let c=0;c<cCount&&index<count;c++){
  while(entry+1<sc.length&&sc[entry+1][0]<=c+1)entry++;
  const cp=offsets.a+8+c*(offsets.type==='co64'?8:4);
  let pos=offsets.type==='co64'?Number(v.getBigUint64(cp)):u32(v,cp);
  for(let j=0;j<sc[entry][1]&&index<count;j++,index++){const size=constant||u32(v,stsz.a+12+index*4);locations.push([pos,size]);pos+=size}
 }
 return locations;
}
function fields(data){let p=0;const out=[];function vi(){let n=0,m=1;for(let k=0;k<10;k++){if(p>=data.length)throw Error('Truncated DJI protobuf');const b=data[p++];n+=(b&127)*m;if(b<128)return n;m*=128}throw Error('Long DJI protobuf varint')}
 while(p<data.length){const tag=vi(),f=Math.floor(tag/8),w=tag%8;if(!f)throw Error('Invalid DJI protobuf tag');let val;if(w===0)val=vi();else if(w===2){let len=vi();if(len<0||p+len>data.length)throw Error('Invalid DJI protobuf length');val=data.subarray(p,p+len);p+=len}else if(w===5){if(p+4>data.length)throw Error('Truncated float');val=new DataView(data.buffer,data.byteOffset+p,4).getFloat32(0,true);p+=4}else if(w===1){p+=8;if(p>data.length)throw Error('Truncated double');continue}else throw Error('Unsupported DJI protobuf wire type');out.push([f,w,val])}
 return out;
}
function sub(data,n){const x=fields(data).find(v=>v[0]===n&&v[1]===2);return x?.[2]}
function quat(data){if(!data)return null;const q=[0,0,0,0];for(const [f,w,v] of fields(data))if(w===5&&f>=1&&f<=4)q[f-1]=v;const norm=Math.hypot(...q);return norm>.5&&norm<1.5?q.map(x=>x/norm):null}
function frameQuat(bytes){
 const fm=sub(bytes,3),imu=fm&&sub(fm,3),att=imu&&sub(imu,2);if(!att)return null;
 const qs=fields(att).filter(x=>x[0]===3&&x[1]===2),pick=qs[Math.floor(qs.length/2)];
 return pick?quat(pick[2]):null;
}
function movingSignal(points,step=0.05){
 // Positive-only angular speed (degrees/s), independent of camera/FC axis alignment.
 const result=[];let j=0;for(let t=0;t<=points[points.length-1][0];t+=step){
  while(j+1<points.length&&points[j+1][0]<t)j++;
  result.push([t,points[j][1]]);
 }return result;
}
function movingAverage(values,r=2){return values.map((_,i)=>{let s=0,n=0;for(let k=Math.max(0,i-r);k<=Math.min(values.length-1,i+r);k++){s+=values[k];n++}return s/n})}
function corr(a,b,shift,from,to,dt){let n=0,sx=0,sy=0,sxx=0,syy=0,sxy=0;
 for(let t=from;t<to;t+=dt){let x=a(t),y=b(t+shift);if(!Number.isFinite(x)||!Number.isFinite(y))continue;n++;sx+=x;sy+=y;sxx+=x*x;syy+=y*y;sxy+=x*y}
 const den=Math.sqrt((n*sxx-sx*sx)*(n*syy-sy*sy));return n<90||den<1e-9?-1:(n*sxy-sx*sy)/den}
function interpolate(signal){const dt=signal[1][0]-signal[0][0],start=signal[0][0];return t=>{let f=(t-start)/dt,i=Math.floor(f);if(i<0||i+1>=signal.length)return NaN;return signal[i][1]*(1-(f-i))+signal[i+1][1]*(f-i)}}
function bestShift(a,b,from,to,centre,radius,step){let best={shift:0,score:-1};for(let shift=centre-radius;shift<=centre+radius+1e-8;shift+=step){const score=corr(a,b,shift,from,to,.05);if(score>best.score)best={shift,score}}return best}
export async function matchDjiMotion(file,bblDuration,bblFieldNames,bblFrameAtTime,onProgress){
 const normals=bblFieldNames.map(v=>v.toLowerCase().replace(/[^a-z0-9]/g,''));
 const ids=[0,1,2].map(i=>normals.indexOf('gyroadc'+i));
 if(ids.some(i=>i<0))throw Error('BBL does not include all three gyroADC fields; no automatic movement match possible.');
 const {v,root}=await movie(file);
 let locations=null;
 for(const tr of atoms(v,root.a,root.b).filter(x=>x.type==='trak')){locations=sampleIndex(v,tr);if(locations)break}
 if(!locations||locations.length<100)throw Error('No usable DJI djmd quaternion metadata samples.');
 const frameDuration=bblDuration;const samples=[],stride=4;
 for(let i=0;i<locations.length;i+=stride){
  const [pos,size]=locations[i];if(size<1||size>100000||pos+size>file.size)continue;
  const bytes=new Uint8Array(await file.slice(pos,pos+size).arrayBuffer());
  try{const q=frameQuat(bytes);if(q)samples.push([i/100,q])}catch(err){if(samples.length===0&&i>100)throw Error('Unable to decode DJI quaternion metadata: '+err.message)}
  if(i%1200===0){onProgress?.('Reading DJI motion metadata '+Math.round(i/locations.length*100)+'%');await new Promise(r=>setTimeout(r,0))}
 }
 if(samples.length<150)throw Error('Too few valid DJI orientation samples for reliable matching ('+samples.length+').');
 const camera=[];for(let i=1;i<samples.length;i++){const [t,q]=samples[i], [prev,qp]=samples[i-1],dt=t-prev;if(dt<=0||dt>.2)continue;const dot=Math.max(-1,Math.min(1,Math.abs(q.reduce((a,x,k)=>a+x*qp[k],0))));camera.push([t,2*Math.acos(dot)*180/Math.PI/dt])}
 const dt=.05,camTimes=camera.map(x=>x[0]),camValues=movingAverage(camera.map(x=>x[1]),2);
 const cam=interpolate(camera.map((x,i)=>[x[0],camValues[i]]));
 onProgress?.('Sampling BBL gyro (no video frames)…');
 const black=[];for(let t=0;t<bblDuration;t+=dt){const f=bblFrameAtTime(t);const values=ids.map(i=>Number(f?.[i]));black.push([t,values.every(Number.isFinite)?Math.hypot(...values):NaN])}
 const blackSmooth=movingAverage(black.map(x=>Number.isFinite(x[1])?x[1]:0),2);
 const blackFn=interpolate(black.map((x,i)=>[x[0],blackSmooth[i]]));
 const camMax=camera.at(-1)[0];
 const windows=[[10,Math.min(42,bblDuration*.33)],[Math.max(45,bblDuration*.45),Math.min(bblDuration*.72,bblDuration-25)],[Math.max(60,bblDuration-43),bblDuration-9]].filter(([a,b])=>b-a>=14);
 if(windows.length<2)throw Error('Flight too short for drift comparison.');
 onProgress?.('Matching motion at start, middle, and end…');
 // Shift maps BBL t to camera t. 8 seconds covers common recording delays.
 const first=bestShift(blackFn,cam,...windows[0],0,8,.1);
 const refined=bestShift(blackFn,cam,...windows[0],first.shift,.18,.01);
 const results=[{time:(windows[0][0]+windows[0][1])/2,...refined}];
 for(const [a,b] of windows.slice(1)){const coarse=bestShift(blackFn,cam,a,b,refined.shift,1.2,.04);results.push({time:(a+b)/2,...bestShift(blackFn,cam,a,b,coarse.shift,.07,.01)})}
 const scores=results.map(x=>x.score);
 if(scores.some(s=>s<.45))return {status:'low-confidence',reason:'Motion correlation was too weak in one or more sections. No safe automatic speed recommendation.',scores,results,quaternions:samples.length};
 const firstPoint=results[0],lastPoint=results.at(-1),slope=(lastPoint.shift-firstPoint.shift)/(lastPoint.time-firstPoint.time);
 const speed=100/(1+slope);
 const predicted=results.map(p=>firstPoint.shift+slope*(p.time-firstPoint.time));
 const residual=Math.max(...results.map((p,i)=>Math.abs(p.shift-predicted[i])));
 if(!Number.isFinite(speed)||speed<98||speed>102||residual>.15)return {status:'low-confidence',reason:'Movement alignment is inconsistent across the flight. No reliable speed recommendation.',scores,results,quaternions:samples.length,residual};
 return {status:'estimate',speed,results,scores,residual,quaternions:samples.length,offset:results[0].shift};
}
