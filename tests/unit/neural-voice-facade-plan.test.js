// @vitest-environment node
import {readFileSync} from 'node:fs'
import {beforeEach,expect,it,vi} from 'vitest'
const fixture=vi.hoisted(()=>({instances:[],loaded:null,require:vi.fn()}))
vi.mock('../../src/js/rust-voice-core.js',()=>({getRustVoiceCore:()=>fixture.loaded,requireRustVoiceCore:()=>fixture.require()}))
vi.mock('../../src/js/readers/neural-voice/engine.js',()=>({NeuralEngine:class extends EventTarget{
 constructor(options){super();this.options=options;fixture.instances.push(this)}
 speak=vi.fn(request=>this.options.onSpeak?.(request));warmUp=vi.fn(async()=>true);prime=vi.fn(async()=>true)
 release=vi.fn();stop=vi.fn();pause=vi.fn();cancelCurrent=vi.fn()
}}))
import {NeuralVoiceEngine} from '../../src/js/readers/neural-voice/index.js'
const core=new WebAssembly.Instance(new WebAssembly.Module(readFileSync('src/wasm/inhouse_read_voice.wasm'))).exports
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve}}
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()}
beforeEach(()=>{fixture.instances.length=0;fixture.loaded=core;fixture.require.mockReset()})
it('construction and inactive stop/pause/release retain zero voice work',()=>{
 const engine=new NeuralVoiceEngine();engine.pause();engine.stop();engine.release();engine.cancelCurrent()
 expect(engine.plan).toBe(null);expect(engine.loading).toBe(null);expect(fixture.instances).toEqual([]);expect(fixture.require).not.toHaveBeenCalled()
})
it('adopts queued speech into the native FIFO and releases remaining callbacks on close',async()=>{
 let engine;engine=new NeuralVoiceEngine({onSpeak:request=>{if(request.id===1)engine.release()}})
 engine.speak({id:1,text:'First'});engine.speak({id:2,text:'Must not restart after close'})
 await engine.preload();expect(fixture.instances[0].speak.mock.calls.map(([r])=>r.id)).toEqual([1]);expect(fixture.instances[0].release).toHaveBeenCalledOnce()
 expect(engine.queue).toEqual([]);expect(engine.plan.draining).toBe(false)
})
it.each(['stop','pause','cancelCurrent'])('does not restart queued speech after %s during adoption',async action=>{
 let engine;engine=new NeuralVoiceEngine({onSpeak:request=>{if(request.id===1)engine[action]()}})
 engine.speak({id:1,text:'First'});engine.speak({id:2,text:'Must stay cancelled'})
 await engine.preload();expect(fixture.instances[0].speak.mock.calls.map(([r])=>r.id)).toEqual([1])
 expect(fixture.instances[0][action]).toHaveBeenCalledOnce();expect(engine.plan.take()).toBeNaN();engine.release()
})
it('suppresses stale warmup and prime requests after reader release during module loading',async()=>{
 const engine=new NeuralVoiceEngine(),warm=engine.warmUp('voice'),prime=engine.prime({text:'Pending'})
 engine.release();expect(await warm).toBe(false);expect(await prime).toBe(false)
 expect(fixture.instances[0].warmUp).not.toHaveBeenCalled();expect(fixture.instances[0].prime).not.toHaveBeenCalled()
 expect(await engine.warmUp('voice')).toBe(true);expect(await engine.prime({text:'Now'})).toBe(true);engine.release()
})
it('survives release during first core download without starting voices or another download',async()=>{
 const gate=deferred();fixture.loaded=null;fixture.require.mockImplementation(()=>gate.promise.then(value=>(fixture.loaded=value)))
 const engine=new NeuralVoiceEngine(),warm=engine.warmUp('voice')
 await vi.dynamicImportSettled?.();await flush();expect(fixture.require).toHaveBeenCalledOnce()
 engine.release();gate.resolve(core);expect(await warm).toBe(false)
 expect(fixture.require).toHaveBeenCalledOnce();expect(fixture.instances).toHaveLength(1);expect(fixture.instances[0].warmUp).not.toHaveBeenCalled()
 engine.release()
})
