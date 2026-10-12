import {nativeAudio} from './neural-voice/audio.js'
const NEURAL_ERRORS={default:'No se pudo iniciar la voz natural. Pulsa Reintentar para volver a usarla.'}
export class LegacyVoicePresentation{
  engineStarted(id) {
    if (id !== this.utteranceId || this.state !== 'playing') return
    this.startedId = id
    clearTimeout(this.waitTimer)
    if (this.waiting) { this.waiting = false; this.notify() }
    this.present(id)
    const native = nativeAudio(), position = this.reader.speechPosition
    if (native?.session === this.nativeSession && Number.isInteger(position?.index)) {
      try { native.bridge.mark?.(native.session, id, position.index, position.kind) } catch { /* media progress is advisory */ }
    }
    if (this.state === 'playing') this.prepareAhead()
  }
  /** The engine finished `id`: remember whether it ever announced a start, so a silent engine is not waited for again. */
  engineEnded(id) {
    this.neuralRetries = 0
    if (this.startedId !== id && this.source?.activate) { this.pause(); this.notify(NEURAL_ERRORS.default); return }
    if (this.startedId !== id) this.present(id)
  }
  /**
   * Shows the sentence of the fragment being spoken and lets the reader bring it on screen. The sentence is painted once
   * for all its <=180 character fragments (a fragment only re-follows) and the previous one stays until it is replaced,
   * so there is no blank flash between sentences or at a page turn. A deferred fixed page commits before its highlight;
   * an invalidated page pauses the voice. Highlight and follow failures remain cosmetic.
   */
  present(id = this.utteranceId, offset = 0) {
    clearTimeout(this.presentTimer)
    if (id !== this.utteranceId || this.state !== 'playing') return
    const item = this.items[this.index]
    const boundary = offset ? item?.marks?.find(mark=>mark.offset === offset) : null
    if (offset && !boundary) return
    const source = boundary?.source || this.source
    if (!source || !item?.sentence) return
    if (source.activate) {
      // A no-start completion may paint a legacy source, but can never reveal a prepared next page.
      if (this.startedId !== id) return
      let activated = false
      try { activated = source.activate() } catch { /* navigation or layout invalidated the prepared page */ }
      if (activated !== true) { this.pause(); this.notify('No se pudo mostrar la página. Pulsa Reintentar para continuar.'); return }
      this.deferredPage = null
    }
    const { start, end } = boundary?.sentence || item.sentence
    try {
      const shown = this.shown
      if (!shown || shown.source !== source || shown.start !== start || shown.end !== end) {
        if (shown && shown.source !== source) shown.source.clear?.()
        this.shown = { source, start, end }
        source.highlight?.(start, end)
      }
      const followStart = boundary?.start ?? item.start
      const next = item.marks?.find(mark=>mark.offset > offset)
      const followEnd = next && (!next.source || next.source === source) ? next.start : boundary?.sentence?.end ?? item.end
      Promise.resolve(source.follow?.(followStart, followEnd)).catch(() => {})
    } catch { /* the page may have changed under a paused voice */ }
  }
  /** Removes the highlight (and the one a previous page left behind). */
  unpaint() {
    clearTimeout(this.presentTimer)
    const shown = this.shown
    this.shown = null
    shown?.source.clear?.()
    if (this.source !== shown?.source) this.source?.clear?.()
  }
}
