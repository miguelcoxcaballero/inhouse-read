// Reading owns the display: a screen wake lock in the browser and, in the
// Android app, KEEP_SCREEN_ON with its status bar hidden.
//
// A shell that reports a stable top inset (InhouseNative.getSafeTopInset)
// draws the page behind its status bar, and the page always keeps the bar's
// strip free (index.html, --ihr-safe-top). Hiding or showing the bar there
// moves and resizes nothing, so it follows the book itself: it fades out as
// the page zooms in (body.is-reader-page-arriving) and comes back as the 3D
// book starts carrying the page to the shelf (body.is-reader-page-leaving).
// Its icons follow what is under them: the reading paper while the book owns
// the display, the app's theme otherwise.
//
// Older shells resize the WebView when the bar changes. Changing their
// insets during a 3D flight would look like a user resize and cancel it, so
// for them the display changes only after the book has opened and after it
// is back on the shelf.
export function initReadingDisplay({ document:doc = document, window:win = window, navigator:nav = navigator } = {}) {
  let reading = false, active = false, disposed = false, pageActive = true
  let lock = null, pending = null, epoch = 0, nativeState = null, lightState = null
  const visible = () => pageActive && doc.visibilityState !== 'hidden'
  const eligible = () => active && !disposed && visible()
  const release = sentinel => { try { Promise.resolve(sentinel?.release()).catch(() => {}) } catch { /* Already released. */ } }
  const has = name => doc.body.classList.contains(name)
  // The book's page owns the screen: from its zoom in until the 3D book takes
  // it back (stable shells only; `reading` itself changes after the motion).
  const pageOwnsDisplay = () => reading
    ? !(has('is-closing-reader') && has('is-reader-page-leaving'))
    : has('is-opening-reader') && has('is-reader-page-arriving')
  const native = enabled => {
    // New shells own their Activity lifecycle. A delayed WebView visibility
    // event after unlocking must not hide a notification shade the user opened.
    const bridge = win.InhouseNative
    const ownership = typeof bridge?.setReaderOwnership === 'function'
    const owned = typeof bridge?.getSafeTopInset === 'function' ? pageOwnsDisplay() : reading
    const requested = ownership ? owned && pageActive && !disposed : enabled
    if (nativeState === requested) return
    try {
      if (ownership) {
        bridge.setReaderOwnership(requested)
        nativeState = requested
      } else if (typeof bridge?.setReadingMode === 'function') {
        bridge.setReadingMode(requested)
        nativeState = requested
      }
    } catch { /* Older shells use the browser wake lock when available. */ }
  }
  // Whether the surface under the status bar is light (dark icons).
  const lightUnderStatusBar = () => {
    // The blocking update notice dims the whole screen, the bar's strip too.
    if (doc.getElementById('android-update-gate')) return false
    // So does the catalogue's backdrop: light paper when flown into from the
    // booklet (both themes), the dimmed room otherwise.
    const catalog = doc.querySelector('dialog.ihr-plant-catalog[open]')
    if (catalog) return catalog.hasAttribute('data-catalog-camera')
    const scheme = reading && pageOwnsDisplay() ? doc.getElementById('reader-screen')?.style.colorScheme : ''
    if (scheme === 'light' || scheme === 'dark') return scheme === 'light'
    return doc.documentElement.getAttribute('data-theme') !== 'dark'
  }
  const statusBarIcons = () => {
    const bridge = win.InhouseNative
    if (disposed || typeof bridge?.setStatusBarAppearance !== 'function') return
    const light = lightUnderStatusBar()
    if (lightState === light) return
    try { bridge.setStatusBarAppearance(light); lightState = light } catch { /* Shell without icon control. */ }
  }
  const acquire = () => {
    if (!eligible() || lock || pending || typeof nav.wakeLock?.request !== 'function') return
    const requestedEpoch = epoch
    pending = Promise.resolve().then(() => nav.wakeLock.request('screen')).then(sentinel => {
      if (requestedEpoch !== epoch || !eligible()) { release(sentinel); return }
      lock = sentinel
      sentinel.addEventListener('release', () => { if (lock === sentinel) lock = null }, { once:true })
    }).catch(() => {
      // Battery saver, permissions or an older WebView may refuse a lock.
      // Retry only on visibility/focus/user interaction, never a busy loop.
    }).finally(() => {
      pending = null
      if (requestedEpoch !== epoch && eligible()) acquire()
    })
  }
  const sync = () => {
    if (disposed) return
    // Retain the previous policy until the opening/return animation finishes.
    if (!has('is-opening-reader') && !has('is-closing-reader')) reading = has('is-reading')
    const next = reading && visible()
    if (active !== next) {
      active = next; epoch++
      if (!active) { const previous = lock; lock = null; release(previous) }
    }
    // Icons first, so a bar coming back already matches what is under it.
    statusBarIcons()
    native(active)
    acquire()
  }
  const pageHide = () => { pageActive = false; sync() }
  const pageShow = () => { pageActive = true; nativeState = null; lightState = null; sync() }
  const observer = new win.MutationObserver(sync)
  // Body: reader states and the update notice. Root: app theme. Reader: paper.
  observer.observe(doc.body, { attributes:true, attributeFilter:['class'], childList:true })
  observer.observe(doc.documentElement, { attributes:true, attributeFilter:['data-theme'] })
  const readerScreen = doc.getElementById('reader-screen')
  if (readerScreen) observer.observe(readerScreen, { attributes:true, attributeFilter:['data-reading-theme'] })
  // Dialogs opening anywhere (the catalogue covers the status bar's strip).
  const dialogs = new win.MutationObserver(sync)
  dialogs.observe(doc.body, { subtree:true, attributes:true, attributeFilter:['open', 'data-catalog-camera'] })
  doc.addEventListener('visibilitychange', sync)
  doc.addEventListener('pointerdown', acquire, { passive:true })
  win.addEventListener('focus', sync)
  win.addEventListener('pagehide', pageHide)
  win.addEventListener('pageshow', pageShow)
  sync()
  return { dispose() {
    if (disposed) return
    disposed = true; active = false; epoch++
    observer.disconnect(); dialogs.disconnect()
    doc.removeEventListener('visibilitychange', sync)
    doc.removeEventListener('pointerdown', acquire)
    win.removeEventListener('focus', sync)
    win.removeEventListener('pagehide', pageHide)
    win.removeEventListener('pageshow', pageShow)
    const previous = lock; lock = null; release(previous)
    native(false)
  } }
}
