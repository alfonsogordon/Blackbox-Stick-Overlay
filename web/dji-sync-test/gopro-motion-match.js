// GoPro GPMF gyro-to-Betaflight motion matching, TEST ONLY.
// Browser-local reads of gpmd metadata samples. No video/audio decoding.
// GPMF layout documented at https://gopro.github.io/gpmf-parser/
function word(v,p){return String.fromCharCode(v[p],v[p+1],v[p+2],v[p+3])}
const u32=(v,p)=>v.getUint32(p);
function boxes(v,start,end){const a=[];for(let p=start;p+8<=end;){let n=u32(v,p),h=8;if(n===1){n=Number(v.getBigUint64(p+8));h=16}else if(n===0)n=end-p;if(!Number.isSafeInteger(n)||n<h||p+n>end)throw Error('Invalid MP4 atom at '+p);a.push({type:word(new Uint8Array(v.buffer,v.byteOffset),p+4),start:p+h,end:p+n});p+=n}return a}
const find=(v,parent,key)=>boxes(v,parent.start,parent.end).find(x=>x.type===key);
function requireBox(v,p,k){const b=find(v,p,k);if(!b)throw Error('Missing '+k+' atom');return b}
async function mp4Index(file){let pos=0;for(let n=0;n<10000&&pos<file.size;n++){const v=new DataView(await file.slice(pos,pos+16).arrayBuffer());if(v.byteLength<8)break;let size=u32(v,0);if(size===1)size=Number(v.getBigUint64(8));if(size===0)size=file.size-pos;const type=word(new Uint8Array(v.buffer),4);if(!Number.isSafeInteger(size)||size<8||pos+size>file.size)throw Error('Bad MP4 header');if(type==='moov'){if(size>128*1048576)throw Error('MP4 index too large');return {v:new DataView(await file.slice(pos,pos+size).arrayBuffer()),root:{start:size>=16&&u32(v,0)===1?16:8,end:size}}}pos+=size}throw Error('MP4 metadata index missing')}
function indexedGpmf(v,root){
 for(const tr of boxes(v,root.start,root.end).filter(x=>x.type==='trak')){
  const mdia=find(v,tr,'mdia'),minf=mdia&&find(v,mdia,'minf'),stbl=minf&&find(v,minf,'stbl');
  if(!stbl)continue;
  const sd=find(v,stbl,'stsd');if(!sd||word(new Uint8Array(v.buffer),sd.start+12)!=='gpmd')continue;
  const mdhd=requireBox(v,mdia,'mdhd'),version=v.getUint8(mdhd.start);
  const scale=u32(v,mdhd.start+(version===1?20:12));if(!scale)throw Error('Bad GoPro metadata timescale');
  const stts=requireBox(v,stbl,'stts'),sz=requireBox(v,stbl,'stsz'),sc=requireBox(v,stbl,'stsc'),co=find(v,stbl,'stco')||find(v,stbl,'co64');
  if(!co)throw Error('GoPro metadata chunk offsets missing');
  const count=u32(v,sz.start+8),fixed=u32(v,sz.start+4),scCount=u32(v,sc.start+4),coCount=u32(v,co.start+4);
  if(count>500000||scCount>20000||coCount>500000)throw Error('Huge GoPro metadata sample table');
  const chunkDefs=[];for(let i=0;i<scCount;i++){const p=sc.start+8+i*12;chunkDefs.push([u32(v,p),u32(v,p+4)])}
  const index=[];let si=0,entry=0;
  for(let ci=0;ci<coCount&&si<count;ci++){
   while(entry+1<chunkDefs.length&&chunkDefs[entry+1][0]<=ci+1)entry++;
   let pos=co.type==='co64'?Number(v.getBigUint64(co.start+8+ci*8)):u32(v,co.start+8+ci*4);
   for(let i=0;i<chunkDefs[entry][1]&&si<count;i++,si++){
    const length=fixed||u32(v,sz.start+12+si*4);index.push({pos,length});pos+=length;
   }
  }
  let sample=0,ticks=0;for(let i=0;i<u32(v,stts.start+4);i++){const p=stts.start+8+i*8;const n=u32(v,p),dt=u32(v,p+4);for(let j=0;j<n&&sample<index.length;j++,sample++){index[sample].time=ticks/scale;index[sample].period=dt/scale;ticks+=dt}}
  return {index,duration:ticks/scale};
 }
 throw Error('No GoPro GPMF gpmd metadata track found. Footage may lack gyro metadata.');
}
function records(b,start=0,end=b.length){const out=[];for(let p=start;p+8<=end;){
 const key=word(b,p),type=String.fromCharCode(b[p+4]),size=b[p+5],repeat=(b[p+6]<<8)|b[p+7],bytes=size*repeat,n=(bytes+3)&~3;
 if(!size||p+8+n>end)break;
 out.push({key,type,size,repeat,value:b.subarray(p+8,p+8+bytes)});p+=8+n;
 }return out}
function gpmfPacket(data){
 const streams=[];let deviceName='';
 function scan(bytes,depth=0){if(depth>7)return;const r=records(bytes);for(const v of r){
  if(v.key==='DVNM')deviceName=new TextDecoder().decode(v.value).replace(/\0/g,'').trim();
  if(v.key==='STRM'){const parts=records(v.value);const gyro=parts.find(x=>x.key==='GYRO');if(gyro){const scaleEntry=parts.find(x=>x.key==='SCAL');const tsmp=parts.find(x=>x.key==='TSMP');let scale=1;if(scaleEntry&&scaleEntry.size>=2){const sv=new DataView(scaleEntry.value.buffer,scaleEntry.value.byteOffset);scale=scaleEntry.type==='l'?sv.getInt32(0,false):scaleEntry.type==='L'?sv.getUint32(0,false):scaleEntry.type==='s'?sv.getInt16(0,false):scaleEntry.type==='S'?sv.getUint16(0,false):1}
  const vals=[],dv=new DataView(gyro.value.buffer,gyro.value.byteOffset);
  const size=gyro.size,count=Math.min(gyro.repeat,3000);
  for(let i=0;i<count;i++){const p=i*size;if(p+size>gyro.value.length)break;const a=[];for(let j=0;j<3;j++){const at=p+j*(size/3);if(gyro.type==='s'&&size===6)a.push(dv.getInt16(at,false));else if(gyro.type==='l'&&size===12)a.push(dv.getInt32(at,false));else if(gyro.type==='f'&&size===12)a.push(dv.getFloat32(at,false));else{a.length=0;break}}
   if(a.length===3&&Number.isFinite(scale)&&scale!==0)vals.push(Math.hypot(...a)/scale);
  }
  let total=null;if(tsmp?.value.length>=4)total=new DataView(tsmp.value.buffer,tsmp.value.byteOffset).getUint32(0,false);
  if(vals.length)streams.push({vals,total,scale});
 }}
  if(v.key==='DEVC'||v.key==='GPMF')scan(v.value,depth+1);
 }}scan(data);return {streams,deviceName};
}
const smooth=(v,r=2)=>v.map((_,i)=>{let s=0,n=0;for(let j=Math.max(0,i-r);j<=Math.min(v.length-1,i+r);j++){s+=v[j];n++}return s/n});
function interp(pts){if(pts.length<2)throw Error('Insufficient sensor samples');return t=>{if(t<pts[0][0]||t>pts.at(-1)[0])return NaN;let lo=0,hi=pts.length-1;while(lo+1<hi){let m=(lo+hi)>>1;if(pts[m][0]<=t)lo=m;else hi=m}const a=pts[lo],b=pts[hi],q=(t-a[0])/(b[0]-a[0]);return a[1]*(1-q)+b[1]*q}}
function corr(a,b,delta,from,to,step=.1){let n=0,sx=0,sy=0,xx=0,yy=0,xy=0;for(let t=from;t<to;t+=step){const x=a(t),y=b(t+delta);if(!Number.isFinite(x)||!Number.isFinite(y))continue;n++;sx+=x;sy+=y;xx+=x*x;yy+=y*y;xy+=x*y}const d=Math.sqrt((n*xx-sx*sx)*(n*yy-sy*sy));return n<60||d<1e-9?-1:(n*xy-sx*sy)/d}
function peak(a,b,start,end,center,radius,step){let best={shift:0,score:-1};for(let s=center-radius;s<=center+radius+1e-8;s+=step){const score=corr(a,b,s,start,end);if(score>best.score)best={shift:s,score}}return best}
function fit(points){let sw=0,x=0,y=0,xx=0,xy=0;for(let p of points){let w=p.score*p.score;sw+=w;x+=w*p.time;y+=w*p.shift;xx+=w*p.time*p.time;xy+=w*p.time*p.shift}const d=sw*xx-x*x;if(Math.abs(d)<1e-8)return null;const slope=(sw*xy-x*y)/d;return {slope,intercept:(y-slope*x)/sw}}
export async function matchGoProMotion(file,bblDuration,fieldNames,frameAtTime,onProgress){
 const names=fieldNames.map(s=>s.toLowerCase().replace(/[^a-z0-9]/g,'')),ids=[0,1,2].map(i=>names.indexOf('gyroadc'+i));
 if(ids.some(i=>i<0))throw Error('BBL gyroADC[0..2] fields are required.');
 const {v,root}=await mp4Index(file),{index,duration:videoDuration}=indexedGpmf(v,root);
 if(index.length<4)throw Error('Not enough GoPro gyro metadata packets.');
 const camera=[],packetInfo=[];let totalGyro=0;
 for(let k=0;k<index.length;k++){
  const entry=index[k];if(entry.length>2*1048576||entry.pos+entry.length>file.size)continue;
  const raw=new Uint8Array(await file.slice(entry.pos,entry.pos+entry.length).arrayBuffer());
  const pack=gpmfPacket(raw);
  // Camera gyro stream: pick largest valid stream in the payload.
  const stream=pack.streams.sort((a,b)=>b.vals.length-a.vals.length)[0];if(!stream)continue;
  const values=stream.vals,n=values.length;
  // Time spans are based on MP4 packet timestamps, with sensor samples spread
  // within their metadata interval; TSMP is retained for diagnosis.
  for(let j=0;j<n;j+=Math.max(1,Math.floor(n/Math.max(8,Math.round(entry.period*35))))){
   const t=entry.time+(j+.5)*entry.period/n;
   camera.push([t,values[j]]);
  }
  totalGyro+=n;packetInfo.push({time:entry.time,count:n,total:stream.total});
  if(k%32===0){onProgress?.('Reading GoPro GPMF gyro '+Math.round(k/index.length*100)+'%');await new Promise(r=>setTimeout(r,0))}
 }
 camera.sort((a,b)=>a[0]-b[0]);
 if(camera.length<150)throw Error('Not enough GoPro gyro data. Try an original MP4 with GPMF metadata.');
 const camValues=smooth(camera.map(p=>p[1]),3),cam=interp(camera.map((p,i)=>[p[0],camValues[i]]));
 const black=[];for(let t=0;t<bblDuration;t+=.05){const f=frameAtTime(t),v=ids.map(i=>Number(f?.[i]));black.push([t,v.every(Number.isFinite)?Math.hypot(...v):0])}
 const bv=smooth(black.map(p=>p[1]),2),bb=interp(black.map((p,i)=>[p[0],bv[i]]));
 // GoPro might start minutes before the Blackbox log. Search the entire video
 // for a distinctive 14-second movement signature, then refine locally.
 const span=14,anchors=[Math.max(2,bblDuration*.15),Math.max(4,bblDuration*.42),Math.max(4,bblDuration*.7)].filter(t=>t+span<bblDuration-2);
 if(!anchors.length)throw Error('Flight too short for GoPro auto match.');
 onProgress?.('Finding flight inside GoPro recording (including long pre-roll)…');
 let candidates=[];
 for(const a of anchors){
  const from=a,to=a+span;let best=[];
  for(let delta=-to+3;delta<=videoDuration-from-3;delta+=.8){
   const score=corr(bb,cam,delta,from,to,.15);
   if(score>.48){best.push({shift:delta,score});best.sort((x,y)=>y.score-x.score);if(best.length>6)best.pop()}
  }
  candidates.push(...best.map(p=>({...p,anchor:a})));
  await new Promise(r=>setTimeout(r,0));
 }
 candidates.sort((a,b)=>b.score-a.score);
 if(!candidates.length)return {status:'low-confidence',reason:'Could not locate a distinctive matching flight movement in the GoPro recording.',totalWindows:0,matchedWindows:0,scores:[],results:[],gyroSamples:totalGyro,videoDuration};
 // Recheck candidates over multiple separated windows, to reject repeated motions.
 const checks=[.18,.48,.78].map(x=>Math.max(2,Math.min(bblDuration-16,bblDuration*x)));
 let winner=null;
 for(const c of candidates.slice(0,18)){
  let scores=[];for(const a of checks){const local=peak(bb,cam,a,a+14,c.shift,1.5,.12);scores.push(local.score)}
  const avg=scores.reduce((a,b)=>a+b,0)/scores.length;
  if(!winner||avg>winner.avg)winner={shift:c.shift,avg,scores};
 }
 if(!winner||winner.avg<.52||winner.scores.filter(x=>x>.5).length<2)
  return {status:'low-confidence',reason:'GoPro pre-roll alignment was ambiguous. No reliable speed correction.',totalWindows:3,matchedWindows:0,scores:winner?.scores||[],results:[],gyroSamples:totalGyro,videoDuration};
 const begin=6,windowSize=Math.min(16,Math.max(9,bblDuration/8)),end=bblDuration-windowSize-6;
 const count=Math.min(20,Math.max(7,Math.ceil((end-begin)/9)+1));
 const windows=Array.from({length:count},(_,i)=>{const a=begin+(end-begin)*i/(count-1);return [a,a+windowSize]});
 const results=[];
 for(let i=0;i<windows.length;i++){
  const [a,b]=windows[i],p=results.at(-1),pred=p?p.shift:winner.shift;
  const coarse=peak(bb,cam,a,b,pred,1.4,.08),fine=peak(bb,cam,a,b,coarse.shift,.12,.01);
  results.push({time:(a+b)/2,...fine});
  if(i%3===0){onProgress?.('Matched GoPro movement '+(i+1)+' / '+count+' sections…');await new Promise(r=>setTimeout(r,0))}
 }
 const threshold=Math.max(5,Math.ceil(results.length*.7));let inliers=results.filter(x=>x.score>=.55);
 let model=inliers.length>=threshold?fit(inliers):null;
 if(!model)return {status:'low-confidence',reason:'Insufficient matching GoPro motion sections.',results,scores:results.map(x=>x.score),gyroSamples:totalGyro,videoDuration,matchedWindows:inliers.length,totalWindows:count};
 for(let p=0;p<3;p++){const good=inliers.filter(x=>Math.abs(x.shift-model.intercept-model.slope*x.time)<=.12);if(good.length<threshold)break;inliers=good;model=fit(inliers)||model}
 const residual=Math.max(...inliers.map(x=>Math.abs(x.shift-model.intercept-model.slope*x.time)));
 const speed=100/(1+model.slope),coverage=inliers.at(-1).time-inliers[0].time;
 if(inliers.length<threshold||coverage<bblDuration*.55||residual>.12||speed<98||speed>102)
  return {status:'low-confidence',reason:'GoPro alignment inconsistent over the flight. No safe correction.',results,scores:results.map(x=>x.score),gyroSamples:totalGyro,videoDuration,matchedWindows:inliers.length,totalWindows:count,residual};
 const goodTimes=new Set(inliers.map(x=>x.time));for(const p of results)p.inlier=goodTimes.has(p.time);
 return {status:'estimate',speed,fit:model,offset:model.intercept,results,scores:results.map(x=>x.score),gyroSamples:totalGyro,videoDuration,
  matchedWindows:inliers.length,totalWindows:count,residual,confidence:inliers.length>=count*.9&&residual<.05?'high':'moderate'};
}
