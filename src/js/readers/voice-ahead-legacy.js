import {neuralEngine} from './neural-runtime.js'
const NEURAL_LOOKAHEAD=4
export class LegacyVoiceAhead{
  prepareAhead() {
    if (this.aheadPage?.error?.name === 'AbortError' ||
      this.aheadPage?.plan && !this.pagePlanValid(this.aheadPage.plan)) this.clearAhead()
    if (this.state !== 'playing' || this.aheadPage || this.deferredPage ||
      this.chunks.length - this.index - 1 > NEURAL_LOOKAHEAD || typeof this.reader.getNextSpeechSource !== 'function') return
    const request = { generation:this.generation, source:this.source, plan:undefined, cancelled:false }
    this.aheadPage = request
    const isActive = () => !request.cancelled && request.generation === this.generation &&
      this.state === 'playing' && (this.source === request.source || this.source === request.plan?.source)
    request.promise = (async () => {
      let source
      try {
        source = await this.reader.getNextSpeechSource({ isActive, afterPage:this.source?.physicalPage })
        if (!isActive()) { source?.clear?.(); return undefined }
        if (source === undefined && this.aheadPage === request) this.aheadPage = null
        request.plan = source == null ? source : await this.prepare(source)
        if (!isActive()) { source?.clear?.(); request.plan = undefined; return undefined }
        this.joinPageSentence()
        const { voice } = this.voiceFor(this.chunks[this.index])
        if (voice && this.index < this.chunks.length) {
          const { upcoming, deferAfter } = this.upcomingFor(voice)
          neuralEngine()?.extendUpcoming?.({ id:this.utteranceId, voiceId:voice.id, rate:this.rate, upcoming, deferAfter })
        }
        return request.plan
      } catch (error) { source?.clear?.(); request.error = error; return undefined }
    })()
  }
  clearAhead() {
    const ahead = this.aheadPage
    this.aheadPage = null
    if (ahead) { ahead.cancelled = true; ahead.plan?.source?.clear?.() }
  }
  pagePlanValid(plan) {
    try { return !plan?.source?.isValid || plan.source.isValid() === true }
    catch { return false }
  }
  async revalidateNext(plan, generation) {
    if (this.pagePlanValid(plan)) return plan
    plan?.source?.clear?.()
    if (generation !== this.generation || this.state !== 'playing') return undefined
    return this.prepareNext(generation)
  }
  adopt({ source, items }) {
    source?.adopt?.()
    this.source = source; this.items = items; this.chunks = items.map(item => item.text); this.index = 0
    this.deferredPage = typeof source?.activate === 'function' ? source : null
  }
}
