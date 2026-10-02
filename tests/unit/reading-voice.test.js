import { describe, it, expect, vi, afterEach } from 'vitest'
import { ReadingVoice } from '../../src/js/readers/reading-voice.js'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('reading voice lifecycle', () => {
  it('does not start speaking when extraction finishes after Stop', async () => {
    let finish
    const speak = vi.fn()
    vi.stubGlobal('InhouseSpeech', { speak, stop:vi.fn() })
    const voice = new ReadingVoice({ getSpeechText:() => new Promise(resolve => { finish=resolve }) })
    const playing = voice.play()
    voice.stop(); finish('Text fetched after closing the book.'); await playing
    expect(speak).not.toHaveBeenCalled()
    expect(voice.state).toBe('stopped')
  })
  it('pausing during an automatic page turn cannot speak an undefined chunk', async () => {
    let finishTurn
    const speak = vi.fn()
    vi.stubGlobal('InhouseSpeech', { speak, stop:vi.fn() })
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
  it('the sleep timer stops native playback and ignores late completion events', async () => {
    vi.useFakeTimers()
    const speak=vi.fn(), stop=vi.fn(), next=vi.fn()
    vi.stubGlobal('InhouseSpeech',{speak,stop})
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
    vi.stubGlobal('InhouseSpeech', { speak, stop })
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
    vi.stubGlobal('InhouseSpeech', { speak, stop })
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
    vi.stubGlobal('InhouseSpeech', { speak, stop })
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
    vi.stubGlobal('InhouseSpeech', { speak, stop:vi.fn() })
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
    vi.stubGlobal('InhouseSpeech', { speak, stop:vi.fn() })
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
    vi.stubGlobal('InhouseSpeech', { speak, stop:vi.fn() })
    const messages = []
    const reader = mappedReader([{ text:'Only page.' }])
    const voice = new ReadingVoice(reader, (state, message) => message && messages.push(message))
    await voice.play(); done(say(speak)[4])
    await vi.advanceTimersByTimeAsync(1000)
    expect(reader.nexts).toBe(3) // the turn and two retries, then it really is the end
    expect(messages).toContain('Final del libro.')
    const again = new ReadingVoice(mappedReader([{ text:'Only page.' }]))
    await again.play(); done(vi.mocked(window.InhouseSpeech.speak).mock.calls.at(-1)[4])
    again.stop()
    await vi.advanceTimersByTimeAsync(1000)
    expect(again.reader.nexts).toBe(1)
  })
  it('keeps the old message when a run of pages has no readable text at all', async () => {
    const speak = vi.fn()
    vi.stubGlobal('InhouseSpeech', { speak, stop:vi.fn() })
    const messages = []
    const reader = mappedReader([{ text:'Start.' }, ...Array.from({ length:20 }, () => ({ text:'' }))])
    const voice = new ReadingVoice(reader, (state, message) => message && messages.push(message))
    await voice.play(); done(say(speak)[4])
    await vi.waitFor(() => expect(voice.state).toBe('stopped'))
    expect(messages).toContain('Página siguiente sin texto legible.')
  })
  it('a failing or rejected page follow never interrupts the speech', async () => {
    const speak = vi.fn()
    vi.stubGlobal('InhouseSpeech', { speak, stop:vi.fn() })
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
    vi.stubGlobal('InhouseSpeech', { speak, stop:vi.fn() })
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
  it('works through speechSynthesis too, one highlight per utterance end', async () => {
    const utterances = []
    class FakeUtterance { constructor(text) { this.text = text } }
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
    vi.stubGlobal('speechSynthesis', { getVoices:() => [], speak:u => utterances.push(u), cancel:vi.fn() })
    const reader = mappedReader([{ text:'Alpha. Beta.' }])
    const voice = new ReadingVoice(reader)
    await voice.play()
    expect(highlights(reader)).toEqual([])
    utterances[0].onstart(); utterances[0].onend(); expect(utterances[1].text).toBe('Beta.')
    expect(highlights(reader).map(c => c[4])).toEqual(['Alpha.'])
    utterances[1].onstart()
    expect(highlights(reader).map(c => c[4])).toEqual(['Alpha.', 'Beta.'])
    voice.stop()
  })
  it('a speed or voice change re-speaks the current sentence with the new settings; stale completions are ignored', async () => {
    const speak = vi.fn(), stop = vi.fn()
    vi.stubGlobal('InhouseSpeech', { speak, stop })
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
    vi.stubGlobal('InhouseSpeech', { speak, stop:vi.fn() })
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
  it('a missing start event cannot leave the page plain: the sentence shows after a safety delay, and at once for a silent engine', async () => {
    vi.useFakeTimers()
    const speak = vi.fn()
    vi.stubGlobal('InhouseSpeech', { speak, stop:vi.fn() })
    const reader = mappedReader([{ text:'Alpha one. Beta two. Gamma three.' }])
    const voice = new ReadingVoice(reader)
    await voice.play()
    await vi.advanceTimersByTimeAsync(1000)
    expect(highlights(reader)).toEqual([])
    await vi.advanceTimersByTimeAsync(600)
    expect(highlights(reader).map(c => c[4])).toEqual(['Alpha one.'])
    // the utterance ended without ever starting: this engine does not report it, so stop waiting for it
    done(say(speak)[4])
    await vi.advanceTimersByTimeAsync(1)
    expect(highlights(reader).map(c => c[4])).toEqual(['Alpha one.', 'Beta two.'])
    voice.stop()
  })
  it('pausing, restarting or stopping while the engine is still starting cancels the pending highlight', async () => {
    vi.useFakeTimers()
    const speak = vi.fn()
    vi.stubGlobal('InhouseSpeech', { speak, stop:vi.fn() })
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
    vi.stubGlobal('InhouseSpeech', { speak, stop:vi.fn() })
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
    vi.stubGlobal('InhouseSpeech', { speak, stop:vi.fn() })
    const voice = new ReadingVoice({ getSpeechText:async () => 'Plain one. Plain two.' })
    await voice.play()
    expect(say(speak)[0]).toBe('Plain one.')
    expect(voice.source).toBeNull()
    voice.stop()
  })
})

describe('reading voice selection', () => {
  const voice = (voiceURI, lang, quality, extra = {}) => ({ voiceURI, name:voiceURI, lang, quality, network:false, installed:true, ...extra })
  const DEVICE = [voice('es-robot', 'es-ES', 200, { name:'eSpeak' }), voice('es-good', 'es-ES', 400), voice('en-good', 'en-US', 400), voice('fr-good', 'fr-FR', 400)]
  const bridge = (voices = DEVICE) => { const speak = vi.fn(); vi.stubGlobal('InhouseSpeech', { speak, stop:vi.fn(), getVoices:() => JSON.stringify(voices) }); return speak }
  const reading = async (text, { language = 'es', ...settings } = {}) => {
    const voice = new ReadingVoice({ language, getSpeechText:async () => text })
    Object.assign(voice, settings)
    await voice.play(); voice.stop()
    return voice
  }

  it("'Automática' speaks with the best natural voice of the book language, not the system default", async () => {
    const speak = bridge()
    await reading('Hola mundo.')
    expect(speak.mock.calls[0].slice(1, 4)).toEqual(['es-ES', 1, 'es-good'])
  })
  it('an explicit voice choice wins', async () => {
    const speak = bridge()
    await reading('Hola mundo.', { voice:'es-robot' })
    expect(speak.mock.calls[0][3]).toBe('es-robot')
  })
  it('with Voz multilingüe each sentence gets the best voice of its detected language', async () => {
    const speak = bridge()
    const voice = new ReadingVoice({ language:'es', getSpeechText:async () => 'Los niños salieron a jugar con una pelota. The old man was sitting by the window and she was not there.', next:vi.fn() })
    voice.options = { footnotes:false, multilingual:true, skipHeaders:false }
    voice.voice = 'es-good'
    await voice.play()
    const first = speak.mock.calls[0]
    window.dispatchEvent(new CustomEvent('inhouse-tts', { detail:{ id:first[4], type:'done' } }))
    const second = speak.mock.calls[1]
    voice.stop()
    expect([first[1], first[3]]).toEqual(['es-ES', 'es-good'])
    expect([second[1], second[3]]).toEqual(['en-US', 'en-good'])
  })
  it('still works with an older bridge that has no voice metadata or no getVoices at all', async () => {
    const speak = vi.fn()
    vi.stubGlobal('InhouseSpeech', { speak, stop:vi.fn() })
    await reading('Hola mundo.', { voice:'saved-voice' })
    expect(speak.mock.calls[0][3]).toBe('saved-voice')
    bridge([{ voiceURI:'old-es', name:'español (España) · dispositivo', lang:'es-ES' }])
    const again = vi.mocked(window.InhouseSpeech.speak)
    await reading('Hola mundo.')
    expect(again.mock.calls[0][3]).toBe('old-es')
  })
  it('an online voice that fails (offline) hands over once to the best on-device voice instead of stopping', async () => {
    const speak = bridge([voice('es-net', 'es-ES', 500, { network:true }), voice('es-good', 'es-ES', 400)])
    const messages = []
    const reader = new ReadingVoice({ language:'es', getSpeechText:async () => 'Hola mundo. Adiós.' }, (state, message) => message && messages.push(message))
    reader.voice = 'es-net' // explicitly chosen online voice
    await reader.play()
    expect(speak.mock.calls[0][3]).toBe('es-net')
    const fail = () => window.dispatchEvent(new CustomEvent('inhouse-tts', { detail:{ id:speak.mock.calls.at(-1)[4], type:'error' } }))
    fail()
    expect(reader.state).toBe('playing')
    expect(speak.mock.calls[1].slice(0, 4)).toEqual(['Hola mundo.', 'es-ES', 1, 'es-good'])
    fail() // the local voice failing too is a real error
    expect(reader.state).toBe('stopped')
    expect(messages.at(-1)).toMatch(/No hay voz para este idioma/)
  })
  it('an on-device voice failing is a real error right away', async () => {
    const speak = bridge()
    const reader = new ReadingVoice({ language:'es', getSpeechText:async () => 'Hola mundo.' })
    await reader.play()
    window.dispatchEvent(new CustomEvent('inhouse-tts', { detail:{ id:speak.mock.calls[0][4], type:'error' } }))
    expect(reader.state).toBe('stopped')
    expect(speak).toHaveBeenCalledTimes(1)
  })
  it('picks the best browser voice for speechSynthesis and passes its language', async () => {
    const spoken = []
    const browser = [{ voiceURI:'b-es-net', name:'Google español', lang:'es-ES', localService:false }, { voiceURI:'b-es-local', name:'Microsoft Helena - Spanish (Spain)', lang:'es-ES', localService:true }]
    vi.stubGlobal('speechSynthesis', { getVoices:() => browser, speak:utterance => spoken.push(utterance), cancel:vi.fn() })
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(text) { this.text = text } })
    await reading('Hola mundo.')
    expect(spoken[0]).toMatchObject({ lang:'es-ES', voice:browser[1] })
    spoken.length = 0
    await reading('Hola mundo.', { voice:'b-es-net' })
    expect(spoken[0].voice).toBe(browser[0])
  })
})
