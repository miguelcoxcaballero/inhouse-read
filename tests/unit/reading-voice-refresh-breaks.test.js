import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReadingVoice } from '../../src/js/readers/reading-voice.js'
import { planSpeech } from '../../src/js/readers/speech-text.js'

afterEach(() => vi.restoreAllMocks())

describe('re-cutting the fragments not yet read at freshly measured page breaks', () => {
  const text = 'Primera frase corta. Esta frase larga empieza en una página y termina en la siguiente sin pausa. Fin.'
  const cut = text.indexOf('termina')
  const voiceWith = source => {
    const voice = Object.create(ReadingVoice.prototype)
    Object.assign(voice, { state:'playing', generation:1, source, index:0, rate:1, utteranceId:'u1',
      options:{ footnotes:false, skipHeaders:false }, reader:{} })
    voice.items = planSpeech(text, { pageBreaks:source.pageBreaks }, 0)
    voice.chunks = voice.items.map(item => item.text)
    voice.voiceFor = () => ({ voice:null })
    return voice
  }

  it('splits the next sentence at the first word of the next page and keeps the one being heard', async () => {
    const source = { text, start:0, pageBreaks:[], measurePageBreaks:async () => [cut] }
    const voice = voiceWith(source)
    const heard = voice.items[0]
    expect(await voice.refreshPageBreaks()).toBe(true)
    expect(voice.items[0]).toBe(heard)
    const texts = voice.items.map(item => item.text)
    expect(texts).toContain('Esta frase larga empieza en una página y')
    expect(texts).toContain('termina en la siguiente sin pausa.')
    const [before, after] = voice.items.filter(item => item.text.startsWith('Esta') || item.text.startsWith('termina'))
    expect(after.start).toBe(cut)
    // One highlight for the whole sentence, across the page.
    expect(after.sentence).toEqual(before.sentence)
    expect(voice.chunks).toEqual(voice.items.map(item => item.text))
  })

  it('changes nothing when the breaks are the same, or when the voice moved on meanwhile', async () => {
    const same = { text, start:0, pageBreaks:[cut], measurePageBreaks:async () => [cut] }
    expect(await voiceWith(same).refreshPageBreaks()).toBe(false)
    let release
    const late = { text, start:0, pageBreaks:[], measurePageBreaks:() => new Promise(resolve => { release = resolve }) }
    const voice = voiceWith(late), items = voice.items
    const pending = voice.refreshPageBreaks()
    voice.index = 1
    release([cut])
    expect(await pending).toBe(false)
    expect(voice.items).toBe(items)
  })
})
