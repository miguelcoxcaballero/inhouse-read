import {declaredLanguage,isNeuralId,langBase,resolveVoice} from './reference-voice-catalog.js'
import {neuralVoiceList} from '../../../src/js/readers/neural-runtime.js'
// 1.7.291: match the engine six-fragment lookahead, including deferred pages.
const NEURAL_LOOKAHEAD=6
export class LegacyVoiceSelection{
  voiceFor(text) {
    const language = this.options.multilingual ? this.detectLanguage(text) : this.languageOverride || this.reader.language || navigator.language || 'es-ES'
    const voices = neuralVoiceList().filter(voice => voice.installed && !this.missing.has(voice.id))
    let voiceId = isNeuralId(this.voice) ? this.voice : ''
    // A neural voice speaks one language (its phonemiser is the language's): a saved choice for another language than the one the
    // book DECLARES would garble it, so an English book read after picking a Spanish voice gets the automatic pick for English
    // instead. A book that declares nothing (a PDF) keeps the person's choice: the device language says nothing about it.
    const declared = declaredLanguage(this.reader)
    if (isNeuralId(voiceId) && !this.options.multilingual && declared && !this.languageOverride) {
      const chosen = voices.find(voice => voice.id === voiceId)
      if (chosen && chosen.base !== langBase(declared)) voiceId = ''
    }
    if (voiceId && !voices.some(voice => voice.id === voiceId)) return { voice:null, voiceId, language }
    return resolveVoice(voices, { voiceId, language, multilingual:this.options.multilingual, deviceLang:navigator.language })
  }
  upcomingFor(voice) {
    const upcoming = []
    for (let next = this.index + 1; next < this.chunks.length && upcoming.length < NEURAL_LOOKAHEAD; next++) {
      if (this.needsPageJoin(this.items[next],next) && !this.items[next].joinChecked) break
      if (this.options.multilingual && this.voiceFor(this.chunks[next]).voice?.id !== voice.id) break // another language: another voice, not prefetched
      upcoming.push(this.audioItem(this.items[next] || {text:this.chunks[next]}))
    }
    const deferAfter = upcoming.length
    const plan = this.aheadPage?.plan
    if (this.index + 1 + upcoming.length === this.chunks.length && plan?.items) {
      for (const item of plan.items.slice(0, NEURAL_LOOKAHEAD - upcoming.length)) {
        if (this.voiceFor(item.text).voice?.id !== voice.id) break
        upcoming.push(this.audioItem(item))
      }
    }
    return { upcoming, deferAfter }
  }
  audioItem(item) { return item.marks?.length ? {text:item.text,marks:item.marks.map(mark=>mark.offset)} : item.text }
  needsPageJoin(item,index) {
    return this.source?.physicalPage && index === this.items.length - 1 && item?.text && !/[.!?。！？…]["'”’»›)\]}]*\s*$/.test(item.text)
  }
}
