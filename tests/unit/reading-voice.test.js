import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { ReadingVoice } from '../../src/js/readers/reading-voice.js'

import {loadNeural} from '../../src/js/readers/neural-runtime.js'
import {neuralVoices,setNeuralEngine} from '../../src/js/readers/neural-voice/index.js'
import {createFakeNeuralEngine,FAKE_CATALOG} from '../helpers/fake-neural-engine.js'
let catalogue, activeEngine
beforeAll(async () => { await loadNeural(); catalogue=[...neuralVoices]; neuralVoices.splice(0,neuralVoices.length,...FAKE_CATALOG) })
afterAll(() => { neuralVoices.splice(0,neuralVoices.length,...catalogue); setNeuralEngine(null) })
afterEach(() => { activeEngine?.stop(); vi.unstubAllGlobals(); vi.useRealTimers() })
// These tuple spies observe the natural engine contract; they are not an Android bridge.
function transport(speak=vi.fn(),stop=vi.fn(),installed=FAKE_CATALOG.map(voice=>voice.id)) {
  const engine=activeEngine=createFakeNeuralEngine({voices:FAKE_CATALOG,installed,hold:true})
  const dispatch=engine.speak.bind(engine), cancel=engine.stop.bind(engine)
  engine.speak=request=>{ speak(request.text,FAKE_CATALOG.find(voice=>voice.id===request.voiceId)?.lang,request.rate,request.voiceId,request.id); dispatch(request) }
  engine.stop=()=>{stop();cancel()};setNeuralEngine(engine)
  return engine
}
describe('reading voice lifecycle', () => {
  it('does not start speaking when extraction finishes after Stop', async () => {
    let finish
    const speak = vi.fn()
    transport(speak)
    const voice = new ReadingVoice({ getSpeechText:() => new Promise(resolve => { finish=resolve }) })
    const playing = voice.play()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    voice.stop(); finish('Text fetched after closing the book.'); await playing
    expect(speak).not.toHaveBeenCalled()
    expect(voice.state).toBe('stopped')
  })
  it('pausing during an automatic page turn cannot speak an undefined chunk', async () => {
    let finishTurn
    const speak = vi.fn()
    transport(speak)
    const reader = { location:{ fraction:0 }, getSpeechText:async () => 'One sentence.',
      next:() => new Promise(resolve => { finishTurn=() => { reader.location={fraction:.5}; resolve() } }) }
    const voice = new ReadingVoice(reader)
    await voice.play()
    const advance = voice.advance()
    voice.pause(); await voice.play(); finishTurn(); await advance
    expect(speak.mock.calls.every(call => typeof call[0] === 'string' && call[0].length > 0)).toBe(true)
    expect(speak).toHaveBeenCalledTimes(2)
    voice.stop()
  })
  it('the sleep timer stops natural playback and ignores late completion events', async () => {
    vi.useFakeTimers()
    const speak=vi.fn(), stop=vi.fn(), next=vi.fn()
    transport(speak,stop)
    const voice=new ReadingVoice({ getSpeechText:async () => 'First sentence. Second sentence.', next })
    await voice.play(); const id=speak.mock.calls[0][4]
    voice.setSleep(15); vi.advanceTimersByTime(15*60000)
    window.dispatchEvent(new CustomEvent('inhouse-tts',{detail:{id,type:'done'}}))
    expect(voice.state).toBe('stopped'); expect(stop).toHaveBeenCalled(); expect(next).not.toHaveBeenCalled()
  })
})

// A reader that can map text back to its page: records what the voice asks it to show.
function mappedReader(pages, { follow } = {}) {
  const calls = []
  let page = 0
  const reader = {
    calls, location:{ fraction:0, page:0 }, nexts:0,
    getSpeechSource:async () => {
      const text = pages[page]?.text ?? '', current = page
      return { text, start:pages[current]?.start ?? 0,
        highlight:(start, end) => calls.push(['highlight', current, start, end, text.slice(start, end)]),
        follow:(start, end) => { calls.push(['follow', current, start, end]); return follow?.(start, end) },
        clear:() => calls.push(['clear', current]) }
    },
    getSpeechText:async () => { throw new Error('the mapped path must not use plain text') },
    next:async () => { reader.nexts++; if (page < pages.length - 1) { page++; reader.location = { fraction:page / pages.length, page } } }
  }
  return reader
}
const say = (speak, n = -1) => speak.mock.calls.at(n)
const done = id => window.dispatchEvent(new CustomEvent('inhouse-tts', { detail:{ id, type:'done' } }))
// The engine's first audible word: the highlight and the page follow wait for it.
const started = id => window.dispatchEvent(new CustomEvent('inhouse-tts', { detail:{ id, type:'start' } }))
const highlights = reader => reader.calls.filter(c => c[0] === 'highlight')

describe('audiobook sentence highlight and page follow', () => {
  it('highlights each whole sentence as its speech starts and follows with the fragment being spoken', async () => {
    const speak = vi.fn(), stop = vi.fn()
    transport(speak,stop)
    const long = `${'lorem '.repeat(50)}end.`
    const text = `First one. ${long} Last bit.`
    const reader = mappedReader([{ text }])
    const voice = new ReadingVoice(reader)
    await voice.play()
    const sentences = []
    for (let i = 0; i < voice.chunks.length; i++) { if (i) done(say(speak)[4]); started(say(speak)[4]); sentences.push(reader.calls.filter(c => c[0] === 'highlight').at(-1)) }
    expect(sentences[0].slice(2)).toEqual([0, 10, 'First one.'])
    expect(sentences[1][4]).toBe(long)
    // the 180-char fragments of the long sentence share its whole-sentence highlight but have their own follow ranges
    const middle = sentences.filter(s => s[4] === long)
    expect(middle.length).toBeGreaterThan(1)
    const follows = reader.calls.filter(c => c[0] === 'follow')
    expect(follows.length).toBe(voice.chunks.length)
    expect(follows.map(c => c[2]).every((start, i, all) => !i || start > all[i - 1])).toBe(true)
    expect(sentences.at(-1)[4]).toBe('Last bit.')
    // painted once per sentence, not once per fragment
    expect(highlights(reader).map(c => c[4])).toEqual(['First one.', long, 'Last bit.'])
    voice.stop()
  })
  it('starts at the first character of the visible page and clears on pause, re-highlighting the same sentence on resume', async () => {
    const speak = vi.fn(), stop = vi.fn()
    transport(speak,stop)
    const text = 'Left over. One. Two. Three.'
    const reader = mappedReader([{ text, start:text.indexOf('One') }])
    const voice = new ReadingVoice(reader)
    await voice.play()
    expect(say(speak)[0]).toBe('One.')
    done(say(speak)[4])
    expect(say(speak)[0]).toBe('Two.')
    reader.calls.length = 0
    voice.pause()
    expect(reader.calls).toEqual([['clear', 0]])
    // a late native completion of the interrupted utterance changes nothing
    done(say(speak)[4]); expect(speak).toHaveBeenCalledTimes(2)
    await voice.play()
    expect(say(speak)[0]).toBe('Two.')
    started(say(speak)[4])
    expect(reader.calls.filter(c => c[0] === 'highlight').at(-1)[4]).toBe('Two.')
    voice.stop()
    expect(reader.calls.at(-1)).toEqual(['clear', 0])
  })
  it('turns to the next page when a page is spoken, without stopping the voice, and highlights the new page', async () => {
    const speak = vi.fn(), stop = vi.fn()
    transport(speak,stop)
    const reader = mappedReader([{ text:'Page one.' }, { text:'Page two. More.' }])
    const voice = new ReadingVoice(reader)
    await voice.play()
    started(say(speak)[4]); done(say(speak)[4])
    await vi.waitFor(() => expect(speak).toHaveBeenCalledTimes(2))
    expect(reader.nexts).toBe(1)
    expect(say(speak)[0]).toBe('Page two.')
    expect(voice.state).toBe('playing')
    expect(stop).not.toHaveBeenCalled()
    // the last sentence of the old page stays painted until the new page's first one is heard
    expect(reader.calls).not.toContainEqual(['clear', 0])
    started(say(speak)[4])
    expect(reader.calls).toContainEqual(['clear', 0])
    expect(reader.calls.filter(c => c[0] === 'highlight').at(-1).slice(1)).toEqual([1, 0, 9, 'Page two.'])
    voice.stop()
  })
  it('skips pages with no text and reports the end of the book politely', async () => {
    const speak = vi.fn()
    transport(speak)
    const messages = []
    const reader = mappedReader([{ text:'Only text.' }, { text:'' }, { text:'  \n ' }, { text:'Back again.' }])
    const voice = new ReadingVoice(reader, (state, message) => message && messages.push(message))
    await voice.play()
    done(say(speak)[4])
    await vi.waitFor(() => expect(say(speak)[0]).toBe('Back again.'))
    expect(reader.nexts).toBe(3)
    done(say(speak)[4])
    await vi.waitFor(() => expect(voice.state).toBe('stopped'))
    expect(messages).toContain('Final del libro.')
  })
  it('does not report the end of the book while foliate still ignores the turn (page lock held by the voice\'s own follow)', async () => {
    const speak = vi.fn()
    transport(speak)
    const messages = []
    const reader = mappedReader([{ text:'Last of page one.' }, { text:'Page two.' }])
    const turn = reader.next
    let calls = 0
    reader.next = async () => { calls++; if (calls > 1) await turn() } // the first turn is silently ignored
    const voice = new ReadingVoice(reader, (state, message) => message && messages.push(message))
    await voice.play(); done(say(speak)[4])
    await vi.waitFor(() => expect(say(speak)[0]).toBe('Page two.'))
    expect(calls).toBe(2)
    expect(messages).not.toContain('Final del libro.')
    expect(voice.state).toBe('playing')
    voice.stop()
  })
  it('retries a bounded number of times, and a Stop during the wait cancels the rest', async () => {
    vi.useFakeTimers()
    const speak = vi.fn()
    transport(speak)
    const messages = []
    const reader = mappedReader([{ text:'Only page.' }])
    const voice = new ReadingVoice(reader, (state, message) => message && messages.push(message))
    await voice.play(); done(say(speak)[4])
    await vi.advanceTimersByTimeAsync(1000)
    expect(reader.nexts).toBe(3) // the turn and two retries, then it really is the end
    expect(messages).toContain('Final del libro.')
    const again = new ReadingVoice(mappedReader([{ text:'Only page.' }]))
    await again.play(); done(say(speak)[4])
    again.stop()
    await vi.advanceTimersByTimeAsync(1000)
    expect(again.reader.nexts).toBe(1)
  })
  it('keeps the old message when a run of pages has no readable text at all', async () => {
    const speak = vi.fn()
    transport(speak)
    const messages = []
    const reader = mappedReader([{ text:'Start.' }, ...Array.from({ length:20 }, () => ({ text:'' }))])
    const voice = new ReadingVoice(reader, (state, message) => message && messages.push(message))
    await voice.play(); done(say(speak)[4])
    await vi.waitFor(() => expect(voice.state).toBe('stopped'))
    expect(messages).toContain('Página siguiente sin texto legible.')
  })
  it('a failing or rejected page follow never interrupts the speech', async () => {
    const speak = vi.fn()
    transport(speak)
    const reader = mappedReader([{ text:'One. Two.' }])
    reader.getSpeechSource = async () => ({ text:'One. Two.', highlight() { throw new Error('range detached') }, follow:() => Promise.reject(new Error('x')), clear() {} })
    const voice = new ReadingVoice(reader)
    await voice.play(); started(say(speak)[4]); done(say(speak)[4])
    expect(say(speak)[0]).toBe('Two.')
    started(say(speak)[4])
    expect(voice.state).toBe('playing')
    voice.stop()
  })
  it('honours the footnote option while keeping raw offsets for the highlight', async () => {
    const speak = vi.fn()
    transport(speak)
    const reader = mappedReader([{ text:'Claim.[12] Next point (nota 3) here.' }])
    const voice = new ReadingVoice(reader)
    await voice.play()
    expect(say(speak)[0]).toBe('Claim.')
    done(say(speak)[4])
    expect(say(speak)[0]).toBe('Next point here.')
    started(say(speak)[4])
    expect(reader.calls.filter(c => c[0] === 'highlight').at(-1)[4]).toBe('Next point (nota 3) here.')
    voice.stop()
    voice.options = { ...voice.options, footnotes:true }
    await voice.play()
    expect(say(speak)[0]).toBe('Claim.')
    done(say(speak)[4])
    expect(say(speak)[0]).toBe('[12] Next point (nota 3) here.')
    voice.stop()
  })
  it('uses natural audio even when browser speech exists, with one highlight per audible start', async () => {
    const speak=vi.fn(), browserSpeak=vi.fn();transport(speak)
    vi.stubGlobal('speechSynthesis',{getVoices:()=>[],speak:browserSpeak,cancel:vi.fn()})
    const reader=mappedReader([{text:'Alpha. Beta.'}]),voice=new ReadingVoice(reader)
    await voice.play();expect(highlights(reader)).toEqual([])
    started(say(speak)[4]);done(say(speak)[4]);expect(say(speak)[0]).toBe('Beta.')
    expect(highlights(reader).map(call=>call[4])).toEqual(['Alpha.'])
    started(say(speak)[4]);expect(highlights(reader).map(call=>call[4])).toEqual(['Alpha.','Beta.'])
    expect(browserSpeak).not.toHaveBeenCalled();voice.stop()
  })
  it('a speed or voice change re-speaks the current sentence with the new settings; stale completions are ignored', async () => {
    const speak = vi.fn(), stop = vi.fn()
    transport(speak,stop)
    const voice = new ReadingVoice(mappedReader([{ text:'One. Two.' }]))
    await voice.play()
    const firstId = say(speak)[4]
    voice.rate = 1.6; voice.restart()
    expect(speak).toHaveBeenCalledTimes(2)
    expect(say(speak).slice(0, 3)).toEqual(['One.', expect.any(String), 1.6])
    done(firstId)
    expect(speak).toHaveBeenCalledTimes(2)
    voice.pause(); voice.restart(); expect(speak).toHaveBeenCalledTimes(2)
    voice.stop()
  })
  it('does not paint or follow before the engine says it started, then does once', async () => {
    const speak = vi.fn()
    transport(speak)
    const reader = mappedReader([{ text:'Alpha one. Beta two.' }])
    const voice = new ReadingVoice(reader)
    await voice.play()
    expect(reader.calls).toEqual([])
    started(say(speak)[4])
    expect(reader.calls.map(c => c[0])).toEqual(['highlight', 'follow'])
    started(say(speak)[4]) // a repeated event never repaints the same sentence
    expect(highlights(reader)).toHaveLength(1)
    // a late 'start' of an utterance that is no longer current changes nothing
    const first = say(speak)[4]
    done(first); started(first)
    expect(highlights(reader)).toHaveLength(1)
    voice.stop()
  })
  it('does not invent an audible start after a safety delay: natural highlight waits for audio', async () => {
    vi.useFakeTimers();const speak=vi.fn();transport(speak)
    const reader=mappedReader([{text:'Alpha one. Beta two. Gamma three.'}]),voice=new ReadingVoice(reader)
    await voice.play();await vi.advanceTimersByTimeAsync(10_000)
    expect(highlights(reader)).toEqual([])
    started(say(speak)[4]);expect(highlights(reader).map(call=>call[4])).toEqual(['Alpha one.'])
    done(say(speak)[4]);await vi.advanceTimersByTimeAsync(10_000)
    expect(highlights(reader).map(call=>call[4])).toEqual(['Alpha one.'])
    started(say(speak)[4]);expect(highlights(reader).map(call=>call[4])).toEqual(['Alpha one.','Beta two.'])
    voice.stop()
  })
  it('pausing, restarting or stopping while the engine is still starting cancels the pending highlight', async () => {
    vi.useFakeTimers()
    const speak = vi.fn()
    transport(speak)
    const reader = mappedReader([{ text:'Alpha one. Beta two.' }])
    const voice = new ReadingVoice(reader)
    await voice.play()
    voice.pause()
    await vi.advanceTimersByTimeAsync(5000)
    expect(highlights(reader)).toEqual([])
    await voice.play(); voice.restart()
    started(say(speak, -2)[4]) // the cancelled utterance's start event is stale
    expect(highlights(reader)).toEqual([])
    started(say(speak)[4])
    expect(highlights(reader)).toHaveLength(1)
    voice.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(highlights(reader)).toHaveLength(1)
  })
  it('a speed change re-speaks without repainting the sentence that is already shown', async () => {
    const speak = vi.fn()
    transport(speak)
    const reader = mappedReader([{ text:'Alpha one. Beta two.' }])
    const voice = new ReadingVoice(reader)
    await voice.play(); started(say(speak)[4])
    voice.rate = 1.4; voice.restart(); started(say(speak)[4])
    expect(highlights(reader)).toHaveLength(1)
    expect(reader.calls.filter(c => c[0] === 'follow')).toHaveLength(2)
    expect(reader.calls.some(c => c[0] === 'clear')).toBe(false)
    voice.stop()
  })
  it('readers without a speech source keep the plain text path and never highlight', async () => {
    const speak = vi.fn()
    transport(speak)
    const voice = new ReadingVoice({ getSpeechText:async () => 'Plain one. Plain two.' })
    await voice.play()
    expect(say(speak)[0]).toBe('Plain one.')
    expect(voice.source).toBeNull()
    voice.stop()
  })
})

describe('reading voice selection',()=>{
  const ES='piper:es_ES-davefx-medium',MX='piper:es_MX-claude-high',EN='piper:en_US-lessac-high'
  const reading=async(text,settings={})=>{const voice=new ReadingVoice({language:'es-ES',getSpeechText:async()=>text});Object.assign(voice,settings);await voice.play();return voice}
  it('Automática uses an installed natural voice of the book language',async()=>{
    const speak=vi.fn();transport(speak);const voice=await reading('Hola mundo.')
    expect(say(speak).slice(1,4)).toEqual(['es-ES',1,ES]);voice.stop()
  })
  it('an explicit natural voice choice wins',async()=>{
    const speak=vi.fn();transport(speak);const voice=await reading('Hola mundo.',{voice:MX})
    expect(say(speak)[3]).toBe(MX);voice.stop()
  })
  it('multilingual sentences select their installed natural language voices',async()=>{
    const speak=vi.fn();transport(speak);const voice=await reading('Los niños salieron a jugar con una pelota. The old man was sitting by the window and she was not there.',{voice:ES,options:{multilingual:true}})
    expect(say(speak)[3]).toBe(ES);done(say(speak)[4]);expect(say(speak)[3]).toBe(EN);voice.stop()
  })
  it('ignores a saved device voice even when an old Android bridge exists',async()=>{
    const speak=vi.fn(),nativeSpeak=vi.fn();transport(speak)
    vi.stubGlobal('InhouseSpeech',{speak:nativeSpeak,stop:vi.fn()})
    const voice=await reading('Hola mundo.',{voice:'saved-system-voice'})
    expect(say(speak)[3]).toBe(ES);expect(nativeSpeak).not.toHaveBeenCalled();voice.stop()
  })
  it('a failed natural voice exposes a retry of that voice without an online device fallback',async()=>{
    const speak=vi.fn(),nativeSpeak=vi.fn();transport(speak)
    vi.stubGlobal('InhouseSpeech',{speak:nativeSpeak,stop:vi.fn(),getVoices:()=>JSON.stringify([{voiceURI:'online',lang:'es',network:true}])})
    const messages=[],voice=await reading('Hola mundo. Adiós.',{voice:MX,onState:(_,message)=>messages.push(message)})
    for(let index=0;index<4;index++)window.dispatchEvent(new CustomEvent('inhouse-tts',{detail:{id:say(speak)[4],type:'error',reason:'synth-failed'}}))
    expect(voice.state).toBe('paused');expect(messages.at(-1)).toContain('Reintentar');expect(nativeSpeak).not.toHaveBeenCalled()
    await voice.play();expect(say(speak)[3]).toBe(MX);expect(say(speak)[0]).toBe('Hola mundo.');voice.stop()
  })
  it('a removed selected natural voice is a visible error instead of an automatic replacement',async()=>{
    const speak=vi.fn();transport(speak);const voice=await reading('Hola mundo.',{voice:MX})
    window.dispatchEvent(new CustomEvent('inhouse-tts',{detail:{id:say(speak)[4],type:'error',reason:'not-installed'}}))
    expect(voice.state).toBe('paused');expect(speak).toHaveBeenCalledTimes(1);expect(voice.voice).toBe(MX);voice.stop()
  })
  it('never invokes speechSynthesis even when an explicit saved browser voice exists',async()=>{
    const speak=vi.fn(),browserSpeak=vi.fn();transport(speak)
    vi.stubGlobal('speechSynthesis',{getVoices:()=>[{voiceURI:'browser-es',lang:'es-ES'}],speak:browserSpeak,cancel:vi.fn()})
    const voice=await reading('Hola mundo.',{voice:'browser-es'})
    expect(say(speak)[3]).toBe(ES);expect(browserSpeak).not.toHaveBeenCalled();voice.stop()
  })
})
