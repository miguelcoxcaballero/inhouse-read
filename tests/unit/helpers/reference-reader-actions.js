import {clonePlace,cleanPlaces,cleanQuotes} from '../../../src/js/readers/reading-state.js'
import {toggleBookmark,prependHistory} from '../../../src/js/readers/reading-places.js'
export const legacyReaderActions = {
  async savePlaces() {
    if (!this.book) return
    try { await this.persist(this.book.id, { readingHistory:cleanPlaces(this.history), bookmarks:cleanPlaces(this.bookmarks, 100), quotes:cleanQuotes(this.quotes) }) }
    catch { this.error('No se pudieron guardar los marcadores.') }
  },
  async jump(place, target, isCurrent) {
      this.voice.browse(); this.error('')
      const origin = { ...clonePlace(this.location), label:this.label(this.location), createdAt:Date.now() }
      this.history = prependHistory(this.history,origin)
      await this.savePlaces()
      if (!isCurrent()) return
      this.renderPlaces()
      try {
        if (target !== undefined) await this.reader.goToTarget(target)
        else await this.reader.goToLocator(place.locator, place.fraction)
        if (!isCurrent()) return
        this.relocate(); this.panel.close()
      } catch { if (isCurrent()) this.error('No se pudo abrir.') }
  },
  async returnToReading(place, isCurrent) {
      if (!this.history.includes(place)) return
      this.voice.browse()
      try {
        await this.reader.goToLocator(place.locator, place.fraction)
        if (!isCurrent()) return
        this.history.splice(this.history.indexOf(place),1)
        await this.savePlaces()
        if (!isCurrent()) return
        this.relocate(); this.renderPlaces(); this.panel.close()
      } catch { if (isCurrent()) this.error('No se pudo volver.') }
  },
  async addBookmark() {
    this.bookmarks = toggleBookmark(this.bookmarks,this.location,()=>({ ...clonePlace(this.location), label:this.label(this.location), createdAt:Date.now() }))
    await this.savePlaces(); this.renderPlaces(); this.showPlaceTab('bookmarks')
  },
  async addQuote() {
    const selection = this.reader.getSelection() || this.selectedQuoteSelection
    const text = typeof selection === 'string' ? selection : selection?.text
    if (!text) { this.error('Selecciona un texto primero.'); return }
    const locator = typeof selection === 'string' ? this.location.locator : selection.locator
    const quote = {id:globalThis.crypto?.randomUUID?.() || `${Date.now()}`,text,locator,fraction:this.location.fraction,label:this.label(this.location),color:this.quoteColor,createdAt:Date.now()}
    this.quotes = cleanQuotes([quote,...this.quotes]); this.reader.addQuoteAnnotation(quote)
    this.selectedQuoteSelection = null
    await this.savePlaces(); this.renderPlaces(); this.showPlaceTab('quotes')
  },
  async search(query) {
    this.lists.clearSearch('Buscando…')
    try {
      const results = await this.reader.search(query)
      this.searchActive = results.length > 0
      this.lists.renderSearch(results,result => { this.keepSearchHits = true; this.jump({fraction:result.fraction ?? this.location.fraction,locator:result.locator}) })
    } catch { this.panel.querySelector('[data-search-status]').textContent = 'No se pudo buscar.' }
  },
  endSearch() {
    if (!this.searchActive) return
    this.searchActive = false; this.keepSearchHits = false
    this.reader.clearSearch?.()
    this.lists.clearSearch('')
  }
}
