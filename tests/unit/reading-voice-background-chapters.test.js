import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ReadingVoice } from '../../src/js/readers/reading-voice.js'
import { FoliateSpeechCursor } from '../../src/js/readers/foliate-speech-cursor.js'
import { mapSpeechText } from '../../src/js/readers/speech-map.js'
import { loadNeural } from '../../src/js/readers/neural-runtime.js'
import { neuralVoices, setNeuralEngine } from '../../src/js/readers/neural-voice/index.js'
import { createFakeNeuralEngine, FAKE_CATALOG } from '../helpers/fake-neural-engine.js'
import * as CFI from 'foliate-js/epubcfi.js'

let saved, voice, cursor
beforeAll(async () => { await loadNeural(); saved = [...neuralVoices]; neuralVoices.splice(0,neuralVoices.length,...FAKE_CATALOG) })
afterEach(() => { voice?.stop(); cursor?.close(); voice = cursor = null; setNeuralEngine(null); vi.restoreAllMocks() })
afterAll(() => { neuralVoices.splice(0,neuralVoices.length,...saved) })
const drain = async () => { for (let step = 0; step < 60; step++) await Promise.resolve() }
function setup() {
  const env = new EventTarget(); env.hidden = true
  const docs = ['Primera frase.','Segunda frase.','Tercera frase.'].map(text => new DOMParser().parseFromString(`<p>${text}</p>`,'text/html'))
  const view = { book:{sections:docs.map(doc => ({size:100,createDocument:async () => doc}))}, lastLocation:{section:{current:0}},
    renderer:{getContents:() => [{index:0,doc:docs[0]}]}, goTo:vi.fn(() => new Promise(() => {})),
    getCFI:(index,range) => CFI.joinIndir(CFI.fake.fromIndex(index),CFI.fromRange(range)) }
  const reader = { language:'es', location:{index:0}, next:vi.fn(() => new Promise(() => {})) }
  cursor = new FoliateSpeechCursor(view,{env,onRelocate:location => { reader.location = location }})
  const map = mapSpeechText(docs[0].body)
  reader.getSpeechSource = async () => cursor.wrap({text:map.text,start:0},map,0)
  reader.getNextSpeechSource = options => cursor.next(options)
  const engine = createFakeNeuralEngine({voices:FAKE_CATALOG,installed:['piper:es_ES-davefx-medium'],hold:true})
  setNeuralEngine(engine); voice = new ReadingVoice(reader); voice.voice = 'piper:es_ES-davefx-medium'
  return {env,view,reader,engine,docs}
}

describe('ReadingVoice uses detached chapters without waiting for a hidden visual page', () => {
  it('reads three complete chapters in order while every visual navigation remains unresolved',async () => {
    const h = setup(), timer = vi.spyOn(globalThis,'setTimeout')
    await voice.play()
    for (let chapter = 0; chapter < 3; chapter++) {
      const call = h.engine.calls.at(-1)
      h.engine.emit('start',call.id); await drain()
      expect(h.reader.location.index).toBe(chapter)
      h.engine.emit('done',call.id); await drain()
    }
    expect(h.engine.calls.map(call => call.text)).toEqual(['Primera frase.','Segunda frase.','Tercera frase.'])
    expect(voice.state).toBe('stopped')
    expect(h.reader.next).not.toHaveBeenCalled(); expect(h.view.goTo).not.toHaveBeenCalled()
    // The only timers are the cosmetic "preparing" label. No chapter wait,
    // render retry, heartbeat, silence or synthetic completion is supplied.
    expect(timer.mock.calls.every(([,ms]) => ms === 900)).toBe(true)
  })
  it('rechecks preparation after a visible prefetch reports unsupported and the screen is subsequently hidden',async () => {
    const h = setup(); h.env.hidden = false
    await voice.play(); const call = h.engine.calls.at(-1)
    h.engine.emit('start',call.id); await drain()
    expect(voice.aheadPage).toBeNull()
    h.env.hidden = true; h.engine.emit('done',call.id); await drain()
    expect(h.engine.calls.at(-1).text).toBe('Segunda frase.')
    expect(h.reader.next).not.toHaveBeenCalled()
    h.engine.emit('start',h.engine.calls.at(-1).id)
    expect(h.reader.location.index).toBe(1)
  })
  it('pausing after activation resumes the same audible fragment and advances to the correct following chapter',async () => {
    const h = setup()
    await voice.play(); let call = h.engine.calls.at(-1)
    h.engine.emit('start',call.id); await drain(); h.engine.emit('done',call.id); await drain()
    call = h.engine.calls.at(-1); h.engine.emit('start',call.id); await drain()
    voice.pause(); await voice.play()
    expect(h.engine.calls.at(-1).text).toBe('Segunda frase.')
    call = h.engine.calls.at(-1); h.engine.emit('start',call.id); await drain()
    expect(voice.state).toBe('playing')
    h.engine.emit('done',call.id); await drain()
    expect(h.engine.calls.at(-1).text).toBe('Tercera frase.')
    expect(h.reader.next).not.toHaveBeenCalled()
  })
})
