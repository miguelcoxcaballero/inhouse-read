// Web Audio transport. Rust names each event's recorded clips (cozy_clip), synthesises a fallback (cozy_sound)
// and reports the real contact events; no oscillator, polling loop or audio context runs on an idle shelf.
// The clip atlas (public/sfx: 16-bit PCM plus an index) is fetched once after the first gesture; until it has
// loaded, or if it cannot load (offline without a cached copy), every event uses the synthesised sound.
import {needRustShelf} from './rust-shelf.js';
const KEY='inhouse-read-shelf-sounds',ATLAS=`${import.meta.env?.BASE_URL||'/'}sfx/`,RETRY_MS=60000;
let context=null,master=null,unlocked=false,muted=false,serial=0,idle=0,owners=0;
let atlas=null,atlasState='idle',atlasRetry=0,viewUntil=-Infinity;
const buffers=new Map(),voices=new Set(),tails=new Set(),groups=new Map(),routes=new Map(),lastTake=new Map();
try{muted=localStorage.getItem(KEY)==='off';}catch{}
export const shelfSoundsEnabled=()=>owners>0&&!muted&&unlocked&&document.visibilityState!=='hidden';
/** The level an event is rendered at: soft under 0.33, medium under 0.66, otherwise hard. */
export const shelfSoundLevel=strength=>{const value=Number(strength)||0;return value<.33?0:value<.66?1:2;};
function stop(){
 clearTimeout(idle);idle=0;
 for(const voice of [...voices,...tails]){try{voice.source.onended=null;voice.source.stop();}catch{}voice.source.disconnect();voice.gain.disconnect();voice.pan?.disconnect();}
 voices.clear();tails.clear();
 if(context?.state==='running')context.suspend().catch(()=>{});
}
function park(){
 clearTimeout(idle);if(!owners)return;
 if(!voices.size)idle=setTimeout(()=>{idle=0;if(!voices.size&&context?.state==='running')context.suspend().catch(()=>{});},180);
}
/** Index the atlas as groups of takes (`book_set_wood_t0`… belong to `book_set_wood`), keeping only valid clips. */
export function indexShelfSoundAtlas(index,samples){
 const found=new Map();
 for(const [name,clip] of Object.entries(index&&typeof index==='object'?index:{})){
  const offset=clip?.offset,length=clip?.length,rate=clip?.rate??24000;
  if(!Number.isInteger(offset)||!Number.isInteger(length)||offset<0||length<2||offset+length>samples||!(rate>=8000&&rate<=96000))continue;
  const group=name.replace(/_t\d+$/,'');if(!found.has(group))found.set(group,[]);found.get(group).push({name,offset,length,rate});
 }
 return found;
}
function loadAtlas(){
 if(atlasState==='loading'||atlasState==='ready'||atlasState==='failed'&&Date.now()<atlasRetry||typeof fetch!=='function')return;
 atlasState='loading';
 const base=new URL(ATLAS,globalThis.location?.href||'http://localhost/'),get=(name,read)=>fetch(new URL(name,base)).then(response=>{if(!response.ok)throw Error(`HTTP ${response.status}`);return read(response);});
 Promise.all([get('atlas.json',response=>response.json()),get('atlas.bin',response=>response.arrayBuffer())]).then(([index,bin])=>{
  const samples=new Int16Array(bin,0,bin.byteLength>>1),found=indexShelfSoundAtlas(index,samples.length);
  if(!found.size)throw Error('empty sound atlas');
  groups.clear();for(const [group,takes] of found)groups.set(group,takes);
  atlas=samples;routes.clear();atlasState='ready';
 }).catch(()=>{atlasState='failed';atlasRetry=Date.now()+RETRY_MS;});
}
/** The atlas takes of an event, or null for the synthesised sound. Rust lists the groups, most specific first. */
function takesFor(kind,material,level){
 if(atlasState!=='ready')return null;
 const key=`${kind}:${material}:${level}`;if(routes.has(key))return routes.get(key);
 let takes=null;
 try{for(const group of String(needRustShelf().cozy_clip?.(kind,material,level)||'').split(',')){if(groups.has(group)){takes=groups.get(group);break;}}}catch{}
 routes.set(key,takes);return takes;
}
function clipBuffer(audio,clip){
 const key=`clip:${clip.name}`;let buffer=buffers.get(key);if(buffer)return buffer;
 const pcm=new Float32Array(clip.length);for(let i=0;i<clip.length;i++)pcm[i]=atlas[clip.offset+i]/32768;
 buffer=audio.createBuffer(1,clip.length,clip.rate);buffer.copyToChannel(pcm,0);buffers.set(key,buffer);return buffer;
}
export function unlockShelfSounds(){
 if(!owners||muted||document.visibilityState==='hidden')return;
 const Constructor=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Constructor)return;
 try{
  if(!context||context.state==='closed'){
   stop();context=new Constructor({latencyHint:'interactive'});master=context.createGain();master.gain.value=.42;master.connect(context.destination);
   buffers.clear();
   // One silent sample unlocks iOS during the actual finger/key event.
   // It is never looped and does not keep the audio device running.
   const prime=context.createBufferSource();prime.buffer=context.createBuffer(1,1,24000);
   prime.connect(master);prime.onended=()=>{prime.onended=null;prime.disconnect();};prime.start();
  }
  unlocked=true;clearTimeout(idle);loadAtlas();
  const resumed=context.state==='suspended'?context.resume():Promise.resolve();
  resumed.then(park,()=>{unlocked=false;});
 }catch{unlocked=false;}
}
export function playShelfSound(kind,material=0,strength=1,pan=0){
 if(!shelfSoundsEnabled()||!context)return;
 // A view switch (33, 34) owns its whoosh: zoom whooshes (31, 32) wait until it has played.
 if((kind===31||kind===32)&&performance.now()<viewUntil)return;
 if(kind===33||kind===34)viewUntil=performance.now()+550;
 const audio=context,requested=performance.now(),variant=serial++%3,level=shelfSoundLevel(strength),resuming=audio.state==='suspended';
 const play=()=>{
  if(context!==audio||!shelfSoundsEnabled()||audio.state!=='running'&&!(resuming&&audio.state==='suspended')||performance.now()-requested>180)return;
  try{
   let buffer,rate=1;const takes=takesFor(kind,material,level);
   if(takes){
    // A random take, never the same one twice in a row, slightly detuned so repeats do not sound copied.
    const group=takes[0].name,last=lastTake.get(group);let index=Math.floor(Math.random()*takes.length);
    if(takes.length>1&&index===last)index=(index+1)%takes.length;lastTake.set(group,index);
    buffer=clipBuffer(audio,takes[index]);rate=1+(Math.random()*2-1)*.04;
   }else{
    const key=`${kind}:${material}:${level}:${variant}`;buffer=buffers.get(key);
    if(!buffer){
     const pcm=needRustShelf().cozy_sound(kind,material,variant,level);if(!pcm.length)return;
     buffer=audio.createBuffer(1,pcm.length,24000);buffer.copyToChannel(pcm,0);buffers.set(key,buffer);
    }
   }
   clearTimeout(idle);
   if(voices.size>=4){const first=voices.values().next().value;voices.delete(first);tails.add(first);first.gain.gain.setTargetAtTime(0,audio.currentTime,.006);first.source.stop(audio.currentTime+.025);}
   const source=audio.createBufferSource(),gain=audio.createGain();source.buffer=buffer;
   if(source.playbackRate)source.playbackRate.value=rate;
   gain.gain.value=Math.max(0,Math.min(1,Number(strength)||0));source.connect(gain);
   const stereo=audio.createStereoPanner?.();
   if(stereo){stereo.pan.value=Math.max(-.7,Math.min(.7,Number(pan)||0));gain.connect(stereo);stereo.connect(master);}else gain.connect(master);
   const voice={source,gain,pan:stereo};voices.add(voice);
   source.onended=()=>{voices.delete(voice);tails.delete(voice);source.disconnect();gain.disconnect();stereo?.disconnect();park();};source.start();
  }catch{park();}
 };
 // Web Audio accepts scheduled sources while resuming. Queue now, before a
 // synchronous cover render can delay the resume callback and discard the cue.
 if(resuming)audio.resume().catch(()=>{unlocked=false;stop();});
 play();
}
export function setShelfSoundsEnabled(enabled){
 muted=!enabled;try{localStorage.setItem(KEY,muted?'off':'on');}catch{}
 if(muted)stop();else unlockShelfSounds();
}
export function attachShelfSounds(root){
 if(!root)return()=>{};owners++;
 const gesture=event=>{if(event.isTrusted)unlockShelfSounds();};
 const hidden=()=>{if(document.visibilityState==='hidden')stop();},pageHidden=()=>stop();
 root.addEventListener('pointerdown',gesture,{capture:true,passive:true});root.addEventListener('keydown',gesture,true);
 document.addEventListener('visibilitychange',hidden);
 globalThis.addEventListener('pagehide',pageHidden);
 let disposed=false;
 return()=>{
  if(disposed)return;disposed=true;root.removeEventListener('pointerdown',gesture,true);root.removeEventListener('keydown',gesture,true);
  document.removeEventListener('visibilitychange',hidden);
  globalThis.removeEventListener('pagehide',pageHidden);
  if(--owners===0){stop();const audio=context;context=master=null;buffers.clear();unlocked=false;try{audio?.close()?.catch(()=>{});}catch{}}
 };
}
export const shelfSoundPreference=()=>!muted;

export function bindShelfSoundPreference(document){
 const input=document.getElementById('shelf-sounds-toggle');if(!input)return()=>{};
 input.checked=shelfSoundPreference();const changed=()=>setShelfSoundsEnabled(input.checked);
 input.addEventListener('change',changed);return()=>input.removeEventListener('change',changed);
}
