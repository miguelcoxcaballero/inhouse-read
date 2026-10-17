import {beforeEach,afterEach,expect,it,vi} from 'vitest';
const synth=vi.hoisted(()=>vi.fn(()=>new Float32Array([0,.1,0])));
vi.mock('../../src/js/rust-shelf.js',()=>({needRustShelf:()=>({cozy_sound:synth})}));
let contexts,disposed,module;
class Node{
 constructor(){this.gain={value:0,setTargetAtTime:vi.fn()};this.pan={value:0};this.connect=vi.fn();this.disconnect=vi.fn();}
}
class Context{
 constructor(){this.state='running';this.currentTime=0;this.destination={};this.sources=[];contexts.push(this);}
 createGain(){return new Node();}createStereoPanner(){return new Node();}
 createBuffer(channels,length,rate){return {length,sampleRate:rate,copyToChannel:vi.fn()};}
 createBufferSource(){const n=new Node();n.start=vi.fn();n.stop=vi.fn();this.sources.push(n);return n;}
 resume=vi.fn(async()=>{this.state='running';});suspend=vi.fn(async()=>{this.state='suspended';});close=vi.fn(async()=>{this.state='closed';});
}
beforeEach(async()=>{
 vi.resetModules();vi.useFakeTimers();synth.mockClear();contexts=[];disposed=[];
 localStorage.clear();Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
 vi.stubGlobal('AudioContext',Context);module=await import('../../src/js/cozy-sounds.js');
});
afterEach(()=>{for(const f of disposed)f();vi.unstubAllGlobals();vi.useRealTimers();});
const own=()=>{const f=module.attachShelfSounds(document.body);disposed.push(f);return f;};
const flush=async()=>{await Promise.resolve();await Promise.resolve();};

it('does not create audio from settings or an untouched shelf, then sleeps between sounds',async()=>{
 module.setShelfSoundsEnabled(true);expect(contexts).toHaveLength(0);own();expect(contexts).toHaveLength(0);
 module.unlockShelfSounds();await flush();expect(contexts).toHaveLength(1);
 module.playShelfSound(0);expect(synth).toHaveBeenCalledWith(0,0,0);
 const audio=contexts[0],voice=audio.sources.at(-1);expect(voice.start).toHaveBeenCalledTimes(1);
 voice.onended();await vi.advanceTimersByTimeAsync(180);expect(audio.state).toBe('suspended');
 module.playShelfSound(1);await flush();expect(audio.resume).toHaveBeenCalledTimes(1);expect(synth).toHaveBeenLastCalledWith(1,0,1);
});

it('reuses three PCM variants and limits overlapping voices',async()=>{
 own();module.unlockShelfSounds();await flush();
 for(let i=0;i<9;i++)module.playShelfSound(3,2,.7,.4);
 expect(synth).toHaveBeenCalledTimes(3);
 const voices=contexts[0].sources.slice(1);expect(voices).toHaveLength(9);
 expect(voices.filter(v=>v.stop.mock.calls.length)).toHaveLength(5);
 expect(voices.at(-1).buffer.sampleRate).toBe(24000);
});

it('mutes immediately, persists the preference and releases only its own context',async()=>{
 const dispose=own();module.unlockShelfSounds();await flush();module.playShelfSound(2);
 const audio=contexts[0];module.setShelfSoundsEnabled(false);
 expect(localStorage.getItem('inhouse-read-shelf-sounds')).toBe('off');expect(audio.sources.at(-1).stop).toHaveBeenCalledTimes(1);
 const count=synth.mock.calls.length;module.playShelfSound(3);expect(synth).toHaveBeenCalledTimes(count);
 dispose();expect(audio.close).toHaveBeenCalledTimes(1);dispose();expect(audio.close).toHaveBeenCalledTimes(1);
});

it('also stops the brief fading tails when muting a crowded sound batch',async()=>{
 own();module.unlockShelfSounds();await flush();for(let i=0;i<9;i++)module.playShelfSound(3,1);
 module.setShelfSoundsEnabled(false);
 for(const source of contexts[0].sources.slice(1)){
  expect(source.stop.mock.calls.at(-1)).toEqual([]);
  expect(source.disconnect).toHaveBeenCalled();expect(source.onended).toBeNull();
 }
});

it('stops for hidden pages and retains audio until the last shelf owner is disposed',async()=>{
 const first=own(),last=own();module.unlockShelfSounds();await flush();module.playShelfSound(0);
 first();expect(contexts[0].close).not.toHaveBeenCalled();
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
 document.dispatchEvent(new Event('visibilitychange'));expect(contexts[0].state).toBe('suspended');
 expect(module.shelfSoundsEnabled()).toBe(false);last();expect(contexts[0].state).toBe('closed');
});

it('keeps unavailable browser audio optional',()=>{
 own();vi.stubGlobal('AudioContext',undefined);module.unlockShelfSounds();module.playShelfSound(0);
 expect(contexts).toHaveLength(0);expect(synth).not.toHaveBeenCalled();
});
