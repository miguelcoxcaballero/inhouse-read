// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativePcmPlayer, encodePcm } from '../../src/js/readers/neural-voice/native-player.js'
import { audioContext, nativeAudio, pauseNativeAudio, resetAudio, stopNativeAudio, unlockAudio } from '../../src/js/readers/neural-voice/audio.js'
import { NeuralEngine } from '../../src/js/readers/neural-voice/engine.js'
import { NeuralVoiceEngine } from '../../src/js/readers/neural-voice/index.js'
import { fakeClients, feedJob, flush, recordEvents } from './neural-fakes.js'

let current
function setup() {
  const env = new EventTarget(), bridge = { getProtocol:()=>1, begin:vi.fn(), enqueue:vi.fn(), reset:vi.fn(), truncateAfter:vi.fn(), pause:vi.fn(), stop:vi.fn(), getState:()=>JSON.stringify(current.clock) }
  Object.assign(env, { InhousePcm:bridge, btoa, Worker(){}, WebAssembly:{}, caches:{} })
  const start=vi.fn(), end=vi.fn(), error=vi.fn(), player=new NativePcmPlayer({env,onStart:start,onEnd:end,onError:error})
  current = {env,bridge,player,start,end,error,clock:{}}
  unlockAudio(env)
  return current
}
const pcm = new Float32Array(22050).fill(.1)
function event(type, unit, extra={}) {
  current.env.dispatchEvent(new CustomEvent('inhouse-pcm',{detail:{session:nativeAudio()?.session,epoch:current.player.epoch,type,unit,...extra}}))
}
afterEach(() => { current?.player.dispose(); current=null; resetAudio(); vi.useRealTimers() })

describe('natural Android Float32 PCM sink', () => {
  it('transports the exact Float32 samples as little endian without downsampling or quantisation', () => {
    const input = new Float32Array([0, -.2, .125, 1, -.9999])
    const bytes = Buffer.from(encodePcm(input),'base64')
    expect([...input].map((_,i)=>bytes.readFloatLE(i*4))).toEqual([...input])
    expect([...input]).toEqual([0,Math.fround(-.2),.125,1,Math.fround(-.9999)])
    expect(()=>encodePcm(new Float32Array([NaN]))).toThrow('invalid PCM')
  })
  it('unlocks a native foreground session synchronously without creating Web Audio', () => {
    const t=setup()
    expect(t.bridge.begin).toHaveBeenCalledOnce()
    expect(audioContext()).toMatchObject({native:true,state:'running'})
    unlockAudio(t.env); expect(t.bridge.begin).toHaveBeenCalledOnce()
  })
  it('supports a native-only AudioTrack sink with the same neural model prerequisites', () => {
    const t=setup()
    expect(NeuralEngine.isSupported(t.env)).toBe(true)
    expect(NeuralVoiceEngine.isSupported(t.env)).toBe(true)
    expect(NeuralEngine.isSupported({...t.env, InhousePcm:{getProtocol:()=>0}})).toBe(false)
  })
  it('waits for authentic native start/done; elapsed JavaScript time cannot advance a fragment', () => {
    vi.useFakeTimers(); const t=setup()
    t.player.schedule(1,pcm,22050,{last:true})
    vi.advanceTimersByTime(300_000)
    expect(t.start).not.toHaveBeenCalled(); expect(t.end).not.toHaveBeenCalled()
    event('done',1); expect(t.end).not.toHaveBeenCalled()
    event('start',1); event('start',1); event('done',1); event('done',1)
    expect(t.start).toHaveBeenCalledExactlyOnceWith(1); expect(t.end).toHaveBeenCalledExactlyOnceWith(1)
  })
  it('registers a fragment before a synchronous enqueue callback', () => {
    const t=setup(); t.bridge.enqueue.mockImplementation((_session,_epoch,n)=>event('start',n))
    t.player.schedule(7,pcm,22050,{last:true})
    expect(t.start).toHaveBeenCalledExactlyOnceWith(7); expect(t.player.playing()).toBe(7)
  })
  it('uses the native rendered-frame clock and queues fragments without a gap', () => {
    const t=setup(); t.player.schedule(1,pcm,22050,{last:true})
    t.clock={session:nativeAudio().session,epoch:t.player.epoch,playedSeconds:.25}
    expect(t.player.schedule(2,pcm,22050,{last:true})).toBe(1)
    expect(t.player.buffered()).toBe(1.75); expect(t.player.drained()).toBe(false)
    t.clock.playedSeconds=2; expect(t.player.drained()).toBe(true)
  })
  it('rejects a stale head clock and callbacks after a restart in the same foreground session', () => {
    const t=setup(); t.player.schedule(1,pcm,22050,{last:true}); const oldEpoch=t.player.epoch
    t.clock={session:nativeAudio().session,epoch:oldEpoch,playedSeconds:19}
    t.player.stopAll({keepSession:true})
    expect(t.player.schedule(2,pcm,22050,{last:true})).toBe(0)
    event('start',2,{epoch:oldEpoch}); event('error',-1,{epoch:oldEpoch})
    expect(t.start).not.toHaveBeenCalled(); expect(t.error).not.toHaveBeenCalled()
    expect(t.bridge.stop).not.toHaveBeenCalled()
  })
  it('Pause retains a cancellable paused session, and Stop removes that notification/session', () => {
    const t=setup(), session=nativeAudio().session
    t.player.schedule(1,pcm,22050,{last:true}); t.player.stopAll({pause:true})
    expect(t.bridge.pause).toHaveBeenCalledWith(session)
    expect(nativeAudio()).toMatchObject({session,paused:true}); expect(audioContext()).toBeNull()
    t.player.stopAll()
    expect(t.bridge.stop).toHaveBeenCalledWith(session); expect(nativeAudio()).toBeNull()
    event('start',1,{session}); expect(t.start).not.toHaveBeenCalled()
  })
  it('resuming creates a fresh session and rejects PCM events from the paused one', () => {
    const t=setup(), previous=nativeAudio().session
    t.player.schedule(1,pcm,22050,{last:true}); t.player.stopAll({pause:true})
    unlockAudio(t.env); expect(nativeAudio().session).not.toBe(previous)
    t.player.schedule(2,pcm,22050,{last:true})
    event('start',2,{session:previous}); expect(t.start).not.toHaveBeenCalled()
    event('start',2); expect(t.start).toHaveBeenCalledWith(2)
  })
  it('truncates queued lookahead without cancelling the audible unit', () => {
    const t=setup(); t.player.schedule(1,pcm,22050,{last:true}); t.player.schedule(2,pcm,22050,{last:true})
    event('start',1); t.player.truncateAfter(1)
    expect(t.player.playing()).toBe(1); expect(t.bridge.truncateAfter).toHaveBeenCalledWith(nativeAudio().session,t.player.epoch,1)
    event('start',2); expect(t.start).toHaveBeenCalledTimes(1)
    expect(t.player.schedule(3,pcm,22050,{last:true})).toBe(1)
  })
  it('does not accept invalid sample rates or non-finite PCM', () => {
    const t=setup()
    expect(()=>t.player.schedule(1,pcm,7999)).toThrow()
    expect(()=>t.player.schedule(1,new Float32Array([Infinity]),22050)).toThrow()
    expect(t.bridge.enqueue).not.toHaveBeenCalled()
  })
  it('disposes the native event listener and stops even a paused session', () => {
    const t=setup(); pauseNativeAudio(); t.player.dispose()
    expect(t.bridge.stop).toHaveBeenCalledOnce(); stopNativeAudio()
    event('error',-1); expect(t.error).not.toHaveBeenCalled()
  })
  it('opening/selecting/downloading a voice cannot start a native foreground service',()=>{
    const t=setup(); stopNativeAudio(); t.bridge.begin.mockClear()
    const engine=new NeuralEngine({env:t.env,store:{list:async()=>new Set()}})
    engine.unlock({playback:false})
    expect(t.bridge.begin).not.toHaveBeenCalled();expect(nativeAudio()).toBeNull()
    engine.unlock();expect(t.bridge.begin).toHaveBeenCalledOnce();engine.stop()
  })
  it('the engine cancels loading and ignores late worker PCM after Stop', async () => {
    const t=setup(), clients=fakeClients()
    const engine=new NeuralEngine({env:t.env,store:{list:async()=>new Set()},createClient:clients.createClient})
    engine._installed.add('piper:es_MX-claude-high')
    engine.speak({text:'Primero.',voiceId:'piper:es_MX-claude-high',id:'old'}); await flush()
    const job=clients.last().jobs[0]; engine.stop(); feedJob(job,1); await flush()
    expect(t.bridge.enqueue).not.toHaveBeenCalled(); expect(t.bridge.stop).toHaveBeenCalled()
  })
  it('bounds native delivery of cached fragments and resumes from the rendered clock without changing PCM', async()=>{
    vi.useFakeTimers();const t=setup(),clients=fakeClients(),events=recordEvents(t.env)
    const engine=new NeuralEngine({env:t.env,store:{list:async()=>new Set()},createClient:clients.createClient})
    const voiceId='piper:es_MX-claude-high',texts=Array.from({length:7},(_,i)=>`Texto ${i}.`)
    const samples=new Float32Array(8000*20).fill(.1)
    engine._installed.add(voiceId)
    for(const text of texts)engine.cache.put(`es_MX-claude-high#0|0.5|${text}`,[{pcm:samples,sampleRate:8000,dur:20,last:true}])
    engine.speak({text:texts[0],voiceId,rate:.5,id:'first',upcoming:texts.slice(1)})
    await flush()
    expect(t.bridge.enqueue).toHaveBeenCalledTimes(1)
    const [,epoch,unit,encoded]=t.bridge.enqueue.mock.calls[0]
    expect(Buffer.from(encoded,'base64').equals(Buffer.from(samples.buffer))).toBe(true)
    expect(clients.made).toHaveLength(0)
    t.clock={session:nativeAudio().session,epoch,playedSeconds:12}
    vi.advanceTimersByTime(1000);await flush()
    expect(t.bridge.enqueue).toHaveBeenCalledTimes(2)
    expect(engine.player.buffered()).toBe(28)
    t.env.dispatchEvent(new CustomEvent('inhouse-pcm',{detail:{session:nativeAudio().session,epoch,type:'start',unit}}))
    engine.stop();vi.advanceTimersByTime(60_000);await flush()
    expect(t.bridge.enqueue).toHaveBeenCalledTimes(2)
    expect(events.filter(e=>e.type==='error')).toEqual([])
  })
  it('reports playback failure and cancels native service instead of advancing silently', async () => {
    const t=setup(), clients=fakeClients(), events=recordEvents(t.env)
    const engine=new NeuralEngine({env:t.env,store:{list:async()=>new Set()},createClient:clients.createClient})
    engine._installed.add('piper:es_MX-claude-high')
    t.bridge.enqueue.mockImplementation(()=>{throw new Error('closed')})
    engine.speak({text:'Primero.',voiceId:'piper:es_MX-claude-high',id:'a'}); await flush()
    feedJob(clients.last().jobs[0],1); await flush()
    expect(events).toContainEqual({type:'error',id:'a',reason:'native-playback-failed'})
    expect(engine.run).toBeNull(); expect(nativeAudio()).toBeNull()
  })
})
