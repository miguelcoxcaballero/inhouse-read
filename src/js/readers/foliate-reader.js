// Lector de EPUB / MOBI / AZW3 / FB2 / CBZ sobre foliate-js. La librería
// expone un custom element <foliate-view> que se encarga de paginar (vía
// columnas CSS) y renderizar cada sección; nosotros solo lo montamos,
// aplicamos nuestros propios tokens de estilo dentro de su shadow DOM, y
// traducimos sus eventos a la misma interfaz que usa el lector de PDF.
//
// Nota de honestidad (ver README.md → "Limitaciones honestas"): el soporte de MOBI/AZW3 de
// foliate-js es funcional pero no tan maduro como su soporte de EPUB, y no
// puede abrir archivos con DRM de Amazon (limitación criptográfica, no de
// la librería). Ver también la investigación en el propio HANDOFF.

import 'foliate-js/view.js'
import { Overlayer } from 'foliate-js/overlayer.js'
import { attachSwipeNavigation, classifyTapZone, ZONE } from '../gestures.js'
import { DEFAULT_READING_PREFERENCES, readingCSS, normalizeReadingPreferences } from './reading-preferences.js'
import { READING_THEMES } from './reading-preferences.js'
import { compositePageSnapshots, renderedPageFilter, settlePageLayout, snapshotDOMPage } from './page-snapshot.js'
import { mapSpeechText } from './speech-map.js'
import { speechPageBreaks } from './speech-page-breaks.js'
import { measureBookLength } from '../book-length.js'
import { SPEECH_HIGHLIGHT, clearSpeechRange, installSpeechStyle, paintSpeechRange, speechOverlayColor } from './speech-highlight.js'

// foliate marca las coincidencias de búsqueda con Overlayer.outline (un
// recuadro rojo de 3px que parecía una capa de depuración). Lo sustituimos una
// vez por un resaltado ámbar de rotulador, suave en los cinco temas de lectura.
Overlayer.outline = (rects, { color = '#d9a23a' } = {}) => {
  const svg = 'http://www.w3.org/2000/svg', g = document.createElementNS(svg, 'g')
  g.setAttribute('fill', color)
  g.style.opacity = '.34'
  for (const { left, top, width, height } of rects) {
    const rect = document.createElementNS(svg, 'rect')
    for (const [name, value] of Object.entries({ x:left - 1.5, y:top + height * .08, width:width + 3, height:height * .9, rx:3 })) rect.setAttribute(name, value)
    g.append(rect)
  }
  return g
}
// El extracto de foliate llega como { pre, match, post }; se aplana para quien espere texto.
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
// Where a spoken fragment starts relative to the page foliate shows: -1 before, 0 on it, 1 after.
function pageSide(visible, range) {
  const { startContainer:node, startOffset:offset } = range
  const side = visible.comparePoint(node, offset)
  return side === 0 && node === visible.endContainer && offset >= visible.endOffset ? 1 : side
}
const excerptParts = excerpt => typeof excerpt === 'string' ? { pre:excerpt, match:'', post:'' }
  : { pre:String(excerpt?.pre ?? ''), match:String(excerpt?.match ?? ''), post:String(excerpt?.post ?? '') }

export class FoliateReader {
  #view
  #container
  #onRelocate = () => {}
  #detachGestures = () => {}
  #preferences = { ...DEFAULT_READING_PREFERENCES }
  #documentGestures = []
  #skipSnapUntil = 0
  #resizeObserver
  #resizeTimer
  #followTicket = 0
  #followTurn = Promise.resolve()
  #pageTurn = Promise.resolve()
  #lengthMetadata = null
  #diagnosticTurns = { followPending:0, pageTurnPending:0 }

  async open(container, file, { onRelocate, onToggleChrome, onUserNavigation, onFollowLink } = {}) {
    this.#lengthMetadata = null
    this.#diagnosticTurns = { followPending:0, pageTurnPending:0 }
    this.#pageTurn = Promise.resolve()
    this.#container = container
    this.#onRelocate = onRelocate ?? (() => {})

    container.innerHTML = ''
    container.classList.add('foliate-reader')
    container.classList.remove('pdf-reader')

    this.#view = document.createElement('foliate-view')
    this.#view.classList.add('foliate-view-el')
    container.append(this.#view)

    // foliate-js es deliberadamente de bajo nivel y no trae gestos táctiles
    // propios (ver HANDOFF-FORMATOS.md): reusamos el mismo detector de
    // swipe/tap que el lector de PDF para que la sensación táctil sea
    // idéntica entre formatos.
    const gestures = {
      onNext: () => { onUserNavigation?.(); this.#skipTouchSnap(); return this.next() },
      onPrev: () => { onUserNavigation?.(); this.#skipTouchSnap(); return this.prev() },
      onToggleChrome,
      // Foliate already tracks touch drag/velocity and snaps to the next page.
      // A second pointerup navigation here used to advance twice per swipe.
      nativeTouchSwipes:true,
      onNativeSwipe:() => onUserNavigation?.(),
      canSwipe:() => this.#preferences.flow !== 'scrolled'
    }
    this.#detachGestures = attachSwipeNavigation(container, gestures)
    // A paginated section is one wide document that the paginator slides
    // sideways, so measuring a tap against it classified every tap by where the
    // page sits in the chapter (all of them turned forward). Judge the tap
    // against the visible reader instead; right-to-left books turn on the left.
    const tapZone = event => {
      const outer = container.getBoundingClientRect()
      const frame = event.target?.ownerDocument?.defaultView?.frameElement
      const zone = classifyTapZone((frame ? frame.getBoundingClientRect().left : outer.left) + event.clientX - outer.left, outer.width)
      if (zone === ZONE.CENTER || this.#view?.book?.dir !== 'rtl') return zone
      return zone === ZONE.PREV ? ZONE.NEXT : ZONE.PREV
    }
    this.#view.addEventListener('load', event => {
      // Events inside the book iframe do not bubble to the outer viewport.
      this.#documentGestures.push(attachSwipeNavigation(event.detail.doc.documentElement, { ...gestures, tapZone }))
      event.detail.doc.addEventListener('selectionchange', () => {
        const selection = event.detail.doc.defaultView.getSelection()
        if (!selection?.toString().trim() || !selection.rangeCount) return
        window.dispatchEvent(new CustomEvent('inhouse-reader-selection',{detail:{
          text:selection.toString().trim(),locator:{kind:'cfi',value:this.#view.getCFI(event.detail.index,selection.getRangeAt(0))}
        }}))
      })
    })
    this.#view.addEventListener('link', event => {
      if (onFollowLink) { event.preventDefault(); onFollowLink(event.detail.href) }
    })
    this.#view.addEventListener('draw-annotation', event => {
      const { draw, annotation } = event.detail
      const colors = {green:'#75ad6b66',blue:'#74a6d866',pink:'#df8dad66',yellow:'#f2d35d77'}
      draw(Overlayer.highlight, {color:colors[annotation.color] || colors.yellow})
    })

    this.#view.addEventListener('relocate', e => {
      this.#onRelocate({
        // View.lastLocation contains SectionProgress.section.current, not a top-level index.
        // Retain a valid explicit index for older adapters; never turn a missing index into chapter zero.
        index: Number.isInteger(e.detail.index) && e.detail.index >= 0 ? e.detail.index
          : Number.isInteger(e.detail.section?.current) && e.detail.section.current >= 0 ? e.detail.section.current : undefined,
        fraction: e.detail.fraction ?? 0,
        cfi: e.detail.cfi,
        section:e.detail.tocItem?.label || '', page:e.detail.pageItem?.label || ''
      })
    })

    await this.#view.open(file)
    this.#guardTapSnap(this.#view.renderer)
    // Configure the paginator before the first page is laid out. Its defaults
    // reserve 48 px above/below the text even though our chrome has its own
    // space. The first visible page must use the same geometry as later pages.
    this.#applyReaderLayout()
    this.#applyReaderStyles()
    await this.#view.init({ showTextStart: true })
    if (typeof ResizeObserver !== 'undefined') {
      this.#resizeObserver = new ResizeObserver(() => {
        clearTimeout(this.#resizeTimer)
        this.#resizeTimer = setTimeout(() => this.#applyReaderLayout(), 80)
      })
      this.#resizeObserver.observe(container)
    }
  }

  /** Numeric queue state only; no book text, labels, DOM ranges or CFI. */
  get speechDiagnosticState() { return { ...this.#diagnosticTurns } }

  get metadata() {
    return this.#view?.book?.metadata ?? {}
  }

  get toc() {
    return this.#view?.book?.toc ?? []
  }

  /** Right-to-left books turn pages from the left edge. */
  get rtl() {
    return this.#view?.book?.dir === 'rtl'
  }

  /** Portada embebida del libro (EPUB/MOBI), si el archivo trae una. */
  async getCoverBlob() {
    try {
      return (await this.#view?.book?.getCover?.()) ?? null
    } catch {
      return null // una portada rota no puede impedir leer el libro
    }
  }

  // Foliate answers every touchend with snap(), which settles the paginator on
  // the page under the finger a frame later. A finger always drifts a few pixels
  // during a tap, so that snap starts a 300 ms animation back to the OLD page
  // while our own page turn is already running: the two fight and the page stops
  // between pages (or stays put). The tap's page turn replaces that snap, so the
  // single snap that belongs to the tap is skipped; swipes still snap normally.
  #skipTouchSnap() { this.#skipSnapUntil = performance.now() + 250 }
  #guardTapSnap(renderer) {
    const snap = renderer?.snap?.bind(renderer)
    if (!snap) return
    renderer.snap = (...args) => {
      if (performance.now() < this.#skipSnapUntil) { this.#skipSnapUntil = 0; return }
      return snap(...args)
    }
  }

  // Foliate silently discards a turn while its previous one is locked. Even
  // without animation it holds that lock for 100 ms AFTER moving the page.
  // Preserve rapid tap/button order through the full promise, not just until
  // the new offset becomes visible; a closed/replaced book drops pending turns.
  #turnPage(direction, { isActive = () => true } = {}) {
    const view = this.#view
    // Speech follows the last fragment with the same paginator as manual
    // navigation. Its relocate event fires before the animation releases
    // Foliate's lock. At a chapter boundary, wait for that whole follow turn:
    // otherwise next() silently does nothing and the voice mistakes the
    // unchanged location for the end of the book.
    const following = this.#followTurn
    const diagnostic = this.#diagnosticTurns
    diagnostic.pageTurnPending++
    const turn = this.#pageTurn.then(async () => {
      await following.catch(() => {}) // a highlight/follow failure stays cosmetic
      if (view && view === this.#view && isActive()) return view[direction]()
    })
    this.#pageTurn = turn.catch(() => {})
    const settled = () => { diagnostic.pageTurnPending-- }
    void turn.then(settled, settled)
    return turn
  }

  /** Cached physical-length metadata, counted outside the visible paginator. */
  getLengthMetadata() {
    const view = this.#view, book = view?.book
    if (!book) return Promise.resolve(null)
    return this.#lengthMetadata ??= measureBookLength(book, { isActive:() => view === this.#view && book === view.book })
  }

  async next(options) { await this.#turnPage('next', options) }

  async prev() { await this.#turnPage('prev') }

  async goToFraction(fraction) {
    await this.#view?.goToFraction(fraction)
  }

  async goToCfi(cfi) {
    if (cfi) await this.#view?.goTo(cfi)
  }
  async goToTarget(target) { await this.#view?.goTo(target) }
  async getSpeechText() {
    return this.#view?.lastLocation?.range?.toString() || ''
  }
  /**
   * The audiobook reads from the visible page to the end of its section, so a
   * sentence keeps one highlight across page breaks. Its audio fragments end
   * at actual page boundaries, so the next audible fragment turns the page.
   * Offsets index the returned text; the
   * DOM is only read (ranges for the highlight), never changed.
   */
  async getSpeechSource() {
    const view = this.#view, visible = view?.lastLocation?.range, doc = visible?.startContainer?.ownerDocument
    const content = view?.renderer?.getContents?.().find(item => item.doc === doc)
    if (!content || !doc.body) return null
    installSpeechStyle(doc, this.#preferences.theme)
    const map = mapSpeechText(doc.body)
    const live = () => this.#view === view && view.renderer.getContents().some(item => item.doc === doc)
    const pageBreaks = await speechPageBreaks(map, view.renderer, { isCurrent:live })
    if (!live()) return null
    // Clearing also cancels a page turn still queued for a sentence nobody is reading any more.
    const clear = () => { this.#followTicket++; clearSpeechRange(doc); try { content.overlayer?.remove(SPEECH_HIGHLIGHT) } catch { /* overlay already gone */ } }
    return {
      text:map.text, start:map.offsetOf(visible.startContainer, visible.startOffset), pageBreaks, clear,
      highlight:(start, end) => {
        if (!live()) return
        const range = map.rangeFor(start, end)
        if (!range) return clear()
        // Old WebViews without the Highlight API still get the same wash, drawn by foliate's own overlay.
        if (!paintSpeechRange(range)) content.overlayer?.add(SPEECH_HIGHLIGHT, range, Overlayer.highlight, { color:speechOverlayColor(this.#preferences.theme) })
      },
      follow:(start, end) => live() ? this.#followSpeech(doc, map.rangeFor(start, end)) : undefined
    }
  }
  /**
   * Turns pages with foliate's own animated paging (programmatic: it never goes
   * through the gesture callbacks that stop the voice) until the fragment being
   * spoken is on screen. Only the newest request matters; older ones yield.
   */
  #followSpeech(doc, range) {
    // Text that is not rendered (a hidden note) has no boxes: there is no page to show it on, so never turn pages for it.
    if (!range || !range.getClientRects().length) return
    const ticket = ++this.#followTicket
    const diagnostic = this.#diagnosticTurns
    diagnostic.followPending++
    const turn = this.#followTurn = this.#followTurn.catch(() => {}).then(async () => {
      const view = this.#view, renderer = view?.renderer
      if (ticket !== this.#followTicket || !renderer || !renderer.getContents().some(item => item.doc === doc)) return
      if (renderer.scrolled) return this.#followScroll(doc, range)
      for (let attempt = 0; attempt < 4; attempt++) {
        const visible = view.lastLocation?.range
        if (ticket !== this.#followTicket || visible?.startContainer?.ownerDocument !== doc) return
        const side = pageSide(visible, range)
        if (!side) return
        const before = view.lastLocation
        await (side > 0 ? view.next() : view.prev())
        // A turn requested while another one animates is ignored by foliate: retry.
        if (view.lastLocation === before) await wait(150)
      }
      if (ticket === this.#followTicket) await renderer.scrollToAnchor(range)
    })
    const settled = () => { diagnostic.followPending-- }
    void turn.then(settled, settled)
    return turn
  }
  /** Scroll flow: glide only when the sentence leaves the screen, landing it a quarter down so the next lines stay visible. */
  async #followScroll(doc, range) {
    const view = this.#view, renderer = view.renderer
    if (doc.defaultView.getComputedStyle(doc.documentElement).writingMode.startsWith('vertical')) return
    const rect = range.getClientRects()[0]
    if (!rect) return
    const size = renderer.size, top = rect.top - renderer.start
    if (top >= 0 && top <= size * .62) return
    const delta = top - size * .25
    if (delta > 0 && renderer.viewSize - renderer.end > 2) await view.next(delta)
    else if (delta < 0 && renderer.start > 0) await view.prev(-delta)
  }
  /** Snapshot the current paginated column/scroll viewport after CFI restore. */
  async getPageSnapshot() {
    const view = this.#view
    const initial = view?.renderer?.getContents?.() || []
    if (!initial.some(item => item.doc?.body || item.doc?.documentElement?.localName === 'svg')) return null
    await Promise.all(initial.filter(item => item.doc).map(item => settlePageLayout(item.doc)))
    if (view !== this.#view) return null
    const viewport = view.getBoundingClientRect()
    if (!viewport.width || !viewport.height) return null
    // Fixed-layout renderers expose both spread frames, including the hidden
    // side on portrait phones. Select actual visible frames, not array[0].
    const contents = (view.renderer?.getContents?.() || []).map(item => {
      const frame = item.doc?.defaultView?.frameElement
      const rect = frame?.getBoundingClientRect()
      if (!rect?.width || !rect.height) return null
      const left = Math.max(viewport.left,rect.left), top = Math.max(viewport.top,rect.top)
      const right = Math.min(viewport.right,rect.right), bottom = Math.min(viewport.bottom,rect.bottom)
      if (right <= left || bottom <= top) return null
      const width = frame.clientWidth || Number.parseFloat(frame.ownerDocument.defaultView.getComputedStyle(frame).width) || rect.width
      const height = frame.clientHeight || Number.parseFloat(frame.ownerDocument.defaultView.getComputedStyle(frame).height) || rect.height
      return { ...item, rect, scaleX:rect.width / width, scaleY:rect.height / height,
        clipBounds:{left,top,width:right-left,height:bottom-top} }
    }).filter(Boolean)
    if (!contents.length) return null
    const location = view.lastLocation
    const theme = READING_THEMES[this.#preferences.theme]
    const { background } = theme
    // The physical book starts with white paper even when the reader uses sepia.
    const paper = { background:'#ffffff', color:'#292821', themeColor:theme.color }
    const filter = renderedPageFilter(this.#container)
    const deadline = performance.now() + 1500
    const pages = []
    for (const {doc,rect,scaleX,scaleY,clipBounds} of contents) {
      const root = doc.body || (doc.documentElement.localName === 'svg' ? doc.documentElement : null)
      const page = await snapshotDOMPage(root, {
        viewport, offsetX:(viewport.left - rect.left) / scaleX, offsetY:(viewport.top - rect.top) / scaleY,
        coordinateScaleX:scaleX,coordinateScaleY:scaleY,clipBounds,background,filter,deadline,paper,
        range:location?.range?.startContainer?.ownerDocument === doc ? location.range : undefined
      })
      if (page) pages.push(page)
    }
    const snapshot = compositePageSnapshots(pages,{viewport,background,filter,paperBackground:paper.background})
    if (!snapshot || view !== this.#view || location !== view.lastLocation) return null
    return { ...snapshot, engine:'foliate', sourceType:'epub-page',
      label:location?.pageItem?.label || location?.tocItem?.label || '',
      location:{ fraction:Math.min(1, Math.max(0, Number(location?.fraction) || 0)),
        locator:location?.cfi ? { kind:'cfi', value:location.cfi } : null } }
  }
  async search(query) {
    if (!this.#view || !String(query || '').trim()) return []
    const results = []
    const hit = (label, excerpt, cfi) => {
      const parts = excerptParts(excerpt)
      return { label, parts, excerpt:`${parts.pre}${parts.match}${parts.post}`, locator:{kind:'cfi',value:cfi} }
    }
    for await (const item of this.#view.search({query:String(query).trim()})) {
      if (item?.cfi) results.push(hit('', item.excerpt, item.cfi))
      for (const sub of item?.subitems || []) results.push(hit(item.label || '', sub.excerpt, sub.cfi))
      if (results.length >= 200) break
    }
    return results
  }
  clearSearch() { this.#view?.clearSearch?.() }
  getSelection() {
    for (const item of this.#view?.renderer?.getContents?.() || []) {
      const text = item.doc?.defaultView?.getSelection?.().toString().trim()
      if (text) return { text, locator:{kind:'cfi',value:this.#view.getCFI(item.index,item.doc.defaultView.getSelection().getRangeAt(0))} }
    }
    return null
  }
  addQuoteAnnotation(quote) { if (quote?.locator?.kind === 'cfi') this.#view?.addAnnotation?.({value:quote.locator.value,color:quote.color}) }
  removeQuoteAnnotation(quote) { if (quote?.locator?.kind === 'cfi') this.#view?.deleteAnnotation?.({value:quote.locator.value}) }
  async applyPreferences(preferences) {
    this.#preferences = normalizeReadingPreferences(preferences)
    this.#applyReaderLayout()
    this.#applyReaderStyles()
  }

  #applyReaderLayout() {
    const renderer = this.#view?.renderer
    if (!renderer) return
    const bounds = this.#container.getBoundingClientRect()
    const width = this.#container.clientWidth || bounds.width || this.#view.getBoundingClientRect().width || 360
    const height = this.#container.clientHeight || bounds.height || this.#view.getBoundingClientRect().height || 720
    const p = this.#preferences
    // Foliate's margin is the vertical gutter, in CSS lengths; its horizontal
    // gutter is a percentage named gap. Passing a unitless "24" for margin was
    // invalid CSS and the horizontal setting did not affect the page at all.
    // Scrolled mode has a different grid, so convert pixels using that mode's
    // gap formula instead of introducing wider margins when switching flow.
    // Wide landscape windows show a two-page spread that ran edge to edge
    // (text 16px from the window, 16px between pages). Cap each page at a
    // book-like measure so the spread centres under the reader chrome, with a
    // real gutter plus the user's margin. Phones and portrait are unchanged.
    const wide = width >= 960 && width > height
    const gutter = wide ? 48 + p.margin : p.margin
    const gap = gutter / (width + (p.flow === 'scrolled' ? gutter : 0)) * 100
    const column = wide ? Math.round(Math.min(580, (width - 96) / 2)) : 720
    const attributes = {
      flow:p.flow,
      margin:'12px',
      gap:`${gap.toFixed(4)}%`,
      'max-inline-size':`${column}px`,
      'max-block-size':`${Math.max(width, height, 1440)}px`
    }
    for (const [name, value] of Object.entries(attributes)) {
      if (renderer.getAttribute?.(name) !== value) renderer.setAttribute(name, value)
    }
    const animated = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (animated) renderer.setAttribute('animated', '')
    else renderer.removeAttribute('animated')
  }

  #applyReaderStyles() {
    // foliate-js permite inyectar CSS propio dentro de cada documento
    // renderizado vía renderer.setStyles(), para que la tipografía del
    // texto del libro use nuestra misma fuente base y las columnas
    // respiren igual que el resto de la UI.
    const css = readingCSS(this.#preferences)
    this.#view?.renderer?.setStyles?.(css)
  }

  close() {
    this.#lengthMetadata = null
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    clearTimeout(this.#resizeTimer)
    this.#resizeTimer = null
    this.#detachGestures()
    for (const detach of this.#documentGestures) detach()
    this.#documentGestures = []
    this.#view?.close()
    this.#view?.remove()
    this.#view = null
    this.#diagnosticTurns = { followPending:0, pageTurnPending:0 }
    this.#pageTurn = Promise.resolve()
    if (this.#container) { this.#container.innerHTML = ''; this.#container.classList.remove('foliate-reader') }
  }
}
