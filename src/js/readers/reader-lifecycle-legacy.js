import {displayBookTitle,normalizeBookAuthor} from '../book-title.js'
import {cleanPlaces,cleanQuotes} from './reading-state.js'
import {neuralEngine} from './neural-runtime.js'
export class LegacyReaderLifecycle{
  refreshNames(bookId, fields) {
    if (!this.book || String(this.book.id) !== String(bookId)) return
    Object.assign(this.book, fields)
    const title = displayBookTitle(this.book)
    const author = normalizeBookAuthor(this.book.author) || normalizeBookAuthor(this.book.metadata?.creator)
    this.view.setDocumentInfo(title,author,`${title}${author ? ` · ${author}` : ''}
${this.book.format || 'Documento'} · ${this.formatSize(this.book.sizeBytes)}`,true)
  }

  async open(record) {
    this.cancelNavigation()
    this.book = record
    this.history = cleanPlaces(record.readingHistory)
    this.bookmarks = cleanPlaces(record.bookmarks, 100)
    this.quotes = cleanQuotes(record.quotes)
    const title = displayBookTitle(record)
    const author = normalizeBookAuthor(record.author) || normalizeBookAuthor(record.metadata?.creator)
    this.view.setDocumentInfo(title,author,`${title}${author ? ` · ${author}` : ''}\n${record.format || 'Documento'} · ${this.formatSize(record.sizeBytes)}`,false)
    this.view.configureFormat(this.reader.format?.engine === 'pdf',this.reader.pageCount || 1)
    this.neuralPicker.warm() // the engine module (needed synchronously at the first Play tap) loads while the book settles
    this.renderPlaces(); this.renderToc(); await this.applyPreferences(); this.relocate()
    for (const quote of this.quotes) this.reader.addQuoteAnnotation(quote)
  }
  // Explicit book close only; no await, preload, visibility or pause hook.
  closeVoice() {
    this.neuralPicker?.cancelWarm?.()
    this.voice.stop()
    try { neuralEngine()?.release?.() } catch { /* playback is already stopped */ }
  }
  reset() {
    this.neuralPicker?.cancelWarm?.()
    this.cancelNavigation(); this.voice.stop(); this.keepSearchHits = false; this.endSearch(); this.panel.close(); this.book = null
    this.returnButton.hidden = true; this.syncReturnLayout(); this.screen.classList.remove('reader-kids-mode')
    const kids = this.panel.querySelector('[data-kids]')
    kids.setAttribute('aria-pressed','false'); kids.setAttribute('aria-label','Activar modo infantil')
  }
  show(tab) {
    if (this.screen.getAttribute('aria-busy') === 'true') return
    this.showTab(tab)
    if (tab === 'audio') { this.populateVoices(); this.neuralPicker.refresh() }
    if (!this.panel.open) this.panel.showModal()
    this.updateMiniPlayer(); this.resizePanel()
    this.panel.querySelector('[data-close]').focus({preventScroll:true})
  }
}
