// Frozen preparation with the explicit 1.7.291 six-fragment, contiguous-voice opening contract.
import {neuralEngine} from '../../../src/js/readers/neural-runtime.js'
import {planSpeech,firstCompleteSentenceOffset} from '../../../src/js/readers/speech-text.js'
const PAGE_PREPARATION_RETRIES=2
export class LegacyPreparation {
  async refreshPageBreaks() {
    const source = this.source, generation = this.generation, index = this.index
    if (this.state !== 'playing' || typeof source?.measurePageBreaks !== 'function') return false
    let pageBreaks
    try { pageBreaks = await source.measurePageBreaks() } catch { return false }
    if (!Array.isArray(pageBreaks) || this.state !== 'playing' || generation !== this.generation ||
      this.source !== source || this.index !== index) return false
    const current = this.items[index]
    if (!current) return false
    const known = source.pageBreaks || []
    if (known.length === pageBreaks.length && known.every((at, i) => at === pageBreaks[i])) return false
    source.pageBreaks = pageBreaks
    const rest = (await this.prepare({ ...source, start:current.end })).items
      .map(item => item.start < current.sentence.end && item.sentence.start >= current.sentence.start ? { ...item, sentence:current.sentence } : item)
    if (this.state !== 'playing' || generation !== this.generation || this.source !== source || this.index !== index) return false
    this.items = [...this.items.slice(0, index + 1), ...rest]
    this.chunks = this.items.map(item => item.text)
    const { voice } = this.voiceFor(this.chunks[index])
    if (voice) {
      const { upcoming, deferAfter } = this.upcomingFor(voice)
      neuralEngine()?.extendUpcoming?.({ id:this.utteranceId, voiceId:voice.id, rate:this.rate, upcoming, deferAfter })
    }
    return true
  }
  async prepare(source, opening = false) {
    if (source === undefined) {
      const pending = this.reader.getSpeechSource?.(this.completeOpening && opening ? {visible:true, completeSentences:true} : undefined)
      source = pending ? await pending : null
    }
    if (!source) return { source, items:planSpeech(this.prepareText(await this.reader.getSpeechText()).replace(/\s+/g, ' ').trim(), {opening}).map(({text}) => ({text})) }
    const { footnotes, skipHeaders } = this.options
    const from = this.completeOpening && opening ? firstCompleteSentenceOffset(source.text, source.start, source.previousText, this.options) : source.start || 0
    return { source, items:planSpeech(source.text, { footnotes, skipHeaders, opening, pageBreaks:source.pageBreaks, headerRanges:source.headerRanges }, from) }
  }
  /** Share the page analysis started by voice selection with immediate Play.
   * Voice/rate do not alter offsets; page, layout, text options and Stop do. */
  async prepareOpening() {
    const generation = this.generation
    const keyOf = () => JSON.stringify([this.reader.location, this.options.footnotes, this.options.skipHeaders, this.openingLayout, Boolean(this.completeOpening)])
    const key = keyOf()
    let pending = this.openingPlan
    if (!pending || pending.key !== key) {
      pending = {key, promise:this.prepare(undefined, true)}
      this.openingPlan = pending
    }
    try {
      const plan = await pending.promise
      if (!this.browsing && this.state === 'loading' && generation === this.generation && key !== keyOf()) return this.prepareOpening()
      if (!this.pagePlanValid(plan)) {
        if (this.openingPlan === pending) this.openingPlan = null
        return this.prepare(undefined, true)
      }
      return plan
    } catch (error) {
      if (this.openingPlan === pending) this.openingPlan = null
      throw error
    }
  }
  /** Cache audio without adopting, highlighting or following a page before Play. */
  async preparePlayback(isActive = () => true) {
    if (!['stopped', 'paused'].includes(this.state) || this.resumeNextPage || this.restartFromVisiblePage()) return false
    const generation = this.generation, location = JSON.stringify(this.reader.location)
    const settings = JSON.stringify([this.voice, this.rate, this.languageOverride, this.options])
    const valid = () => isActive() && generation === this.generation &&
      location === JSON.stringify(this.reader.location) &&
      settings === JSON.stringify([this.voice, this.rate, this.languageOverride, this.options]) &&
      ['stopped', 'paused'].includes(this.state)
    try {
      const items = this.state === 'paused' && this.chunks.length && !this.resumeNextPage
        ? this.chunks.slice(this.index).map((text,index) => this.items[this.index+index] || {text}) : (await this.prepareOpening()).items
      if (!valid() || !items.length) return false
      const { voice } = this.voiceFor(items[0].text)
      if (!voice?.neural) return false
      const upcoming = []
      for (const item of items.slice(1, 6)) {
        if (this.voiceFor(item.text).voice?.id !== voice.id) break
        upcoming.push(this.audioItem(item))
      }
      return await neuralEngine()?.prime?.({ text:items[0].text, voiceId:voice.id, rate:this.rate, upcoming,
        ...(items[0].marks?.length ? {marks:items[0].marks.map(mark=>mark.offset)} : {}) }) || false
    } catch { return false }
  }
  /** Optional fixed-page preparation: it must leave the current page visible until an audible start. */
  async prepareNext(generation) {
    if (typeof this.reader.getNextSpeechSource !== 'function') return undefined
    const request = { generation }; this.preparingPage = request
    const isActive = () => generation === this.generation && (this.state === 'playing' || this.state === 'loading')
    let source
    try {
      for (let retry = 0; retry <= PAGE_PREPARATION_RETRIES; retry++) {
        try {
          source = await this.reader.getNextSpeechSource({ isActive })
          if (!isActive()) { source?.clear?.(); return undefined }
          // undefined means this format has no deferred-page API; null means an actual end, never a cancelled preparation.
          if (source == null) return source
          const plan = await this.prepare(source)
          if (!isActive()) { source.clear?.(); return undefined }
          if (this.pagePlanValid(plan)) return plan
          source.clear?.(); source = null
          if (retry === PAGE_PREPARATION_RETRIES) throw new Error('La página preparada sigue cambiando.')
        } catch (error) {
          source?.clear?.(); source = null
          if (!isActive()) return undefined
          if (error.name !== 'AbortError' || retry === PAGE_PREPARATION_RETRIES) throw error
        }
      }
    } catch (error) { source?.clear?.(); throw error }
    finally { if (this.preparingPage === request) this.preparingPage = null }
  }
}
