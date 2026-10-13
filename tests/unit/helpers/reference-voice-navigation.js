export class LegacyVoiceNavigation{
  jumpToPoint({ doc, x, y } = {}) {
    if (this.state !== 'playing' || typeof this.source?.offsetAtPoint !== 'function') return false
    let at
    try { at = this.source.offsetAtPoint(doc, x, y) } catch { return false }
    if (!Number.isFinite(at)) return false
    const hit = this.items.findIndex(item => item.sentence && at >= item.sentence.start && at < item.sentence.end)
    if (hit < 0) return false
    let first = hit
    while (first > 0 && this.items[first - 1].sentence?.start === this.items[hit].sentence.start) first--
    this.index = first
    this.restart()
    return true
  }
  /** Manual browsing changes the visible page, keeping the audible cursor intact. */
  async continueFromPage(navigate) {
    this.browse()
    await navigate?.()
  }
  browse() {
    if (!['playing','paused','loading'].includes(this.state)) return
    this.browseEpoch = (this.browseEpoch || 0) + 1
    this.browsing = true
    this.reader.browseSpeech?.()
    this.notify()
  }
  async returnToAudio() {
    if (!this.browsing) return
    const epoch = this.browseEpoch, generation = this.generation
    await this.reader.returnToSpeech?.()
    if (epoch !== this.browseEpoch || generation !== this.generation) return
    this.browsing = false
    this.notify()
  }
  async seekToPoint({doc,x,y}) {
    const generation = this.generation
    try {
      const source = await this.reader.getSpeechSource?.({visible:true})
      if (generation !== this.generation || this.state !== 'playing') return
      const offset = source?.offsetAtPoint?.(doc,x,y)
      if (!Number.isFinite(offset)) return
      const plan = await this.prepare({...source,start:0})
      if (generation !== this.generation || this.state !== 'playing') return
      const hit = plan.items.find(item => offset >= item.sentence.start && offset < item.sentence.end)
      if (!hit) return
      this.stop()
      this.adopt({source,items:plan.items.filter(item => item.start >= hit.sentence.start)})
      this.state = 'playing'; this.waiting = true
      this.notify('Preparando la voz natural…'); this.speakCurrent()
    } catch { /* An obsolete frame or a hold outside text cannot seek. */ }
  }
}
