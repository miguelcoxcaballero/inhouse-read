import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ReadingVoice } from '../../src/js/readers/reading-voice.js'
import { loadNeural } from '../../src/js/readers/neural-runtime.js'
import { neuralVoices, setNeuralEngine } from '../../src/js/readers/neural-voice/index.js'
import { nativeAudio, pauseNativeAudio, resetAudio, stopNativeAudio, unlockAudio } from '../../src/js/readers/neural-voice/audio.js'
import { FAKE_CATALOG, createFakeNeuralEngine } from '../helpers/fake-neural-engine.js'
let saved, current
beforeAll(async()=>{await loadNeural();saved=[...neuralVoices];neuralVoices.splice(0,neuralVoices.length,...FAKE_CATALOG)})
afterAll(()=>neuralVoices.splice(0,neuralVoices.length,...saved))
afterEach(()=>{current?.voice.stop();current=null;resetAudio();setNeuralEngine(null);vi.unstubAllGlobals()})
function setup(reader={language:'es',speechPosition:{kind:'chapter',index:3},getSpeechText:async()=> 'Primera frase. Segunda frase.'}) {
  const bridge={getProtocol:()=>1,begin:vi.fn(),pause:vi.fn(),stop:vi.fn(),mark:vi.fn()}
  vi.stubGlobal('InhousePcm',bridge)
  const engine=createFakeNeuralEngine({voices:FAKE_CATALOG,installed:['piper:es_ES-davefx-medium'],hold:true})
  const stop=engine.stop.bind(engine)
  engine.unlock=()=>unlockAudio();engine.stop=()=>{stop();stopNativeAudio()}
  engine.pause=vi.fn(()=>{stop();pauseNativeAudio()});engine.cancelCurrent=vi.fn(()=>stop())
  setNeuralEngine(engine)
  const voice=new ReadingVoice(reader);current={bridge,engine,voice};return current
}
const control=(session,action)=>window.dispatchEvent(new CustomEvent('inhouse-audio-control',{detail:{session,action}}))
const start=(id)=>window.dispatchEvent(new CustomEvent('inhouse-tts',{detail:{type:'start',id}}))
describe('native notification controls keep the actual natural fragment',()=>{
  it('Pause then Stop cancels the paused native session and a stale notification cannot resurrect it',async()=>{
    const t=setup();await t.voice.play();const session=t.voice.nativeSession
    start(t.voice.utteranceId);control(session,'pause')
    expect(t.voice.state).toBe('paused');expect(nativeAudio()).toMatchObject({session,paused:true})
    control(session,'stop');expect(t.voice.state).toBe('stopped');expect(t.bridge.stop).toHaveBeenCalledWith(session)
    expect(nativeAudio()).toBeNull();control(session,'play');expect(t.voice.state).toBe('stopped')
  })
  it('notification resume speaks the same fragment in a new session and rejects controls from the old one',async()=>{
    const t=setup();await t.voice.play();const session=t.voice.nativeSession, text=t.engine.calls.at(-1).text
    start(t.voice.utteranceId);control(session,'pause');control(session,'play')
    expect(t.voice.state).toBe('playing');expect(t.voice.nativeSession).not.toBe(session)
    expect(t.engine.calls.at(-1).text).toBe(text)
    control(session,'stop');expect(t.voice.state).toBe('playing')
    control(t.voice.nativeSession,'stop');expect(t.voice.state).toBe('stopped')
  })
  it('changing voice/rate cancels the old unit but keeps its native foreground session controls',async()=>{
    const t=setup();await t.voice.play();const session=t.voice.nativeSession, old=t.voice.utteranceId
    t.voice.rate=1.25;t.voice.restart()
    expect(t.engine.cancelCurrent).toHaveBeenCalledOnce();expect(t.bridge.begin).toHaveBeenCalledOnce()
    expect(t.voice.nativeSession).toBe(session);expect(t.voice.utteranceId).not.toBe(old)
    start(old);expect(t.bridge.mark).not.toHaveBeenCalled()
    control(session,'pause');expect(t.voice.state).toBe('paused')
  })
  it('publishes only numeric chapter/page position after the matching audible start',async()=>{
    const t=setup();await t.voice.play();const id=t.voice.utteranceId
    expect(t.bridge.mark).not.toHaveBeenCalled();start('stale');expect(t.bridge.mark).not.toHaveBeenCalled()
    start(id);expect(t.bridge.mark).toHaveBeenCalledWith(t.voice.nativeSession,id,3,'chapter')
  })
  it('Pause/Stop while text prepares releases the service and prevents a late source from speaking',async()=>{
    let ready;const pending=new Promise(resolve=>ready=resolve)
    const t=setup({language:'es',getSpeechText:()=>pending})
    const playing=t.voice.play();await Promise.resolve();await Promise.resolve()
    expect(t.voice.state).toBe('loading');const session=t.voice.nativeSession
    control(session,'pause');expect(t.voice.state).toBe('paused');expect(t.bridge.pause).toHaveBeenCalledWith(session)
    t.voice.stop();ready('Una respuesta tardía.');await playing
    expect(t.voice.state).toBe('stopped');expect(t.engine.calls).toHaveLength(0);expect(t.bridge.stop).toHaveBeenCalledWith(session)
  })
})
