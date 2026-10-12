const MAX_EMPTY_PAGES=12,END_RETRIES=2,END_RETRY_MS=200
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
export class LegacyAdvance {
  async advance() {
    if (this.state !== 'playing') return
    if (++this.index < this.chunks.length) return this.speakCurrent()
    const generation = this.generation
    const diagnostic = this.diagnosticAdvance = { generation, stage:'prepare-next' }
    // The sentence just read stays painted while the page turns: the next one replaces it the moment it is heard (see present()).
    try {
      if (typeof this.reader.getNextSpeechSource === 'function') {
        const ahead = this.aheadPage
        let next
        if (ahead) {
          this.aheadPage = null
          const request = { generation }; this.preparingPage = request
          try {
            next = await ahead.promise
            if (ahead.error) {
              if (ahead.error.name !== 'AbortError' || generation !== this.generation || this.state !== 'playing') throw ahead.error
              next = await this.prepareNext(generation)
            }
          }
          finally { if (this.preparingPage === request) this.preparingPage = null }
          if (next === undefined && generation === this.generation && this.state === 'playing') next = await this.prepareNext(generation)
        } else next = await this.prepareNext(generation)
        if (generation !== this.generation || this.state !== 'playing') { next?.source?.clear?.(); return }
        if (!this.pagePlanValid(next)) next = await this.revalidateNext(next, generation)
        if (generation !== this.generation || this.state !== 'playing') { next?.source?.clear?.(); return }
        if (next === null) { this.stop(); this.notify('Final del libro.'); return }
        if (next !== undefined) {
          this.adopt(next)
          if (!this.chunks.length) { this.index = -1; return this.advance() }
          return this.speakCurrent()
        }
      }
      const isActive = () => generation === this.generation && this.state === 'playing'
      for (let blank = 0; blank < MAX_EMPTY_PAGES; blank++) {
        const previous = JSON.stringify(this.reader.location)
        diagnostic.stage = 'next-turn'
        await this.reader.next({ source:true, isActive })
        if (generation !== this.generation || this.state !== 'playing') return
        for (let retry = 0; retry < END_RETRIES && JSON.stringify(this.reader.location) === previous; retry++) {
          diagnostic.stage = 'retry-wait'
          await wait(END_RETRY_MS)
          if (generation !== this.generation || this.state !== 'playing') return
          diagnostic.stage = 'retry-turn'
          await this.reader.next({ source:true, isActive })
          if (generation !== this.generation || this.state !== 'playing') return
        }
        if (JSON.stringify(this.reader.location) === previous) { this.stop(); this.notify('Final del libro.'); return }
        diagnostic.stage = 'prepare-source'
        const plan = await this.prepare()
        if (generation !== this.generation || this.state !== 'playing') return
        this.adopt(plan)
        if (this.chunks.length) return this.speakCurrent()
      }
      this.fail('Página siguiente sin texto legible.')
    } catch { if (generation === this.generation) this.fail('No se pudo pasar de página.') }
    finally { if (this.diagnosticAdvance === diagnostic) this.diagnosticAdvance = null }
  }
}
