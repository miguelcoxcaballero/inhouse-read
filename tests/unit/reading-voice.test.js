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
