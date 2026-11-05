"""Betaflight Blackbox log decoder + transparent stick overlay renderer."""
import bisect
import csv
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

def decoder_path():
    roots=[Path(sys.executable).parent] if getattr(sys,"frozen",False) else [Path(__file__).parent]
    if hasattr(sys,"_MEIPASS"): roots.append(Path(sys._MEIPASS))
    for root in roots:
        for path in [root/"blackbox_decode.exe",root/"_internal"/"blackbox_decode.exe"]:
            if path.is_file(): return path
    raise FileNotFoundError("Bundled blackbox_decode.exe not found. This is an incomplete Windows build.")

def decode_log(source, tempdir):
    """Copy log to tempdir because official decoder writes CSV beside input."""
    source=Path(source).resolve()
    copied=Path(tempdir)/("flight"+source.suffix.lower())
    shutil.copyfile(source,copied)
    decoder=decoder_path()
    p=subprocess.run([str(decoder),str(copied)],cwd=tempdir,
                     capture_output=True,text=True,errors="replace",timeout=300)
    csvs=sorted(Path(tempdir).glob("flight.*.csv"))
    if p.returncode!=0 or not csvs:
        raise RuntimeError("Blackbox decoding failed: "+(p.stderr or p.stdout or "No CSV created")[-1200:])
    return csvs

def load_csv(path):
    values=[]
    with open(path,encoding="utf-8-sig",newline="") as f:
        reader=csv.DictReader(f)
        fields={k.lower().replace(" ",""):k for k in reader.fieldnames or []}
        def field(*names):
            for n in names:
                if n.lower() in fields:return fields[n.lower()]
            raise ValueError("Missing required Blackbox column: "+names[0])
        t=field("time","time(us)","time_us","timestamp")
        rc=[field("rccommand["+str(i)+"]","rccommand"+str(i)) for i in range(4)]
        for row in reader:
            try: values.append((float(row[t]),*(float(row[k]) for k in rc)))
            except (TypeError,ValueError): continue
    if len(values)<2: raise ValueError("Log does not contain enough valid RC samples")
    values.sort(key=lambda x:x[0])
    # Official decoder defaults to microseconds.
    factor=1e-6 if values[-1][0]-values[0][0]>10000 else 1.0
    start=values[0][0]
    return [((v[0]-start)*factor,*v[1:]) for v in values]

def clamp(v):
    return max(-1.0,min(1.0,v))

def draw_sticks(roll,pitch,yaw,throttle,width=800,height=300):
    im=Image.new("RGBA",(width,height),(0,0,0,0))
    d=ImageDraw.Draw(im)
    side=min(height-28,(width-60)//2)
    centers=[(width//2-side//2-14,height//2),(width//2+side//2+14,height//2)]
    # Betaflight rcCommand axis ranges are approximately +/-500.
    # Throttle is normally 1000-2000 or 0-1000.
    th=clamp((throttle-1500)/500 if throttle>=1000 else (throttle-500)/500)
    positions=[(clamp(yaw/500),th),(clamp(roll/500),clamp(pitch/500))]
    for i,((cx,cy),(x,y)) in enumerate(zip(centers,positions)):
        r=side//2
        d.rounded_rectangle((cx-r,cy-r,cx+r,cy+r),radius=18,
                            fill=(14,20,31,175),outline=(142,165,194,205),width=3)
        d.line((cx-r+12,cy,cx+r-12,cy),fill=(125,145,170,90),width=2)
        d.line((cx,cy-r+12,cx,cy+r-12),fill=(125,145,170,90),width=2)
        travel=r*0.74
        px=int(cx+x*travel);py=int(cy-y*travel)
        dot=max(7,int(side*0.065))
        color=(71,231,214,255) if i==0 else (186,152,255,255)
        d.ellipse((px-dot,py-dot,px+dot,py+dot),fill=color,outline=(245,250,255,255),width=2)
    return im

def make_overlay(source,outdir,flight=1,fps=60,offset=0.0,duration=None,progress=None):
    if fps<=0 or fps>240:raise ValueError("FPS must be between 1 and 240")
    if flight<1:raise ValueError("Flight number must be at least 1")
    source=Path(source)
    outdir=Path(outdir)
    with tempfile.TemporaryDirectory(prefix="stickoverlay_") as temp:
        csvs=decode_log(source,temp) if source.suffix.lower() in (".bbl",".bfl") else [source]
        if flight>len(csvs):raise ValueError(f"This file has {len(csvs)} decoded flight(s), not {flight}")
        data=load_csv(csvs[flight-1])
    times=[v[0] for v in data]
    duration=float(duration) if duration is not None else data[-1][0]+max(0,offset)
    if duration<=0 or duration>3600:
        raise ValueError("Output duration must be between 0 and 3600 seconds")
    total=math.ceil(duration*fps)
    outdir.mkdir(parents=True,exist_ok=True)
    # PNG sequence intended for Resolve; use the video editor to slide it for sync.
    for n in range(total):
        t=n/fps-offset
        if t<times[0] or t>times[-1]:
            frame=Image.new("RGBA",(800,300),(0,0,0,0))
        else:
            j=bisect.bisect_right(times,t)
            if j<=0: vals=data[0][1:]
            elif j>=len(data):vals=data[-1][1:]
            else:
                a,b=data[j-1],data[j]
                ratio=(t-a[0])/(b[0]-a[0]) if b[0]!=a[0] else 0
                vals=[a[k]+ratio*(b[k]-a[k]) for k in range(1,5)]
            frame=draw_sticks(*vals)
        frame.save(outdir/f"sticks_{n:06d}.png")
        if progress and n%max(1,total//20)==0: progress(f"Rendering {n+1}/{total}")
    if progress: progress(f"Complete: {total} PNG frames in {outdir}")
    return total
