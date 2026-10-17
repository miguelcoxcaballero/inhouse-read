#!/usr/bin/env python3
"""Builds the shelf sound atlas from real CC0 recordings.

Sources (all CC0, no attribution required; credit kept in public/sfx/CREDITS.txt):
  Kenney Impact Sounds, Kenney RPG Audio, Kenney Interface Sounds (kenney.nl),
  OpenGameArt: "Scrapes", "Light Switch Turn On And Off SFX" (yd), "20 Rustles of dry leaves",
  "Sound Effects Pack" by Owlish Media (Paper, Cloth/Rustle, Impacts).
Every clip is trimmed, band-limited and warmed, loudness matched and faded, then written as 24 kHz mono.

usage: build-atlas.py <sources dir> <out dir>
  <sources dir> holds: kenney-impact/Audio, rpg-audio/Audio, interface-sounds/Audio, scrapes, lightswitch,
  owlish, leaves.mp3 (as extracted by tools/sfx/fetch-sources.sh).
Writes <out>/clips/<name>.wav (for listening), <out>/atlas.bin (16-bit PCM, concatenated) and <out>/atlas.json.
"""
import json,os,subprocess,sys
import numpy as np
from scipy import signal
RATE=24000
src,out=sys.argv[1],sys.argv[2]
def decode(path,start=None,end=None):
    cmd=['ffmpeg','-v','error','-i',path,'-ac','1','-ar',str(RATE),'-f','f32le','-']
    x=np.frombuffer(subprocess.run(cmd,capture_output=True,check=True).stdout,dtype=np.float32).astype(np.float64)
    if start is not None:x=x[int(start*RATE):int((end if end else len(x)/RATE)*RATE)]
    return x
def shelf(x,hz,gain_db,high):
    # RBJ shelving biquad
    A=10**(gain_db/40);w=2*np.pi*hz/RATE;cs,sn=np.cos(w),np.sin(w);al=sn/2*np.sqrt(2)
    if high:
        b=[A*((A+1)+(A-1)*cs+2*np.sqrt(A)*al),-2*A*((A-1)+(A+1)*cs),A*((A+1)+(A-1)*cs-2*np.sqrt(A)*al)]
        a=[(A+1)-(A-1)*cs+2*np.sqrt(A)*al,2*((A-1)-(A+1)*cs),(A+1)-(A-1)*cs-2*np.sqrt(A)*al]
    else:
        b=[A*((A+1)-(A-1)*cs+2*np.sqrt(A)*al),2*A*((A-1)-(A+1)*cs),A*((A+1)-(A-1)*cs-2*np.sqrt(A)*al)]
        a=[(A+1)+(A-1)*cs+2*np.sqrt(A)*al,-2*((A-1)+(A+1)*cs),(A+1)+(A-1)*cs-2*np.sqrt(A)*al]
    return signal.lfilter(np.array(b)/a[0],np.array(a)/a[0],x)
def peaking(x,hz,gain_db,q):
    A=10**(gain_db/40);w=2*np.pi*hz/RATE;al=np.sin(w)/(2*q);cs=np.cos(w)
    b=[1+al*A,-2*cs,1-al*A];a=[1+al/A,-2*cs,1-al/A]
    return signal.lfilter(np.array(b)/a[0],np.array(a)/a[0],x)
def process(x,lp=8500,warm=1.0,max_len=1.2,target=0.07,fade=0.03,tail_db=-42):
    x=x-np.mean(x)
    sos=signal.butter(2,70,'hp',fs=RATE,output='sos');x=signal.sosfilt(sos,x)
    sos=signal.butter(4,lp,'lp',fs=RATE,output='sos');x=signal.sosfilt(sos,x)
    x=shelf(x,220,2.2*warm,False);x=shelf(x,4200,-3.0*warm,True)
    # Small phone speakers lose everything under about 150 Hz: give dull clips a clear mid presence.
    S=np.abs(np.fft.rfft(x*np.hanning(len(x))))**2;c=np.cumsum(S)/(S.sum()+1e-18);roll=np.fft.rfftfreq(len(x),1/RATE)[min(np.searchsorted(c,0.9),len(S)-1)]
    if roll<900:
        x=signal.sosfilt(signal.butter(2,130,'hp',fs=RATE,output='sos'),x);x=peaking(x,1100,4.5,0.9);x=peaking(x,2400,2.5,0.8)
    if roll<250:  # soft thumps live almost entirely under a phone speaker's range: nudge them up a little
        x=signal.resample(x,int(len(x)/1.35))
    pk=np.abs(x).max()+1e-12
    on=np.argmax(np.abs(x)>pk*0.03);on=max(0,on-int(0.003*RATE))
    sm=np.convolve(np.abs(x),np.ones(int(0.01*RATE))/int(0.01*RATE),'same')
    thr=pk*10**(tail_db/20);idx=np.where(sm>thr)[0];end=min(len(x),(idx[-1] if len(idx) else len(x))+int(0.01*RATE))
    end=min(end,on+int(max_len*RATE));x=x[on:end].copy()
    n=len(x);f=min(int(fade*RATE),n//2)
    x[:int(0.0006*RATE)]*=np.linspace(0,1,int(0.0006*RATE));x[n-f:]*=np.linspace(1,0,f)
    act=x[np.abs(x)>np.abs(x).max()*0.05];rms=np.sqrt(np.mean(act**2))+1e-12
    x=x*min(target/rms,0.89/np.abs(x).max())
    return x
def layer(parts,gap=0.0):
    n=max(int((o+len(p)/RATE)*RATE) for o,p,g in parts)+1;y=np.zeros(n)
    for o,p,g in parts:s=int(o*RATE);y[s:s+len(p)]+=p*g
    return y
def K(pack,name,i):return f'{src}/{pack}/Audio/{name}_{i:03d}.ogg'
clips={}  # name -> float array
def add(name,x,**kw):clips[name]=process(x,**kw)
# ---------- impacts of a book (or anything light) on each material: soft, medium, hard
IMP={'wood':('impactWood',['light','medium','heavy']),'metal':('impactMetal',['light','medium','heavy']),'glass':('impactGlass',['light','medium','heavy']),
     'ceramic':('impactPlate',['light','medium','heavy']),'linen':('impactSoft',['medium','medium','heavy'])}
for mat,(base,lv) in IMP.items():
    for li,l in enumerate(lv):
        for t in range(5 if l!='medium' or li==1 else 3):
            p=K('kenney-impact',f'{base}_{l}',t)
            if os.path.exists(p):add(f'impact_{mat}_L{li}_t{t}',decode(p),target=0.075,max_len=0.9 if mat in('metal','glass') else 0.5,lp=7600 if mat in('metal','glass') else 6500)
for t in range(1,4):add(f'impact_paper_L1_t{t-1}',decode(f'{src}/rpg-audio/Audio/bookPlace{t}.ogg'),target=0.07,max_len=0.5)
for t in range(5):add(f'impact_paper_L0_t{t}',decode(K('kenney-impact','impactSoft_medium',t)) if os.path.exists(K('kenney-impact','impactSoft_medium',t)) else np.zeros(10),target=0.05,lp=4200,max_len=0.4)
for t in range(5):add(f'impact_wood_plank_t{t}',decode(K('kenney-impact','impactPlank_medium',t)),max_len=0.6)
# ---------- books
for i,n in enumerate(['cloth1','cloth2','cloth3','cloth4','handleSmallLeather','handleSmallLeather2']):add(f'book_pickup_t{i}',decode(f'{src}/rpg-audio/Audio/{n}.ogg'),target=0.055,max_len=0.7,lp=5500)
add('book_cover_open_t0',decode(f'{src}/rpg-audio/Audio/bookOpen.ogg'),target=0.06,max_len=1.2,lp=6500)
add('book_cover_close_t0',decode(f'{src}/rpg-audio/Audio/bookClose.ogg'),target=0.065,max_len=1.0,lp=6500)
for i in range(1,4):add(f'book_flip_t{i-1}',decode(f'{src}/rpg-audio/Audio/bookFlip{i}.ogg'),target=0.05,max_len=1.0,lp=6000)
for i in (1,2):add(f'book_pageturn_t{i-1}',decode(f'{src}/owlish/Paper/pageturn{i}.wav'),target=0.05,max_len=1.4,lp=6000)
for i in range(1,4):add(f'book_set_t{i-1}',decode(f'{src}/rpg-audio/Audio/bookPlace{i}.ogg'),target=0.075,max_len=0.5)
for i,n in enumerate(['dropLeather']):add('book_drop_t0',decode(f'{src}/rpg-audio/Audio/{n}.ogg'),target=0.075,max_len=0.6)
# ---------- sliding / scraping (books, lamps, pots)
for i in range(1,9):add(f'scrape_t{i-1}',decode(f'{src}/scrapes/scrape-{i}.wav'),target=0.05,max_len=1.2,lp=5200,tail_db=-38)
for i in range(1,4):add(f'scrape_owl_t{i-1}',decode(f'{src}/owlish/Impacts/scrape{i}.wav'),target=0.05,max_len=1.2,lp=5200,tail_db=-38)
for i in range(1,4):add(f'creak_t{i-1}',decode(f'{src}/rpg-audio/Audio/creak{i}.ogg'),target=0.045,max_len=1.2,lp=4500,tail_db=-38)
for i in range(1,4):add(f'metal_pot_t{i-1}',decode(f'{src}/rpg-audio/Audio/metalPot{i}.ogg'),target=0.06,max_len=0.9)
# ---------- switches
add('switch_light_on_t0',decode(f'{src}/lightswitch/light_switch_turn_on.mp3'),target=0.07,max_len=0.5,lp=7000)
add('switch_light_off_t0',decode(f'{src}/lightswitch/light_switch_turn_off.mp3'),target=0.07,max_len=0.5,lp=7000)
add('switch_metal_click_t0',decode(f'{src}/rpg-audio/Audio/metalClick.ogg'),target=0.06,max_len=0.4)
add('switch_metal_latch_t0',decode(f'{src}/rpg-audio/Audio/metalLatch.ogg'),target=0.06,max_len=0.5)
for i in range(1,8):add(f'switch_ui_t{i-1}',decode(f'{src}/interface-sounds/Audio/switch_{i:03d}.ogg'),target=0.05,max_len=0.3,lp=7000)
for i in range(1,5):add(f'toggle_ui_t{i-1}',decode(f'{src}/interface-sounds/Audio/toggle_{i:03d}.ogg'),target=0.05,max_len=0.3,lp=7000)
# ---------- paper and cloth
for i in (1,2):add(f'paper_crumple_t{i-1}',decode(f'{src}/owlish/Paper/crumples{i}.wav'),target=0.05,max_len=1.4,lp=6000)
for i in (1,2,3,4,5,6):
    p=[f for f in os.listdir(f'{src}/owlish/Cloth, Rustle') if f'blanket-movement-{i}.wav' in f]
    if p:add(f'cloth_rustle_t{i-1}',decode(f'{src}/owlish/Cloth, Rustle/{p[0]}'),target=0.045,max_len=1.4,lp=5000,tail_db=-36)
# ---------- leaves: split the montage of dry-leaf rustles by silences
lv=decode(f'{src}/leaves.mp3');w=int(0.25*RATE);env=np.sqrt(np.convolve(lv**2,np.ones(w)/w,'same'));taken=[]
for _ in range(10):
    e=env.copy()
    for t in taken:e[max(0,t-int(1.0*RATE)):t+int(1.0*RATE)]=0
    k=int(np.argmax(e))
    if e[k]<env.max()*0.18:break
    taken.append(k)
for j,k in enumerate(sorted(taken)):add(f'leaves_rustle_t{j}',lv[max(0,k-int(0.35*RATE)):k+int(0.75*RATE)],target=0.04,max_len=1.1,lp=4800,tail_db=-34)
# ---------- composed events from real hits
def hit(name,i):return decode(K('kenney-impact',name,i))
def composed(name,seq,**kw):
    clips[name]=process(layer([(o,process(decode(K('kenney-impact',b,i)),target=0.08,max_len=0.9)*g,g) for o,b,i,g in seq]),**kw)
for t in range(3):
    composed(f'lamp_fall_metal_t{t}',[(0.0,'impactMetal_heavy',t,1.0),(0.015,'impactGlass_light',t,0.45),(0.21,'impactMetal_medium',t+1,0.7),(0.36,'impactMetal_light',t+2,0.5),(0.47,'impactGlass_light',t+1,0.3),(0.55,'impactMetal_light',t,0.22)],target=0.085,max_len=1.6)
    composed(f'lamp_fall_wood_t{t}',[(0.0,'impactWood_heavy',t,1.0),(0.02,'impactSoft_medium',t,0.5),(0.19,'impactWood_medium',t+1,0.7),(0.33,'impactWood_light',t+2,0.5),(0.43,'impactWood_light',t,0.28)],target=0.085,max_len=1.4)
    composed(f'pot_fall_t{t}',[(0.0,'impactPlate_heavy',t,1.0),(0.02,'impactMining',t,0.5),(0.23,'impactPlate_medium',t+1,0.6),(0.38,'impactPlate_light',t+2,0.35)],target=0.085,max_len=1.3)
os.makedirs(f'{out}/clips',exist_ok=True)
index={};blob=bytearray()
for name,x in sorted(clips.items()):
    pcm=(np.clip(x,-1,1)*32767).astype('<i2');index[name]={'offset':len(blob)//2,'length':len(pcm),'rate':RATE}
    blob+=pcm.tobytes()
    import wave
    w=wave.open(f'{out}/clips/{name}.wav','wb');w.setnchannels(1);w.setsampwidth(2);w.setframerate(RATE);w.writeframes(pcm.tobytes());w.close()
open(f'{out}/atlas.bin','wb').write(bytes(blob));json.dump(index,open(f'{out}/atlas.json','w'),indent=0)
print(len(clips),'clips',len(blob)/1024,'KB')
