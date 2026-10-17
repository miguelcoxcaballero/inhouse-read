// Web Audio transport. Rust produces the short PCM buffers and real contact
// events; no oscillator, polling loop or audio context runs on an idle shelf.
import {needRustShelf} from './rust-shelf.js';
const KEY='inhouse-read-shelf-sounds';
let context=null,master=null,unlocked=false,muted=false,serial=0,idle=0,owners=0;
const buffers=new Map(),voices=new Set(),tails=new Set();
try{muted=localStorage.getItem(KEY)==='off';}catch{}
export const shelfSoundsEnabled=()=>owners>0&&!muted&&unlocked&&document.visibilityState!=='hidden';
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
  unlocked=true;clearTimeout(idle);
  const resumed=context.state==='suspended'?context.resume():Promise.resolve();
  resumed.then(park,()=>{unlocked=false;});
 }catch{unlocked=false;}
}
export function playShelfSound(kind,material=0,strength=1,pan=0){
 if(!shelfSoundsEnabled()||!context)return;
 const audio=context,requested=performance.now(),variant=serial++%3;
 const play=()=>{
  if(context!==audio||!shelfSoundsEnabled()||audio.state!=='running'||performance.now()-requested>180)return;
  try{
   const key=`${kind}:${material}:${variant}`;let buffer=buffers.get(key);
   if(!buffer){
    const pcm=needRustShelf().cozy_sound(kind,material,variant);if(!pcm.length)return;
    buffer=audio.createBuffer(1,pcm.length,24000);buffer.copyToChannel(pcm,0);buffers.set(key,buffer);
   }
   clearTimeout(idle);
   if(voices.size>=4){const first=voices.values().next().value;voices.delete(first);tails.add(first);first.gain.gain.setTargetAtTime(0,audio.currentTime,.006);first.source.stop(audio.currentTime+.025);}
   const source=audio.createBufferSource(),gain=audio.createGain();source.buffer=buffer;
   gain.gain.value=Math.max(0,Math.min(1,Number(strength)||0));source.connect(gain);
   const stereo=audio.createStereoPanner?.();
   if(stereo){stereo.pan.value=Math.max(-.7,Math.min(.7,Number(pan)||0));gain.connect(stereo);stereo.connect(master);}else gain.connect(master);
   const voice={source,gain,pan:stereo};voices.add(voice);
   source.onended=()=>{voices.delete(voice);tails.delete(voice);source.disconnect();gain.disconnect();stereo?.disconnect();park();};source.start();
  }catch{park();}
 };
 if(audio.state==='suspended')audio.resume().then(play,()=>{unlocked=false;});else play();
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
