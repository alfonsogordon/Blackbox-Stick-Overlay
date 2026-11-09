// QuickTime MOV writer with PNG-compressed RGBA frames (codec 'png ').
// PNG preserves transparency; editor compatibility depends on QuickTime PNG support.
const enc = new TextEncoder();
const u16 = n => Uint8Array.of((n>>>8)&255,n&255);
const u32 = n => Uint8Array.of((n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255);
const join = (...parts) => {const len=parts.reduce((n,p)=>n+p.length,0),out=new Uint8Array(len);let i=0;for(const p of parts){out.set(p,i);i+=p.length}return out};
const str = s => enc.encode(s);
const atom = (tag,...parts) => {const body=join(...parts);return join(u32(body.length+8),str(tag),body)};
const zeros = n => new Uint8Array(n);
const matrix = join(u32(65536),u32(0),u32(0),u32(0),u32(65536),u32(0),u32(0),u32(0),u32(1073741824));
export function createMovPng(frames,width,height,fps){
  if(!frames.length)throw Error('No video frames');
  if(width>65535||height>65535)throw Error('Dimensions exceed MOV limits');
  const timescale=600,delta=Math.round(timescale/fps),duration=delta*frames.length;
  const sizes=frames.map(f=>f.size??f.byteLength),offsets=[];
  const payloadBytes=sizes.reduce((a,b)=>a+b,0);
  if(payloadBytes+8>=0xffffffff)throw Error('MOV exceeds 4 GB; export a shorter section');
  const ftyp=atom('ftyp',str('qt  '),u32(0),str('qt  '));
  // Keep encoded PNG frames as separate Blob parts: never allocate one giant Uint8Array.
  const mdatHeader=join(u32(payloadBytes+8),str('mdat'));
  let pos=ftyp.length+8;for(const n of sizes){offsets.push(pos);pos+=n}
  if(pos>=0xffffffff)throw Error('MOV exceeds 4 GB; export a shorter section');
  const mvhd=atom('mvhd',u32(0),u32(0),u32(0),u32(timescale),u32(duration),u32(65536),u16(256),zeros(10),matrix,zeros(24),u32(2));
  const tkhd=atom('tkhd',u32(7),u32(0),u32(0),u32(1),u32(0),u32(duration),zeros(8),u16(0),u16(0),u16(0),u16(0),matrix,u32(width*65536),u32(height*65536));
  const mdhd=atom('mdhd',u32(0),u32(0),u32(0),u32(timescale),u32(duration),u16(0),u16(0));
  const hdlr=atom('hdlr',u32(0),str('mhlr'),str('vide'),str('appl'),u32(0),u32(0),str('VideoHandler\0'));
  const vmhd=atom('vmhd',u32(1),u16(0),u16(0),u16(0),u16(0));
  const dinf=atom('dinf',atom('dref',u32(0),u32(1),atom('alis',u32(1))));
  const compressor=join(Uint8Array.of(3),str('PNG'),zeros(28));
  const sampleEntry=join(zeros(6),u16(1),u16(0),u16(0),str('appl'),u32(0),u32(0),u16(width),u16(height),u32(0x00480000),u32(0x00480000),u32(0),u16(1),compressor,u16(32),u16(0xffff));
  const stsd=atom('stsd',u32(0),u32(1),atom('png ',sampleEntry));
  const stts=atom('stts',u32(0),u32(1),u32(frames.length),u32(delta));
  const stsc=atom('stsc',u32(0),u32(1),u32(1),u32(1),u32(1));
  const stsz=atom('stsz',u32(0),u32(0),u32(frames.length),...sizes.map(u32));
  const stco=atom('stco',u32(0),u32(frames.length),...offsets.map(u32));
  const stbl=atom('stbl',stsd,stts,stsc,stsz,stco);
  const minf=atom('minf',vmhd,dinf,stbl);
  const mdia=atom('mdia',mdhd,hdlr,minf);
  const trak=atom('trak',tkhd,mdia);
  const moov=atom('moov',mvhd,trak);
  return new Blob([ftyp,mdatHeader,...frames,moov],{type:'video/quicktime'});
}
