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
