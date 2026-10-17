import {beforeEach,afterEach,expect,it,vi} from 'vitest';
const synth=vi.hoisted(()=>vi.fn(()=>new Float32Array([0,.1,0])));
const clip=vi.hoisted(()=>vi.fn(()=>''));
vi.mock('../../src/js/rust-shelf.js',()=>({needRustShelf:()=>({cozy_sound:synth,cozy_clip:clip})}));
let contexts,disposed,module,fetches;
class Node{
 constructor(){this.gain={value:0,setTargetAtTime:vi.fn()};this.pan={value:0};this.playbackRate={value:1};this.connect=vi.fn();this.disconnect=vi.fn();}
}
class Context{
 constructor(){this.state='running';this.currentTime=0;this.destination={};this.sources=[];contexts.push(this);}
 createGain(){return new Node();}createStereoPanner(){return new Node();}
 createBuffer(channels,length,rate){return {length,sampleRate:rate,copyToChannel:vi.fn()};}
 createBufferSource(){const n=new Node();n.start=vi.fn();n.stop=vi.fn();this.sources.push(n);return n;}
 resume=vi.fn(async()=>{this.state='running';});suspend=vi.fn(async()=>{this.state='suspended';});close=vi.fn(async()=>{this.state='closed';});
}
const offline=()=>Promise.reject(new TypeError('Failed to fetch'));
const atlasFetch=(index,samples)=>url=>{
 const name=String(url);
 if(name.endsWith('/sfx/atlas.json'))return Promise.resolve({ok:true,json:async()=>index});
 if(name.endsWith('/sfx/atlas.bin'))return Promise.resolve({ok:true,arrayBuffer:async()=>Int16Array.from(samples).buffer});
 return Promise.resolve({ok:false,status:404});
};
beforeEach(async()=>{
 vi.resetModules();vi.useFakeTimers();synth.mockClear();clip.mockReset();clip.mockReturnValue('');contexts=[];disposed=[];
 fetches=vi.fn(offline);vi.stubGlobal('fetch',fetches);
 localStorage.clear();Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
 vi.stubGlobal('AudioContext',Context);module=await import('../../src/js/cozy-sounds.js');
});
afterEach(()=>{for(const f of disposed)f();vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});
const own=()=>{const f=module.attachShelfSounds(document.body);disposed.push(f);return f;};
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
const started=audio=>audio.sources.slice(1).filter(source=>source.start.mock.calls.length);

it('does not create audio from settings or an untouched shelf, then sleeps between sounds',async()=>{
 module.setShelfSoundsEnabled(true);expect(contexts).toHaveLength(0);own();expect(contexts).toHaveLength(0);
 module.unlockShelfSounds();await flush();expect(contexts).toHaveLength(1);
 module.playShelfSound(0);expect(synth).toHaveBeenCalledWith(0,0,0,2);
 const audio=contexts[0],voice=audio.sources.at(-1);expect(voice.start).toHaveBeenCalledTimes(1);
 voice.onended();await vi.advanceTimersByTimeAsync(180);expect(audio.state).toBe('suspended');
 module.playShelfSound(1);await flush();expect(audio.resume).toHaveBeenCalledTimes(1);expect(synth).toHaveBeenLastCalledWith(1,0,1,2);
});

it('reuses three PCM variants per level and limits overlapping voices',async()=>{
 own();module.unlockShelfSounds();await flush();
 for(let i=0;i<9;i++)module.playShelfSound(3,2,.7,.4);
 expect(synth).toHaveBeenCalledTimes(3);
 const voices=contexts[0].sources.slice(1);expect(voices).toHaveLength(9);
 expect(voices.filter(v=>v.stop.mock.calls.length)).toHaveLength(5);
 expect(voices.at(-1).buffer.sampleRate).toBe(24000);
});

it('renders soft, medium and hard events from the strength',async()=>{
 own();module.unlockShelfSounds();await flush();
 module.playShelfSound(3,1,.2);module.playShelfSound(3,1,.5);module.playShelfSound(3,1,.9);
 expect(synth.mock.calls.map(call=>call[3])).toEqual([0,1,2]);
 expect([0,.329,.33,.659,.66,1,'x'].map(module.shelfSoundLevel)).toEqual([0,0,1,1,2,2,0]);
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
 expect(contexts).toHaveLength(0);expect(synth).not.toHaveBeenCalled();expect(fetches).not.toHaveBeenCalled();
});

it('plays a random recorded take of the most specific atlas group, never the same take twice running',async()=>{
 fetches.mockImplementation(atlasFetch({
  impact_wood_L0_t0:{offset:0,length:4,rate:24000},impact_wood_L0_t1:{offset:4,length:3,rate:22050},
  broken_t0:{offset:6,length:50,rate:24000},odd_t0:{offset:-1,length:3},
 },[0,16384,-16384,0,0,8192,0]));
 clip.mockImplementation((kind,material,level)=>kind===3?`impact_wood_L${level}_x,impact_wood_L${level},impact_wood_L1`:'');
 vi.spyOn(Math,'random').mockReturnValue(0);
 own();module.unlockShelfSounds();await flush();
 expect(fetches.mock.calls.map(call=>String(call[0]).replace(/^.*\/sfx\//,''))).toEqual(['atlas.json','atlas.bin']);
 for(let i=0;i<4;i++)module.playShelfSound(3,1,.2,0);
 expect(synth).not.toHaveBeenCalled();expect(clip).toHaveBeenCalledTimes(1);expect(clip).toHaveBeenCalledWith(3,1,0);
 const voices=started(contexts[0]);expect(voices.map(v=>v.buffer.length)).toEqual([4,3,4,3]);
 expect(voices[1].buffer.sampleRate).toBe(22050);
 expect(Array.from(voices[0].buffer.copyToChannel.mock.calls[0][0])).toEqual([0,.5,-.5,0]);
 // Takes are cached as buffers, and repeats are detuned by at most 4 %.
 expect(voices[0].buffer).toBe(voices[2].buffer);for(const v of voices)expect(Math.abs(v.playbackRate.value-1)).toBeLessThanOrEqual(.0400001);
 // An event the atlas lacks still sounds, synthesised.
 module.playShelfSound(29,0,.5);expect(synth).toHaveBeenCalledWith(29,0,expect.any(Number),1);
});

it('falls back to the synthesised sound while the atlas loads, when it is invalid and when offline',async()=>{
 let resolve;fetches.mockImplementation(()=>new Promise(r=>{resolve=r;}));clip.mockReturnValue('impact_wood_L1');
 own();module.unlockShelfSounds();await flush();
 module.playShelfSound(3,1,.5);expect(synth).toHaveBeenCalledTimes(1);
 resolve({ok:false,status:503});await flush();
 module.playShelfSound(3,1,.5);expect(synth).toHaveBeenCalledTimes(2);
 // A failed atlas is not fetched again on every gesture.
 const calls=fetches.mock.calls.length;module.unlockShelfSounds();await flush();expect(fetches).toHaveBeenCalledTimes(calls);
 expect(module.indexShelfSoundAtlas({a_t0:{offset:0,length:2},b_t1:{offset:1,length:5},c:{offset:'0',length:2}},4).size).toBe(1);
 expect(module.indexShelfSoundAtlas(null,4).size).toBe(0);
});

it('lets a view switch own its whoosh before zoom whooshes resume',async()=>{
 own();module.unlockShelfSounds();await flush();const audio=contexts[0];
 module.playShelfSound(33,0,.6);module.playShelfSound(31,0,.5);module.playShelfSound(32,0,.5);
 expect(started(audio)).toHaveLength(1);
 await vi.advanceTimersByTimeAsync(600);module.playShelfSound(31,0,.5);expect(started(audio)).toHaveLength(2);
 module.setShelfSoundsEnabled(false);module.playShelfSound(34,0,.6);expect(started(audio)).toHaveLength(2);
});

it('queues a pickup before a delayed resume callback so cover work cannot discard it',async()=>{
 own();module.unlockShelfSounds();await flush();
 const audio=contexts[0];audio.state='suspended';let resolveResume;
 audio.resume.mockImplementation(()=>new Promise(resolve=>{resolveResume=resolve;}));
 module.playShelfSound(17,0,.65);
 expect(synth).toHaveBeenCalledWith(17,0,0,1);
 const voice=audio.sources.at(-1);expect(voice.start).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(500);audio.state='running';resolveResume();await flush();
 expect(voice.start).toHaveBeenCalledTimes(1);
});
it('stops a queued pickup if resuming audio is rejected',async()=>{
 own();module.unlockShelfSounds();await flush();
 const audio=contexts[0];audio.state='suspended';audio.resume.mockRejectedValue(new Error('blocked'));
 module.playShelfSound(17,0,.65);const voice=audio.sources.at(-1);await flush();
 expect(voice.stop).toHaveBeenCalledTimes(1);expect(module.shelfSoundsEnabled()).toBe(false);
});
