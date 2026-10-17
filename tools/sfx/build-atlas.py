#!/usr/bin/env python3
"""Builds the shelf sound atlas from real CC0 recordings.

Sources (all CC0, no attribution required; credit kept in public/sfx/CREDITS.txt):
  Kenney Impact Sounds, RPG Audio, Interface Sounds (kenney.nl); OpenGameArt: "Scrapes",
  "Light Switch Turn On And Off SFX" (yd), "20 Rustles of dry leaves", "Sound Effects Pack" (Owlish Media).
Every clip is cleaned (DC, rumble, hiss), warmed, given a soft attack where it is a rustle, tamed at the transient,
given a very small room, loudness matched by A-weighted level and trimmed; the final atlas keeps the best takes.

usage: build-atlas.py <sources dir> <out dir> [iteration 1-3]
  iteration 1: fix defects (sub-bass booms, electronic beeps, hiss, cut-off rustles)
  iteration 2: + cozy polish (soft transients, small room, A-weighted loudness matching, outlier takes dropped)
  iteration 3: + events composed from real layers (lamp and pot specific) and take selection for the final atlas
<sources dir> is what tools/sfx/fetch-sources.sh prepares. Writes <out>/clips/<name>.wav, atlas.bin (int16) and atlas.json.
"""
import json,os,subprocess,sys,wave
import numpy as np
from scipy import signal
RATE=24000
src,out=sys.argv[1],sys.argv[2]
ITER=int(sys.argv[3]) if len(sys.argv)>3 else 3
rng=np.random.default_rng(20261017)
def decode(path,start=0.0,end=None):
    cmd=['ffmpeg','-v','error','-i',path,'-ac','1','-ar',str(RATE),'-f','f32le','-']
    x=np.frombuffer(subprocess.run(cmd,capture_output=True,check=True).stdout,dtype=np.float32).astype(np.float64)
    return x[int(start*RATE):int(end*RATE) if end else None]
def sos(kind,hz,order=2):return signal.butter(order,hz,kind,fs=RATE,output='sos')
def shelf(x,hz,gain_db,high):
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
def spectrum_stats(x):
    S=np.abs(np.fft.rfft(x*np.hanning(len(x)),max(4096,len(x))))**2;f=np.fft.rfftfreq(max(4096,len(x)),1/RATE);E=S.sum()+1e-18
    c=np.cumsum(S)/E
    return dict(roll=f[min(np.searchsorted(c,0.9),len(f)-1)],lf=S[f<150].sum()/E,mid=S[(f>=200)&(f<2500)].sum()/E,hf=S[f>6000].sum()/E,cent=(S*f).sum()/E)
# A-weighting (IEC 61672) as a digital filter, used to match perceived level
def a_weight(x):
    f1,f2,f3,f4=20.598997,107.65265,737.86223,12194.217
    num=[(2*np.pi*f4)**2*10**(1.9997/20),0,0,0,0];den=np.polymul([1,4*np.pi*f4,(2*np.pi*f4)**2],[1,4*np.pi*f1,(2*np.pi*f1)**2])
    den=np.polymul(np.polymul(den,[1,2*np.pi*f3]),[1,2*np.pi*f2])
    b,a=signal.bilinear(num,den,RATE);return signal.lfilter(b,a,x)
def level(x):
    w=a_weight(x);act=w[np.abs(x)>np.abs(x).max()*0.04]
    return np.sqrt(np.mean(act**2))+1e-12
DRY=None
def room(x,mix=0.10,ms=70):
    # a very small, soft room so a dry recording does not sound pasted on
    global DRY
    n=int(ms/1000*RATE);ir=rng.standard_normal(n)*np.exp(-np.arange(n)/(0.28*n)*3.0);ir=signal.sosfilt(sos('lp',2600),ir);ir[:int(0.004*RATE)]=0
    ir/=np.abs(ir).sum()+1e-12;wet=np.convolve(x,ir*6,'full')[:len(x)+n]
    wet=np.concatenate([wet,np.zeros(len(x)+n-len(wet))])
    y=np.concatenate([x,np.zeros(n)]);return y+wet*mix
def clean(x,kind='impact',lp=7000,hp=100,warm=1.0,max_len=1.0,tail_db=-42,fade=0.03,soft_in=0.0,pre=0.003,hiss=False):
    x=x-np.mean(x)
    x=signal.sosfilt(sos('hp',hp,2),x)
    x=signal.sosfilt(sos('lp',min(lp,4800) if hiss else lp,4),x)
    x=shelf(x,230,2.0*warm,False);x=shelf(x,4300,-3.0*warm,True)
    st=spectrum_stats(x)
    if st['roll']<900:  # little content a phone speaker can play: add clear mid presence
        x=peaking(x,1100,4.0,0.9);x=peaking(x,2400,2.0,0.8)
    if st['roll']<230:x=signal.resample(x,int(len(x)/1.3))
    if ITER>=2 and kind=='impact':  # tame the transient: a gentle saturation brings the sharpest peak down about 4 dB
        k=1.7/np.abs(x).max();x=np.tanh(x*k)/k
    pk=np.abs(x).max()+1e-12
    on=int(np.argmax(np.abs(x)>pk*(0.03 if kind=='impact' else 0.02)));on=max(0,on-int(pre*RATE))
    if ITER>=2:x=room(x,0.10 if kind=='impact' else 0.07)
    sm=np.convolve(np.abs(x),np.ones(int(0.01*RATE))/int(0.01*RATE),'same')
    idx=np.where(sm>pk*10**(tail_db/20))[0];end=min(len(x),(idx[-1] if len(idx) else len(x))+int(0.01*RATE))
    end=min(end,on+int(max_len*RATE));x=x[on:end].copy();n=len(x);f=min(int(fade*RATE),n//2)
    r=int((soft_in if soft_in else 0.0006)*RATE);x[:r]*=np.sin(np.linspace(0,np.pi/2,r))**2
    x[n-f:]*=np.cos(np.linspace(0,np.pi/2,f))**2
    return x
def finish(x,db=0.0):
    # A-weighted loudness: every clip at the same perceived level, trimmed by `db` for its role
    target=0.065*10**(db/20);x=x*(target/level(x));pk=np.abs(x).max()
    if pk>0.8:x=x*(0.8/pk)
    return x
def layer(parts):
    n=max(int(round((o)*RATE))+len(p) for o,p,g in parts)+1;y=np.zeros(n)
    for o,p,g in parts:s=int(round(o*RATE));y[s:s+len(p)]+=p*g
    return y
def pitch(x,ratio):return signal.resample(x,int(len(x)/ratio))

# Natural wood and metal: the pitched Kenney wood thuds and bright metal rings sounded artificial and glassy, so wood
# comes from real wooden steps, doors and an axe chop (dense, noisy, no single ringing tone) and metal from dull tin
# plus the first part of a hollow pot, with the ring damped so it never reads as glass.
def peak1(x):return x/(np.abs(x).max()+1e-9)
def damp(x,tau,start=0.008):
    t=np.arange(len(x))/RATE;return x*np.where(t<start,1.0,np.exp(-(t-start)/tau))
WOOD_L=[['footstep00','footstep02','footstep04','footstep06','footstep07'],
        ['footstep01','footstep03','doorClose_4','footstep05','footstep08'],
        ['doorClose_1','doorClose_3','chop','doorClose_4','footstep09']]
def wood_raw(level,i):
    n=WOOD_L[level][i%5];x=decode(R(n))
    if n in('doorClose_1','doorClose_3','chop'):x=damp(x,0.06,0.02)
    return x
def metal_raw(level,i):
    tin=peak1(decode(K('kenney-impact','impactTin_medium',i%3)))
    pot=peak1(damp(decode(R(f'metalPot{1+i%3}'),0,0.3),0.055))
    gen=peak1(decode(K('kenney-impact','impactGeneric_light',i%5)))
    mix=[(0.9,0.15,0.0),(0.8,0.35,0.0),(0.7,0.55,0.4)][level]
    n=max(len(tin),len(pot),len(gen));y=np.zeros(n)
    for a,c in zip(mix,(tin,pot,gen)):y[:len(c)]+=a*c
    return y
clips={};roles={}
def add(name,x,db=0.0,**kw):
    kind=kw.get('kind','impact')
    x=clean(x,**kw);clips[name]=finish(x,db)
K=lambda pack,name,i:f'{src}/{pack}/Audio/{name}_{i:03d}.ogg'
R=lambda n:f'{src}/rpg-audio/Audio/{n}.ogg'
# ======================= book collisions on each material, three strengths
IMP={'glass':('impactGlass',['light','medium','heavy']),'ceramic':('impactPlate',['light','medium','heavy'])}
LVDB=[-4.0,0.0,3.0]
for mat,(base,lv) in IMP.items():
    for li,l in enumerate(lv):
        for t in range(5):
            hard=mat in('metal','glass')
            add(f'impact_{mat}_L{li}_t{t}',decode(K('kenney-impact',f'{base}_{l}',t)),db=LVDB[li],lp=6800 if hard else 6000,hp=140 if (mat=='wood' and l=='heavy') else 110,max_len=0.55 if hard else 0.4,tail_db=-38)
for li in range(3):
    for t in range(5):
        add(f'impact_wood_L{li}_t{t}',wood_raw(li,t),db=LVDB[li],lp=3600,hp=110,max_len=0.35,tail_db=-38)
        add(f'impact_metal_L{li}_t{t}',metal_raw(li,t),db=LVDB[li],lp=3400,hp=150,max_len=0.4,tail_db=-38)
# linen and paper: the recorded "soft" impacts are sub-bass booms, so they are built from real taps plus real cloth
def cloth_slice(n,a,b):return decode(R(n),a,b)
for li,db in enumerate(LVDB):
    for t in range(5):
        tap=clean(decode(K('kenney-impact','impactGeneric_light',t)),lp=1500,hp=130,max_len=0.2)*0.55
        sw=decode(R(['cloth2','cloth4','handleSmallLeather','handleSmallLeather2','cloth4'][t]),0.04,0.32)
        sw=clean(sw,kind='rustle',lp=3800,hp=140,max_len=0.3,soft_in=0.01)
        clips[f'impact_linen_L{li}_t{t}']=finish(layer([(0.0,tap/ (np.abs(tap).max()+1e-9)*0.5,1.0),(0.008,sw/(np.abs(sw).max()+1e-9)*(0.35+0.2*li),1.0)]),db-1.0)
        bp=decode(R(f'bookPlace{1+t%3}'))
        base=clean(bp,lp=6200,hp=130,max_len=0.45)
        if li==0:base=base*0.5
        if li==2:base=layer([(0,base,1.0),(0.002,clean(decode(K('kenney-impact','impactTin_medium',t)),lp=1900,hp=200,max_len=0.2)/3,0.6)])
        clips[f'impact_paper_L{li}_t{t}']=finish(base,db)
for t in range(5):add(f'impact_wood_plank_t{t}',decode(R(f'footstep0{5+t%5}')) if t<4 else decode(R('footstep09')),db=0.0,hp=110,lp=3400,max_len=0.4)
# ======================= books
for i,(n,a,b) in enumerate([('cloth2',0,None),('cloth4',0,None),('handleSmallLeather',0,None),('handleSmallLeather2',0,None)]):
    add(f'book_pickup_t{i}',decode(R(n),a,b),db=-3.0,kind='rustle',lp=5200,hp=150,max_len=0.55,soft_in=0.012)
add('book_pickup_t4',decode(f'{src}/owlish/Cloth, Rustle/'+[f for f in os.listdir(f'{src}/owlish/Cloth, Rustle') if 'movement-2' in f][0],0.8,1.4),db=-3.0,kind='rustle',lp=4800,hp=150,max_len=0.55,soft_in=0.02)
add('book_cover_open_t0',decode(R('bookOpen')),db=-1.0,kind='rustle',lp=6000,hp=110,max_len=1.1,soft_in=0.004)
add('book_cover_close_t0',decode(R('bookClose')),db=0.0,lp=6000,hp=110,max_len=0.9)
for i in (1,2,3):add(f'book_flip_t{i-1}',decode(R(f'bookFlip{i}')),db=-3.0,kind='rustle',lp=5800,hp=150,max_len=0.9,soft_in=0.012)
add('book_pageturn_t0',decode(f'{src}/owlish/Paper/pageturn1.wav'),db=-3.0,kind='rustle',lp=5600,hp=150,max_len=1.2,soft_in=0.012)
for i in range(1,4):add(f'book_set_t{i-1}',decode(R(f'bookPlace{i}')),db=0.0,lp=6200,hp=130,max_len=0.45)
add('book_drop_t0',decode(R('dropLeather')),db=0.0,lp=5600,hp=130,max_len=0.5)
# ======================= sliding, scraping, creaking
for i in range(1,9):add(f'scrape_t{i-1}',decode(f'{src}/scrapes/scrape-{i}.wav'),db=-4.0,kind='rustle',lp=4600,hp=130,max_len=1.1,tail_db=-36,soft_in=0.02)
for i in range(1,4):add(f'scrape_owl_t{i-1}',decode(f'{src}/owlish/Impacts/scrape{i}.wav'),db=-4.0,kind='rustle',lp=4600,hp=130,max_len=1.1,tail_db=-36,soft_in=0.02)
for i in range(1,4):add(f'creak_t{i-1}',decode(R(f'creak{i}')),db=-5.0,kind='rustle',lp=4200,hp=120,max_len=1.0,tail_db=-36,soft_in=0.015)
for i in range(1,4):add(f'metal_pot_t{i-1}',decode(R(f'metalPot{i}')),db=-1.0,lp=6200,hp=140,max_len=0.7)
# ======================= switches: only real mechanisms, no electronic beeps
add('switch_light_on_t0',decode(f'{src}/lightswitch/light_switch_turn_on.mp3'),db=-1.0,lp=6200,hp=150,max_len=0.4,hiss=True)
add('switch_light_off_t0',decode(f'{src}/lightswitch/light_switch_turn_off.mp3'),db=-1.0,lp=6200,hp=150,max_len=0.4,hiss=True)
add('switch_metal_click_t0',decode(R('metalClick')),db=-1.0,lp=5600,hp=160,max_len=0.35,hiss=True)
add('switch_metal_latch_t0',decode(R('metalLatch')),db=-1.0,lp=5600,hp=160,max_len=0.45,hiss=True)
for i,(n) in enumerate(['click_001','click_002','toggle_001','toggle_002','tick_002']):
    add(f'switch_plastic_t{i}',decode(f'{src}/interface-sounds/Audio/{n}.ogg'),db=-3.0,lp=5200,hp=200,max_len=0.2,hiss=True)
# ======================= paper, cloth, leaves
for i in (1,2):add(f'paper_crumple_t{i-1}',decode(f'{src}/owlish/Paper/crumples{i}.wav'),db=-3.0,kind='rustle',lp=5200,hp=160,max_len=1.2,soft_in=0.02)
cl=sorted(f for f in os.listdir(f'{src}/owlish/Cloth, Rustle') if f.endswith('.wav') and 'blanket' in f)
for i,f in enumerate([c for c in cl if 'movement-2' in c or 'movement-1' in c][:2]):
    x=decode(f'{src}/owlish/Cloth, Rustle/{f}');pk=int(np.argmax(np.convolve(np.abs(x),np.ones(int(0.2*RATE)),'same')))
    add(f'cloth_rustle_t{i}',x[max(0,pk-int(0.25*RATE)):pk+int(0.9*RATE)],db=-4.0,kind='rustle',lp=4200,hp=170,max_len=1.1,soft_in=0.03,tail_db=-34)
lv=decode(f'{src}/leaves.mp3');w=int(0.25*RATE);env=np.sqrt(np.convolve(lv**2,np.ones(w)/w,'same'));taken=[]
for _ in range(10):
    e=env.copy()
    for t in taken:e[max(0,t-int(1.0*RATE)):t+int(1.0*RATE)]=0
    k=int(np.argmax(e))
    if e[k]<env.max()*0.18:break
    taken.append(k)
for j,k in enumerate(sorted(taken)):add(f'leaves_rustle_t{j}',lv[max(0,k-int(0.35*RATE)):k+int(0.75*RATE)],db=-6.0,kind='rustle',lp=4400,hp=300,max_len=1.0,soft_in=0.04,tail_db=-34)
# ======================= composed events from real hits
def raw_hit(base,i):
    lv={'light':0,'medium':1,'heavy':2}
    if base.startswith('impactWood_'):return wood_raw(lv[base.split('_')[1]],i)
    if base.startswith('impactPlank'):return wood_raw(1,i)
    if base.startswith('impactMetal_'):return metal_raw(lv[base.split('_')[1]],i)
    return decode(K('kenney-impact',base,i))
def hit(base,i,lp=6500,hp=130,ml=0.7,db=0.0):
    soft=base.startswith(('impactWood','impactPlank','impactMetal'))
    return clean(raw_hit(base,i),lp=3600 if soft else lp,hp=hp,max_len=ml)
def composed(name,seq,db=2.0):
    parts=[]
    for o,b,i,g in seq:
        h=hit(b,i);h=h/(np.abs(h).max()+1e-9)*g;o=max(0.0,o+(rng.uniform(-0.012,0.012) if ITER>=3 and o>0 else 0))
        parts.append((o,h,1.0))
        if ITER>=3:  # small parts rattling after each blow, so the gaps between hits are never dead silence
            for _ in range(3):
                tick=clean(decode(K('kenney-impact','impactGeneric_light',int(rng.integers(0,5)))),lp=3500,hp=300,max_len=0.08)
                parts.append((o+rng.uniform(0.03,0.14),tick/(np.abs(tick).max()+1e-9)*0.07*g,1.0))
    y=layer(parts)
    if ITER>=3:y=room(y,0.16,130)
    clips[name]=finish(y,db)
for t in range(3):
    composed(f'lamp_fall_metal_t{t}',[(0.0,'impactMetal_heavy',t,1.0),(0.015,'impactGlass_light',t,0.45),(0.21,'impactMetal_medium',t+1,0.7),(0.36,'impactMetal_light',t+2,0.5),(0.47,'impactGlass_light',t+1,0.3),(0.55,'impactMetal_light',t,0.22)])
    composed(f'lamp_fall_wood_t{t}',[(0.0,'impactWood_heavy',t,1.0),(0.02,'impactPlank_medium',t,0.5),(0.19,'impactWood_medium',t+1,0.7),(0.33,'impactWood_light',t+2,0.5),(0.43,'impactWood_light',t,0.28)])
    composed(f'pot_fall_t{t}',[(0.0,'impactPlate_heavy',t,1.0),(0.02,'impactPlate_medium',t+2,0.5),(0.23,'impactPlate_medium',t+1,0.6),(0.38,'impactPlate_light',t+2,0.35)])
if ITER>=3:
    # events that belong to one lamp or one pot, made of real layers shifted in pitch
    for t in range(3):
        composed(f'lamp_setdown_metal_t{t}',[(0.0,'impactMetal_medium',t,1.0),(0.012,'impactGlass_light',t,0.4)],db=0.0)
        composed(f'lamp_setdown_wood_t{t}',[(0.0,'impactWood_medium',t,1.0),(0.02,'impactPlank_medium',t,0.4)],db=0.0)
        composed(f'lamp_setdown_plastic_t{t}',[(0.0,'impactTin_medium',t,0.9),(0.01,'impactGeneric_light',t,0.5)],db=-1.0)
        for pn,base,ratio in (('glazed','impactPlate_medium',1.0),('terracotta','impactPlate_medium',0.86),('zinc','impactTin_medium',0.9)):
            x=hit(base,t);x=pitch(x,ratio) if ratio!=1.0 else x
            clips[f'pot_setdown_{pn}_t{t}']=finish(x,0.0)
    for pn,i0 in (('glazed',0),('terracotta',3),('zinc',6)):
        for t in range(2):
            x=decode(f'{src}/scrapes/scrape-{1+(i0+t)%8}.wav');x=pitch(x,{'glazed':1.15,'terracotta':0.85,'zinc':1.0}[pn])
            add(f'pot_move_{pn}_t{t}',x,db=-4.0,kind='rustle',lp=4200,hp=150,max_len=0.9,soft_in=0.02,tail_db=-36)
    for ln,i0,lp_ in (('metal',0,4800),('wood',3,3800),('plastic',5,5200)):
        for t in range(2):
            add(f'lamp_move_{ln}_t{t}',decode(f'{src}/scrapes/scrape-{1+(i0+t)%8}.wav') if ln!='wood' else decode(R(f'creak{1+t}')),db=-5.0,kind='rustle',lp=lp_,hp=150,max_len=0.8,soft_in=0.02,tail_db=-36)
# ======================= camera: switching between the straight and the isometric view, and zooming (original, soft and airy)
def svf_sweep(x,f0,f1,q):
    # state-variable band-pass whose centre glides from f0 to f1 (log scale)
    n=len(x);fs=np.exp(np.linspace(np.log(f0),np.log(f1),n));y=np.zeros(n);lo=bp=0.0
    for i in range(n):
        g=2*np.sin(np.pi*fs[i]/RATE);hi=x[i]-lo-bp/q;bp+=g*hi;lo+=g*bp;y[i]=bp
    return y
def whoosh(dur,f0,f1,seed,tone=(0.0,0.0),peak=0.45,q=1.7,body=0.5):
    r=np.random.default_rng(seed);n=int(dur*RATE);t=np.arange(n)/RATE;u=t/dur
    air=svf_sweep(r.standard_normal(n),f0,f1,q);air/=np.abs(air).max()
    swell=np.sin(np.pi*np.clip(u/0.95,0,1))**1.6*np.exp(-0.8*u)*(0.35+0.65*np.sin(np.pi*np.clip(u/peak,0,1)/2)**2 if False else 1.0)
    env=np.where(u<peak,np.sin(np.pi/2*u/peak)**2,np.cos(np.pi/2*(u-peak)/(1-peak))**2)
    low=signal.sosfilt(sos('lp',420,2),r.standard_normal(n));low/=np.abs(low).max()
    y=air*env+body*low*env**1.5*0.55
    if tone[0]:  # a very faint, breathy glide so the motion has a direction, never a clean note
        f=np.exp(np.linspace(np.log(tone[0]),np.log(tone[1]),n));ph=2*np.pi*np.cumsum(f)/RATE
        jit=signal.sosfilt(sos('lp',9,2),r.standard_normal(n));jit/=np.abs(jit).max()
        tn=(np.sin(ph)+0.5*np.sin(2*ph+0.4)+0.25*np.sin(3*ph+1.1))*(1+0.35*jit)
        y+=0.07*tn*env**1.2
    return y
def camera(name,dur,f0,f1,tone,t,peak=0.45):
    x=whoosh(dur,f0*(1+0.04*t),f1*(1+0.04*t),100+t,tone=(tone[0]*(1+0.03*t),tone[1]*(1+0.03*t)),peak=peak)
    clips[name]=finish(clean(x,kind='rustle',lp=5200,hp=110,max_len=dur+0.1,soft_in=0.02,tail_db=-40,warm=1.0,pre=0.0),-1.0)
if ITER>=3:
    for t in range(3):
        camera(f'zoom_in_t{t}',0.34,450,1700,(300,430),t,0.5)     # closer: the air opens up
        camera(f'zoom_out_t{t}',0.34,1700,450,(430,300),t,0.4)    # further away: it closes again
        camera(f'view_iso_t{t}',0.55,380,2000,(260,470),t,0.55)   # straight to isometric: a longer, rising turn
        camera(f'view_front_t{t}',0.55,2000,380,(470,260),t,0.4)  # isometric to straight: the turn settles back
# ======================= take selection: drop outliers within a group (iteration 2+), keep at most 4 (iteration 3)
import re
groups={}
for n in clips:groups.setdefault(re.sub(r'_t\d+$','',n),[]).append(n)
dropped=[]
if ITER>=2:
    for g,names in groups.items():
        feats=np.array([[np.log(spectrum_stats(clips[n])['cent']+1),spectrum_stats(clips[n])['lf'],len(clips[n])/RATE] for n in names])
        keep=set(names)
        for n,fv in zip(names,feats):
            st=spectrum_stats(clips[n])
            if st['lf']>0.5 or st['mid']<0.12 and g.startswith(('impact','switch','book_set')):keep.discard(n)
        if len(names)>3 and ITER>=3:
            med=np.median(feats,axis=0);sd=feats.std(axis=0)+1e-6
            dist={n:float(np.abs((f-med)/sd).sum()) for n,f in zip(names,feats) if n in keep}
            while len(keep)>4:keep.discard(max(dist,key=lambda k:dist[k] if k in keep else -1))
        for n in names:
            if n not in keep:dropped.append(n);del clips[n]
os.makedirs(f'{out}/clips',exist_ok=True)
index={};blob=bytearray()
for name,x in sorted(clips.items()):
    pcm=(np.clip(x,-1,1)*32767).astype('<i2');index[name]={'offset':len(blob)//2,'length':len(pcm),'rate':RATE}
    blob+=pcm.tobytes()
    w=wave.open(f'{out}/clips/{name}.wav','wb');w.setnchannels(1);w.setsampwidth(2);w.setframerate(RATE);w.writeframes(pcm.tobytes());w.close()
open(f'{out}/atlas.bin','wb').write(bytes(blob));json.dump(index,open(f'{out}/atlas.json','w'),indent=0)
print(f'iteration {ITER}:',len(clips),'clips',round(len(blob)/1024),'KB; dropped',len(dropped),dropped[:12])
