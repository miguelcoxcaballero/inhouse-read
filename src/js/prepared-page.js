// The page a book opens on, prepared while the book is still being lifted off
// the shelf. The expensive part of opening (restore the saved place, lay the
// page out, rasterise it) is done ahead of the tap and kept here, together with
// the conditions it was made under. A prepared page is only ever handed out
// when every one of those conditions still holds: showing a stale page (other
// size, other theme, a place that moved since) is worse than computing it now.

const EDGE_TOLERANCE = .5
const FRACTION_TOLERANCE = 1e-9

const sameJSON = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const sameNumber = (a, b, tolerance) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= tolerance

/**
 * The first condition that differs between the key a page was prepared under
 * and the key of the moment it is wanted, or null when the page is still valid.
 * Preparation is strict about position; only consumption of a completed page
 * may allow its whole viewport to translate without changing its pixels.
 *
 * key = { bookId, epoch, locator, fraction, location, viewport:{left,top,width,height},
 *         pixelRatio, preferences, theme, filter }
 *  - epoch: which engine instance (a different book or a reopened one is a new epoch)
 *  - locator/fraction: the saved place the page was restored to (Drive progress can change it)
 *  - location: where the reader said it was once the page was laid out
 *  - viewport/pixelRatio: the geometry the page was rasterised for
 *  - preferences/theme/filter: reading preferences, app theme and the viewport's CSS filter
 */
export function pageKeyMismatch(prepared, wanted, { allowViewportTranslation = false } = {}) {
  if (!prepared || !wanted) return 'missing'
  if (prepared.bookId !== wanted.bookId) return 'book'
  if (prepared.epoch !== wanted.epoch) return 'engine'
  if (!sameJSON(prepared.locator, wanted.locator) ||
      !sameNumber(prepared.fraction, wanted.fraction, FRACTION_TOLERANCE)) return 'saved-position'
  if (!sameJSON(prepared.location, wanted.location)) return 'reader-position'
  for (const edge of ['left', 'top', 'width', 'height']) {
    if (!Number.isFinite(prepared.viewport?.[edge]) || !Number.isFinite(wanted.viewport?.[edge])) return 'viewport'
    if (allowViewportTranslation && (edge === 'left' || edge === 'top')) continue
    if (!sameNumber(prepared.viewport?.[edge], wanted.viewport?.[edge], EDGE_TOLERANCE)) return 'viewport'
  }
  if (prepared.pixelRatio !== wanted.pixelRatio) return 'pixel-ratio'
  if (prepared.preferences !== wanted.preferences) return 'preferences'
  if (prepared.theme !== wanted.theme) return 'theme'
  if (prepared.filter !== wanted.filter) return 'filter'
  return null
}

/**
 * One prepared page at a time (there is one shared reader). `begin()` hands out
 * a ticket before the work starts; any invalidation made while the work runs
 * makes `store()` refuse the result, so a slow snapshot can never outlive the
 * event that made it wrong.
 */
export function createPreparedPageCache() {
  let generation = 0
  let entry = null
  let lastBookId = null
  let lastDiscard = null
  const discard = reason => { if (entry) lastDiscard = reason; entry = null }
  return {
    begin(bookId) {
      generation++
      discard('new-work')
      lastBookId = bookId
      return { bookId, generation }
    },
    isCurrent: ticket => Boolean(ticket) && ticket.generation === generation,
    store(ticket, key, snapshot) {
      if (!ticket || ticket.generation !== generation || !snapshot || ticket.bookId !== key?.bookId) return false
      entry = { key, snapshot }
      return true
    },
    /** Consume a matching page, rebasing a rigid translation; otherwise drop it. */
    take(key) {
      const held = entry
      entry = null
      if (!held) return null
      const mismatch = pageKeyMismatch(held.key, key, { allowViewportTranslation:true })
      if (mismatch) { lastDiscard = mismatch; return null }
      const bounds = held.snapshot.displayBounds
      const dx = key.viewport.left - held.key.viewport.left
      const dy = key.viewport.top - held.key.viewport.top
      if (!bounds || !['left', 'top', 'width', 'height'].every(edge => Number.isFinite(bounds[edge])) ||
          !(bounds.width > 0 && bounds.height > 0) ||
          !Number.isFinite(bounds.left + dx) || !Number.isFinite(bounds.top + dy)) {
        lastDiscard = 'viewport'
        return null
      }
      // A rigid translation changes where the page lands, not its laid-out
      // pixels. Keep the warmed snapshot's identity (and its GPU textures),
      // rebasing only its destination after every content/size check passed.
      // Preparation itself still uses the strict default key comparison.
      if (dx || dy) held.snapshot.displayBounds = {
        ...bounds, left:bounds.left + dx, top:bounds.top + dy
      }
      return held.snapshot
    },
    has: bookId => entry?.key.bookId === bookId,
    peek: () => entry?.snapshot ?? null,
    /** Everything: the engine changed, the window resized, the reader closed... */
    invalidate(reason = 'invalidated') {
      generation++
      discard(reason)
    },
    /** Only when `bookId` owns the page (or the work in flight): deletion, a book's own change. */
    invalidateBook(bookId, reason = 'book-changed') {
      if (entry?.key.bookId === bookId || lastBookId === bookId) this.invalidate(reason)
    },
    get lastDiscard() { return lastDiscard }
  }
}

/**
 * Holds the heavy page work back until it can no longer disturb the pull-out
 * animation. `settled` resolves true once the lifted book sits still (false when
 * the selection was cancelled); the work then waits for an idle slice. An open
 * request (`release('open')`) lets it go at once, because somebody is waiting
 * for the result; any other release (the selection was dismissed or replaced)
 * ends the wait without work. `wait()` resolves true to proceed, false to skip.
 */
export function createStageGate(settled, { idle = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  let release = () => {}
  const released = new Promise(resolve => { release = resolve })
  // No signal from the shelf (a book opened some other way): nothing to wait for.
  const settledThenIdle = settled == null ? Promise.resolve(true) : Promise.resolve(settled).then(async ok => {
    if (!ok) return false
    await idle()
    return true
  }, () => false)
  return {
    wait: () => Promise.race([released, settledThenIdle]),
    release: reason => release(reason === 'open')
  }
}
