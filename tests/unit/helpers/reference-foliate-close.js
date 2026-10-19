// Frozen from 0a4d84ea (1.7.309): FoliateReader.close() and the cursor reset of its jumps and native
// swipes, written over the reader state `s`, before they moved to rust-ui foliate_reader.rs.
export function close(s) {
  s.speechCursor?.close()
  s.speechCursor = null
  s.lengthMetadata = null
  s.resizeObserver?.disconnect()
  s.resizeObserver = null
  clearTimeout(s.resizeTimer)
  s.resizeTimer = null
  s.detachGestures()
  for (const detach of s.documentGestures) detach()
  s.documentGestures = []
  s.view?.close()
  s.view?.remove()
  s.view = null
  s.turns = { followPending:0, pageTurnPending:0 }
  s.pageTurn = Promise.resolve()
  if (s.container) { s.container.innerHTML = ''; s.container.classList.remove('foliate-reader', 'is-paginated') }
}
export function resetCursor(s) { if (!s.speechCursor?.browsing) s.speechCursor?.reset() }
