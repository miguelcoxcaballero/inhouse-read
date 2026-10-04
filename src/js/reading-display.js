// Reading owns the display only after the book has opened. Changing Android
// insets during a 3D flight would look like a user resize and cancel it.
export function initReadingDisplay({ document:doc = document, window:win = window, navigator:nav = navigator } = {}) {
  let reading = false, active = false, disposed = false, pageActive = true
  let lock = null, pending = null, epoch = 0, nativeState = null
  const visible = () => pageActive && doc.visibilityState !== 'hidden'
  const eligible = () => active && !disposed && visible()
  const release = sentinel => { try { Promise.resolve(sentinel?.release()).catch(() => {}) } catch { /* Already released. */ } }
  const native = enabled => {
    // New shells own their Activity lifecycle. A delayed WebView visibility
    // event after unlocking must not hide a notification shade the user opened.
    const bridge = win.InhouseNative
    const ownership = typeof bridge?.setReaderOwnership === 'function'
    const requested = ownership ? reading && pageActive && !disposed : enabled
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
    const classes = doc.body.classList
    // Retain the previous policy until the opening/return animation finishes.
    if (!classes.contains('is-opening-reader') && !classes.contains('is-closing-reader')) {
      reading = classes.contains('is-reading')
    }
    const next = reading && visible()
    if (active !== next) {
      active = next; epoch++
      if (!active) { const previous = lock; lock = null; release(previous) }
    }
    native(active)
    acquire()
  }
  const pageHide = () => { pageActive = false; sync() }
  const pageShow = () => { pageActive = true; nativeState = null; sync() }
  const observer = new win.MutationObserver(sync)
  observer.observe(doc.body, { attributes:true, attributeFilter:['class'] })
  doc.addEventListener('visibilitychange', sync)
  doc.addEventListener('pointerdown', acquire, { passive:true })
  win.addEventListener('focus', sync)
  win.addEventListener('pagehide', pageHide)
  win.addEventListener('pageshow', pageShow)
  sync()
  return { dispose() {
    if (disposed) return
    disposed = true; active = false; epoch++
    observer.disconnect()
    doc.removeEventListener('visibilitychange', sync)
    doc.removeEventListener('pointerdown', acquire)
    win.removeEventListener('focus', sync)
    win.removeEventListener('pagehide', pageHide)
    win.removeEventListener('pageshow', pageShow)
    const previous = lock; lock = null; release(previous)
    native(false)
  } }
}
