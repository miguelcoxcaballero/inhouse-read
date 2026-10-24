// Frozen pre-migration ReaderExperience methods; tests provide all dependencies.
export function referenceExperiencePolicy({normalizeReadingPreferences,clonePlace,isBookmarked,displayBookTitle,rateLabel,readerIcon,readerUI,closeReaderVoice}) {
return class {
  resetAppearance() {
    this.preferences = normalizeReadingPreferences({ rate:this.preferences.rate, voice:this.preferences.voice, voiceLang:this.preferences.voiceLang })
    this.applyPreferences()
  }
  async rotateReading() {
    try {
      if (screen.orientation?.lock) { await screen.orientation.lock(screen.orientation.type.startsWith('portrait') ? 'landscape' : 'portrait'); this.error('') }
      else this.error('No se puede girar.')
    } catch { this.error('Gira el dispositivo.') }
  }
  /** The title written on the spine or the author changed (in the shelf's
   * editor, maybe while this book was already prepared): show them here too. */
  refreshNames(bookId,fields) { return this.lifecycle.refreshNames(bookId,fields) }
  open(record) {
    this.lengthMetadata = record
    const pending = this.lifecycle.open(record), epoch = this.reader.epoch
    // The engine already caches this count. Do not block opening or let a
    // late count from a closed book leak into the next reader session.
    if (!record.wordCountComplete && this.reader.getLengthMetadata) {
      Promise.resolve(this.reader.getLengthMetadata()).then(metadata => {
        if (this.book !== record || this.reader.epoch !== epoch || !metadata) return
        this.lengthMetadata = {...record,...metadata}
        this.relocate()
        return this.onLengthMetadata(record, metadata)
      }).catch(() => {})
    }
    return pending
  }
  closeVoice() { return closeReaderVoice(this) }
  reset() { return this.lifecycle.reset() }
  relocate() {
    this.location = {...clonePlace(this.reader.location),section:this.reader.location.section || '',page:this.reader.location.page || ''}
    const label = this.label(this.location)
    const compactLabel = this.readingMetrics().compact
    this.view.relocate(label,compactLabel,this.location.fraction * 100,
      this.location.locator?.kind === 'pdf-page',this.location.locator?.value)
    this.updateBookmarkButton()
    this.updateReadingMetrics()
  }
  readingMetrics() {
    return readerUI().reader_reading_metrics(this.reader.s, this.reader.location,
      {...this.lengthMetadata, pageCount:this.reader.pageCount}, this.preferences.rate,
      ['playing','paused','loading'].includes(this.voice?.state))
  }
  updateReadingMetrics() {
    const metrics = this.readingMetrics()
    this.view.updateReadingMetrics(metrics.time, metrics.pagesDescription)
  }
  label(place) { return place.locator?.kind === 'pdf-page' ? `Página ${place.locator.value}${this.reader.pageCount ? ` de ${this.reader.pageCount}` : ''}` : place.section ? `${place.section}${place.page ? ` · Página ${place.page}` : ''}` : `${Math.round(place.fraction * 100)} % del libro` }
  show(tab) { return this.lifecycle.show(tab) }
  showTab(name) {
    if (name !== 'search') this.endSearch()
    this.view.showTab(name)
  }
  showPlaceTab(name) {
    this.placeTab = name
    this.view.showPlaceTab(name)
  }
  updateMiniPlayer(state = this.voice?.state, message = '') {
    this.view.updateMiniPlayer(state || '',message,displayBookTitle(this.book),rateLabel(this.preferences.rate),Boolean(this.book),readerIcon(state === 'playing' ? 'pause' : 'play'))
    this.updateReadingMetrics()
  }
  syncMiniPlayerLayout() {
    this.view.syncMiniPlayerLayout()
  }
  syncReturnLayout() {
    this.view.syncReturnLayout()
  }
  updateBookmarkButton() {
    const marked = isBookmarked(this.bookmarks,this.location)
    this.view.updateBookmarkButton(marked)
  }
  setPreference(key,value,{restart=true}={}) { return this.preferenceFlow.set(key,value,restart) }
  applyPreferences(updateBook=true) { return this.preferenceFlow.apply(updateBook) }
  /** The language of the open book (the device's when it has none or no book is open). */
  bookLanguage() { return this.voiceFlow.bookLanguage() }
  setSleepChoice(minutes) {
    this.view.setSleepChoice(minutes)
  }
  /** Picking a language: the voice goes back to Automática unless the one in use already speaks it. */
  chooseLanguage(value) { return this.voiceFlow.chooseLanguage(value) }
  voiceBase(voices) { return this.voiceFlow.voiceBase(voices) }
  populateVoices() { return this.voiceFlow.populateVoices() }
  error(message) { this.panel.querySelector('.reading-error').textContent = message }
  savePlaces() { return this.actions.savePlaces() }
  cancelNavigation() {
    this.navigation.cancel()
  }
  queueNavigation(action) {
    if (!this.book) return Promise.resolve()
    const book = this.book, generation = this.navigation.generation
    const isCurrent = () => this.book === book && this.navigation.generation === generation
    // A section becomes visible before its history write finishes. Preserve
    // links tapped in that interval instead of silently dropping the request.
    return this.navigation.enqueue(action,isCurrent)
  }
  jump(place, target) {
    return this.queueNavigation(current => this.actions.jump(place,target,current))
  }
  returnToReading(index = 0) {
    const place = this.history[index]
    if (!place) return Promise.resolve()
    return this.queueNavigation(current => this.actions.returnToReading(place,current))
  }
  addBookmark() { return this.actions.addBookmark() }
  addQuote() { return this.actions.addQuote() }
  search(query) { return this.actions.search(query) }
  endSearch() { return this.actions.endSearch() }
  async shareBook() {
    const content = this.book?.content
    if (!content) { this.error('Archivo original no disponible.'); return }
    const file = new File([content],this.book.fileName || `${this.book.title}.${String(this.book.format||'pdf').toLowerCase()}`,{type:this.book.mimeType || content.type || 'application/octet-stream'})
    try {
      if (navigator.canShare?.({files:[file]}) && navigator.share) await navigator.share({title:displayBookTitle(this.book),files:[file]})
      else { const url = URL.createObjectURL(file), link = document.createElement('a'); link.href=url; link.download=file.name; link.click(); setTimeout(()=>URL.revokeObjectURL(url),30000) }
      this.panel.close()
    } catch (error) { if (error.name !== 'AbortError') this.error('No se pudo compartir.') }
  }
  formatSize(bytes = 0) { return bytes >= 1048576 ? `${(bytes/1048576).toFixed(1)} MB` : `${Math.max(1,Math.round(bytes/1024))} KB` }
  renderPlaces() {
    this.updateBookmarkButton()
    this.updateReturnButton()
    for (const [name, places] of [['history',this.history],['bookmarks',this.bookmarks],['quotes',this.quotes]]) {
      this.lists.renderPlaces(name,places,places.map(place => place.label || this.label(place)),
        (index,place) => name === 'history' ? this.returnToReading(index) : this.jump(place),
        async index => { const [removed] = places.splice(index,1); if (name === 'quotes') this.reader.removeQuoteAnnotation(removed); await this.savePlaces(); this.renderPlaces() },readerIcon('close'))
    }
  }
  renderToc() {
    const available = this.lists.renderToc(this.reader.toc,href => this.jump(null,href))
    this.showPlaceTab(available ? 'toc' : 'bookmarks')
  }
  step(direction) {
    // Consult another page without moving the independent audible cursor.
    return this.queueNavigation(() => this.voice.continueFromPage(() => direction > 0 ? this.reader.next() : this.reader.prev()))
  }
  updateReturnButton() {
    const audio = this.voice?.browsing
    this.view.updateReturnButton(Boolean(audio),Boolean(this.history.length),this.history.length ? this.history[0].label || this.label(this.history[0]) : '')
  }
}
}
