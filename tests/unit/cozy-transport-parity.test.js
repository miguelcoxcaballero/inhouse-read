import {beforeAll,afterEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import * as native from '../../src/wasm/shelf/inhouse_read_shelf.js';
const runtime=vi.hoisted(()=>({native:null,current:null}));
vi.mock('../../src/js/rust-shelf.js',()=>({needRustShelf:()=>({
 ...runtime.native,
 cozy_sound:(...args)=>{runtime.current.record('synth',...args);return args[0]===99?new Float32Array():new Float32Array([0,.1,-.1,0]);},
 cozy_clip:(...args)=>{runtime.current.record('clip',...args);return runtime.current.clip;},cozy_sample_rate:()=>48000,
})}));
beforeAll(()=>{native.initSync({module:readFileSync('src/wasm/shelf/inhouse_read_shelf_bg.wasm')});runtime.native=native;});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const cases=[
 ['cold settings and missing owner',async h=>{h.api.playShelfSound(3);h.api.unlockShelfSounds();h.api.setShelfSoundsEnabled(true);h.snapshot();h.api.attachShelfSounds(null)();}],
 ['normal lifecycle and exact 180 ms idle boundary',async h=>{h.own();h.api.unlockShelfSounds();await flush();h.endPrime();h.api.playShelfSound(3,1,.6,.8);h.endVoices();await h.advance(179);h.snapshot();await h.advance(1);h.snapshot();h.api.playShelfSound(1);await flush();}],
 ['four voices plus fading tails and stop',async h=>{await h.start();for(let i=0;i<11;i++)h.api.playShelfSound(3,2,.7,.4);h.api.setShelfSoundsEnabled(false);h.snapshot();}],
 ['tail ending and a new voice before sleep',async h=>{await h.start();for(let i=0;i<6;i++)h.api.playShelfSound(3);h.contexts[0].sources[1].onended();h.endVoices();await h.advance(179);h.api.playShelfSound(2);await h.advance(1);h.snapshot();}],
 ['multiple shelf owners and duplicate disposal',async h=>{const a=h.own(),b=h.own();h.api.unlockShelfSounds();await flush();h.api.playShelfSound(2);a();a();h.snapshot();b();b();h.snapshot();}],
 ['last owner closes; new owner creates a new device and PCM cache',async h=>{const dispose=h.own();h.api.unlockShelfSounds();await flush();h.api.playShelfSound(2);dispose();h.own();h.api.unlockShelfSounds();await flush();h.api.playShelfSound(2);}],
 ['hidden page and pagehide stop without closing another owner',async h=>{await h.start();h.api.playShelfSound(0);h.visibility('hidden');document.dispatchEvent(new Event('visibilitychange'));h.snapshot();h.api.playShelfSound(1);h.api.unlockShelfSounds();h.visibility('visible');h.api.unlockShelfSounds();await flush();h.api.playShelfSound(2);globalThis.dispatchEvent(new Event('pagehide'));h.snapshot();}],
 ['untrusted gestures cannot unlock',async h=>{h.own();document.body.dispatchEvent(new Event('pointerdown',{bubbles:true}));document.body.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'a'}));h.snapshot();}],
 ['trusted gesture unlocks synchronously and detached handlers do not linger',async h=>{const dispose=h.own();h.trusted();h.api.playShelfSound(0);await flush();dispose();h.trusted();h.snapshot();}],
 ['missing audio implementation is optional',async h=>{h.own();vi.stubGlobal('AudioContext',undefined);h.api.unlockShelfSounds();h.api.playShelfSound(1);h.snapshot();}],
 ['webkit audio constructor remains supported',async h=>{h.own();vi.stubGlobal('webkitAudioContext',h.Context);vi.stubGlobal('AudioContext',undefined);h.api.unlockShelfSounds();await flush();h.api.playShelfSound(1);}],
 ['closed device replacement',async h=>{await h.start();h.api.playShelfSound(0);h.contexts[0].state='closed';h.api.unlockShelfSounds();await flush();h.api.playShelfSound(0);}],
 ['delayed successful resume schedules pickup immediately',async h=>{await h.start();const audio=h.contexts[0];audio.state='suspended';h.resume='pending';h.api.playShelfSound(17,0,.65);await h.advance(500);h.snapshot();audio.state='running';h.pending.shift().resolve();await flush();}],
 ['rejected resume stops queued source',async h=>{await h.start();h.contexts[0].state='suspended';h.resume='reject';h.api.playShelfSound(17,0,.65);await flush();h.snapshot();}],
 ['unlock resume failure only relocks',async h=>{h.own();h.initial='suspended';h.resume='reject';h.api.unlockShelfSounds();await flush();h.snapshot();}],
 ['unlock promise settles after final owner closes',async h=>{h.initial='suspended';h.resume='pending';const dispose=h.own();h.api.unlockShelfSounds();dispose();h.pending.shift().resolve();await flush();h.snapshot();}],
 ['view transition owns exactly 550 ms before zoom',async h=>{await h.start();h.api.playShelfSound(33);h.api.playShelfSound(31);await h.advance(549);h.api.playShelfSound(32);await h.advance(1);h.api.playShelfSound(31);h.api.playShelfSound(34);await h.advance(550);h.api.playShelfSound(32);}],
 ['retired drag types stay silent without consuming variants',async h=>{await h.start();for(const kind of [4,8,11,18])h.api.playShelfSound(kind);h.api.playShelfSound(0);h.api.playShelfSound('4');h.api.playShelfSound(1);}],
 ['invalid numeric values and gain/pan clamps',async h=>{await h.start();for(const value of [null,undefined,NaN,-Infinity,Infinity,-2,0,.329,.33,.659,.66,2,'x','0.5']){h.api.playShelfSound(3,1,value,value);h.endVoices();}h.record('levels',...[NaN,-Infinity,Infinity,0,.33,.66].map(h.api.shelfSoundLevel));}],
 ['180 ms event deadline includes strength coercion',async h=>{await h.start();let first=true;const strength={valueOf(){h.record('coerce');if(first){first=false;vi.advanceTimersByTime(181);}return .5;}};h.api.playShelfSound(3,1,strength);h.api.playShelfSound(3,1,.5);}],
 ['exactly 180 ms old events still play',async h=>{await h.start();let first=true;const strength={valueOf(){h.record('coerce');if(first){first=false;vi.advanceTimersByTime(180);}return .5;}};h.api.playShelfSound(3,1,strength);}],
 ['synchronous strength coercion may mute or remove owner',async h=>{const dispose=h.own();h.api.unlockShelfSounds();await flush();h.api.playShelfSound(3,1,{valueOf(){h.record('coerce');dispose();return .5;}});h.snapshot();}],
 ['late gain conversion failure is caught and parks the device',async h=>{await h.start();let count=0;h.api.playShelfSound(3,1,{valueOf(){h.record('coerce',++count);if(count>1)throw Error('invalid gain');return .5;}});await h.advance(180);h.snapshot();}],
 ['pan conversion failure is caught and parks the device',async h=>{await h.start();h.api.playShelfSound(3,1,.5,{valueOf(){h.record('pan');throw Error('invalid pan');}});await h.advance(180);h.snapshot();}],
 ['first strength conversion failure propagates before voice allocation',async h=>{await h.start();try{h.api.playShelfSound(3,1,Symbol('strength'));}catch(error){h.record('error',error.name);}h.api.playShelfSound(3);}],
 ['no stereo node still routes directly to master',async h=>{await h.start();h.contexts[0].createStereoPanner=undefined;h.api.playShelfSound(3,0,.4,.2);h.endVoices();}],
 ['unsupported fallback PCM emits no voice',async h=>{await h.start();h.api.playShelfSound(99);h.api.playShelfSound(3);}],
 ['recorded takes, sample rates, PCM and detuning stay identical',async h=>{h.atlas=true;h.clip='missing,wood_L1';vi.spyOn(Math,'random').mockReturnValue(0);await h.start();for(let i=0;i<5;i++)h.api.playShelfSound(3,1,.5,.2);h.endVoices();}],
 ['stopping a voice tolerates an already ended source',async h=>{await h.start();h.api.playShelfSound(3);h.throwStop=true;h.api.setShelfSoundsEnabled(false);h.snapshot();}],
 ['buffer allocation failure parks the audio device',async h=>{await h.start();h.throwBuffer=true;h.api.playShelfSound(3);await h.advance(180);h.snapshot();}],
 ['stored mute survives a fresh attachment and settings binding',async h=>{h.api.setShelfSoundsEnabled(false);h.own();h.api.unlockShelfSounds();h.snapshot();const input=document.createElement('input');input.id='shelf-sounds-toggle';document.body.append(input);const dispose=h.api.bindShelfSoundPreference(document);h.record('checked',input.checked);input.checked=true;input.dispatchEvent(new Event('change'));await flush();h.api.playShelfSound(2);dispose();input.remove();}],
 ['mute becomes visible before preference persistence can reenter',async h=>{await h.start();const persist=Storage.prototype.setItem;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value){h.record('persist',key,value,h.api.shelfSoundsEnabled());h.api.playShelfSound(3);return persist.call(this,key,value);});h.api.setShelfSoundsEnabled(false);h.snapshot();}],
];

async function harness(which,scenario){
 vi.resetModules();vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date','performance']});vi.setSystemTime(0);
 localStorage.clear();document.body.innerHTML='';
 let id=0;
 const trace=[],owners=[],timers=new Map(),listeners=new Map(),h={contexts:[],pending:[],clip:'',resume:'ok',initial:'running',atlas:false,throwStop:false,throwBuffer:false};
 h.record=(...event)=>trace.push([performance.now(),...event]);
 h.visibility=value=>Object.defineProperty(document,'visibilityState',{configurable:true,value});h.visibility('visible');
 class Node{
  constructor(type){this.id=++id;this.type=type;h.record('node',type,this.id);for(const key of ['gain','pan','playbackRate']){let value=key==='playbackRate'?1:0;this[key]={setTargetAtTime:(...args)=>h.record('target',this.id,key,...args)};Object.defineProperty(this[key],'value',{get:()=>value,set:next=>{value=next;h.record('value',this.id,key,next);}});}let ended=null;Object.defineProperty(this,'onended',{get:()=>ended,set:value=>{ended=value;h.record('ended',this.id,value===null?'null':typeof value);}});}
  connect(target){h.record('connect',this.id,target.id??'destination');}
  disconnect(){h.record('disconnect',this.id);}
  start(...args){h.record('start',this.id,...args);}
  stop(...args){h.record('stop',this.id,...args);if(h.throwStop)throw Error('already stopped');}
 }
 h.Context=class{
  constructor(options){this.id=++id;this.state=h.initial;this.currentTime=12.5;this.destination={};this.sources=[];h.contexts.push(this);h.record('context',this.id,options);}
  createGain(){return new Node('gain');}
  createStereoPanner(){return new Node('panner');}
  createBufferSource(){const node=new Node('source');this.sources.push(node);return node;}
  createBuffer(channels,length,rate){h.record('buffer',channels,length,rate);if(h.throwBuffer)throw Error('buffer unavailable');return {length,sampleRate:rate,copyToChannel:(pcm,channel)=>h.record('pcm',channel,Array.from(pcm))};}
  resume(){h.record('resume',this.id);if(h.resume==='pending')return new Promise((resolve,reject)=>h.pending.push({resolve,reject}));if(h.resume==='reject')return Promise.reject(Error('blocked'));this.state='running';return Promise.resolve();}
  suspend(){h.record('suspend',this.id);this.state='suspended';return Promise.resolve();}
  close(){h.record('close',this.id);this.state='closed';return Promise.resolve();}
 };
 vi.stubGlobal('AudioContext',h.Context);vi.stubGlobal('webkitAudioContext',undefined);
 vi.stubGlobal('fetch',url=>{h.record('fetch',String(url).split('/').at(-1));if(!h.atlas)return Promise.reject(Error('offline'));return Promise.resolve({ok:true,json:async()=>({wood_L1_t0:{offset:0,length:4,rate:24000},wood_L1_t1:{offset:4,length:3,rate:22050}}),arrayBuffer:async()=>Int16Array.from([0,16384,-16384,0,0,8192,0]).buffer});});
 runtime.current=h;
 h.api=which==='native'?await import('../../src/js/cozy-sounds.js'):await import('./helpers/reference-cozy-sounds.js');
 const callbackIds=new WeakMap();let callbackSerial=0;
 for(const [target,name] of [[document.body,'root'],[document,'document'],[globalThis,'global']]){
  const add=target.addEventListener,remove=target.removeEventListener;
  vi.spyOn(target,'addEventListener').mockImplementation(function(type,callback,options){
   if(!callbackIds.has(callback))callbackIds.set(callback,++callbackSerial);
   h.record('listen',name,type,callbackIds.get(callback),options);
   if(name==='root'&&type==='pointerdown')listeners.set(callback,true);
   return add.call(this,type,callback,options);
  });
  vi.spyOn(target,'removeEventListener').mockImplementation(function(type,callback,options){
   h.record('unlisten',name,type,callbackIds.get(callback),options);
   if(name==='root'&&type==='pointerdown')listeners.delete(callback);
   return remove.call(this,type,callback,options);
  });
 }
 h.trusted=()=>{for(const callback of listeners.keys())callback({isTrusted:true});};
 // Count only the transport's timers, not Vite/jsdom import bookkeeping.
 const setTimer=globalThis.setTimeout,clearTimer=globalThis.clearTimeout;let timerSerial=0;
 vi.stubGlobal('setTimeout',(callback,delay,...args)=>{
  const serial=++timerSerial;let id;id=setTimer(()=>{timers.delete(id);callback(...args);},delay);
  timers.set(id,serial);h.record('timer',serial,delay);return id;
 });
 vi.stubGlobal('clearTimeout',id=>{if(timers.has(id))h.record('cancelTimer',timers.get(id));timers.delete(id);clearTimer(id);});
 h.own=()=>{const dispose=h.api.attachShelfSounds(document.body);owners.push(dispose);return dispose;};
 h.start=async()=>{h.own();h.api.unlockShelfSounds();await flush();};
 h.snapshot=()=>h.record('snapshot',h.api.shelfSoundsEnabled(),h.api.shelfSoundPreference(),h.contexts.map(context=>context.state),localStorage.getItem('inhouse-read-shelf-sounds'));
 h.advance=async delay=>{await vi.advanceTimersByTimeAsync(delay);};
 h.endPrime=()=>{for(const context of h.contexts)context.sources[0]?.onended?.();};
 h.endVoices=()=>{for(const context of h.contexts)for(const source of context.sources.slice(1))if(source.onended){source.onended();source.onended=null;}};
 try{await scenario(h);await flush();}finally{for(const dispose of owners)dispose();await flush();h.record('pendingTimers',timers.size);vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();}
 return trace;
}

it.each(cases)('matches WebAudio order, timing and ownership: %s',async(_name,scenario)=>{
 const before=native.shelf_live_handles();
 const reference=await harness('reference',scenario),actual=await harness('native',scenario);
 expect(actual).toEqual(reference);
 expect(native.shelf_live_handles()).toBe(before);
 expect(native.shelf_pending_callbacks()).toBe(0);
});

it('returns native handles and timer ownership to baseline across repeated shelf lifetimes',async()=>{
 const before=native.shelf_live_handles();
 await harness('native',async h=>{
  for(let i=0;i<160;i++){
   const dispose=h.own();h.api.unlockShelfSounds();await flush();h.endPrime();
   for(let j=0;j<7;j++)h.api.playShelfSound(3,j%3,.5,.2);
   h.endVoices();await h.advance(180);dispose();dispose();await flush();
   expect(native.shelf_live_handles()).toBe(before);
   expect(native.shelf_pending_callbacks()).toBe(0);
  }
 });
 expect(native.shelf_live_handles()).toBe(before);
},30000);
