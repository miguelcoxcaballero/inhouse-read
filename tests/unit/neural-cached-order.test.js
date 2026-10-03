// @vitest-environment node
import {afterEach, describe, expect, it, vi} from 'vitest'
import {NeuralEngine} from '../../src/js/readers/neural-voice/engine.js'
import {nativeAudio, resetAudio, unlockAudio} from '../../src/js/readers/neural-voice/audio.js'
import {fakeAudioContext, fakeClients, flush} from './neural-fakes.js'

const voiceId='piper:es_MX-claude-high'
let engine
afterEach(()=>{engine?.stop(); engine=null; resetAudio(); vi.useRealTimers()})
function setup({native=false, limits={}}={}) {
  vi.useFakeTimers()
  const env=new EventTarget(), clients=fakeClients(), ctx=fakeAudioContext(), clock={}
  const bridge={getProtocol:()=>1,begin:vi.fn(),reset:vi.fn(),enqueue:vi.fn(),stop:vi.fn(),getState:()=>JSON.stringify(clock)}
  Object.assign(env,{btoa,Worker(){},WebAssembly:{},caches:{}})
  if(native){env.InhousePcm=bridge;unlockAudio(env)}
  engine=new NeuralEngine({env,createClient:clients.createClient,store:{list:async()=>new Set()},limits,...(native?{}:{audio:{context:()=>ctx,unlock:()=>ctx}})})
  engine._installed.add(voiceId)
  const cache=(text,seconds)=>{
    const pcm=new Float32Array(seconds*8000).fill(.1)
    engine.cache.put(`es_MX-claude-high#0|1|${text}`,[{pcm,sampleRate:8000,dur:seconds,last:true}])
    return pcm
  }
  const event=(type,unit)=>env.dispatchEvent(new CustomEvent('inhouse-pcm',{detail:{session:nativeAudio().session,epoch:engine.player.epoch,type,unit}}))
  return {clients,ctx,bridge,clock,cache,event}
}
describe('cached speech stays in reading order without depending on background timers',()=>{
  it('synthesizes the missing first sentence before long cached later sentences',async()=>{
    const t=setup();t.cache('Later one.',20);t.cache('Later two.',20)
    engine.speak({text:'New chapter.',voiceId,id:'chapter',upcoming:['Later one.','Later two.']})
    await flush()
    expect(t.clients.last()?.jobs.map(j=>j.request.text)).toEqual(['New chapter.'])
    expect(t.ctx.sources).toHaveLength(0)
    expect(engine.run.pumpTimer).toBeNull()
  })
  it('does not count cached sentences after the missing one against maxAhead',async()=>{
    const t=setup({limits:{maxAhead:2}});t.cache('Later one.',1);t.cache('Later two.',1)
    engine.speak({text:'Missing.',voiceId,id:'first',upcoming:['Later one.','Later two.']})
    await flush()
    expect(t.clients.last()?.jobs.map(j=>j.request.text)).toEqual(['Missing.'])
  })
  it('does not let deferred cached pages block the current sentence',async()=>{
    const t=setup();t.cache('Next page.',40)
    engine.speak({text:'Current.',voiceId,id:'current',upcoming:['Next page.'],deferAfter:0})
    await flush()
    expect(t.clients.last()?.jobs.map(j=>j.request.text)).toEqual(['Current.'])
    expect(t.ctx.sources).toHaveLength(0)
  })
  it('still bounds synthesis when earlier cached audio can actually play',async()=>{
    const t=setup();t.cache('First.',20);t.cache('Second.',20)
    engine.speak({text:'First.',voiceId,id:'first',upcoming:['Second.','Missing later.']})
    await flush()
    expect(t.clients.made).toHaveLength(0)
    expect(engine.run.pumpTimer).not.toBeNull()
  })
  it('feeds waiting native cached PCM when the real start clock frees room, with timers suspended',async()=>{
    const t=setup({native:true});const original=t.cache('First.',20);t.cache('Second.',20)
    engine.speak({text:'First.',voiceId,id:'first',upcoming:['Second.']});await flush()
    expect(t.bridge.enqueue).toHaveBeenCalledTimes(1)
    const unit=t.bridge.enqueue.mock.calls[0][2]
    Object.assign(t.clock,{session:nativeAudio().session,epoch:engine.player.epoch,playedSeconds:12})
    t.event('start',unit);await flush()
    expect(t.bridge.enqueue).toHaveBeenCalledTimes(2)
    expect(Buffer.from(t.bridge.enqueue.mock.calls[0][3],'base64')).toEqual(Buffer.from(original.buffer))
    expect(engine.player.buffered()).toBe(28)
    expect(t.clients.made).toHaveLength(0)
  })
  it('feeds waiting native cached PCM when the audible unit ends, with timers suspended',async()=>{
    const t=setup({native:true});t.cache('First.',20);t.cache('Second.',20)
    engine.speak({text:'First.',voiceId,id:'first',upcoming:['Second.']});await flush()
    const unit=t.bridge.enqueue.mock.calls[0][2]
    t.event('start',unit)
    Object.assign(t.clock,{session:nativeAudio().session,epoch:engine.player.epoch,playedSeconds:20})
    t.event('done',unit);await flush()
    expect(t.bridge.enqueue).toHaveBeenCalledTimes(2)
    expect(engine.player.buffered()).toBe(20)
    expect(t.clients.made).toHaveLength(0)
  })
})
